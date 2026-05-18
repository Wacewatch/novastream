from fastapi import FastAPI, APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, PlainTextResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import time
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from urllib.parse import quote
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="LiveWatch API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("livewatch")

# ----------------- Shared HTTP client (connection pool) -----------------
# A single AsyncClient is reused for ALL upstream requests so we benefit from
# connection keep-alive. This is critical to scale to 1000+ concurrent viewers.
_http_client: Optional[httpx.AsyncClient] = None

async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            verify=False,
            follow_redirects=True,
            limits=httpx.Limits(
                max_keepalive_connections=200,
                max_connections=500,
                keepalive_expiry=60.0,
            ),
            http2=False,
        )
    return _http_client

# ----------------- Upstream proxy logic (source hidden) -----------------
UPSTREAM_BASES = ["https://vavoo.to", "https://kool.to"]
# IMPORTANT: lokke.app MUST be tried first. The vavoo.tv ping endpoint returns
# a "free-tier" signature that makes the upstream serve the LOKKE-promo ad stream
# instead of the real channel. lokke.app ping returns the working signature.
PING_URLS = ["https://www.lokke.app/api/app/ping", "https://www.vavoo.tv/api/app/ping"]
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

# Resolved stream URL cache. Vavoo signed URLs are usually valid 5+ minutes.
# Caching for 240 s means that even if 1000 clients ask for the same channel
# in the same minute, we only do ONE upstream resolve call.
RESOLVE_TTL = 240
_resolve_cache: Dict[str, Tuple[str, float]] = {}
_resolve_locks: Dict[str, asyncio.Lock] = {}

# Micro-cache for HLS playlists (the .m3u8 file). The playlist updates every
# segment-duration (~6 s) so we cache it for 2 s to coalesce concurrent viewers
# on the same channel. Segments (.ts) are NOT cached (they would explode RAM).
HLS_PLAYLIST_TTL = 2.0
_hls_cache: Dict[str, Tuple[bytes, str, float]] = {}
_hls_locks: Dict[str, asyncio.Lock] = {}

# ===== View tracking =====
# A "view" is recorded each time the FE resolves a stream URL via
# /api/stream/{id}. Stored in MongoDB so it survives restarts. A TTL index on
# `ts` removes documents older than 24h automatically.
LIVE_WINDOW = timedelta(minutes=5)   # what counts as "currently watching"
STATS_TTL = 8.0                       # cache stats aggregation for 8 s
_stats_cache: Dict[str, Any] = {"data": None, "exp": 0.0}
_stats_lock = asyncio.Lock()

async def _ensure_views_index() -> None:
    try:
        await db.views.create_index("ts", expireAfterSeconds=24 * 3600)
        await db.views.create_index([("channel_id", 1), ("ts", -1)])
    except Exception as e:
        logger.warning(f"views index init failed: {e}")

async def _record_view(channel_id: str) -> None:
    try:
        await db.views.insert_one({
            "channel_id": channel_id,
            "ts": datetime.now(timezone.utc),
        })
    except Exception as e:
        logger.warning(f"record view failed: {e}")

async def _compute_stats() -> Dict[str, Any]:
    """Aggregate live and 24h view counts. Cached for STATS_TTL seconds."""
    now = time.time()
    if _stats_cache["data"] and _stats_cache["exp"] > now:
        return _stats_cache["data"]
    async with _stats_lock:
        if _stats_cache["data"] and _stats_cache["exp"] > time.time():
            return _stats_cache["data"]
        live_threshold = datetime.now(timezone.utc) - LIVE_WINDOW
        # 24h total (the TTL index keeps the collection at 24h naturally)
        try:
            total_24h = await db.views.count_documents({})
        except Exception:
            total_24h = 0
        # Per-channel live counts
        per_channel: Dict[str, int] = {}
        try:
            pipeline = [
                {"$match": {"ts": {"$gte": live_threshold}}},
                {"$group": {"_id": "$channel_id", "n": {"$sum": 1}}},
            ]
            async for row in db.views.aggregate(pipeline):
                per_channel[row["_id"]] = row["n"]
        except Exception as e:
            logger.warning(f"stats aggregate failed: {e}")
        live_total = sum(per_channel.values())
        data = {
            "total_24h": total_24h,
            "live_total": live_total,
            "per_channel": per_channel,
        }
        _stats_cache["data"] = data
        _stats_cache["exp"] = time.time() + STATS_TTL
        return data

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

