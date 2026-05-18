from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse, PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import time
import re
from pathlib import Path
from typing import Optional, List, Dict, Any
from urllib.parse import quote
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="NovaStream API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("novastream")

# ----------------- Upstream proxy logic (source hidden) -----------------
UPSTREAM_BASES = ["https://vavoo.to", "https://kool.to"]
PING_URLS = ["https://www.vavoo.tv/api/app/ping", "https://www.lokke.app/api/app/ping"]
USER_AGENT_STREAM = "VAVOO/2.6"
LANG = "fr"
REGION = "US"  # US returns broad multi-country catalog
CLIENT_VERSION = "3.0.2"
COUNTRY_SEPARATORS = ['➾', '⟾', '->', '→', '»', '›']

_cache: Dict[str, Any] = {
    "sig": None,
    "sig_exp": 0,
    "channels": None,
    "channels_exp": 0,
}

# Category keyword mapping (French-leaning)
CATEGORY_KEYWORDS = {
    "Sport": ["sport", "bein", "rmc sport", "eurosport", "canal+ sport", "infosport", "l'equipe", "lequipe", "espn", "dazn", "ligue 1", "ligue1"],
    "Info": ["info", "news", "lci", "bfm", "cnews", "franceinfo", "france info", "i24", "euronews", "cnn", "tv5"],
    "Cinéma": ["cine", "ciné", "film", "movie", "ocs", "canal+ cinema", "tcm", "action", "frisson", "premier", "paramount", "warner"],
    "Jeunesse": ["junior", "kids", "gulli", "tiji", "boomerang", "cartoon", "nickelodeon", "disney", "tfou", "boing", "piwi", "tilou", "okoo"],
    "Divertissement": ["tf1", "m6", "tmc", "tfx", "w9", "6ter", "c8", "cstar", "nrj12", "mtv", "comedy", "paris premiere"],
    "Documentaire": ["doc", "history", "discovery", "national geo", "nat geo", "rmc decouverte", "rmc découverte", "ushuaia", "planète", "planete", "science", "animal"],
    "Musique": ["music", "musique", "mtv", "trace", "mcm", "m6 music", "nrj hits", "melody"],
    "Généralistes": ["france 2", "france 3", "france 4", "france 5", "france ô", "arte", "tf1", "m6", "rts", "rtbf", "rtl", "tva"],
}

def _categorize(name: str) -> List[str]:
    n = (name or "").lower()
    cats = []
    for cat, kws in CATEGORY_KEYWORDS.items():
        for kw in kws:
            if kw in n:
                cats.append(cat)
                break
    if not cats:
        cats = ["Généralistes"]
    return cats

def _extract_country(group: str) -> str:
    raw = (group or "").strip()
    if not raw:
        return "default"
    for sep in COUNTRY_SEPARATORS:
        if sep in raw:
            part = raw.split(sep)[0].strip()
            return part or "default"
    return raw

def _ping_payload():
    ts = int(time.time() * 1000)
    return {
        "reason": "app-focus",
        "locale": LANG,
        "theme": "dark",
        "metadata": {
            "device": {"type": "desktop", "uniqueId": f"node-{ts}"},
            "os": {"name": "linux", "version": "Linux", "abis": ["x64"], "host": "node"},
            "app": {"platform": "electron"},
            "version": {"package": "tv.vavoo.app", "binary": "3.1.8", "js": "3.1.8"},
        },
        "appFocusTime": 0,
        "playerActive": False,
        "playDuration": 0,
        "devMode": False,
        "hasAddon": True,
        "castConnected": False,
        "package": "tv.vavoo.app",
        "version": "3.1.8",
        "process": "app",
        "firstAppStart": ts,
        "lastAppStart": ts,
        "ipLocation": None,
        "adblockEnabled": True,
        "proxy": {"supported": ["ss"], "engine": "Mu", "enabled": False, "autoServer": True},
        "iap": {"supported": False},
    }

