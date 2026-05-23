"""NovaStream feature extensions: DaddyTV, Sports (streamed.pk), Football Live
(RapidAPI), Sports Info (tv247.us schedule), and the admin module to manage
RapidAPI Football keys (stored in Supabase table ``football_api_keys``).

All endpoints are mounted under the existing ``/api`` prefix via the shared
``api_router`` defined in ``server.py``.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlparse

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from daddy_channels import (
    DADDY_CHANNELS as DADDY_STATIC_CHANNELS,
    DADDY_BY_ID as DADDY_STATIC_BY_ID,
    DADDY_CATEGORIES as DADDY_STATIC_CATEGORIES,
    DADDY_COUNTRIES as DADDY_STATIC_COUNTRIES,
    daddy_embed_url,
)

logger = logging.getLogger("novastream.ext")

# These are imported lazily from server.py so we don't create a circular import.
# Callers from server.py will pass them in via ``init_extensions``.
_get_http_client = None  # type: ignore
_supabase_query = None  # type: ignore
_require_admin = None   # type: ignore
_extract_bearer = None  # type: ignore
_db = None  # type: ignore  # Motor db


def init_extensions(*, get_http_client, supabase_query, require_admin, extract_bearer, db):
    """Wire helpers from server.py into the extensions module."""
    global _get_http_client, _supabase_query, _require_admin, _extract_bearer, _db
    _get_http_client = get_http_client
    _supabase_query = supabase_query
    _require_admin = require_admin
    _extract_bearer = extract_bearer
    _db = db


# A separate router that server.py will include into its existing api_router.
ext_router = APIRouter()


# =====================================================================
# DaddyTV — dynamic version
# Channels list + m3u8 list are fetched from external JSON URLs configurable
# in the admin module (collection: app_config, doc _id="daddy"). Matched by id.
# =====================================================================
DADDY_DEFAULTS = {
    "enabled": True,
    "channels_url": "https://daddylive.li/player/player10.json",
    "m3u8_url": "https://player.cfbu247.sbs/allchannel.json",
}

# Categorization fallback (we don't have country/category info in the external JSONs).
from daddy_channels import _categorize as _daddy_categorize  # noqa: E402

_daddy_cache: Dict[str, Any] = {"ts": 0.0, "channels": [], "by_id": {}}
DADDY_TTL = 5 * 60.0  # 5 min


async def _get_daddy_config() -> Dict[str, Any]:
    if _db is None:
        return dict(DADDY_DEFAULTS)
    doc = await _db.app_config.find_one({"_id": "daddy"})
    if not doc:
        return dict(DADDY_DEFAULTS)
    return {
        "enabled": bool(doc.get("enabled", True)),
        "channels_url": (doc.get("channels_url") or DADDY_DEFAULTS["channels_url"]).strip(),
        "m3u8_url": (doc.get("m3u8_url") or DADDY_DEFAULTS["m3u8_url"]).strip(),
    }


async def _save_daddy_config(patch: Dict[str, Any]) -> Dict[str, Any]:
    cfg = await _get_daddy_config()
    cfg.update({k: v for k, v in patch.items() if k in {"enabled", "channels_url", "m3u8_url"}})
    if _db is not None:
        await _db.app_config.update_one(
            {"_id": "daddy"},
            {"$set": cfg, "$currentDate": {"updated_at": True}},
            upsert=True,
        )
    # Reset cache so next call refetches
    _daddy_cache["ts"] = 0.0
    return cfg


def _normalize_id(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def _extract_channel_rows(raw: Any) -> List[Dict[str, Any]]:
    """Accepts livewatch [{name, id, url}] OR simpler [{id, title}] formats.
    Preserves the upstream `url` field as `embed_url` when present (player10.json
    returns `https://player.cfbu247.sbs/embed/<slug>` which is the working iframe).
    NOTE: player10.json returns id=0 for every row — we ignore numeric extraction
    from the URL (slugs only) and rely on name-matching against the static catalog.
    """
    if isinstance(raw, dict):
        for k in ("channels", "data", "items", "list"):
            if isinstance(raw.get(k), list):
                raw = raw[k]
                break
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        raw_id = row.get("id") or row.get("channel_id") or row.get("ID")
        cid = _normalize_id(raw_id) if raw_id not in (0, "0", None, "") else ""
        name = (row.get("title") or row.get("name") or row.get("channel_name") or "").strip()
        if not name:
            continue
        url = (row.get("url") or row.get("link") or "").strip()
        # Only treat numeric-segment-in-path as an id if it looks like /stream-12345
        # (we explicitly skip URLs like .../embed/<slug> where any digit comes from
        # the host name, e.g. cfbu247).
        if not cid:
            m = re.search(r"(?:stream[-_]|premium|channel[-_/])(\d+)", str(url), re.I)
            if m:
                cid = m.group(1)
        # cid may still be empty here — the catalog refresh will resolve it via
        # name-matching against the static catalog.
        out.append({"id": cid, "name": name, "embed_url": url})
    return out


def _extract_m3u8_rows(raw: Any) -> Dict[str, str]:
    """Accepts [{id, m3u8_link}] OR [{id, url}] OR {id: url} formats."""
    if isinstance(raw, dict):
        # Inner list?
        for k in ("channels", "data", "items", "list"):
            if isinstance(raw.get(k), list):
                raw = raw[k]
                break
        else:
            # Object form: {id: link}
            if all(isinstance(v, str) for v in raw.values()):
                return {_normalize_id(k): v for k, v in raw.items() if v}
    if not isinstance(raw, list):
        return {}
    out: Dict[str, str] = {}
    for row in raw:
        if not isinstance(row, dict):
            continue
        cid = _normalize_id(row.get("id") or row.get("channel_id"))
        link = (
            row.get("m3u8_link") or row.get("m3u8") or row.get("link") or row.get("url") or ""
        ).strip()
        if cid and link:
            out[cid] = link
    return out


async def _refresh_daddy_catalog(force: bool = False) -> None:
    now = time.time()
    if not force and _daddy_cache["channels"] and (now - _daddy_cache["ts"] < DADDY_TTL):
        return
    cfg = await _get_daddy_config()
    if not cfg["enabled"]:
        _daddy_cache["channels"] = []
        _daddy_cache["by_id"] = {}
        _daddy_cache["ts"] = now
        return
    ch_raw = None
    m_raw = None
    try:
        if cfg["channels_url"]:
            ch_raw = await _fetch_json(cfg["channels_url"], timeout=20.0)
    except Exception as e:  # noqa: BLE001
        logger.warning("daddy channels fetch failed: %s", e)
    try:
        if cfg["m3u8_url"]:
            m_raw = await _fetch_json(cfg["m3u8_url"], timeout=20.0)
    except Exception as e:  # noqa: BLE001
        logger.warning("daddy m3u8 fetch failed: %s", e)

    dyn_rows = _extract_channel_rows(ch_raw) if ch_raw is not None else []
    m3u8_map = _extract_m3u8_rows(m_raw) if m_raw is not None else {}

    # Build a name → real numeric id lookup from our static catalog.
    name_to_id: Dict[str, str] = {}
    for c in DADDY_STATIC_CHANNELS:
        name_to_id[c["name"].lower().strip()] = c["id"]

    def _normalize_name_key(s: str) -> str:
        # Loose normalisation for fallback name matching (case + non-alnum stripped).
        return re.sub(r"[^a-z0-9]+", "", (s or "").lower())

    # Loose name index too (handles minor punctuation differences).
    loose_name_to_id: Dict[str, str] = {
        _normalize_name_key(c["name"]): c["id"] for c in DADDY_STATIC_CHANNELS
    }

    # Player10.json returns id=0 for all rows. We rely on NAME matching against the
    # static catalog to recover a real numeric id (which is also the key in the
    # m3u8 map).
    def _resolve_real_id(row: Dict[str, Any]) -> Optional[str]:
        rid = _normalize_id(row.get("id"))
        if rid and rid in m3u8_map:
            return rid
        nm = (row.get("name") or "").lower().strip()
        nid = name_to_id.get(nm)
        if nid:
            return nid
        nid = loose_name_to_id.get(_normalize_name_key(nm))
        if nid:
            return nid
        # Fallback: synthesise a stable slug-based id from the embed URL so
        # channels missing from the static catalog are still exposed (with
        # iframe-only playback — no m3u8 mapping).
        url = (row.get("embed_url") or "").strip()
        m = re.search(r"/embed/([^/?#]+)", url)
        if m:
            return f"slug-{m.group(1)}"
        return rid or None

    enriched: List[Dict[str, Any]] = []
    seen_ids: set = set()
    if dyn_rows:
        for r in dyn_rows:
            real_id = _resolve_real_id(r)
            if not real_id:
                continue
            m3u8 = m3u8_map.get(real_id)
            if real_id in seen_ids:
                continue
            seen_ids.add(real_id)
            meta = _daddy_categorize(r["name"])
            # Prefer the upstream URL from player10.json (working iframe on
            # player.cfbu247.sbs) over the constructed daddylive.li embed.
            iframe_url = (r.get("embed_url") or "").strip() or daddy_embed_url(real_id)
            enriched.append({
                "id": real_id,
                "name": r["name"],
                "category": meta["category"],
                "country": meta["country"],
                "m3u8": m3u8 or "",
                "embed_url": iframe_url,
                "has_m3u8": bool(m3u8),
            })

    # Fallback: also include any static-catalog channel that has a m3u8 entry
    # but wasn't returned by the external channels JSON.
    for c in DADDY_STATIC_CHANNELS:
        if c["id"] in seen_ids:
            continue
        m3u8 = m3u8_map.get(c["id"])
        if not m3u8:
            continue
        seen_ids.add(c["id"])
        enriched.append({
            "id": c["id"],
            "name": c["name"],
            "category": c["category"],
            "country": c["country"],
            "m3u8": m3u8,
            # No upstream embed URL available — use the legacy constructed one.
            "embed_url": daddy_embed_url(c["id"]),
            "has_m3u8": True,
        })

    # Sort by country then name (stable, predictable)
    enriched.sort(key=lambda x: (x["country"], x["name"].lower()))

    _daddy_cache["channels"] = enriched
    _daddy_cache["by_id"] = {c["id"]: c for c in enriched}
    _daddy_cache["ts"] = now


async def _daddy_catalog() -> List[Dict[str, Any]]:
    await _refresh_daddy_catalog()
    return _daddy_cache["channels"]


async def _daddy_meta() -> Dict[str, List[str]]:
    items = await _daddy_catalog()
    return {
        "countries": sorted({c["country"] for c in items}),
        "categories": sorted({c["category"] for c in items}),
    }


def _daddy_503(detail: str = "DaddyTV désactivé") -> HTTPException:
    return HTTPException(status_code=503, detail=detail)


@ext_router.get("/daddy/channels")
async def daddy_list_channels(
    search: str = Query("", description="Name substring"),
    country: str = Query("", description="Filter by country"),
    category: str = Query("", description="Filter by category"),
    limit: int = Query(0, ge=0, le=2000, description="0 = no limit"),
):
    cfg = await _get_daddy_config()
    if not cfg["enabled"]:
        raise _daddy_503()
    items = await _daddy_catalog()
    s = search.strip().lower()
    out: List[Dict[str, Any]] = []
    for c in items:
        if country and c["country"] != country:
            continue
        if category and c["category"] != category:
            continue
        if s and s not in c["name"].lower():
            continue
        out.append({
            "id": c["id"],
            "name": c["name"],
            "country": c["country"],
            "category": c["category"],
            "embed_url": c["embed_url"],
        })
    if limit > 0:
        out = out[:limit]
    meta = await _daddy_meta()
    return {
        "total": len(out),
        "countries": meta["countries"],
        "categories": meta["categories"],
        "channels": out,
    }


@ext_router.get("/daddy/channel/{channel_id}")
async def daddy_get_channel(channel_id: str):
    cfg = await _get_daddy_config()
    if not cfg["enabled"]:
        raise _daddy_503()
    await _refresh_daddy_catalog()
    c = _daddy_cache["by_id"].get(str(channel_id).strip())
    if not c:
        raise HTTPException(status_code=404, detail="Chaîne DaddyTV introuvable")
    return {
        "id": c["id"],
        "name": c["name"],
        "country": c["country"],
        "category": c["category"],
        "embed_url": c["embed_url"],
    }


@ext_router.get("/daddy/embed/{channel_id}")
async def daddy_embed(channel_id: str):
    cfg = await _get_daddy_config()
    if not cfg["enabled"]:
        raise _daddy_503()
    await _refresh_daddy_catalog()
    if str(channel_id).strip() not in _daddy_cache["by_id"]:
        raise HTTPException(status_code=404, detail="Chaîne DaddyTV introuvable")
    return {"id": channel_id, "embed_url": daddy_embed_url(channel_id)}


# -----------------------------------------------------------------------------
# DLStream resolver (mirrors the daddy.php / Wacewatch /api/direct technique)
# -----------------------------------------------------------------------------
# We call https://chat.cfbu247.sbs/api/resolve-dlstream/{channel_id}
# which returns {proxyPlaylistUrl, proxyPlayerUrl}. The proxyPlaylistUrl is a
# valid HLS (.m3u8) that we then wrap through our own /api/football/proxy.
# The proxyPlayerUrl is iframe-friendly (no frame-ancestors restriction),
# unlike player.cfbu247.sbs which only allows tv247.us and self.
DLSTREAM_BASE = "https://chat.cfbu247.sbs/api/resolve-dlstream"
DLSTREAM_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://chat.cfbu247.sbs/",
    "Accept": "application/json, */*",
}
DLSTREAM_TTL = 4 * 60.0  # 4 min
_dlstream_cache: Dict[str, Tuple[Dict[str, str], float]] = {}
_dlstream_locks: Dict[str, asyncio.Lock] = {}


# -----------------------------------------------------------------------------
# Slug → numeric channel_id resolver (player.cfbu247.sbs channelData bundle)
# -----------------------------------------------------------------------------
# Many DaddyTV channels (slug-XXX in our cache) lack a numeric ID in the static
# catalog and in player10.json (id=0). To play them, we need their REAL numeric
# channel_id which lives in the Vite bundle channelData-<hash>.js shipped by
# player.cfbu247.sbs. We discover the bundle filename from the embed HTML, then
# parse the JS to build a {slug: channel_id} map, cached for 6h.
SLUG_MAP_BASE = "https://player.cfbu247.sbs"
# Discovery slugs — we try each one in order until we find a working
# channelData-*.js asset. Rotating across multiple stable slugs guards us
# against any single one being removed from the upstream catalog.
SLUG_MAP_DISCOVERY_SLUGS = (
    "abc-usa",
    "bbc-one-uk",
    "astro-supersport-1",
    "cnn-usa",
    "espn-usa",
)
SLUG_MAP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://daddylive.li/",
    "Accept": "*/*",
}
SLUG_MAP_TTL = 6 * 3600.0  # 6h
_slug_map_cache: Dict[str, Any] = {"at": 0.0, "map": {}}
_slug_map_lock = asyncio.Lock()
_CHANNEL_DATA_RE = re.compile(r"/assets/(channelData-[A-Za-z0-9_-]+\.js)")
_SLUG_ENTRY_RE = re.compile(r'channel_id\s*:\s*"(\d+)"\s*,\s*slug\s*:\s*"([a-z0-9-]+)"')


async def _build_slug_map() -> Dict[str, str]:
    """Fetch the player.cfbu247.sbs embed HTML for one of several discovery
    slugs, find the `channelData-*.js` asset reference and parse the
    slug → numeric channel_id pairs. Tries multiple seed slugs so the
    resolver still works if one of them is removed upstream."""
    cx = await _get_http_client()
    asset_url: Optional[str] = None
    for slug in SLUG_MAP_DISCOVERY_SLUGS:
        try:
            r = await cx.get(
                f"{SLUG_MAP_BASE}/embed/{slug}",
                headers=SLUG_MAP_HEADERS,
                timeout=15.0,
                follow_redirects=True,
            )
            if r.status_code != 200:
                logger.warning("slug map seed %s HTTP %s", slug, r.status_code)
                continue
            m = _CHANNEL_DATA_RE.search(r.text)
            if not m:
                logger.warning("slug map seed %s: channelData asset not found", slug)
                continue
            asset_url = f"{SLUG_MAP_BASE}/assets/{m.group(1)}"
            logger.info("slug map seed %s -> %s", slug, m.group(1))
            break
        except Exception as e:  # noqa: BLE001
            logger.warning("slug map seed %s failed: %s", slug, e)
            continue
    if not asset_url:
        logger.warning("slug map: all discovery seeds failed")
        return {}
    try:
        r2 = await cx.get(asset_url, headers=SLUG_MAP_HEADERS, timeout=20.0, follow_redirects=True)
        if r2.status_code != 200:
            logger.warning("slug map asset HTTP %s", r2.status_code)
            return {}
        out: Dict[str, str] = {}
        for cid, slug in _SLUG_ENTRY_RE.findall(r2.text):
            if slug and cid and slug not in out:
                out[slug] = cid
        logger.info("slug map built: %s entries", len(out))
        return out
    except Exception as e:  # noqa: BLE001
        logger.warning("slug map asset fetch failed: %s", e)
        return {}


async def _get_slug_map(force: bool = False) -> Dict[str, str]:
    now = time.time()
    if (not force and _slug_map_cache["map"]
            and now - _slug_map_cache["at"] < SLUG_MAP_TTL):
        return _slug_map_cache["map"]
    async with _slug_map_lock:
        if (not force and _slug_map_cache["map"]
                and time.time() - _slug_map_cache["at"] < SLUG_MAP_TTL):
            return _slug_map_cache["map"]
        mp = await _build_slug_map()
        if mp:
            _slug_map_cache["map"] = mp
            _slug_map_cache["at"] = time.time()
        return _slug_map_cache["map"]


async def _resolve_slug_to_numeric(slug_or_id: str) -> Optional[str]:
    """Given a 'slug-XXX' ID from our catalog, return the real numeric channel_id."""
    s = (slug_or_id or "").strip()
    if not s:
        return None
    if not s.startswith("slug-"):
        return s if s.isdigit() else None
    slug = s[5:]  # strip "slug-" prefix
    mp = await _get_slug_map()
    return mp.get(slug)


def _dlstream_lock(key: str) -> asyncio.Lock:
    lk = _dlstream_locks.get(key)
    if lk is None:
        lk = asyncio.Lock()
        _dlstream_locks[key] = lk
    return lk


async def _resolve_dlstream(channel_id: str) -> Optional[Dict[str, str]]:
    """Resolve a DaddyTV numeric channel_id → {proxyPlaylistUrl, proxyPlayerUrl}.

    Cached for DLSTREAM_TTL with a per-id lock to avoid thundering herd.
    Returns None if the upstream resolver fails.
    """
    cid = str(channel_id).strip()
    if not cid:
        return None
    now = time.time()
    cached = _dlstream_cache.get(cid)
    if cached and now - cached[1] < DLSTREAM_TTL:
        return cached[0]
    async with _dlstream_lock(cid):
        cached = _dlstream_cache.get(cid)
        if cached and time.time() - cached[1] < DLSTREAM_TTL:
            return cached[0]
        cx = await _get_http_client()
        try:
            r = await cx.get(
                f"{DLSTREAM_BASE}/{cid}",
                headers=DLSTREAM_HEADERS,
                timeout=10.0,
                follow_redirects=True,
            )
            if r.status_code != 200:
                logger.warning("dlstream resolve %s -> HTTP %s", cid, r.status_code)
                return None
            data = r.json()
            if not isinstance(data, dict):
                return None
            playlist = (data.get("proxyPlaylistUrl") or "").strip()
            player = (data.get("proxyPlayerUrl") or "").strip()
            if not playlist and not player:
                return None
            out = {"proxyPlaylistUrl": playlist, "proxyPlayerUrl": player}
            _dlstream_cache[cid] = (out, time.time())
            return out
        except Exception as e:  # noqa: BLE001
            logger.warning("dlstream resolve %s failed: %s", cid, e)
            return None


@ext_router.get("/daddy/stream/{channel_id}")
async def daddy_stream(channel_id: str, request: Request):
    """Resolves the playable URLs for a DaddyTV channel.

    Returns:
        - stream_url: HLS playlist routed through our /api/daddy/proxy
          (Chrome UA + chat.cfbu247.sbs Referer + streamed segments + Range
          forwarding + forced video/mp2t content-type). PRIMARY.
        - iframe_url: chat.cfbu247.sbs/api/proxy/player URL — iframe-friendly
          fallback when HLS fails on the client.
        - embed_url: kept for backward compat (same as iframe_url).
    """
    cfg = await _get_daddy_config()
    if not cfg["enabled"]:
        raise _daddy_503()
    await _refresh_daddy_catalog()
    cid = str(channel_id).strip()
    c = _daddy_cache["by_id"].get(cid)
    if not c:
        raise HTTPException(status_code=404, detail="Chaîne DaddyTV introuvable")

    base = _public_base(request)
    stream_url = ""
    iframe_url = ""

    # 1) Prefer the DLStream resolver (matches the Wacewatch /api/direct flow).
    #    For slug-XXX channels, first resolve to numeric channel_id via the
    #    player.cfbu247.sbs channelData bundle.
    numeric_id = cid
    if cid.startswith("slug-"):
        n = await _resolve_slug_to_numeric(cid)
        if n:
            numeric_id = n

    if numeric_id and numeric_id.isdigit():
        resolved = await _resolve_dlstream(numeric_id)
        if resolved:
            if resolved.get("proxyPlaylistUrl"):
                stream_url = f"{base}/api/daddy/proxy?url={quote(resolved['proxyPlaylistUrl'], safe='')}"
            if resolved.get("proxyPlayerUrl"):
                iframe_url = resolved["proxyPlayerUrl"]

    # 2) Fallback to legacy m3u8 from allchannel.json if DLStream failed.
    if not stream_url and c.get("m3u8"):
        stream_url = f"{base}/api/daddy/proxy?url={quote(c['m3u8'], safe='')}"

    # 3) Fallback iframe = original embed_url from player10.json (last resort —
    #    note player.cfbu247.sbs has frame-ancestors CSP so it rarely works).
    if not iframe_url:
        iframe_url = c.get("embed_url") or ""

    return {
        "id": c["id"],
        "name": c["name"],
        "stream_url": stream_url,
        "iframe_url": iframe_url,
        "embed_url": iframe_url,  # backward compat
    }


# =====================================================================
# DaddyTV / DLStream HLS proxy — strictly for the orange DaddyTV button.
# Mirrors the daddytv.php technique (Chrome UA + Referer + URL rewriting
# of the m3u8 + streamed binary passthrough with Range + content-type
# forcing for obfuscated segments). DO NOT route RapidAPI football traffic
# through this — use /api/football/proxy for that.
# =====================================================================
_DADDY_PROXY_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_DADDY_REFERER = "https://chat.cfbu247.sbs/"

# Segment file extensions — the DLStream CDN obfuscates HLS chunks behind
# .js / .jpg / .pdf / .zst / .png / .woff to bypass content filters, so we
# treat any non-m3u8 response on those hosts as a TS segment.
_DADDY_SEG_EXT_RE = re.compile(
    r"\.(ts|m4s|mp4|aac|key|js|jpg|jpeg|png|pdf|zst|woff2?|gif|webp)(\?|$)",
    re.I,
)
# Domains served by the DaddyTV / DLStream pipeline. Anything else is rejected
# so this proxy can't be abused as an open-relay.
_DADDY_HOST_ALLOW_RE = re.compile(
    r"(cfbu247\.sbs|zempovlantis\.online|zampledakis\.shop|jimpenopisonline\.online"
    r"|daddylive\.li|daddylivehd\.|wikisport\.best|cdn-ed\.\w+|streamtp\d?\.)",
    re.I,
)


def _proxify_daddy(base: str, abs_url: str) -> str:
    return f"{base}/api/daddy/proxy?url={quote(abs_url, safe='')}"


@ext_router.get("/daddy/proxy")
@ext_router.head("/daddy/proxy")
async def daddy_proxy(request: Request, url: str = Query("")):
    """HLS / segment proxy dedicated to the DaddyTV (orange button) flow.

    Replicates the PHP daddytv.php behaviour:
      * Chrome desktop UA + Referer https://chat.cfbu247.sbs/.
      * Buffers + rewrites m3u8 playlists so every URL loops back here.
      * Streams binary segments via httpx cx.stream() (no in-memory buffer).
      * Forwards Range / If-None-Match for HLS seek + caching.
      * Forces Content-Type: video/mp2t for obfuscated segments (image/js/pdf).
    """
    from fastapi.responses import StreamingResponse

    if not url:
        return Response("Missing url", status_code=400)
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return Response("Invalid url", status_code=400)
    except Exception:
        return Response("Invalid url", status_code=400)

    # Open-relay guard: only proxy known DaddyTV / DLStream domains. We're
    # permissive (substring match) because the CDN rotates segment domains.
    if not _DADDY_HOST_ALLOW_RE.search(parsed.netloc):
        # Allow if host ends with .sbs / .shop / .online (DLStream rotation
        # pattern) to avoid breaking on a domain change.
        if not re.search(r"\.(sbs|shop|online|space|click|site)$", parsed.netloc, re.I):
            return Response("Host not allowed", status_code=400)

    cx = await _get_http_client()
    headers = {
        "User-Agent": _DADDY_PROXY_UA,
        "Referer": _DADDY_REFERER,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
        "Accept-Encoding": "identity",
    }
    range_hdr = request.headers.get("range")
    if range_hdr:
        headers["Range"] = range_hdr

    is_m3u8_url = (
        bool(re.search(r"\.m3u8(\?|$)", parsed.path, re.I))
        or "/playlist" in parsed.path
    )

    # ── m3u8 playlist: fetch + rewrite ───────────────────────────────────
    if is_m3u8_url:
        try:
            upstream = await cx.get(url, headers=headers, follow_redirects=True, timeout=12.0)
        except Exception as e:  # noqa: BLE001
            logger.warning("daddy proxy (m3u8) upstream failed: %s", e)
            return Response("Proxy error", status_code=502)
        if upstream.status_code != 200:
            return Response(
                f"Upstream {upstream.status_code}",
                status_code=502,
                headers={"Access-Control-Allow-Origin": "*"},
            )
        try:
            text = upstream.text
        except Exception:
            text = upstream.content.decode("utf-8", errors="ignore")
        base = _public_base(request)
        base_url = re.sub(r"[^/]*(\?.*)?$", "", url)

        def rewrite_line(line: str) -> str:
            line = line.rstrip("\r")
            if not line or line.startswith("#"):
                def _r(m):
                    u = m.group(1)
                    abs_u = u if re.match(r"^https?://", u, re.I) else base_url + u.lstrip("/")
                    return f'URI="{_proxify_daddy(base, abs_u)}"'
                return re.sub(r'URI="([^"]+)"', _r, line)
            abs_u = line if re.match(r"^https?://", line, re.I) else base_url + line.lstrip("/")
            return _proxify_daddy(base, abs_u)

        rewritten = "\n".join(rewrite_line(ln) for ln in text.split("\n"))
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Expose-Headers": "*",
            },
        )

    # ── Segment / binary passthrough (streamed) ──────────────────────────
    try:
        upstream_req = cx.stream(
            "GET", url,
            headers=headers,
            follow_redirects=True,
            timeout=httpx.Timeout(connect=8.0, read=30.0, write=10.0, pool=10.0),
        )
        upstream = await upstream_req.__aenter__()
    except Exception as e:  # noqa: BLE001
        logger.warning("daddy proxy (seg) upstream failed: %s", e)
        return Response("Proxy error", status_code=502)

    if upstream.status_code >= 400:
        body = await upstream.aread()
        await upstream.aclose()
        await upstream_req.__aexit__(None, None, None)
        return Response(
            body[:512] or f"Upstream {upstream.status_code}",
            status_code=502 if upstream.status_code >= 500 else upstream.status_code,
            headers={"Access-Control-Allow-Origin": "*"},
        )

    # Force video/mp2t for obfuscated segments served as image/js/pdf/etc.
    if _DADDY_SEG_EXT_RE.search(parsed.path) or "chat.cfbu247.sbs" in parsed.netloc or "zampledakis" in parsed.netloc:
        ct_out = "video/iso.segment" if parsed.path.lower().endswith(".m4s") else "video/mp2t"
    else:
        ct_out = upstream.headers.get("content-type") or "application/octet-stream"

    out_headers = {
        "Cache-Control": "public, max-age=30, s-maxage=60",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Expose-Headers": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    }
    for h in ("content-length", "accept-ranges", "content-range", "last-modified", "etag"):
        v = upstream.headers.get(h)
        if v:
            out_headers[h.title()] = v

    resp_status = upstream.status_code

    async def _stream():
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=64 * 1024):
                yield chunk
        finally:
            try:
                await upstream.aclose()
            except Exception:
                pass
            try:
                await upstream_req.__aexit__(None, None, None)
            except Exception:
                pass

    return StreamingResponse(
        _stream(),
        status_code=resp_status,
        media_type=ct_out,
        headers=out_headers,
    )


# Admin: Daddy config
class DaddyConfigPatch(BaseModel):
    enabled: Optional[bool] = None
    channels_url: Optional[str] = Field(None, max_length=500)
    m3u8_url: Optional[str] = Field(None, max_length=500)


@ext_router.get("/admin/daddy/config")
async def admin_daddy_get(authorization: Optional[str] = Header(None)):
    jwt = _extract_bearer(authorization)
    await _require_admin(jwt)
    cfg = await _get_daddy_config()
    items = await _daddy_catalog()
    return {
        **cfg,
        "defaults": DADDY_DEFAULTS,
        "channel_count": len(items),
        "cache_age_sec": int(time.time() - (_daddy_cache.get("ts") or 0)),
    }


@ext_router.patch("/admin/daddy/config")
async def admin_daddy_patch(body: DaddyConfigPatch, authorization: Optional[str] = Header(None)):
    jwt = _extract_bearer(authorization)
    await _require_admin(jwt)
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    cfg = await _save_daddy_config(patch)
    await _refresh_daddy_catalog(force=True)
    items = _daddy_cache["channels"]
    return {"success": True, **cfg, "channel_count": len(items)}


@ext_router.post("/admin/daddy/test")
async def admin_daddy_test(body: DaddyConfigPatch, authorization: Optional[str] = Header(None)):
    jwt = _extract_bearer(authorization)
    await _require_admin(jwt)
    cfg = await _get_daddy_config()
    cu = (body.channels_url or cfg["channels_url"]).strip()
    mu = (body.m3u8_url or cfg["m3u8_url"]).strip()
    ch_raw = await _fetch_json(cu, timeout=20.0)
    m_raw = await _fetch_json(mu, timeout=20.0)
    ch_rows = _extract_channel_rows(ch_raw) if ch_raw is not None else []
    m_map = _extract_m3u8_rows(m_raw) if m_raw is not None else {}
    matched = sum(1 for r in ch_rows if r["id"] in m_map)
    return {
        "channels_url": cu,
        "m3u8_url": mu,
        "channels_ok": ch_raw is not None,
        "m3u8_ok": m_raw is not None,
        "channels_total": len(ch_rows),
        "m3u8_total": len(m_map),
        "matched": matched,
        "sample_channel": ch_rows[0] if ch_rows else None,
        "sample_m3u8": (list(m_map.items())[0] if m_map else None),
    }


# =====================================================================
# Sports (streamed.pk)
# =====================================================================
SPORTS_BASE = "https://streamed.pk/api"
SPORTS_TTL = 120.0  # 2 min for /matches/all-today

_sports_matches_cache: Dict[str, Any] = {"data": None, "ts": 0.0}
_sports_streams_cache: Dict[str, Tuple[Any, float]] = {}
_sports_locks: Dict[str, asyncio.Lock] = {}


def _sports_lock(key: str) -> asyncio.Lock:
    lk = _sports_locks.get(key)
    if lk is None:
        lk = asyncio.Lock()
        _sports_locks[key] = lk
    return lk


async def _fetch_json(url: str, timeout: float = 15.0) -> Optional[Any]:
    cx = await _get_http_client()
    try:
        r = await cx.get(
            url,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=timeout,
        )
        if r.status_code != 200:
            return None
        return r.json()
    except Exception as e:  # noqa: BLE001
        logger.warning("fetch_json %s failed: %s", url, e)
        return None


async def _fetch_sports_matches() -> List[Dict[str, Any]]:
    now = time.time()
    cached = _sports_matches_cache
    if cached["data"] is not None and now - cached["ts"] < SPORTS_TTL:
        return cached["data"]
    async with _sports_lock("__sports_matches__"):
        cached = _sports_matches_cache
        if cached["data"] is not None and time.time() - cached["ts"] < SPORTS_TTL:
            return cached["data"]
        data = await _fetch_json(f"{SPORTS_BASE}/matches/all-today")
        if isinstance(data, list):
            matches = data
        elif isinstance(data, dict):
            matches = data.get("matches") or data.get("data") or []
        else:
            matches = []
        _sports_matches_cache["data"] = matches
        _sports_matches_cache["ts"] = time.time()
        return matches


async def _fetch_sports_streams(source: str, sid: str) -> List[Dict[str, Any]]:
    key = f"{source}_{sid}"
    cached = _sports_streams_cache.get(key)
    if cached and time.time() - cached[1] < SPORTS_TTL:
        return cached[0]
    async with _sports_lock(f"streams:{key}"):
        cached = _sports_streams_cache.get(key)
        if cached and time.time() - cached[1] < SPORTS_TTL:
            return cached[0]
        data = await _fetch_json(f"{SPORTS_BASE}/stream/{source}/{sid}")
        if isinstance(data, list):
            streams = data
        elif isinstance(data, dict):
            streams = data.get("streams") or []
        else:
            streams = []
        _sports_streams_cache[key] = (streams, time.time())
        return streams


def _format_ts_paris(ts_val: Any) -> str:
    """Format a timestamp (seconds or millis) to dd/mm HH:MM in Europe/Paris."""
    if ts_val in (None, "", 0):
        return ""
    try:
        ts = int(ts_val)
    except (TypeError, ValueError):
        # Maybe already a string
        return str(ts_val)
    if ts > 10**12:
        ts = ts // 1000
    try:
        d = datetime.fromtimestamp(ts, tz=timezone.utc) + timedelta(hours=2)
        return d.strftime("%d/%m %H:%M")
    except Exception:
        return ""


def _normalize_sports_event(m: Dict[str, Any]) -> Dict[str, Any]:
    raw_time = m.get("date") or m.get("time") or m.get("startTime") or ""
    time_str = (
        _format_ts_paris(raw_time)
        if (isinstance(raw_time, (int, float)) or (isinstance(raw_time, str) and raw_time.isdigit()))
        else str(raw_time)
    )
    teams = m.get("teams") or {}
    home_obj = teams.get("home") or {}
    away_obj = teams.get("away") or {}
    home = home_obj.get("name") or m.get("home") or m.get("team1") or ""
    away = away_obj.get("name") or m.get("away") or m.get("team2") or ""
    home_badge = (
        f"https://streamed.pk/api/images/badge/{home_obj.get('badge')}.webp"
        if home_obj.get("badge")
        else ""
    )
    away_badge = (
        f"https://streamed.pk/api/images/badge/{away_obj.get('badge')}.webp"
        if away_obj.get("badge")
        else ""
    )
    sources = []
    for i, s in enumerate(m.get("sources") or []):
        sources.append({
            "source": s.get("source") or s.get("name") or f"source-{i}",
            "id": s.get("id") or m.get("id") or "",
            "name": s.get("source") or s.get("name") or f"Stream {i + 1}",
            "embedUrl": s.get("embedUrl") or "",
        })
    return {
        "id": str(m.get("id") or f"m-{i}-{time.time()}"),
        "title": m.get("title") or (f"{home} vs {away}" if home and away else (home or away)),
        "sport": m.get("category") or m.get("sport") or "Sports",
        "league": m.get("league") or m.get("competition") or "",
        "time": time_str,
        "popular": bool(m.get("popular")),
        "isLive": bool(m.get("isLive") or m.get("live")),
        "home": home,
        "away": away,
        "homeBadge": home_badge,
        "awayBadge": away_badge,
        "sources": sources,
    }


@ext_router.get("/sports/matches")
async def sports_matches(sport: str = Query("", description="Filter by sport / category")):
    matches = await _fetch_sports_matches()
    if sport and sport.lower() != "all":
        matches = [
            m for m in matches
            if (m.get("category") or m.get("sport") or "").lower() == sport.lower()
        ]
    events = [_normalize_sports_event(m) for m in matches]
    raw = await _fetch_sports_matches()
    sports = sorted({(m.get("category") or m.get("sport") or "Sports") for m in raw})
    counts: Dict[str, int] = {}
    for m in raw:
        k = m.get("category") or m.get("sport") or "Sports"
        counts[k] = counts.get(k, 0) + 1
    live_count = sum(1 for m in raw if m.get("isLive") or m.get("live"))
    popular_count = sum(1 for m in raw if m.get("popular"))
    return {
        "total": len(events),
        "sports": sports,
        "sportCounts": counts,
        "liveCount": live_count,
        "popularCount": popular_count,
        "events": events,
    }


@ext_router.get("/sports/streams")
async def sports_streams(
    source: str = Query("", description="Source name (alpha, beta, ...)"),
    id: str = Query("", alias="id", description="Source-specific match id"),
):
    if not source or not id:
        return {"streams": []}
    streams = await _fetch_sports_streams(source, id)
    return {"streams": streams}


# =====================================================================
# Sports Info (tv247.us schedule)
# =====================================================================
INFO_UPSTREAM = "https://tv247.us/schedule.json"
INFO_TTL = 5 * 60.0
_info_cache: Dict[str, Any] = {"ts": 0.0, "days": []}


async def _fetch_info_days() -> List[Dict[str, Any]]:
    now = time.time()
    if _info_cache["days"] and now - _info_cache["ts"] < INFO_TTL:
        return _info_cache["days"]
    async with _sports_lock("__info__"):
        if _info_cache["days"] and time.time() - _info_cache["ts"] < INFO_TTL:
            return _info_cache["days"]
        raw = await _fetch_json(INFO_UPSTREAM)
        days: List[Dict[str, Any]] = []
        if isinstance(raw, dict):
            for day, payload in raw.items():
                lst = (payload or {}).get("Upcoming Events") if isinstance(payload, dict) else None
                if not isinstance(lst, list):
                    continue
                events = []
                for e in lst:
                    if not isinstance(e, dict):
                        continue
                    ev = e.get("event") or ""
                    if not ev:
                        continue
                    chans = e.get("channels") or []
                    chs = []
                    if isinstance(chans, list):
                        for c in chans:
                            if isinstance(c, dict):
                                chs.append({
                                    "channel_id": str(c.get("channel_id") or ""),
                                    "channel_name": str(c.get("channel_name") or ""),
                                })
                    events.append({
                        "time": str(e.get("time") or ""),
                        "event": str(ev),
                        "channels": chs,
                    })
                if events:
                    days.append({"day": day, "events": events})
        _info_cache["days"] = days
        _info_cache["ts"] = time.time()
        return days


@ext_router.get("/sports/info")
async def sports_info():
    days = await _fetch_info_days()
    return {"total_days": len(days), "days": days}


# =====================================================================
# Football Live (RapidAPI – football-live-streaming-api.p.rapidapi.com)
# =====================================================================
RAPID_HOST = "football-live-streaming-api.p.rapidapi.com"
RAPID_BASE = f"https://{RAPID_HOST}"
FRESH_TTL = 30 * 60.0       # 30 min
STALE_TTL = 24 * 3600.0     # 24 h SWR
MAX_PAGES = 4

# Static fallback keys (last-resort, if Supabase table is empty and FOOTBALL_API_KEYS env is absent).
STATIC_FALLBACK_KEYS = [
    "593cf48882msha51302663c0b313p1fd761jsn10b2bb751204",
    "0e0053b2edmsh887e70b522570cdp11485ejsn7a331eebf998",
    "439d6a056dmsh2cfb290c5afdd48p13670bjsn685fd3884b81",
]

# In-memory caches
_fb_keys_cache: Dict[str, Any] = {"ts": 0.0, "keys": []}
_FB_KEYS_TTL = 60.0
_fb_match_cache: Dict[str, Any] = {"ts": 0.0, "matches": []}
_fb_servers_by_mid: Dict[str, List[Dict[str, Any]]] = {}
_fb_banned: Dict[str, Dict[str, Any]] = {}  # keyId -> {until: epoch, reason}
_fb_inflight: Dict[str, "asyncio.Task[Any]"] = {}


def _utc_midnight_next() -> float:
    now = datetime.now(timezone.utc)
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return nxt.timestamp()


def _is_key_banned(kid: str) -> Tuple[bool, Optional[str]]:
    b = _fb_banned.get(kid)
    if not b:
        return False, None
    if time.time() >= b["until"]:
        _fb_banned.pop(kid, None)
        return False, None
    return True, b.get("reason")


def _ban_key(kid: str, reason: str) -> None:
    if not kid:
        return
    _fb_banned[kid] = {"until": _utc_midnight_next(), "reason": reason}


async def _load_football_keys() -> List[Dict[str, Any]]:
    now = time.time()
    if _fb_keys_cache["keys"] and now - _fb_keys_cache["ts"] < _FB_KEYS_TTL:
        return _fb_keys_cache["keys"]
    keys: List[Dict[str, Any]] = []
    try:
        r = await _supabase_query(
            "GET", "football_api_keys",
            params={
                "select": "id,api_key,enabled,label,last_status,last_used_at,last_success_at,last_error,success_count,error_count",
                "enabled": "eq.true",
                "order": "created_at.asc",
            },
        )
        if r.status_code == 200:
            rows = r.json() or []
            for row in rows:
                if row.get("api_key"):
                    keys.append({
                        "id": row["id"],
                        "api_key": row["api_key"],
                        "enabled": bool(row.get("enabled", True)),
                    })
    except Exception as e:  # noqa: BLE001
        logger.warning("load football keys (supabase) failed: %s", e)

    if not keys:
        env_keys = (os.environ.get("FOOTBALL_API_KEYS") or "").split(",")
        env_keys = [k.strip() for k in env_keys if k and len(k.strip()) >= 20]
        for k in env_keys:
            keys.append({"id": "env:" + k[:8], "api_key": k, "enabled": True})
    if not keys:
        for k in STATIC_FALLBACK_KEYS:
            keys.append({"id": "static:" + k[:8], "api_key": k, "enabled": True})

    _fb_keys_cache["keys"] = keys
    _fb_keys_cache["ts"] = now
    return keys


def _invalidate_football_keys_cache() -> None:
    _fb_keys_cache["keys"] = []
    _fb_keys_cache["ts"] = 0.0


async def _record_fb_key_result(key_id: str, status: int, ok: bool, error: Optional[str]) -> None:
    if not key_id or key_id.startswith(("env:", "static:")):
        return
    patch: Dict[str, Any] = {
        "last_status": int(status),
        "last_used_at": datetime.now(timezone.utc).isoformat(),
    }
    if ok:
        patch["last_success_at"] = datetime.now(timezone.utc).isoformat()
        patch["last_error"] = None
    else:
        patch["last_error"] = (error or "")[:300] or None
    try:
        # Increment counters via select+update (simple, fire-and-forget)
        gr = await _supabase_query(
            "GET", "football_api_keys",
            params={"id": f"eq.{key_id}", "select": "success_count,error_count"},
        )
        if gr.status_code == 200:
            rows = gr.json() or []
            if rows:
                sc = int(rows[0].get("success_count") or 0)
                ec = int(rows[0].get("error_count") or 0)
                if ok:
                    patch["success_count"] = sc + 1
                else:
                    patch["error_count"] = ec + 1
        await _supabase_query(
            "PATCH", "football_api_keys",
            params={"id": f"eq.{key_id}"},
            json=patch,
            prefer="return=minimal",
        )
    except Exception as e:  # noqa: BLE001
        logger.debug("record fb key result failed: %s", e)


async def _rapid_call(path: str) -> Optional[Any]:
    """Try each available key until one returns 200. Auto-ban 429/403 keys."""
    existing = _fb_inflight.get(path)
    if existing is not None:
        return await existing

    async def _run() -> Optional[Any]:
        keys = await _load_football_keys()
        cx = await _get_http_client()
        for k in keys:
            kid = k["id"]
            api_key = k["api_key"]
            if _is_key_banned(kid)[0]:
                continue
            try:
                r = await cx.get(
                    f"{RAPID_BASE}{path}",
                    headers={
                        "X-RapidAPI-Key": api_key,
                        "X-RapidAPI-Host": RAPID_HOST,
                        "Accept": "application/json",
                        "User-Agent": "Mozilla/5.0",
                    },
                    timeout=15.0,
                )
                if r.status_code != 200:
                    err_msg = f"HTTP {r.status_code}"
                    try:
                        j = r.json()
                        if isinstance(j, dict) and j.get("message"):
                            err_msg = j["message"]
                    except Exception:
                        pass
                    asyncio.create_task(_record_fb_key_result(kid, r.status_code, False, err_msg))
                    low = err_msg.lower()
                    if r.status_code in (429, 403) or "exceeded the" in low or "not subscribed" in low or "quota" in low:
                        _ban_key(kid, err_msg)
                    continue
                data = r.json()
                if data:
                    asyncio.create_task(_record_fb_key_result(kid, 200, True, None))
                    return data
            except Exception as e:  # noqa: BLE001
                asyncio.create_task(_record_fb_key_result(kid, 0, False, str(e)))
        return None

    task = asyncio.create_task(_run())
    _fb_inflight[path] = task
    try:
        return await task
    finally:
        _fb_inflight.pop(path, None)


def _normalize_fb_matches(raw: Any) -> List[Dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for k in ("matches", "data", "events", "results", "response"):
            if isinstance(raw.get(k), list):
                return raw[k]
        if raw.get("id"):
            return [raw]
    return []


def _make_match_id(m: Dict[str, Any]) -> str:
    if m.get("id"):
        return str(m["id"])
    if m.get("match_id"):
        return str(m["match_id"])
    home = m.get("home_team_name") or m.get("home") or "H"
    away = m.get("away_team_name") or m.get("away") or "A"
    ts = m.get("match_time") or m.get("time") or 0
    raw = f"{home}|{away}|{ts}"
    h = 0
    for ch in raw:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return f"{h:x}-{len(raw):x}"


async def _fetch_all_football(force: bool = False) -> Dict[str, Any]:
    now = time.time()
    cached_ts = _fb_match_cache.get("ts") or 0.0
    matches = _fb_match_cache.get("matches") or []
    age = now - cached_ts
    if not force and matches and age < FRESH_TTL:
        return {"matches": matches, "fetched_at": cached_ts, "from_stale": False}

    inflight_key = "__all_football_fetch__"
    pending = _fb_inflight.get(inflight_key)
    if pending is not None:
        data = await pending
        return {"matches": data or [], "fetched_at": time.time(), "from_stale": False}

    async def _run() -> Optional[List[Dict[str, Any]]]:
        all_: List[Dict[str, Any]] = []
        first = await _rapid_call("/matches")
        if not first or not isinstance(first, dict) or not isinstance(first.get("matches"), list):
            first = await _rapid_call("/live")
        if first is None:
            return None
        base = first.get("matches") if isinstance(first, dict) and isinstance(first.get("matches"), list) else _normalize_fb_matches(first)
        all_.extend(base)
        pagination = (first.get("pagination") if isinstance(first, dict) else None) or {}
        try:
            total_pages = min(MAX_PAGES, max(1, int(pagination.get("totalPages") or 1)))
        except Exception:
            total_pages = 1
        for p in range(2, total_pages + 1):
            page_data = await _rapid_call(f"/matches?page={p}")
            if page_data is None:
                break
            page_list = (
                page_data.get("matches") if isinstance(page_data, dict) and isinstance(page_data.get("matches"), list)
                else _normalize_fb_matches(page_data)
            )
            if not page_list:
                break
            all_.extend(page_list)
        return all_

    task = asyncio.create_task(_run())
    _fb_inflight[inflight_key] = task
    try:
        fresh = await task
    finally:
        _fb_inflight.pop(inflight_key, None)

    if fresh:
        _fb_match_cache["matches"] = fresh
        _fb_match_cache["ts"] = time.time()
        return {"matches": fresh, "fetched_at": _fb_match_cache["ts"], "from_stale": False}

    if matches and age < STALE_TTL:
        return {"matches": matches, "fetched_at": cached_ts, "from_stale": True}
    return {"matches": [], "fetched_at": 0.0, "from_stale": False}


def _index_servers(raw_list: List[Dict[str, Any]]) -> None:
    _fb_servers_by_mid.clear()
    for m in raw_list:
        mid = _make_match_id(m)
        srvs = m.get("servers")
        if isinstance(srvs, list) and srvs:
            _fb_servers_by_mid[mid] = srvs


def _format_fb_ts(ts: int) -> str:
    if not ts or ts <= 0:
        return "—"
    try:
        d = datetime.fromtimestamp(int(ts), tz=timezone.utc) + timedelta(hours=2)
        return d.strftime("%d %b %H:%M")
    except Exception:
        return "—"


def _pick(m: Dict[str, Any], *paths: Any) -> Any:
    """Pick first non-empty value from a list of keys or dotted paths."""
    for p in paths:
        if isinstance(p, str):
            v = m.get(p)
            if v not in (None, "", 0):
                return v
        elif isinstance(p, tuple):
            obj = m
            for step in p:
                if isinstance(obj, dict):
                    obj = obj.get(step)
                else:
                    obj = None
                    break
            if obj not in (None, "", 0):
                return obj
    return ""


def _normalize_fb_match(m: Dict[str, Any]) -> Dict[str, Any]:
    mid = _make_match_id(m)
    ts = (
        m.get("match_time") or m.get("time") or m.get("timestamp")
        or m.get("date") or m.get("startTime") or m.get("kickoff") or 0
    )
    try:
        ts = int(ts)
    except Exception:
        ts = 0
    if ts > 10**12:
        ts //= 1000
    home = _pick(m, "home_team_name", "home_team", ("home", "name"), ("homeTeam", "name"), "team1", "home") or "Home"
    away = _pick(m, "away_team_name", "away_team", ("away", "name"), ("awayTeam", "name"), "team2", "away") or "Away"
    home_logo = _pick(m, "home_team_logo", "home_logo", ("home", "logo"), ("homeTeam", "logo")) or ""
    away_logo = _pick(m, "away_team_logo", "away_logo", ("away", "logo"), ("awayTeam", "logo")) or ""
    home_score = _pick(m, "homeTeamScore", "home_score", "score_home")
    away_score = _pick(m, "awayTeamScore", "away_score", "score_away")
    league = _pick(m, "league_name", "league", "competition", "tournament") or "Football"
    league_logo = m.get("league_logo") or ""
    status = str(m.get("match_status") or m.get("status") or m.get("state") or "").lower()
    now_s = int(time.time())
    is_live = status in {"live", "inprogress", "in_progress", "1h", "2h", "ht"} or (
        ts > 0 and ts <= now_s and ts >= now_s - 2 * 3600
    )
    servers = m.get("servers") if isinstance(m.get("servers"), list) else []
    return {
        "id": mid,
        "title": f"{home} vs {away}",
        "home": home,
        "away": away,
        "home_logo": home_logo,
        "away_logo": away_logo,
        "home_score": "" if home_score in (None, "") else home_score,
        "away_score": "" if away_score in (None, "") else away_score,
        "league": league,
        "league_logo": league_logo,
        "status": status,
        "is_live": is_live,
        "timestamp": ts,
        "time_label": _format_fb_ts(ts),
        "has_servers": bool(servers),
        "server_count": len(servers),
    }


@ext_router.get("/football/matches")
async def football_matches():
    data = await _fetch_all_football()
    raw = data["matches"]
    if raw:
        _index_servers(raw)
    matches = [_normalize_fb_match(m) for m in raw]
    leagues = sorted({m["league"] for m in matches if m.get("league")})
    live = sum(1 for m in matches if m.get("is_live"))
    age = int(time.time() - data["fetched_at"]) if data.get("fetched_at") else 0
    return {
        "total": len(matches),
        "live_count": live,
        "league_count": len(leagues),
        "leagues": leagues,
        "matches": matches,
        "cache_age_sec": age,
        "from_stale": bool(data.get("from_stale")),
        "banned_keys": len(_fb_banned),
    }


@ext_router.get("/football/streams")
async def football_streams(mid: str = Query("", description="Match id from /football/matches"), request: Request = None):
    if not mid:
        return {"servers": []}
    if not _fb_servers_by_mid:
        data = await _fetch_all_football()
        if data["matches"]:
            _index_servers(data["matches"])
    servers = _fb_servers_by_mid.get(mid, [])
    base = _public_base(request) if request else ""
    out = []
    for i, s in enumerate(servers):
        url = s.get("url") or s.get("stream_url") or ""
        if not url:
            continue
        proxied = f"{base}/api/football/proxy?url={url}" if base else f"/api/football/proxy?url={url}"
        out.append({
            "name": s.get("name") or s.get("server_name") or f"Server {i + 1}",
            "url": url,           # raw upstream m3u8 (for advanced consumers)
            "stream_url": proxied,  # HLS proxy URL (frontend should use this)
            "header": s.get("header"),
        })
    return {"servers": out}


# HLS proxy: relays the upstream .m3u8 + segments, rewriting internal URLs so
# they loop back through this proxy. Required because the RapidAPI streams need
# a specific User-Agent and don't expose proper CORS headers.
#
# IMPORTANT — scope:
#   • /api/football/proxy  → RapidAPI football streams only (iPhone Safari UA).
#                            DO NOT add unrelated logic here. It's tied to the
#                            admin RapidAPI key rotation.
#   • /api/daddy/proxy     → DaddyTV / DLStream (Chrome UA + chat.cfbu247.sbs
#                            Referer + streaming + Range + masqueraded-segment
#                            content-type forcing). See the separate handler
#                            further down in this file.
_FB_PROXY_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3.1 Mobile/15E148 Safari/604.1"
)


def _proxify_fb(base: str, abs_url: str) -> str:
    return f"{base}/api/football/proxy?url={quote(abs_url, safe='')}"


@ext_router.get("/football/proxy")
async def football_proxy(request: Request, url: str = Query("")):
    from fastapi.responses import StreamingResponse  # noqa: F401

    if not url:
        return Response("Missing url", status_code=400)
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return Response("Invalid url", status_code=400)
    except Exception:
        return Response("Invalid url", status_code=400)

    cx = await _get_http_client()
    headers = {
        "User-Agent": _FB_PROXY_UA,
        "Accept": "*/*",
        "Accept-Encoding": "identity",
    }
    try:
        upstream = await cx.get(url, headers=headers, follow_redirects=True, timeout=20.0)
    except Exception as e:  # noqa: BLE001
        logger.warning("football proxy upstream failed: %s", e)
        return Response("Proxy error", status_code=502)

    if upstream.status_code != 200:
        return Response(f"Upstream {upstream.status_code}", status_code=502)

    ct = upstream.headers.get("content-type", "")
    is_m3u8 = bool(re.search(r"(mpegurl|\.m3u8(\?|$))", ct, re.I)) or bool(re.search(r"\.m3u8(\?|$)", parsed.path, re.I))

    base = _public_base(request)

    if is_m3u8:
        try:
            text = upstream.text
        except Exception:
            text = upstream.content.decode("utf-8", errors="ignore")
        base_url = re.sub(r"[^/]*(\?.*)?$", "", url)

        def rewrite_line(line: str) -> str:
            line = line.rstrip("\r")
            if not line or line.startswith("#"):
                def _r(m):
                    u = m.group(1)
                    abs_u = u if re.match(r"^https?://", u, re.I) else base_url + u.lstrip("/")
                    return f'URI="{_proxify_fb(base, abs_u)}"'
                return re.sub(r'URI="([^"]+)"', _r, line)
            abs_u = line if re.match(r"^https?://", line, re.I) else base_url + line.lstrip("/")
            return _proxify_fb(base, abs_u)

        rewritten = "\n".join(rewrite_line(ln) for ln in text.split("\n"))
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            },
        )

    is_segment = bool(re.search(r"\.(ts|m4s|mp4|aac|key)(\?|$)", parsed.path, re.I))
    cache_ctl = (
        "public, max-age=300, s-maxage=600, stale-while-revalidate=60"
        if is_segment
        else upstream.headers.get("cache-control") or "public, max-age=60"
    )
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=ct or "video/mp2t",
        headers={
            "Cache-Control": cache_ctl,
            "Access-Control-Allow-Origin": "*",
        },
    )


# =====================================================================
# Admin: manage RapidAPI Football keys (table: football_api_keys)
# =====================================================================
class FootballKeyCreate(BaseModel):
    api_key: str = Field(..., min_length=20, max_length=200)
    label: Optional[str] = Field(None, max_length=60)
    enabled: bool = True


class FootballKeyPatch(BaseModel):
    enabled: Optional[bool] = None
    label: Optional[str] = Field(None, max_length=60)


def _bearer_or_401(authorization: Optional[str]) -> str:
    return _extract_bearer(authorization)


@ext_router.get("/admin/football-keys")
async def admin_list_fb_keys(authorization: Optional[str] = Header(None)):
    jwt = _bearer_or_401(authorization)
    await _require_admin(jwt)
    r = await _supabase_query(
        "GET", "football_api_keys",
        params={
            "select": "id,api_key,label,enabled,last_status,last_used_at,last_success_at,last_error,success_count,error_count,created_at",
            "order": "created_at.asc",
        },
    )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Supabase: {r.text}")
    rows = r.json() or []
    out = []
    banned_now = {kid: v for kid, v in _fb_banned.items() if time.time() < v["until"]}
    for row in rows:
        kid = row.get("id")
        # Redact most of the key
        full = row.get("api_key") or ""
        masked = (full[:6] + "…" + full[-4:]) if len(full) > 12 else "***"
        ban = banned_now.get(kid)
        out.append({
            "id": kid,
            "label": row.get("label"),
            "api_key_masked": masked,
            "enabled": bool(row.get("enabled")),
            "last_status": row.get("last_status"),
            "last_used_at": row.get("last_used_at"),
            "last_success_at": row.get("last_success_at"),
            "last_error": row.get("last_error"),
            "success_count": row.get("success_count") or 0,
            "error_count": row.get("error_count") or 0,
            "created_at": row.get("created_at"),
            "banned_today": bool(ban),
            "banned_reason": ban.get("reason") if ban else None,
        })
    return {"total": len(out), "keys": out}


@ext_router.post("/admin/football-keys")
async def admin_add_fb_key(body: FootballKeyCreate, authorization: Optional[str] = Header(None)):
    jwt = _bearer_or_401(authorization)
    await _require_admin(jwt)
    payload = {
        "api_key": body.api_key.strip(),
        "label": (body.label or "").strip() or None,
        "enabled": bool(body.enabled),
    }
    r = await _supabase_query(
        "POST", "football_api_keys",
        json=payload,
        prefer="return=representation",
    )
    if r.status_code not in (200, 201):
        # If duplicate key (unique constraint on api_key)
        if r.status_code == 409:
            raise HTTPException(status_code=409, detail="Cette clé existe déjà")
        raise HTTPException(status_code=502, detail=f"Supabase: {r.text}")
    _invalidate_football_keys_cache()
    rows = r.json() or []
    return {"success": True, "key": rows[0] if rows else None}


@ext_router.patch("/admin/football-keys/{key_id}")
async def admin_patch_fb_key(key_id: str, body: FootballKeyPatch, authorization: Optional[str] = Header(None)):
    jwt = _bearer_or_401(authorization)
    await _require_admin(jwt)
    payload = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not payload:
        return {"success": True}
    r = await _supabase_query(
        "PATCH", "football_api_keys",
        params={"id": f"eq.{key_id}"},
        json=payload,
        prefer="return=minimal",
    )
    if r.status_code not in (200, 204):
        raise HTTPException(status_code=502, detail=f"Supabase: {r.text}")
    _invalidate_football_keys_cache()
    return {"success": True}


@ext_router.delete("/admin/football-keys/{key_id}")
async def admin_delete_fb_key(key_id: str, authorization: Optional[str] = Header(None)):
    jwt = _bearer_or_401(authorization)
    await _require_admin(jwt)
    r = await _supabase_query(
        "DELETE", "football_api_keys",
        params={"id": f"eq.{key_id}"},
        prefer="return=minimal",
    )
    if r.status_code not in (200, 204):
        raise HTTPException(status_code=502, detail=f"Supabase: {r.text}")
    _invalidate_football_keys_cache()
    return {"success": True}


# =====================================================================
# PUBLIC v1 endpoints (no auth) — for 3rd-party integrations
# =====================================================================
def _public_base(request: Request) -> str:
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    proto = request.headers.get("x-forwarded-proto") or "https"
    if host:
        return f"{proto}://{host}".rstrip("/")
    return str(request.base_url).rstrip("/")


# ---- DaddyTV public ----
@ext_router.get("/v1/public/daddy/channels")
async def public_daddy_channels(
    request: Request,
    search: str = "",
    country: str = "",
    category: str = "",
    limit: int = 0,
):
    cfg = await _get_daddy_config()
    if not cfg["enabled"]:
        return {"total": 0, "countries": [], "categories": [], "channels": []}
    items = await _daddy_catalog()
    base = _public_base(request)
    s = (search or "").strip().lower()
    out: List[Dict[str, Any]] = []
    for c in items:
        if country and c["country"] != country:
            continue
        if category and c["category"] != category:
            continue
        if s and s not in c["name"].lower():
            continue
        out.append({
            "id": c["id"],
            "name": c["name"],
            "country": c["country"],
            "category": c["category"],
            # Always our own embed page (ad gate + 18+ gate + player).
            # Never expose the upstream player.cfbu247.sbs / chat.cfbu247.sbs URL.
            "embed_url": f"{base}/embed/daddy/{quote(str(c['id']), safe='')}",
        })
    if limit and limit > 0:
        out = out[: max(0, min(limit, 2000))]
    meta = await _daddy_meta()
    return {
        "total": len(out),
        "countries": meta["countries"],
        "categories": meta["categories"],
        "channels": out,
    }


@ext_router.get("/v1/public/daddy/channel/{channel_id}")
async def public_daddy_channel(channel_id: str, request: Request):
    cfg = await _get_daddy_config()
    if not cfg["enabled"]:
        raise HTTPException(status_code=503, detail="DaddyTV désactivé")
    await _refresh_daddy_catalog()
    c = _daddy_cache["by_id"].get(str(channel_id).strip())
    if not c:
        raise HTTPException(status_code=404, detail="Chaîne DaddyTV introuvable")
    base = _public_base(request)
    return {
        "id": c["id"],
        "name": c["name"],
        "country": c["country"],
        "category": c["category"],
        "embed_url": f"{base}/embed/daddy/{quote(str(c['id']), safe='')}",
    }


@ext_router.get("/v1/public/daddy/countries")
async def public_daddy_countries():
    items = await _daddy_catalog()
    counts: Dict[str, int] = {}
    for c in items:
        counts[c["country"]] = counts.get(c["country"], 0) + 1
    countries = sorted(counts.keys())
    return {
        "total": len(countries),
        "countries": [{"country": k, "count": counts[k]} for k in countries],
    }


@ext_router.get("/v1/public/daddy/categories")
async def public_daddy_categories():
    items = await _daddy_catalog()
    counts: Dict[str, int] = {}
    for c in items:
        counts[c["category"]] = counts.get(c["category"], 0) + 1
    cats = sorted(counts.keys())
    return {
        "total": len(cats),
        "categories": [{"category": k, "count": counts[k]} for k in cats],
    }


# ---- Sports public ----
# Build an opaque base64-encoded token so the public response NEVER leaks
# the upstream source provider name. The token is a URL-safe base64 of
# "source:id". Decoded server-side in /embed/sports/t/{token}.
import base64 as _b64


def _encode_sports_token(source: str, sid: str) -> str:
    raw = f"{source}:{sid}".encode("utf-8")
    return _b64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _decode_sports_token(token: str) -> Optional[Tuple[str, str]]:
    try:
        pad = "=" * (-len(token) % 4)
        raw = _b64.urlsafe_b64decode(token + pad).decode("utf-8")
        if ":" not in raw:
            return None
        s, i = raw.split(":", 1)
        return (s.strip(), i.strip())
    except Exception:
        return None


def _public_sport_event(ev: Dict[str, Any], base: str) -> Dict[str, Any]:
    """Public-facing event: stripped of upstream source names / streamed.pk
    embed URLs. Each playable variant becomes an opaque embed URL routed
    through OUR /embed/sports/t/{token} endpoint."""
    embeds: List[Dict[str, str]] = []
    for s in (ev.get("sources") or []):
        src = s.get("source") or ""
        sid = s.get("id") or ""
        if not src or not sid:
            continue
        tok = _encode_sports_token(src, sid)
        title = quote((ev.get("title") or "").strip(), safe="")
        embed_url = f"{base}/embed/sports/t/{tok}"
        if title:
            embed_url += f"?t={title}"
        embeds.append({
            "label": f"Stream {len(embeds) + 1}",  # generic — no source name
            "embed_url": embed_url,
        })
    return {
        "id": ev.get("id"),
        "title": ev.get("title"),
        "sport": ev.get("sport"),
        "league": ev.get("league"),
        "time": ev.get("time"),
        "is_live": bool(ev.get("isLive")),
        "popular": bool(ev.get("popular")),
        "home": ev.get("home"),
        "away": ev.get("away"),
        "home_badge": ev.get("homeBadge"),
        "away_badge": ev.get("awayBadge"),
        "embeds": embeds,
    }


@ext_router.get("/v1/public/sports")
async def public_sports(request: Request, sport: str = ""):
    base = _public_base(request)
    data = await sports_matches(sport=sport)
    events_pub = [_public_sport_event(e, base) for e in (data.get("events") or [])]
    return {
        "total": len(events_pub),
        "sports": data.get("sports") or [],
        "sport_counts": data.get("sportCounts") or {},
        "live_count": data.get("liveCount") or 0,
        "popular_count": data.get("popularCount") or 0,
        "events": events_pub,
    }


def _public_football_match(m: Dict[str, Any], base: str) -> Dict[str, Any]:
    """Public-facing football match: drops raw m3u8 / stream_url, exposes
    only an opaque embed URL when servers are available."""
    out = dict(m)
    out.pop("has_servers", None)
    out.pop("server_count", None)
    embeds: List[Dict[str, str]] = []
    if m.get("server_count"):
        for i in range(int(m["server_count"])):
            tok = _b64.urlsafe_b64encode(
                f"{m['id']}:{i}".encode("utf-8")
            ).rstrip(b"=").decode("ascii")
            embeds.append({
                "label": f"Stream {i + 1}",
                "embed_url": f"{base}/embed/football/t/{tok}",
            })
    out["embeds"] = embeds
    return out


@ext_router.get("/v1/public/football")
async def public_football(request: Request):
    base = _public_base(request)
    data = await football_matches()
    matches_pub = [_public_football_match(m, base) for m in (data.get("matches") or [])]
    return {
        "total": data.get("total", 0),
        "live_count": data.get("live_count", 0),
        "league_count": data.get("league_count", 0),
        "leagues": data.get("leagues") or [],
        "matches": matches_pub,
        "cache_age_sec": data.get("cache_age_sec", 0),
    }


@ext_router.get("/v1/public/sports/info")
async def public_sports_info():
    # Info schedule (tv247.us) only references DaddyTV channels by id/name —
    # no upstream source names or streams. Pass-through is safe.
    return await sports_info()


# =====================================================================
# BossTV (api.bosstvmm.com) — football matches with multi-server m3u8 streams
# =====================================================================
BOSSTV_BASE = "https://api.bosstvmm.com/api/matches"
BOSSTV_TTL = 60.0  # 1 min — live matches turn on/off quickly

_bosstv_cache: Dict[str, Any] = {"ts": 0.0, "matches": []}
_bosstv_servers_by_mid: Dict[str, List[Dict[str, Any]]] = {}
_bosstv_meta_by_mid: Dict[str, Dict[str, Any]] = {}


def _bosstv_slug(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _make_bosstv_id(m: Dict[str, Any]) -> str:
    home = _bosstv_slug(m.get("home_team_name") or "")
    away = _bosstv_slug(m.get("away_team_name") or "")
    ts = str(m.get("match_time") or "")
    base = f"{home}-vs-{away}-{ts}"
    return base[:80] if base.strip("-") else f"bosstv-{int(time.time())}"


def _normalize_bosstv_match(m: Dict[str, Any]) -> Dict[str, Any]:
    mid = _make_bosstv_id(m)
    ts = m.get("match_time") or 0
    try:
        ts = int(ts)
    except Exception:
        ts = 0
    if ts > 10**12:
        ts //= 1000
    home = (m.get("home_team_name") or "").strip() or "?"
    away = (m.get("away_team_name") or "").strip() or "?"
    home_logo = (m.get("home_team_logo") or "").strip()
    away_logo = (m.get("away_team_logo") or "").strip()
    league = (m.get("league_name") or "").strip() or "Autre"
    status = (m.get("match_status") or "").strip().lower()
    servers_raw = m.get("servers") if isinstance(m.get("servers"), list) else []
    return {
        "id": mid,
        "title": f"{home} vs {away}",
        "home": home,
        "away": away,
        "home_logo": home_logo,
        "away_logo": away_logo,
        "league": league,
        "status": status,
        "is_live": status == "live",
        "is_finished": status == "finished",
        "timestamp": ts,
        "time_label": _format_fb_ts(ts) if ts else "",
        "has_servers": bool(servers_raw),
        "server_count": len(servers_raw),
    }


async def _fetch_bosstv_matches() -> Dict[str, Any]:
    """Returns {'matches': [raw...], 'fetched_at': ts}."""
    now = time.time()
    if _bosstv_cache["matches"] and now - _bosstv_cache["ts"] < BOSSTV_TTL:
        return {"matches": _bosstv_cache["matches"], "fetched_at": _bosstv_cache["ts"]}
    async with _sports_lock("__bosstv__"):
        if _bosstv_cache["matches"] and time.time() - _bosstv_cache["ts"] < BOSSTV_TTL:
            return {"matches": _bosstv_cache["matches"], "fetched_at": _bosstv_cache["ts"]}
        cx = await _get_http_client()
        matches_raw: List[Dict[str, Any]] = []
        try:
            r = await cx.get(
                BOSSTV_BASE,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "application/json",
                },
                timeout=15.0,
            )
            if r.status_code == 200:
                data = r.json()
                if isinstance(data, dict):
                    if isinstance(data.get("today"), list):
                        matches_raw = data["today"]
                    else:
                        for v in data.values():
                            if isinstance(v, list):
                                matches_raw.extend(v)
                elif isinstance(data, list):
                    matches_raw = data
        except Exception as e:  # noqa: BLE001
            logger.warning("bosstv fetch failed: %s", e)
            return {"matches": _bosstv_cache["matches"], "fetched_at": _bosstv_cache["ts"]}
        _bosstv_cache["matches"] = matches_raw
        _bosstv_cache["ts"] = time.time()
        # Re-index servers by mid
        _bosstv_servers_by_mid.clear()
        _bosstv_meta_by_mid.clear()
        for m in matches_raw:
            mid = _make_bosstv_id(m)
            servers = m.get("servers") if isinstance(m.get("servers"), list) else []
            cleaned: List[Dict[str, Any]] = []
            for i, s in enumerate(servers):
                if not isinstance(s, dict):
                    continue
                url = s.get("stream_url") or s.get("url") or s.get("link") or ""
                if not url:
                    continue
                cleaned.append({
                    "name": s.get("name") or f"Server {i + 1}",
                    "stream_url": url,
                })
            _bosstv_servers_by_mid[mid] = cleaned
            _bosstv_meta_by_mid[mid] = _normalize_bosstv_match(m)
        return {"matches": matches_raw, "fetched_at": _bosstv_cache["ts"]}


@ext_router.get("/bosstv/matches")
async def bosstv_matches(
    status: str = Query("", description="live | vs | finished | empty for all"),
    league: str = Query(""),
    search: str = Query(""),
):
    data = await _fetch_bosstv_matches()
    raw = data["matches"]
    matches = [_normalize_bosstv_match(m) for m in raw]
    if status:
        matches = [m for m in matches if m.get("status") == status.lower()]
    if league:
        matches = [m for m in matches if m.get("league") == league]
    if search:
        q = search.strip().lower()
        if q:
            matches = [
                m for m in matches
                if q in (m.get("home") or "").lower()
                or q in (m.get("away") or "").lower()
                or q in (m.get("league") or "").lower()
                or q in (m.get("title") or "").lower()
            ]
    # Group counts
    leagues = sorted({m["league"] for m in matches if m.get("league")})
    live = sum(1 for m in matches if m.get("is_live"))
    finished = sum(1 for m in matches if m.get("is_finished"))
    upcoming = len(matches) - live - finished
    age = int(time.time() - data["fetched_at"]) if data.get("fetched_at") else 0
    return {
        "total": len(matches),
        "live_count": live,
        "upcoming_count": upcoming,
        "finished_count": finished,
        "league_count": len(leagues),
        "leagues": leagues,
        "matches": matches,
        "cache_age_sec": age,
    }


@ext_router.get("/bosstv/streams")
async def bosstv_streams(mid: str = Query("", description="Match id from /bosstv/matches")):
    if not mid:
        return {"servers": []}
    # Ensure cache is hot
    if not _bosstv_servers_by_mid:
        await _fetch_bosstv_matches()
    servers = _bosstv_servers_by_mid.get(mid, [])
    return {"servers": servers}


def _public_bosstv_match(m: Dict[str, Any], base: str) -> Dict[str, Any]:
    """Public BossTV: hides server URLs, exposes opaque embed tokens."""
    out = dict(m)
    out.pop("has_servers", None)
    out.pop("server_count", None)
    embeds: List[Dict[str, str]] = []
    if m.get("server_count"):
        for i in range(int(m["server_count"])):
            tok = _b64.urlsafe_b64encode(
                f"{m['id']}:{i}".encode("utf-8")
            ).rstrip(b"=").decode("ascii")
            embeds.append({
                "label": f"Stream {i + 1}",
                "embed_url": f"{base}/embed/bosstv/t/{tok}",
            })
    out["embeds"] = embeds
    return out


@ext_router.get("/v1/public/bosstv")
async def public_bosstv(request: Request, status: str = ""):
    base = _public_base(request)
    data = await bosstv_matches(status=status, league="", search="")
    matches_pub = [_public_bosstv_match(m, base) for m in (data.get("matches") or [])]
    return {
        "total": data.get("total", 0),
        "live_count": data.get("live_count", 0),
        "upcoming_count": data.get("upcoming_count", 0),
        "finished_count": data.get("finished_count", 0),
        "league_count": data.get("league_count", 0),
        "leagues": data.get("leagues") or [],
        "matches": matches_pub,
        "cache_age_sec": data.get("cache_age_sec", 0),
    }