# ===== TV-LOGO repository lookup =====
# We use the public github.com/tv-logo/tv-logos repository which contains ~200
# French channel logos (and many for other countries). At startup we fetch the
# directory listing for the countries we care about and build a slug -> URL
# map. Per-channel logo guessing is then a fast in-memory lookup, no network
# call. Unknown channels fall back to the empty string (FE shows TV icon).
TV_LOGO_BASE = "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries"
TV_LOGO_API = "https://api.github.com/repos/tv-logo/tv-logos/contents/countries"

# Country display name -> (github folder slug, file suffix code)
_LOGO_COUNTRY_MAP = {
    "France": ("france", "fr"),
    "Germany": ("germany", "de"),
    "Italy": ("italy", "it"),
    "Spain": ("spain", "es"),
    "United Kingdom": ("united-kingdom", "uk"),
    "United States": ("united-states", "us"),
    "Portugal": ("portugal", "pt"),
    "Netherlands": ("netherlands", "nl"),
    "Belgium": ("belgium", "be"),
    "Switzerland": ("switzerland", "ch"),
    "Poland": ("poland", "pl"),
    "Turkey": ("turkey", "tr"),
    "Greece": ("greece", "gr"),
    "Austria": ("austria", "at"),
    "Sweden": ("sweden", "se"),
    "Denmark": ("denmark", "dk"),
    "Norway": ("norway", "no"),
    "Finland": ("finland", "fi"),
    "Ireland": ("ireland", "ie"),
    "Romania": ("romania", "ro"),
    "Brazil": ("brazil", "br"),
    "Mexico": ("mexico", "mx"),
    "Canada": ("canada", "ca"),
    "Australia": ("australia", "au"),
    "India": ("india", "in"),
    "Russia": ("russia", "ru"),
    "Ukraine": ("ukraine", "ua"),
    "Albania": ("albania", "al"),
}

# country -> { slug_without_country_suffix: filename } loaded at startup
_LOGO_INDEX: Dict[str, Dict[str, str]] = {}

def _slugify(text: str) -> str:
    """Channel-name slug: lowercase, accent-stripped, kebab-case, '+' -> 'plus'."""
    import unicodedata
    s = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = s.replace("+", " plus ").replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s

# Words stripped from candidate slugs before lookup (resolution/quality/region/etc.)
_SLUG_STOPWORDS = {
    "hd", "fhd", "uhd", "4k", "sd",
    "channel", "tv", "the",
    "backup", "main", "alt", "only",
}

def _candidate_slugs(name: str) -> List[str]:
    """Generate ordered candidate slugs for a channel display name."""
    base = _slugify(name)
    if not base:
        return []
    parts = [p for p in base.split("-") if p]
    cand = ["-".join(parts)]
    pruned = [p for p in parts if p not in _SLUG_STOPWORDS]
    if pruned and pruned != parts:
        cand.append("-".join(pruned))
    if pruned and pruned[-1].isdigit() and len(pruned) > 1:
        cand.append("-".join(pruned[:-1]))
    seen = set()
    out = []
    for s in cand:
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out

def _guess_logo(name: str, country: str) -> str:
    info = _LOGO_COUNTRY_MAP.get(country)
    if not info:
        return ""
    folder, _code = info
    index = _LOGO_INDEX.get(country)
    if not index:
        return ""
    for slug in _candidate_slugs(name):
        fname = index.get(slug)
        if fname:
            return f"{TV_LOGO_BASE}/{folder}/{fname}"
    return ""