async def get_signature() -> str:
    now = time.time()
    if _cache["sig"] and _cache["sig_exp"] > now:
        return _cache["sig"]
    payload = _ping_payload()
    async with httpx.AsyncClient(timeout=20, verify=False) as cx:
        for url in PING_URLS:
            try:
                r = await cx.post(url, json=payload)
                r.raise_for_status()
                data = r.json()
                sig = data.get("addonSig")
                if sig:
                    _cache["sig"] = sig
                    _cache["sig_exp"] = now + 300
                    return sig
            except Exception as e:
                logger.warning(f"ping failed {url}: {e}")
    raise HTTPException(status_code=502, detail="Service indisponible (auth)")

def _catalog_headers(sig: str) -> Dict[str, str]:
    return {
        "content-type": "application/json; charset=utf-8",
        "mediahubmx-signature": sig,
        "user-agent": "MediaHubMX/2",
        "accept": "*/*",
        "Accept-Language": LANG,
        "Accept-Encoding": "gzip, deflate",
        "Connection": "close",
    }

async def _load_catalog(base: str, sig: str) -> List[Dict[str, Any]]:
    url = f"{base.rstrip('/')}/mediahubmx-catalog.json"
    channels: List[Dict[str, Any]] = []
    cursor = None
    async with httpx.AsyncClient(timeout=30, verify=False) as cx:
        while True:
            body = {
                "language": LANG,
                "region": REGION,
                "catalogId": "iptv",
                "id": "iptv",
                "adult": False,
                "search": "",
                "sort": "",
                "filter": {},
                "cursor": cursor,
                "clientVersion": CLIENT_VERSION,
            }
            r = await cx.post(url, headers=_catalog_headers(sig), json=body)
            r.raise_for_status()
            data = r.json()
            for item in (data.get("items") or []):
                if item.get("type") == "iptv" and item.get("url"):
                    cid = str((item.get("ids") or {}).get("id") or item.get("id") or item.get("url"))
                    name = item.get("name") or "Chaîne"
                    group = item.get("group") or ""
                    channels.append({
                        "id": cid,
                        "url": item["url"],
                        "name": name,
                        "logo": item.get("logo") or "",
                        "group": group,
                        "country": _extract_country(group),
                        "categories": _categorize(name),
                    })
            cursor = data.get("nextCursor")
            if not cursor:
                break
    return channels

async def get_channels(force: bool = False) -> List[Dict[str, Any]]:
    now = time.time()
    if not force and _cache["channels"] and _cache["channels_exp"] > now:
        return _cache["channels"]
    sig = await get_signature()
    last_err = None
    for base in UPSTREAM_BASES:
        try:
            ch = await _load_catalog(base, sig)
            _cache["channels"] = ch
            _cache["channels_exp"] = now + 300
            logger.info(f"channels loaded: {len(ch)}")
            return ch
        except Exception as e:
            logger.warning(f"catalog failed {base}: {e}")
            last_err = e
    raise HTTPException(status_code=502, detail=f"Impossible de charger les chaînes: {last_err}")

async def resolve_stream(channel_url: str) -> str:
    sig = await get_signature()
    async with httpx.AsyncClient(timeout=20, verify=False) as cx:
        for base in UPSTREAM_BASES:
            url = f"{base.rstrip('/')}/mediahubmx-resolve.json"
            try:
                r = await cx.post(url, headers=_catalog_headers(sig), json={
                    "language": LANG,
                    "region": REGION,
                    "url": channel_url,
                    "clientVersion": CLIENT_VERSION,
                })
                r.raise_for_status()
                data = r.json()
                if isinstance(data, list) and data and data[0].get("url"):
                    return data[0]["url"]
                if isinstance(data, dict):
                    if data.get("url"):
                        return data["url"]
                    if data.get("streamUrl"):
                        return data["streamUrl"]
            except Exception as e:
                logger.warning(f"resolve failed {base}: {e}")
    raise HTTPException(status_code=502, detail="Flux non disponible")

