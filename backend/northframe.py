"""
NorthTV + FrameTV integrations.

Endpoints exposed under /api/north/* and /api/frame/*.
Both keep a simple in-memory cache with TTL to avoid hammering upstream.
"""
from __future__ import annotations

import re
import time
import asyncio
import logging
from typing import Optional, List, Dict, Any

import httpx
from urllib.parse import quote
from fastapi import APIRouter, HTTPException, Query, Request

logger = logging.getLogger("livewatch.northframe")

router = APIRouter()


def _public_base(request: Request) -> str:
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    proto = request.headers.get("x-forwarded-proto") or "https"
    if host:
        return f"{proto}://{host}".rstrip("/")
    return str(request.base_url).rstrip("/")

# ============================================================
# NorthTV (northlive.lol)
# ============================================================
NORTH_API_BASE = "https://northlive.lol/api/v1/index.php"
NORTH_API_KEY = "ff_575a3531b4e190e5d8c89543e2a81a948f1b8265d8c1d53edfc631e3f8713d5f"
NORTH_HEADERS = {
    "X-API-Key": NORTH_API_KEY,
    "Accept": "application/json, text/html",
    "User-Agent": "NorthliveClient/1.0",
}

_north_cache: Dict[str, Any] = {"ts": 0, "data": []}
_north_stream_cache: Dict[str, Dict[str, Any]] = {}  # slug -> {ts, url}
NORTH_TTL = 600
NORTH_STREAM_TTL = 120

_get_http_client = None  # injected


def init(get_http_client):
    global _get_http_client
    _get_http_client = get_http_client


async def _client() -> httpx.AsyncClient:
    if _get_http_client is not None:
        return await _get_http_client()
    return httpx.AsyncClient(timeout=25.0, verify=False, follow_redirects=True)


async def _north_get(path: str) -> Any:
    sep = "&" if "?" in path else "?"
    url = f"{NORTH_API_BASE}{path}{sep}api_key={NORTH_API_KEY}"
    cli = await _client()
    r = await cli.get(url, headers=NORTH_HEADERS, timeout=25.0)
    r.raise_for_status()
    return r


async def fetch_north_channels(force: bool = False) -> List[Dict[str, Any]]:
    now = time.time()
    if not force and _north_cache["data"] and (now - _north_cache["ts"] < NORTH_TTL):
        return _north_cache["data"]

    # First page to know total_pages
    r = await _north_get("?route=tv&page=1")
    first = r.json()
    if not isinstance(first, dict) or "data" not in first:
        raise HTTPException(status_code=502, detail="north upstream bad response")
    all_data: List[Dict[str, Any]] = list(first.get("data") or [])
    total_pages = int(((first.get("pagination") or {}).get("total_pages")) or 1)

    # Fetch other pages concurrently
    async def _p(page: int):
        try:
            rr = await _north_get(f"?route=tv&page={page}")
            js = rr.json()
            return js.get("data") or []
        except Exception as e:
            logger.warning(f"north page {page} failed: {e}")
            return []

    if total_pages > 1:
        results = await asyncio.gather(*[_p(p) for p in range(2, total_pages + 1)])
        for chunk in results:
            all_data.extend(chunk)

    _north_cache["data"] = all_data
    _north_cache["ts"] = now
    return all_data


@router.get("/north/channels")
async def north_channels(country: str = Query("", description="Filter by country"),
                         category: str = Query(""),
                         search: str = Query("")):
    data = await fetch_north_channels()
    countries = sorted({c.get("country") or "" for c in data if c.get("country")})
    categories = sorted({c.get("category") or "" for c in data if c.get("category")})
    out = data
    if country:
        out = [c for c in out if (c.get("country") or "").lower() == country.lower()]
    if category:
        out = [c for c in out if (c.get("category") or "").lower() == category.lower()]
    if search:
        s = search.lower().strip()
        out = [c for c in out if s in (c.get("name") or "").lower()]
    # Sanitize: only expose slug/name/country/category/logo publicly (no api key)
    channels = [
        {
            "id": c.get("slug"),
            "slug": c.get("slug"),
            "name": c.get("name"),
            "country": c.get("country"),
            "category": c.get("category"),
            "logo": c.get("logo") or "",
            "active": bool(c.get("active", True)),
        }
        for c in out if c.get("slug")
    ]
    return {"count": len(channels), "channels": channels, "countries": countries, "categories": categories}