async def _refresh_logo_index() -> None:
    """Populate _LOGO_INDEX by listing each country's folder once at startup.
    Failure is non-fatal (we just won't have logos for that country)."""
    cx = await get_http_client()
    for display, (folder, code) in _LOGO_COUNTRY_MAP.items():
        try:
            r = await cx.get(f"{TV_LOGO_API}/{folder}", timeout=15.0)
            if r.status_code != 200:
                continue
            payload = r.json()
            files = payload if isinstance(payload, list) else []
            cc_suffix = f"-{code}"
            slug_map: Dict[str, str] = {}
            for f in files:
                fname = f.get("name") or ""
                if not fname.endswith(".png"):
                    continue
                stem = fname[:-4]
                if stem.endswith(cc_suffix):
                    key = stem[: -len(cc_suffix)]
                else:
                    key = stem
                slug_map[key] = fname
                # Also index without inner language markers sometimes present.
                for marker in ("-french", "-deutsch", "-italiano", "-espanol"):
                    if marker in key:
                        slug_map[key.replace(marker, "")] = fname
            _LOGO_INDEX[display] = slug_map
            logger.info(f"logo index {display}: {len(slug_map)} entries")
        except Exception as e:
            logger.warning(f"logo index failed for {display}: {e}")



# Channel name suffix -> source label.
# Vavoo encodes the broadcast source as a 1-letter suffix at the end of the
# channel name (".b" / ".c" / ".s" mostly).
_SOURCE_LABELS = {
    "b": "basic",        # free / standard
    "c": "cable",        # cable distribution
    "s": "satellite",    # satellite
    "t": "terrestrial",  # DVB-T / TNT (very rare in the catalog)
    "i": "iptv",         # IPTV / OTT
    "h": "hd",
    "f": "fhd",
}

_NAME_SUFFIX_RE = re.compile(r"\s\.([A-Za-z]{1,3})\s*$")

# Quality keywords (longer first to avoid HD matching FHD)
_QUALITY_PATTERNS = [
    ("4K",  re.compile(r"\b(?:4K|UHD)\b", re.I)),
    ("FHD", re.compile(r"\b(?:FHD|FULLHD|FULL\s?HD|1080P)\b", re.I)),
    ("HD",  re.compile(r"\b(?:HD|720P)\b", re.I)),
]

def _detect_quality(name: str) -> Optional[str]:
    if not name:
        return None
    for label, rx in _QUALITY_PATTERNS:
        if rx.search(name):
            return label
    return None