# ----------------- API Routes -----------------
@api_router.get("/")
async def root():
    return {"app": "NovaStream", "status": "ok"}

@api_router.get("/countries")
async def list_countries():
    channels = await get_channels()
    countries = sorted({c["country"] for c in channels if c["country"] and c["country"] != "default"})
    return {"countries": countries}

@api_router.get("/categories")
async def list_categories():
    return {"categories": list(CATEGORY_KEYWORDS.keys())}

@api_router.get("/channels")
async def list_channels(
    country: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=2000),
):
    channels = await get_channels()
    out = channels
    if country:
        cl = country.lower()
        out = [c for c in out if c["country"].lower() == cl]
    if category:
        out = [c for c in out if category in c["categories"]]
    if search:
        s = search.lower()
        out = [c for c in out if s in c["name"].lower()]
    # Sanitize output (hide upstream url)
    cleaned = [{
        "id": c["id"],
        "name": c["name"],
        "logo": c["logo"],
        "country": c["country"],
        "categories": c["categories"],
    } for c in out[:limit]]
    return {"total": len(cleaned), "channels": cleaned}

@api_router.get("/stream/{channel_id}")
async def get_stream_url(channel_id: str):
    """Resolve and return the HLS URL through our proxy (source hidden)."""
    channels = await get_channels()
    channel = next((c for c in channels if c["id"] == channel_id), None)
    if not channel:
        raise HTTPException(status_code=404, detail="Chaîne introuvable")
    upstream = await resolve_stream(channel["url"])
    # Return a proxied URL so the source domain is hidden from frontend
    return {
        "id": channel_id,
        "name": channel["name"],
        "proxy_url": f"/api/hls?u={quote(upstream, safe='')}",
    }

@api_router.get("/hls")
async def hls_proxy(u: str):
    """Proxy HLS playlists & segments, rewriting URLs so the source stays hidden."""
    try:
        async with httpx.AsyncClient(timeout=30, verify=False, follow_redirects=True) as cx:
            r = await cx.get(u, headers={"User-Agent": USER_AGENT_STREAM, "Connection": "close"})
            ct = r.headers.get("content-type", "").lower()
            is_m3u8 = "mpegurl" in ct or "application/vnd.apple" in ct or u.lower().split("?")[0].endswith(".m3u8")
            if is_m3u8:
                text = r.text
                rewritten = _rewrite_m3u8(text, u)
                return PlainTextResponse(rewritten, media_type="application/vnd.apple.mpegurl")
            # Binary segment: stream back
            return StreamingResponse(
                _stream_bytes(r.content),
                media_type=r.headers.get("content-type", "application/octet-stream"),
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Erreur de flux: {e}")

async def _stream_bytes(data: bytes):
    yield data

def _rewrite_m3u8(playlist: str, base_url: str) -> str:
    out_lines = []
    for line in playlist.splitlines():
        s = line.strip()
        if not s:
            out_lines.append(line)
            continue
        if s.startswith("#"):
            # Rewrite URI="..." attributes (keys, maps)
            def repl(m):
                uri = m.group(1)
                if re.match(r"^(data|urn|skd):", uri, re.I):
                    return f'URI="{uri}"'
                abs_url = _absolute_url(uri, base_url)
                return f'URI="/api/hls?u={quote(abs_url, safe="")}"'
            new_line = re.sub(r'URI="([^"]+)"', repl, line)
            out_lines.append(new_line)
        else:
            if re.match(r"^(data|urn|skd):", s, re.I):
                out_lines.append(line)
            else:
                abs_url = _absolute_url(s, base_url)
                out_lines.append(f"/api/hls?u={quote(abs_url, safe='')}")
    return "\n".join(out_lines) + "\n"

def _absolute_url(uri: str, base: str) -> str:
    from urllib.parse import urljoin
    return urljoin(base, uri)

# ----------------- App setup -----------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