_M3U8_RE = re.compile(r'(https?://[^\s"\'<>\\]+\.m3u8[^\s"\'<>\\]*)', re.I)
_FIELD_RE = re.compile(r'''(?:file|source|src|hls|url)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']''', re.I)


async def _north_play_url(slug_clean: str) -> Optional[str]:
    """Call the upstream ?route=play_url (POST) endpoint — the exact same
    request the upstream JS player performs — to obtain the real stream URL.

    The upstream player page never embeds the .m3u8 directly; instead its JS
    POSTs {slug, api_key} to /api/v1/index.php?route=play_url and receives
    {"success": true, "url": "https://northlive.lol/api/tv_proxy.php?tok=...",
     "direct": false}. That token-signed URL serves a live HLS manifest with
    CORS `Access-Control-Allow-Origin: *`, so it can be played natively via
    hls.js on our frontend."""
    url = f"{NORTH_API_BASE}?route=play_url&api_key={NORTH_API_KEY}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {NORTH_API_KEY}",
        "X-API-Key": NORTH_API_KEY,
        "User-Agent": "NorthliveClient/1.0",
        "Accept": "application/json",
    }
    body = {"slug": slug_clean, "api_key": NORTH_API_KEY}
    cli = await _client()
    r = await cli.post(url, headers=headers, json=body, timeout=25.0)
    r.raise_for_status()
    try:
        js = r.json()
    except Exception:
        return None
    if isinstance(js, dict) and js.get("success") and js.get("url"):
        return js["url"]
    return None


async def resolve_north_stream(slug: str) -> Optional[str]:
    now = time.time()
    cached = _north_stream_cache.get(slug)
    if cached and (now - cached["ts"] < NORTH_STREAM_TTL):
        return cached["url"]
    slug_clean = re.sub(r"[^a-zA-Z0-9_\-]", "", slug or "")
    if not slug_clean:
        return None
    url = ""
    # 1) Best-effort: scrape a directly-embedded .m3u8 from the player HTML.
    try:
        r = await _north_get(f"?route=tv/{slug_clean}/player")
        html = r.text or ""
        clean = html.replace("\\/", "/")
        m = _M3U8_RE.search(clean)
        if m:
            url = m.group(1)
        if not url:
            m2 = _FIELD_RE.search(clean)
            if m2:
                url = m2.group(1)
    except Exception as e:
        logger.warning(f"north player scrape {slug}: {e}")
    # 2) Modern players load the m3u8 dynamically via ?route=play_url (POST).
    #    Replicate that call to obtain the real token-signed stream URL.
    if not url:
        try:
            url = await _north_play_url(slug_clean)
        except Exception as e:
            logger.warning(f"north play_url {slug}: {e}")
            url = None
    if not url:
        return None
    _north_stream_cache[slug] = {"ts": now, "url": url}
    return url


@router.get("/north/stream/{slug}")
async def north_stream(slug: str):
    slug_clean = re.sub(r"[^a-zA-Z0-9_\-]", "", slug or "")
    if not slug_clean:
        raise HTTPException(status_code=400, detail="bad slug")
    iframe_url = f"/api/north/player/{slug_clean}"
    try:
        url = await resolve_north_stream(slug)
    except Exception as e:
        logger.warning(f"north stream error {slug}: {e}")
        url = None
    if url:
        return {"success": True, "stream_url": url, "iframe_url": iframe_url, "type": "hls"}
    # No m3u8 could be extracted (JS-obfuscated player): fall back to iframe.
    return {"success": True, "stream_url": None, "iframe_url": iframe_url, "type": "iframe"}


@router.get("/north/player/{slug}")
async def north_player(slug: str):
    """Proxy the upstream player HTML so we don't leak the API key.
    Rewrites absolute /api/v1/... calls (used by the embedded JS) to a
    dedicated upstream proxy path served by this app.
    """
    from fastapi.responses import HTMLResponse, Response
    slug_clean = re.sub(r"[^a-zA-Z0-9_\-]", "", slug or "")
    if not slug_clean:
        raise HTTPException(status_code=400, detail="bad slug")
    try:
        r = await _north_get(f"?route=tv/{slug_clean}/player")
    except Exception as e:
        logger.warning(f"north player proxy {slug}: {e}")
        raise HTTPException(status_code=502, detail="upstream error")
    html = r.text or ""
    # Rewrite the api base so browser fetches hit our proxy (which appends api_key)
    html = html.replace('/api/v1/index.php', '/api/north/upstream/index.php')
    html = html.replace('/api/v1/', '/api/north/upstream/')
    # Silence the referer beacon (avoids CORS/404 noise)
    html = html.replace('tv_referer_beacon.php', 'north-upstream-noop')
    return HTMLResponse(content=html, status_code=200)