def _clean_name_and_source(raw_name: str) -> Tuple[str, Optional[str]]:
    name = (raw_name or "").strip()
    if not name:
        return name, None
    m = _NAME_SUFFIX_RE.search(name)
    if not m:
        return name, None
    code = m.group(1).lower()
    label = _SOURCE_LABELS.get(code)
    # Strip the suffix from the display name (always, even if unknown code)
    cleaned = _NAME_SUFFIX_RE.sub("", name).rstrip(" .")
    return (cleaned or name), label

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
    cx = await get_http_client()
    for url in PING_URLS:
        try:
            r = await cx.post(url, json=payload, timeout=20.0)
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
    cx = await get_http_client()
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
        r = await cx.post(url, headers=_catalog_headers(sig), json=body, timeout=30.0)
        r.raise_for_status()
        data = r.json()
        for item in (data.get("items") or []):
            if item.get("type") == "iptv" and item.get("url"):
                raw_cid = str((item.get("ids") or {}).get("id") or item.get("id") or "")
                # Always derive a stable, unique ID from the upstream URL (the
                # upstream catalog has many entries sharing the same `id` for
                # different variants — that broke React keys and caused the
                # wrong VideoPlayer instance to be mounted on click).
                import hashlib
                url_hash = hashlib.md5(item["url"].encode("utf-8")).hexdigest()[:14]
                cid = f"{raw_cid}-{url_hash}" if raw_cid else url_hash
                raw_name = item.get("name") or "Chaîne"
                name, source = _clean_name_and_source(raw_name)
                group = item.get("group") or ""
                country = _extract_country(group)
                quality = _detect_quality(name)
                channels.append({
                    "id": cid,
                    "url": item["url"],
                    "name": name,
                    "source": source,         # "basic" / "cable" / "satellite" / ...
                    "quality": quality,        # "HD" / "FHD" / "4K" / None
                    "logo": _guess_logo(name, country),
                    "group": group,
                    "country": country,
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
            # Final dedup pass: guarantee unique ids
            seen: Dict[str, int] = {}
            unique: List[Dict[str, Any]] = []
            for c in ch:
                base_id = c["id"]
                if base_id in seen:
                    seen[base_id] += 1
                    c = {**c, "id": f"{base_id}-{seen[base_id]}"}
                else:
                    seen[base_id] = 0
                unique.append(c)
            _cache["channels"] = unique
            _cache["channels_exp"] = now + 300
            logger.info(f"channels loaded: {len(unique)}")
            return unique
        except Exception as e:
            logger.warning(f"catalog failed {base}: {e}")
            last_err = e
    raise HTTPException(status_code=502, detail=f"Impossible de charger les chaînes: {last_err}")

async def resolve_stream(channel_url: str) -> str:
    """Resolve channel → signed HLS URL. Cached 240 s with per-channel lock
    so that 1000 simultaneous viewers result in only ONE upstream resolve call."""
    now = time.time()
    cached = _resolve_cache.get(channel_url)
    if cached and cached[1] > now:
        return cached[0]
    # Per-channel lock to prevent thundering herd
    lock = _resolve_locks.setdefault(channel_url, asyncio.Lock())
    async with lock:
        # Re-check after acquiring lock
        cached = _resolve_cache.get(channel_url)
        if cached and cached[1] > time.time():
            return cached[0]
        sig = await get_signature()
        cx = await get_http_client()
        for base in UPSTREAM_BASES:
            url = f"{base.rstrip('/')}/mediahubmx-resolve.json"
            try:
                r = await cx.post(url, headers=_catalog_headers(sig), json={
                    "language": LANG,
                    "region": REGION,
                    "url": channel_url,
                    "clientVersion": CLIENT_VERSION,
                }, timeout=20.0)
                r.raise_for_status()
                data = r.json()
                stream_url = None
                if isinstance(data, list) and data and data[0].get("url"):
                    stream_url = data[0]["url"]
                elif isinstance(data, dict):
                    stream_url = data.get("url") or data.get("streamUrl")
                if stream_url:
                    _resolve_cache[channel_url] = (stream_url, time.time() + RESOLVE_TTL)
                    return stream_url
            except Exception as e:
                logger.warning(f"resolve failed {base}: {e}")
        raise HTTPException(status_code=502, detail="Flux non disponible")

# ----------------- API Routes -----------------
@api_router.get("/")
async def root():
    return {"app": "LiveWatch", "status": "ok"}

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
    stats = await _compute_stats()
    per_ch = stats.get("per_channel", {})
    cleaned = [{
        "id": c["id"],
        "name": c["name"],
        "source": c.get("source"),
        "quality": c.get("quality"),
        "logo": c.get("logo") or "",
        "country": c["country"],
        "categories": c["categories"],
        "viewers": per_ch.get(c["id"], 0),
    } for c in out[:limit]]
    return {"total": len(cleaned), "channels": cleaned}

@api_router.get("/stats")
async def get_stats():
    """Public real-time stats: total views in last 24h + currently live viewers."""
    stats = await _compute_stats()
    return {
        "total_24h": stats["total_24h"],
        "live_total": stats["live_total"],
    }

# ----------------- Public API (v1) -----------------
def _public_channel(c: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    """Public-facing channel object. NO direct stream URL is exposed —
    third parties must use the embed page to play the channel."""
    return {
        "id": c["id"],
        "name": c["name"],
        "source": c.get("source"),
        "country": c["country"],
        "categories": c["categories"],
        "embed_url": f"{base_url}/embed/{c['id']}",
    }

def _public_base(request: Request) -> str:
    # Trust X-Forwarded-* set by the ingress
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"

@api_router.get("/v1/public/all")
async def public_all(request: Request):
    """Single endpoint that returns everything a third-party integrator needs:
    the full list of countries, categories and channels with their embed URL."""
    channels = await get_channels()
    countries = sorted({c["country"] for c in channels if c["country"] and c["country"] != "default"})
    base = _public_base(request)
    return {
        "countries": countries,
        "categories": list(CATEGORY_KEYWORDS.keys()),
        "channels": [_public_channel(c, base) for c in channels],
        "total": len(channels),
    }

@api_router.get("/v1/public/countries")
async def public_countries():
    channels = await get_channels()
    countries = sorted({c["country"] for c in channels if c["country"] and c["country"] != "default"})
    return {"total": len(countries), "countries": countries}

@api_router.get("/v1/public/categories")
async def public_categories():
    return {"categories": list(CATEGORY_KEYWORDS.keys())}

@api_router.get("/v1/public/channels")
async def public_channels(
    request: Request,
    country: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(2000, ge=1, le=5000),
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
    base = _public_base(request)
    result = [_public_channel(c, base) for c in out[:limit]]
    return {"total": len(result), "channels": result}

@api_router.get("/v1/public/channel/{channel_id}")
async def public_channel(channel_id: str, request: Request):
    channels = await get_channels()
    c = next((x for x in channels if x["id"] == channel_id), None)
    if not c:
        raise HTTPException(status_code=404, detail="Chaîne introuvable")
    return _public_channel(c, _public_base(request))

@api_router.get("/stream/{channel_id}")
async def get_stream_url(channel_id: str):
    """Resolve and return the HLS URL through our proxy (source hidden)."""
    channels = await get_channels()
    channel = next((c for c in channels if c["id"] == channel_id), None)
    if not channel:
        raise HTTPException(status_code=404, detail="Chaîne introuvable")
    upstream = await resolve_stream(channel["url"])
    # Track this as a view (non-blocking). The frontend calls this endpoint
    # every time a user actually starts watching (after the ad unlock).
    asyncio.create_task(_record_view(channel_id))
    return {
        "id": channel_id,
        "name": channel["name"],
        "proxy_url": f"/api/hls?u={quote(upstream, safe='')}",
    }

@api_router.get("/hls")
async def hls_proxy(u: str):
    """Proxy HLS playlists & segments. Playlists are micro-cached (2 s) so
    that thousands of concurrent viewers on the same channel result in a
    single upstream fetch every 2 s."""
    now = time.time()
    # Quick test: is this a playlist URL (.m3u8)?
    looks_like_playlist = ".m3u8" in u.lower().split("?")[0]

    if looks_like_playlist:
        cached = _hls_cache.get(u)
        if cached and cached[2] > now:
            return Response(content=cached[0], media_type=cached[1])
        lock = _hls_locks.setdefault(u, asyncio.Lock())
        async with lock:
            cached = _hls_cache.get(u)
            if cached and cached[2] > time.time():
                return Response(content=cached[0], media_type=cached[1])
            try:
                cx = await get_http_client()
                r = await cx.get(u, headers={"User-Agent": USER_AGENT_STREAM}, timeout=15.0)
                ct = r.headers.get("content-type", "").lower()
                is_m3u8 = ("mpegurl" in ct) or ("application/vnd.apple" in ct) or looks_like_playlist
                if is_m3u8:
                    text = r.text
                    rewritten = _rewrite_m3u8(text, u).encode("utf-8")
                    media = "application/vnd.apple.mpegurl"
                    _hls_cache[u] = (rewritten, media, time.time() + HLS_PLAYLIST_TTL)
                    return Response(content=rewritten, media_type=media)
                # Fallback: not really a playlist, stream binary
                return Response(content=r.content, media_type=r.headers.get("content-type", "application/octet-stream"))
            except httpx.HTTPError as e:
                raise HTTPException(status_code=502, detail=f"Erreur de flux: {e}")

    # Segments (.ts, .key, .m4s, …): stream directly, NO cache
    try:
        cx = await get_http_client()
        upstream_req = cx.build_request(
            "GET",
            u,
            headers={"User-Agent": USER_AGENT_STREAM},
            timeout=httpx.Timeout(30.0, connect=10.0),
        )
        r = await cx.send(upstream_req, stream=True)
        if r.status_code >= 400:
            await r.aclose()
            raise HTTPException(status_code=502, detail=f"Erreur amont: HTTP {r.status_code}")
        media = r.headers.get("content-type", "application/octet-stream")

        async def _passthrough():
            try:
                async for chunk in r.aiter_bytes(chunk_size=65536):
                    yield chunk
            finally:
                await r.aclose()

        return StreamingResponse(_passthrough(), media_type=media)
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

@app.on_event("startup")
async def startup_warmup():
    """Pre-warm the catalog cache so the very first /api/channels call is fast.
    Done in a background task so the server starts immediately."""
    async def _warmup():
        try:
            # First build the logo index so the catalog can attach real URLs
            await _refresh_logo_index()
            await _ensure_views_index()
            await get_signature()
            channels = await get_channels()
            logger.info(f"warmup done: {len(channels)} channels cached")
        except Exception as e:
            logger.warning(f"warmup failed (will retry on first request): {e}")
    asyncio.create_task(_warmup())

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