@router.api_route("/north/upstream/{path:path}",
                  methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def north_upstream(path: str, request: Request):
    from fastapi.responses import Response
    # Merge query string with api_key
    query = dict(request.query_params)
    query['api_key'] = NORTH_API_KEY
    qs = '&'.join(f"{k}={v}" for k, v in query.items())
    url = f"https://northlive.lol/api/v1/{path}?{qs}"
    body = await request.body() if request.method != 'GET' else None
    hdrs = {
        "X-API-Key": NORTH_API_KEY,
        "User-Agent": "NorthliveClient/1.0",
        "Accept": request.headers.get("accept", "*/*"),
    }
    if request.headers.get("content-type"):
        hdrs["Content-Type"] = request.headers["content-type"]
    cli = await _client()
    try:
        r = await cli.request(request.method, url, headers=hdrs, content=body, timeout=25.0)
    except Exception as e:
        logger.warning(f"north upstream {path}: {e}")
        return Response(status_code=502)
    out_headers = {}
    for k in ("content-type",):
        if k in r.headers:
            out_headers[k] = r.headers[k]
    return Response(content=r.content, status_code=r.status_code, headers=out_headers)


@router.get("/north/north-upstream-noop")
async def north_noop():
    from fastapi.responses import Response
    return Response(status_code=204)


# ============================================================
# FrameTV (frembed.asia / frembed.casa)
# ============================================================
FRAME_CATALOG_BASE = "https://frembed.asia/api/live-new/catalog"
FRAME_RESOLVE_BASE = "https://frembed.casa/api/live-new/resolve"
FRAME_MAX_CURSOR = 9300
FRAME_STEP = 300

_frame_cache: Dict[str, Any] = {"ts": 0, "data": []}
_frame_stream_cache: Dict[str, Dict[str, Any]] = {}
FRAME_TTL = 900
FRAME_STREAM_TTL = 90


async def fetch_frame_channels(force: bool = False) -> List[Dict[str, Any]]:
    now = time.time()
    if not force and _frame_cache["data"] and (now - _frame_cache["ts"] < FRAME_TTL):
        return _frame_cache["data"]

    cli = await _client()

    async def _p(cursor: int):
        try:
            r = await cli.get(f"{FRAME_CATALOG_BASE}?cursor={cursor}", timeout=20.0)
            r.raise_for_status()
            js = r.json()
            if isinstance(js, dict) and js.get("success"):
                return js.get("items") or []
        except Exception as e:
            logger.warning(f"frame cursor {cursor} failed: {e}")
        return []

    cursors = list(range(0, FRAME_MAX_CURSOR + 1, FRAME_STEP))
    # Batch to avoid overwhelming: 8 concurrent max
    all_items: List[Dict[str, Any]] = []
    sem = asyncio.Semaphore(8)

    async def _bounded(c):
        async with sem:
            return await _p(c)

    results = await asyncio.gather(*[_bounded(c) for c in cursors])
    for chunk in results:
        all_items.extend(chunk)

    # Deduplicate by id
    seen = set()
    unique: List[Dict[str, Any]] = []
    for it in all_items:
        cid = ((it.get("ids") or {}).get("id")) or it.get("url")
        if not cid or cid in seen:
            continue
        seen.add(cid)
        unique.append(it)

    _frame_cache["data"] = unique
    _frame_cache["ts"] = now
    return unique


@router.get("/frame/channels")
async def frame_channels(group: str = Query(""), search: str = Query("")):
    data = await fetch_frame_channels()
    groups = sorted({(c.get("group") or "").strip() for c in data if c.get("group")})
    out = data
    if group:
        out = [c for c in out if (c.get("group") or "").lower() == group.lower()]
    if search:
        s = search.lower().strip()
        out = [c for c in out if s in (c.get("name") or "").lower()]
    channels = [
        {
            "id": ((c.get("ids") or {}).get("id")) or (c.get("url") or ""),
            "name": c.get("name") or "",
            "group": c.get("group") or "",
            "logo": c.get("logo") or "",
            "url": c.get("url") or "",
        }
        for c in out
    ]
    return {"count": len(channels), "channels": channels, "groups": groups}


async def resolve_frame_stream(cid: str) -> Optional[str]:
    now = time.time()
    cached = _frame_stream_cache.get(cid)
    if cached and (now - cached["ts"] < FRAME_STREAM_TTL):
        return cached["url"]
    # Find URL from catalog by id
    data = await fetch_frame_channels()
    ch = next(
        (c for c in data if (((c.get("ids") or {}).get("id")) == cid) or (c.get("url") == cid)),
        None,
    )
    if not ch:
        return None
    up_url = ch.get("url")
    if not up_url:
        return None
    cli = await _client()
    r = await cli.get(f"{FRAME_RESOLVE_BASE}?url={up_url}", timeout=20.0)
    r.raise_for_status()
    js = r.json()
    if not isinstance(js, dict) or not js.get("success"):
        return None
    stream = js.get("stream")
    if not stream:
        return None
    _frame_stream_cache[cid] = {"ts": now, "url": stream}
    return stream


@router.get("/frame/stream/{cid}")
async def frame_stream(cid: str):
    try:
        url = await resolve_frame_stream(cid)
    except Exception as e:
        logger.warning(f"frame stream error {cid}: {e}")
        raise HTTPException(status_code=502, detail="frame upstream error")
    if not url:
        raise HTTPException(status_code=404, detail="stream not found")
    return {"success": True, "stream_url": url, "type": "hls"}



# ============================================================
# Public v1 (documented) endpoints — sanitized JSON with embed_url only.
# Never expose upstream URLs, API keys, or direct .m3u8 links.
# ============================================================
@router.get("/v1/public/north/channels")
async def public_north_channels(
    request: Request,
    country: str = Query(""),
    category: str = Query(""),
    search: str = Query(""),
    limit: int = Query(0),
):
    data = await fetch_north_channels()
    countries = sorted({c.get("country") or "" for c in data if c.get("country")})
    categories = sorted({c.get("category") or "" for c in data if c.get("category")})
    out = data
    if country:
        out = [c for c in out if (c.get("country") or "").lower() == country.lower()]
    if category:
        out = [c for c in out if (c.get("category") or "").lower() == category.lower()]
    if search:
        s = search.lower().strip()
        out = [c for c in out if s in (c.get("name") or "").lower()]
    base = _public_base(request)
    channels = [
        {
            "id": c.get("slug"),
            "name": c.get("name"),
            "country": c.get("country") or "",
            "category": c.get("category") or "",
            "logo": c.get("logo") or "",
            "embed_url": f"{base}/embed/north/{quote(str(c.get('slug')), safe='')}",
        }
        for c in out if c.get("slug")
    ]
    if limit and limit > 0:
        channels = channels[: max(0, min(limit, 5000))]
    return {
        "count": len(channels),
        "countries": countries,
        "categories": categories,
        "channels": channels,
    }


@router.get("/v1/public/frame/channels")
async def public_frame_channels(
    request: Request,
    group: str = Query(""),
    search: str = Query(""),
    limit: int = Query(0),
):
    data = await fetch_frame_channels()
    groups = sorted({(c.get("group") or "").strip() for c in data if c.get("group")})
    out = data
    if group:
        out = [c for c in out if (c.get("group") or "").lower() == group.lower()]
    if search:
        s = search.lower().strip()
        out = [c for c in out if s in (c.get("name") or "").lower()]
    base = _public_base(request)
    channels = []
    for c in out:
        cid = ((c.get("ids") or {}).get("id")) or (c.get("url") or "")
        if not cid:
            continue
        channels.append({
            "id": cid,
            "name": c.get("name") or "",
            "group": c.get("group") or "",
            "logo": c.get("logo") or "",
            "embed_url": f"{base}/embed/frame/{quote(str(cid), safe='')}",
        })
    if limit and limit > 0:
        channels = channels[: max(0, min(limit, 20000))]
    return {
        "count": len(channels),
        "groups": groups,
        "channels": channels,
    }
