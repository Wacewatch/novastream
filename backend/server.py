from fastapi import FastAPI, APIRouter, HTTPException, Query, Request, Header
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

app = FastAPI(title="LiveWatch API", docs_url=None, redoc_url=None, openapi_url=None)
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("livewatch")

# ----------------- Redis (cache partagé entre workers) -----------------
# Migre _resolve_cache et _hls_cache vers Redis : TTL natif (plus de leak de
# clés mortes) + cache partagé entre les N workers uvicorn. Fallback gracieux :
# si Redis est indisponible, on retombe sur un dict mémoire borné.
import redis.asyncio as _aioredis  # noqa: E402

REDIS_URL = os.environ.get("REDIS_URL", "")
_redis: "Optional[_aioredis.Redis]" = None

async def get_redis() -> "Optional[_aioredis.Redis]":
    global _redis
    if not REDIS_URL:
        return None
    if _redis is None:
        try:
            _redis = _aioredis.from_url(
                REDIS_URL, encoding="utf-8", decode_responses=False,
                socket_connect_timeout=2, socket_timeout=2,
            )
            await _redis.ping()
            logger.info("redis connected")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"redis unavailable, fallback to memory: {e}")
            _redis = None
    return _redis

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
# Single-flight: when N viewers ask for the same expired playlist simultaneously,
# only ONE upstream fetch is launched (as a Task). All other viewers await the
# same Task and resume IN PARALLEL when it resolves. This avoids the serialized
# wake-up of asyncio.Lock under high concurrency (1000+ viewers).
_hls_inflight: Dict[str, "asyncio.Task[Tuple[bytes, str, float]]"] = {}

# ===== View tracking =====
# A "view" is recorded each time the FE resolves a stream URL via
# /api/stream/{id}. Stored in MongoDB so it survives restarts. A TTL index on
# `ts` removes documents older than 400 days automatically.
LIVE_WINDOW = timedelta(minutes=5)   # what counts as "currently watching"
STATS_TTL = 3.0                       # cache stats aggregation for 3 s
_stats_cache: Dict[str, Any] = {"data": None, "exp": 0.0}
_stats_lock = asyncio.Lock()

# ----------------- Generic JSON cache (Redis + in-memory fallback) -----------------
# Used to cache the EXPENSIVE admin analytics aggregations (top-referrers full
# group, stats-timeseries, global-stats) so the admin dashboard — which polls
# these endpoints — does not re-run a full-collection scan on every poll. The
# cache is shared across uvicorn workers when Redis is available.
import json as _json_cache  # noqa: E402

_mem_cache: Dict[str, Tuple[Any, float]] = {}

async def _cache_get_json(key: str) -> Optional[Any]:
    r = await get_redis()
    if r is not None:
        try:
            raw = await r.get(key)
            if raw is not None:
                if isinstance(raw, (bytes, bytearray)):
                    raw = raw.decode("utf-8")
                return _json_cache.loads(raw)
        except Exception:
            pass
    ent = _mem_cache.get(key)
    if ent and ent[1] > time.time():
        return ent[0]
    return None

async def _cache_set_json(key: str, value: Any, ttl: int) -> None:
    r = await get_redis()
    if r is not None:
        try:
            await r.set(key, _json_cache.dumps(value), ex=ttl)
            return
        except Exception:
            pass
    # memory fallback (also keep a bounded copy to avoid unbounded growth)
    _mem_cache[key] = (value, time.time() + ttl)
    if len(_mem_cache) > 256:
        now_ = time.time()
        for k in [k for k, v in _mem_cache.items() if v[1] <= now_][:128]:
            _mem_cache.pop(k, None)


def _client_ip(request: Request) -> str:
    """Best-effort client IP behind reverse-proxies (Kubernetes ingress).

    Reads X-Forwarded-For first (takes the *first* hop = the real client),
    then X-Real-IP, then falls back to the direct socket peer. Returns "" if
    nothing is available."""
    try:
        xff = request.headers.get("x-forwarded-for") or ""
        if xff:
            return xff.split(",")[0].strip()
        xr = request.headers.get("x-real-ip") or ""
        if xr:
            return xr.strip()
        if request.client and request.client.host:
            return request.client.host
    except Exception:
        pass
    return ""

async def _ensure_views_index() -> None:
    """Indexes on db.views.

    Retention is 400 days (TTL on `ts`) — long enough for the 24h/7d/30d/1y
    timeseries panel. The legacy 24h TTL is auto-dropped if present.
    """
    try:
        try:
            existing = await db.views.index_information()
            for name, info in existing.items():
                if name == "_id_":
                    continue
                keys = info.get("key") or []
                if (
                    len(keys) == 1
                    and keys[0][0] == "ts"
                    and "expireAfterSeconds" in info
                    and info["expireAfterSeconds"] != 400 * 24 * 3600
                ):
                    await db.views.drop_index(name)
                    logger.info(f"dropped legacy TTL index on views: {name}")
        except Exception as e:
            logger.warning(f"views TTL re-create check failed: {e}")
        await db.views.create_index("ts", expireAfterSeconds=400 * 24 * 3600)
        await db.views.create_index([("channel_id", 1), ("ts", -1)])
        # For per-user "ads avoided" lookups (Dashboard counter).
        await db.views.create_index([("user_id", 1), ("is_vip", 1), ("ts", -1)])
    except Exception as e:
        logger.warning(f"views index init failed: {e}")

async def _record_view(
    channel_id: str,
    is_member: bool = False,
    is_vip: bool = False,
    is_embed: bool = False,
    ip: Optional[str] = None,
    user_id: Optional[str] = None,
) -> None:
    try:
        await db.views.insert_one({
            "channel_id": channel_id,
            "ts": datetime.now(timezone.utc),
            "is_member": bool(is_member),
            "is_vip": bool(is_vip),
            "is_embed": bool(is_embed),
            "ip": (ip or "")[:64] or None,
            "user_id": user_id or None,
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
        # "24h total" must count ONLY the last 24h. The TTL index on `ts` keeps
        # ~400 days of history, so count_documents({}) would return the ALL-TIME
        # total — that was the source of the "incohérence" (the /24h figure shown
        # in the admin and on the public homepage was actually all-time).
        since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
        try:
            total_24h = await db.views.count_documents({"ts": {"$gte": since_24h}})
        except Exception:
            total_24h = 0
        # All-time total of recorded plays (fast: uses collection metadata).
        try:
            total_all_time = await db.views.estimated_document_count()
        except Exception:
            total_all_time = 0
        # Per-channel live counts (+ members count globally)
        per_channel: Dict[str, int] = {}
        members_live = 0
        try:
            pipeline = [
                {"$match": {"ts": {"$gte": live_threshold}}},
                {"$group": {
                    "_id": "$channel_id",
                    "n": {"$sum": 1},
                    "members": {"$sum": {"$cond": [{"$eq": ["$is_member", True]}, 1, 0]}},
                }},
            ]
            async for row in db.views.aggregate(pipeline):
                per_channel[row["_id"]] = row["n"]
                members_live += int(row.get("members") or 0)
        except Exception as e:
            logger.warning(f"stats aggregate failed: {e}")
        live_total = sum(per_channel.values())
        guests_live = max(0, live_total - members_live)
        data = {
            "total_24h": total_24h,
            "total_all_time": total_all_time,
            "live_total": live_total,
            "members_live": members_live,
            "guests_live": guests_live,
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
    """Channel-name slug: lowercase, accent-stripped, kebab-case, '+' -> 'plus'.
    Removes parenthetical suffixes like (BACKUP) and bracketed suffixes like
    [LIVE DURING EVENTS ONLY] before slugifying so they don't pollute the slug."""
    import unicodedata
    s = text or ""
    # Strip [...] and (...) noise (regional/backup/event markers)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = re.sub(r"\([^\)]*\)", " ", s)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
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
    "live", "event", "events", "during",
    "plus",
}

def _candidate_slugs(name: str) -> List[str]:
    """Generate ordered candidate slugs for a channel display name.
    Also emits a "collapsed" variant (no hyphens) so e.g. '13-eme-rue'
    can match the repo entry '13eme-rue'."""
    base = _slugify(name)
    if not base:
        return []
    parts = [p for p in base.split("-") if p]
    cand: List[str] = []
    full = "-".join(parts)
    cand.append(full)
    cand.append(full.replace("-", ""))  # collapsed
    pruned = [p for p in parts if p not in _SLUG_STOPWORDS]
    if pruned and pruned != parts:
        p_full = "-".join(pruned)
        cand.append(p_full)
        cand.append(p_full.replace("-", ""))
    if pruned and pruned[-1].isdigit() and len(pruned) > 1:
        shorter = "-".join(pruned[:-1])
        cand.append(shorter)
        cand.append(shorter.replace("-", ""))
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
    Persists the resulting maps in MongoDB so subsequent restarts don't hit
    GitHub's anonymous rate limit (60 req/h). Falls back to the cached map
    when the upstream API throttles or fails."""
    cx = await get_http_client()
    # Load any persisted indexes first so a rate-limit hit still yields logos.
    try:
        async for doc in db.cached_logo_index.find({}):
            cn = doc.get("_id")
            mp = doc.get("map")
            if cn and isinstance(mp, dict) and mp:
                _LOGO_INDEX[cn] = mp
    except Exception as e:  # noqa: BLE001
        logger.warning(f"logo index db load failed: {e}")
    for display, (folder, code) in _LOGO_COUNTRY_MAP.items():
        try:
            r = await cx.get(f"{TV_LOGO_API}/{folder}", timeout=15.0)
            if r.status_code != 200:
                # Keep any previously cached index for this country.
                if r.status_code in (403, 429):
                    logger.warning(f"logo index {display}: rate limited, keeping cached map ({len(_LOGO_INDEX.get(display, {}))} entries)")
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
                collapsed = key.replace("-", "")
                if collapsed and collapsed != key:
                    slug_map.setdefault(collapsed, fname)
                # Also index without inner language markers sometimes present.
                for marker in ("-french", "-deutsch", "-italiano", "-espanol"):
                    if marker in key:
                        alt = key.replace(marker, "")
                        slug_map.setdefault(alt, fname)
                        slug_map.setdefault(alt.replace("-", ""), fname)
            if slug_map:
                _LOGO_INDEX[display] = slug_map
                try:
                    await db.cached_logo_index.update_one(
                        {"_id": display},
                        {"$set": {"map": slug_map, "updated_at": int(time.time())}},
                        upsert=True,
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"logo index db persist failed for {display}: {e}")
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

# Pattern to strip quality tokens from displayed names (so the card text isn't
# redundant with the colored HD/FHD/4K badge). We only remove standalone tokens
# at word boundaries, never inside words like "HD-something".
_QUALITY_STRIP_RE = re.compile(
    r"\s*\b(?:4K|UHD|FHD|FULLHD|FULL\s?HD|1080P|HD|720P)\b\s*",
    re.I,
)

def _detect_quality(name: str) -> Optional[str]:
    if not name:
        return None
    for label, rx in _QUALITY_PATTERNS:
        if rx.search(name):
            return label
    return None

def _strip_quality_from_name(name: str) -> str:
    """Remove HD/FHD/4K/etc. tokens from display name. Idempotent."""
    cleaned = _QUALITY_STRIP_RE.sub(" ", name or "")
    # collapse multiple spaces and strip leftover punctuation
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -._")
    return cleaned or name

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
                # Use a cleaned display name (no HD/FHD/4K suffix) for the UI,
                # but keep the original name for logo slug matching since some
                # logos require the "hd" hint to disambiguate variants.
                logo_name = name
                display_name = _strip_quality_from_name(name) if quality else name
                channels.append({
                    "id": cid,
                    "url": item["url"],
                    "name": display_name,
                    "source": source,         # "basic" / "cable" / "satellite" / ...
                    "quality": quality,        # "HD" / "FHD" / "4K" / None
                    "logo": _guess_logo(logo_name, country),
                    "group": group,
                    "country": country,
                    "categories": _categorize(display_name),
                })
        cursor = data.get("nextCursor")
        if not cursor:
            break
    return channels

async def get_channels(force: bool = False) -> List[Dict[str, Any]]:
    now = time.time()
    if not force and _cache["channels"] and _cache["channels_exp"] > now:
        return _cache["channels"]
    # Fast path: serve from MongoDB persistent cache while a refresh is queued.
    # Avoids the 30–40 s cold-start delay for end-users.
    if not force and not _cache["channels"]:
        try:
            doc = await db.cached_catalog.find_one({"_id": "channels"})
            if doc and isinstance(doc.get("channels"), list) and doc["channels"]:
                _cache["channels"] = doc["channels"]
                _cache["channels_exp"] = now + 300
                # Trigger an async refresh in the background (don't block).
                asyncio.create_task(_refresh_channels_async())
                return doc["channels"]
        except Exception as e:  # noqa: BLE001
            logger.warning(f"db cache load failed: {e}")
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
            _cache["channels_exp"] = now + 15 * 60  # 15 min in-memory TTL
            logger.info(f"channels loaded: {len(unique)}")
            # Persist to MongoDB so next cold start is instant.
            try:
                await db.cached_catalog.update_one(
                    {"_id": "channels"},
                    {"$set": {"channels": unique, "updated_at": datetime.now(timezone.utc)}},
                    upsert=True,
                )
            except Exception as e:  # noqa: BLE001
                logger.warning(f"db cache save failed: {e}")
            return unique
        except Exception as e:
            logger.warning(f"catalog failed {base}: {e}")
            last_err = e
    # If upstream fails but we have a DB cache, serve it.
    try:
        doc = await db.cached_catalog.find_one({"_id": "channels"})
        if doc and isinstance(doc.get("channels"), list) and doc["channels"]:
            _cache["channels"] = doc["channels"]
            _cache["channels_exp"] = now + 60
            return doc["channels"]
    except Exception:
        pass
    raise HTTPException(status_code=502, detail=f"Impossible de charger les chaînes: {last_err}")


async def _refresh_channels_async() -> None:
    """Background refresh: fetches the upstream catalog and updates the cache
    + the MongoDB persistent cache. Safe to call concurrently — only one
    refresh runs at a time thanks to _refresh_in_progress."""
    if _cache.get("_refresh_in_progress"):
        return
    _cache["_refresh_in_progress"] = True
    try:
        await get_channels(force=True)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"background channels refresh failed: {e}")
    finally:
        _cache["_refresh_in_progress"] = False

async def resolve_stream(channel_url: str) -> str:
    """Resolve channel -> signed HLS URL. Cached in Redis (TTL natif, partage
    entre workers). Fallback memoire borne si Redis down."""
    import hashlib
    key = b"resolve:" + hashlib.md5(channel_url.encode()).hexdigest().encode()
    r = await get_redis()
    # 1) Cache hit
    if r is not None:
        try:
            cached = await r.get(key)
            if cached:
                return cached.decode("utf-8")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"redis get resolve failed: {e}")
    else:
        now = time.time()
        c = _resolve_cache.get(channel_url)
        if c and c[1] > now:
            return c[0]
    # 2) Miss -> upstream resolve
    sig = await get_signature()
    cx = await get_http_client()
    for base in UPSTREAM_BASES:
        url = f"{base.rstrip('/')}/mediahubmx-resolve.json"
        try:
            resp = await cx.post(url, headers=_catalog_headers(sig), json={
                "language": LANG,
                "region": REGION,
                "url": channel_url,
                "clientVersion": CLIENT_VERSION,
            }, timeout=20.0)
            resp.raise_for_status()
            data = resp.json()
            stream_url = None
            if isinstance(data, list) and data and data[0].get("url"):
                stream_url = data[0]["url"]
            elif isinstance(data, dict):
                stream_url = data.get("url") or data.get("streamUrl")
            if stream_url:
                if r is not None:
                    try:
                        await r.set(key, stream_url.encode("utf-8"), ex=RESOLVE_TTL)
                    except Exception as e:  # noqa: BLE001
                        logger.warning(f"redis set resolve failed: {e}")
                else:
                    if len(_resolve_cache) > 5000:
                        _resolve_cache.clear()
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
    limit: int = Query(0, ge=0, le=10000, description="0 = no limit"),
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
    sliced = out if limit == 0 else out[:limit]
    cleaned = [{
        "id": c["id"],
        "name": c["name"],
        "source": c.get("source"),
        "quality": c.get("quality"),
        "logo": c.get("logo") or "",
        "country": c["country"],
        "categories": c["categories"],
        "viewers": per_ch.get(c["id"], 0),
    } for c in sliced]
    return {"total": len(cleaned), "channels": cleaned}

@api_router.get("/stats")
async def get_stats():
    """Public real-time stats: total views in last 24h + currently live viewers,
    plus a per-channel live count so the FE can refresh card badges live."""
    stats = await _compute_stats()
    return {
        "total_24h": stats["total_24h"],
        "total_all_time": stats.get("total_all_time", 0),
        "live_total": stats["live_total"],
        "per_channel": stats.get("per_channel", {}),
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
async def get_stream_url(
    channel_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
    vip: int = 0,
    embed: int = 0,
):
    """Resolve and return the HLS URL through our proxy (source hidden).

    Accepts non-authoritative stats hints from the client (set by streamApi.js
    in the frontend):
      * Authorization: Bearer <jwt>  → counted as "member"
      * ?vip=1   → counted as "VIP" (UI hints; we don't validate the JWT
                   server-side for stats — false positives are inconsequential)
      * ?embed=1 → counted as an embed-page play (i.e. the user came through
                   /embed/{id} on this site or via a 3rd-party iframe)
    """
    channels = await get_channels()
    channel = next((c for c in channels if c["id"] == channel_id), None)
    if not channel:
        raise HTTPException(status_code=404, detail="Chaîne introuvable")
    upstream = await resolve_stream(channel["url"])
    is_member = bool(
        authorization
        and authorization.lower().startswith("bearer ")
        and len(authorization) > 20
    )
    user_id = _decode_jwt_sub(authorization) if is_member else None
    asyncio.create_task(_record_view(
        channel_id,
        is_member=is_member,
        is_vip=bool(is_member and vip),
        is_embed=bool(embed),
        ip=_client_ip(request),
        user_id=user_id,
    ))
    return {
        "id": channel_id,
        "name": channel["name"],
        "proxy_url": f"/api/hls?u={quote(upstream, safe='')}",
    }

@api_router.get("/hls")
async def hls_proxy(u: str):
    """Proxy HLS playlists & segments. Playlists are micro-cached (2 s) so
    that thousands of concurrent viewers on the same channel result in a
    single upstream fetch every 2 s. Uses a single-flight Task so all
    waiting viewers wake up in parallel (not serialized like a Lock)."""
    now = time.time()
    # Quick test: is this a playlist URL (.m3u8)?
    looks_like_playlist = ".m3u8" in u.lower().split("?")[0]

    if looks_like_playlist:
        # Cache hit via Redis (ou memoire en fallback)
        rds = await get_redis()
        if rds is not None:
            try:
                blob = await rds.get(b"hls:" + u.encode("utf-8"))
                if blob:
                    nl = blob.index(b"\n")
                    media_b = blob[:nl].decode("utf-8")
                    body_b = blob[nl + 1:]
                    return Response(content=body_b, media_type=media_b)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"redis get hls failed: {e}")
        else:
            cached = _hls_cache.get(u)
            if cached and cached[2] > now:
                return Response(content=cached[0], media_type=cached[1])

        # Single-flight pattern: 1 upstream fetch shared by ALL waiting viewers.
        task = _hls_inflight.get(u)
        if task is None or task.done():
            task = asyncio.create_task(_fetch_playlist(u))
            _hls_inflight[u] = task

        try:
            entry = await asyncio.shield(task)
            return Response(content=entry[0], media_type=entry[1])
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Erreur de flux: {e}")
        except HTTPException:
            raise
        except Exception as e:
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

async def _fetch_playlist(u: str) -> Tuple[bytes, str, float]:
    """Background single-flight fetcher for an HLS playlist URL. Called as
    a Task so its lifetime is independent of any incoming request. Populates
    `_hls_cache[u]` on success and pops itself from `_hls_inflight` at the end."""
    try:
        cx = await get_http_client()
        r = await cx.get(u, headers={"User-Agent": USER_AGENT_STREAM}, timeout=15.0)
        ct = r.headers.get("content-type", "").lower()
        is_m3u8 = ("mpegurl" in ct) or ("application/vnd.apple" in ct) or (".m3u8" in u.lower().split("?")[0])
        if is_m3u8:
            text = r.text
            rewritten = _rewrite_m3u8(text, u).encode("utf-8")
            media = "application/vnd.apple.mpegurl"
            entry: Tuple[bytes, str, float] = (rewritten, media, time.time() + HLS_PLAYLIST_TTL)
            rds = await get_redis()
            if rds is not None:
                try:
                    await rds.set(b"hls:" + u.encode("utf-8"),
                                  media.encode("utf-8") + b"\n" + rewritten,
                                  ex=int(HLS_PLAYLIST_TTL) + 1)
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"redis set hls failed: {e}")
            else:
                if len(_hls_cache) > 2000:
                    _hls_cache.clear()
                _hls_cache[u] = entry
            return entry
        # Not really a playlist — return body but DON'T cache it
        media2 = r.headers.get("content-type", "application/octet-stream")
        return (r.content, media2, time.time())
    finally:
        # Remove ourselves so the next miss can schedule a fresh fetch
        _hls_inflight.pop(u, None)

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

# =====================================================================
# SUPABASE INTEGRATION
# Auth-gated endpoints used by the React frontend for:
#   - VIP key redemption (uses service role to bypass user_profiles RLS)
#   - Admin: generate VIP keys
#   - Channels by IDs (used by the dashboard to render favorites)
# =====================================================================
from fastapi import Header
from pydantic import BaseModel, Field
import secrets
import string

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY)


async def _supabase_get_user(jwt: str) -> Dict[str, Any]:
    """Validate a user JWT via Supabase /auth/v1/user. Returns the user dict."""
    if not jwt:
        raise HTTPException(status_code=401, detail="Token manquant")
    if not _supabase_configured():
        raise HTTPException(status_code=500, detail="Supabase non configuré côté serveur")
    cx = await get_http_client()
    try:
        r = await cx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {jwt}"},
            timeout=10.0,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Session invalide ou expirée")
        return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Erreur Supabase auth: {e}")


def _service_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    h = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


async def _supabase_query(method: str, path: str, *, params: Optional[Dict[str, Any]] = None,
                          json: Any = None, prefer: Optional[str] = None) -> httpx.Response:
    """Low-level Supabase REST call using service_role key (bypasses RLS)."""
    cx = await get_http_client()
    extra = {}
    if prefer:
        extra["Prefer"] = prefer
    r = await cx.request(
        method,
        f"{SUPABASE_URL}/rest/v1/{path.lstrip('/')}",
        params=params,
        json=json,
        headers=_service_headers(extra),
        timeout=15.0,
    )
    return r


async def _require_admin(jwt: str) -> Dict[str, Any]:
    """Validate user JWT AND check their profile.role == 'admin'."""
    user = await _supabase_get_user(jwt)
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Utilisateur invalide")
    r = await _supabase_query(
        "GET", "user_profiles",
        params={"id": f"eq.{uid}", "select": "id,role,is_vip"},
    )
    if r.status_code != 200 or not r.json():
        raise HTTPException(status_code=403, detail="Profil introuvable")
    profile = r.json()[0]
    if profile.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    return {"user": user, "profile": profile}


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header manquant")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Format Authorization invalide")
    return parts[1].strip()


def _decode_jwt_sub(authorization: Optional[str]) -> Optional[str]:
    """Cheap, NON-VALIDATING extraction of the `sub` claim from a Bearer JWT.

    Used for view tracking (we just want to know "which user" — false values
    are inconsequential since this never grants access). For *real* auth we
    still hit Supabase /auth/v1/user via _supabase_get_user.
    """
    try:
        if not authorization:
            return None
        parts = authorization.split(" ", 1)
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return None
        token = parts[1].strip()
        segments = token.split(".")
        if len(segments) < 2:
            return None
        body = segments[1]
        # Pad base64 (JWT uses base64url without padding)
        body += "=" * (-len(body) % 4)
        import base64 as _b64
        import json as _json
        raw = _b64.urlsafe_b64decode(body)
        payload = _json.loads(raw.decode("utf-8", errors="ignore"))
        sub = payload.get("sub")
        if isinstance(sub, str) and sub:
            return sub
    except Exception:
        pass
    return None


# ---------- Models ----------
class RedeemVipRequest(BaseModel):
    key: str = Field(..., min_length=4, max_length=128)


class GenerateKeysRequest(BaseModel):
    count: int = Field(1, ge=1, le=50)


class ChannelsByIdsRequest(BaseModel):
    ids: List[str] = Field(default_factory=list, max_length=500)


# ---------- Endpoints ----------
@api_router.get("/user/bypass-stats")
async def user_bypass_stats(authorization: Optional[str] = Header(None)):
    """Returns the "ads avoided" counter for the calling user.

    For a VIP user, every play counts as one avoided ad-unlock prompt. We
    return:
        { "month": <count in current calendar month, UTC>,
          "total": <total since the user upgraded, all-time> }

    Requires a valid Bearer JWT (we validate against Supabase /auth/v1/user
    so we get the real user id, not a forged sub).
    """
    jwt = _extract_bearer(authorization)
    user = await _supabase_get_user(jwt)
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Utilisateur invalide")

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    try:
        # Each is_vip=True view = one ad avoided (the user would otherwise
        # have had to wait through the AdUnlockModal).
        total = await db.views.count_documents({"user_id": uid, "is_vip": True})
        month = await db.views.count_documents({
            "user_id": uid,
            "is_vip": True,
            "ts": {"$gte": month_start},
        })
    except Exception as e:
        logger.warning(f"bypass-stats query failed: {e}")
        total = 0
        month = 0

    return {"month": int(month), "total": int(total)}


@api_router.post("/auth/redeem-vip")
async def redeem_vip(body: RedeemVipRequest, authorization: Optional[str] = Header(None)):
    """Mark a VIP key as used by the calling user, then upgrade the user's
    profile to role='vip' / is_vip=true. Uses the service role so RLS does not
    block the role escalation."""
    jwt = _extract_bearer(authorization)
    user = await _supabase_get_user(jwt)
    uid = user.get("id")
    user_email = user.get("email")

    raw_key = body.key.strip()

    # 1) Find the key (must be unused)
    r = await _supabase_query(
        "GET", "vip_keys",
        params={"key": f"eq.{raw_key}", "select": "id,key,used,used_by"},
    )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Erreur Supabase: {r.text}")
    rows = r.json()
    if not rows:
        return {"success": False, "error": "Clé VIP introuvable"}
    key_row = rows[0]
    if key_row.get("used"):
        return {"success": False, "error": "Cette clé a déjà été utilisée"}

    # 2) Mark the key used
    now_iso = datetime.now(timezone.utc).isoformat()
    r2 = await _supabase_query(
        "PATCH", "vip_keys",
        params={"id": f"eq.{key_row['id']}", "used": "is.false"},
        json={"used": True, "used_by": uid, "used_at": now_iso},
        prefer="return=representation",
    )
    if r2.status_code not in (200, 204):
        raise HTTPException(status_code=502, detail=f"Échec MAJ clé: {r2.text}")
    updated = r2.json() if r2.content else []
    if not updated:
        return {"success": False, "error": "Clé déjà consommée"}

    # 3) Upgrade user_profile (upsert in case the profile row does not yet exist)
    profile_payload = {
        "id": uid,
        "email": user_email,
        "role": "vip",
        "is_vip": True,
        "vip_granted_at": now_iso,
    }
    r3 = await _supabase_query(
        "POST", "user_profiles",
        json=profile_payload,
        prefer="resolution=merge-duplicates,return=representation",
    )
    if r3.status_code not in (200, 201):
        r3b = await _supabase_query(
            "PATCH", "user_profiles",
            params={"id": f"eq.{uid}"},
            json={"role": "vip", "is_vip": True, "vip_granted_at": now_iso},
            prefer="return=representation",
        )
        if r3b.status_code not in (200, 204):
            raise HTTPException(status_code=502, detail=f"Échec MAJ profil: {r3b.text}")

    return {"success": True, "role": "vip"}


@api_router.post("/admin/vip-keys/generate")
async def admin_generate_vip_keys(body: GenerateKeysRequest, authorization: Optional[str] = Header(None)):
    """Generate N random VIP keys (only admins)."""
    jwt = _extract_bearer(authorization)
    ctx = await _require_admin(jwt)
    admin_uid = ctx["user"]["id"]

    def _new_key() -> str:
        alphabet = string.ascii_uppercase + string.digits
        groups = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3)]
        return "VIP-" + "-".join(groups)

    rows = [{"key": _new_key(), "used": False, "created_by": admin_uid} for _ in range(body.count)]
    r = await _supabase_query("POST", "vip_keys", json=rows, prefer="return=representation")
    if r.status_code not in (200, 201):
        # `created_by` column may not exist in this schema — retry without it
        rows2 = [{"key": row["key"], "used": False} for row in rows]
        r = await _supabase_query("POST", "vip_keys", json=rows2, prefer="return=representation")
        if r.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"Échec création clés: {r.text[:200]}")
    created = r.json() if r.content else []
    return {"created": len(created), "keys": [c.get("key") for c in created]}


@api_router.post("/channels/by-ids")
async def channels_by_ids(body: ChannelsByIdsRequest):
    """Return channel metadata for a list of IDs (used by dashboard favorites)."""
    if not body.ids:
        return {"channels": []}
    all_channels = await get_channels()
    wanted = set(body.ids)
    out = []
    for c in all_channels:
        if c["id"] in wanted:
            out.append({
                "id": c["id"],
                "name": c["name"],
                "country": c["country"],
                "categories": c["categories"],
                "logo": c.get("logo") or "",
            })
    return {"channels": out}


# ==============================================================================
# ADMIN STATS MODULES (system, live, referrers, global)
# ==============================================================================

import psutil  # noqa: E402
import platform as _platform  # noqa: E402
import sys as _sys  # noqa: E402
from urllib.parse import urlparse  # noqa: E402

_PROCESS = psutil.Process()
_PROCESS_START = time.time()


async def _ensure_referrers_index() -> None:
    """Ensure indexes on the referrers collection.

    We KEEP referrer logs forever (no TTL) so the admin "Top Référents" panel
    can show all-time stats with first/last call timestamps per host.
    If a previous TTL index exists on `ts` (legacy 30-day retention), we drop
    it and recreate it without expireAfterSeconds.
    """
    try:
        # Look for any existing TTL index on `ts` and drop it (so we can switch
        # to permanent retention).
        try:
            existing = await db.referrers.index_information()
            for name, info in existing.items():
                if name == "_id_":
                    continue
                keys = info.get("key") or []
                # `keys` looks like [('ts', 1)] for the legacy index
                if len(keys) == 1 and keys[0][0] == "ts" and "expireAfterSeconds" in info:
                    await db.referrers.drop_index(name)
                    logger.info(f"dropped legacy TTL index on referrers: {name}")
        except Exception as e:
            logger.warning(f"referrers TTL drop check failed: {e}")

        # Permanent (no-TTL) indexes
        await db.referrers.create_index("ts")
        await db.referrers.create_index([("host", 1), ("ts", -1)])
    except Exception as e:
        logger.warning(f"referrers index init failed: {e}")


def _normalize_referer(raw: str) -> Optional[str]:
    if not raw:
        return None
    try:
        u = urlparse(raw)
        host = (u.netloc or "").lower().strip()
        if not host:
            return None
        # strip www.
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return None


@app.middleware("http")
async def _log_referrer(request: Request, call_next):
    """Best-effort logging of HTTP Referer for top-referrers analytics.

    Logs only the actual 'play this channel' actions:
      * /api/stream/{id}            (TV)
      * /api/daddy/stream/{id}      (DaddyTV)
    NOT the HLS segment fetches (they would multiply by ~1 per second).

    For iframe-embedded usage on a 3rd-party site (e.g. wavewatch.top puts
    `<iframe src="https://livewatch.top/embed/{id}">`), the standard `Referer`
    header on these XHRs is `https://livewatch.top/embed/{id}` — i.e. the
    iframe's own page, NOT the parent site. To capture the real parent we
    accept an explicit `?ref=<url>` query parameter which the embed pages
    forward from `document.referrer`.
    """
    response = await call_next(request)
    try:
        path = request.url.path or ""
        # Only the 'play action' endpoints. Keep this list short so we
        # don't double-count (1 click = 1 referrer entry).
        if not (
            path.startswith("/api/stream/")
            or path.startswith("/api/daddy/stream/")
        ):
            return response
        # Prefer the explicit ?ref= sent by EmbedPage / DaddyEmbedPage
        # (= document.referrer of the iframe, i.e. the parent page).
        ref_param = request.query_params.get("ref") or ""
        ref_header = request.headers.get("referer") or ""
        host = _normalize_referer(ref_param) or _normalize_referer(ref_header)
        if not host:
            return response
        await db.referrers.insert_one({
            "host": host,
            "ts": datetime.now(timezone.utc),
            "path": path,
            "via": "query" if ref_param else "header",
        })
    except Exception:
        pass
    return response


@api_router.get("/admin/system-stats")
async def admin_system_stats(authorization: Optional[str] = Header(None)):
    """CPU %, RAM usage, uptime, platform, python version (admin-only)."""
    jwt = (authorization or "").removeprefix("Bearer ").strip()
    await _require_admin(jwt)

    try:
        cpu_pct = psutil.cpu_percent(interval=0.1)
    except Exception:
        cpu_pct = 0.0
    try:
        proc_mem = _PROCESS.memory_info().rss / (1024 * 1024)  # MB
    except Exception:
        proc_mem = 0.0
    try:
        vm = psutil.virtual_memory()
        total_mem = vm.total / (1024 * 1024)
        sys_mem_pct = vm.percent
    except Exception:
        total_mem = 0.0
        sys_mem_pct = 0.0

    uptime_s = int(time.time() - _PROCESS_START)
    h = uptime_s // 3600
    m = (uptime_s % 3600) // 60
    uptime_str = f"{h}h {m:02d}m" if h > 0 else f"{m}m"

    return {
        "cpu_percent": round(cpu_pct, 2),
        "process_mem_mb": round(proc_mem, 2),
        "total_mem_mb": round(total_mem, 2),
        "system_mem_percent": round(sys_mem_pct, 2),
        "uptime": uptime_str,
        "uptime_seconds": uptime_s,
        "platform": _platform.system().lower(),
        "platform_full": _platform.platform(),
        "python_version": f"v{_sys.version_info.major}.{_sys.version_info.minor}.{_sys.version_info.micro}",
    }


@api_router.get("/admin/live-stats")
async def admin_live_stats(authorization: Optional[str] = Header(None)):
    """Real-time viewing stats: online viewers, currently watching, top channels (admin-only)."""
    jwt = (authorization or "").removeprefix("Bearer ").strip()
    await _require_admin(jwt)

    stats = await _compute_stats()
    live_total = stats.get("live_total", 0)
    total_24h = stats.get("total_24h", 0)
    total_all_time = stats.get("total_all_time", 0)
    per_channel = stats.get("per_channel", {})

    # Map per_channel counts to channel names (top 10)
    top_pairs = sorted(per_channel.items(), key=lambda kv: kv[1], reverse=True)[:10]
    all_channels = await get_channels()
    by_id = {c["id"]: c for c in all_channels}
    top_channels = []
    for cid, n in top_pairs:
        c = by_id.get(cid)
        if c is not None:
            top_channels.append({
                "id": cid,
                "name": c.get("name", cid),
                "country": c.get("country", ""),
                "viewers": n,
            })

    return {
        "online": live_total,
        "watching": live_total,
        "members_online": stats.get("members_live", 0),
        "guests_online": stats.get("guests_live", live_total),
        "total_24h": total_24h,
        "total_all_time": total_all_time,
        "top_channels": top_channels,
    }


@api_router.get("/admin/top-referrers")
async def admin_top_referrers(
    authorization: Optional[str] = Header(None),
    hours: int = 0,
    limit: int = 20,
    offset: int = 0,
    sort: str = "count",   # count | last | first
    order: str = "desc",   # desc | asc
):
    """Top HTTP Referer hosts (admin-only), paginated & sortable.

    Query params:
      * hours  — 0 (default) = all-time; >0 restricts to the last N hours
                 (capped to 365 days).
      * limit  — page size (1..100, default 20).
      * offset — number of hosts to skip (pagination).
      * sort   — "count" (call quantity, default), "last" (last call),
                 "first" (first call).
      * order  — "desc" (default) or "asc".

    For each host we return the total call count + the timestamps of the first
    and last calls (ISO-8601 UTC strings). The FULL grouped list (every host) is
    computed in a single aggregation and cached for 60 s, then sorted & sliced
    in-process — so changing the page or the sort is instant and the heavy
    full-collection scan runs at most once per minute regardless of polling.
    """
    jwt = (authorization or "").removeprefix("Bearer ").strip()
    await _require_admin(jwt)

    hours = max(0, min(int(hours or 0), 24 * 365))
    limit = max(1, min(int(limit or 20), 100))
    offset = max(0, int(offset or 0))
    sort = sort if sort in ("count", "last", "first") else "count"
    order = "asc" if (order or "").lower() == "asc" else "desc"

    cache_key = f"ns:referrers:full:{hours}"
    full = await _cache_get_json(cache_key)
    if full is None:
        match_stage: Dict[str, Any] = {}
        if hours > 0:
            since = datetime.now(timezone.utc) - timedelta(hours=hours)
            match_stage = {"$match": {"ts": {"$gte": since}}}
        full = []
        try:
            pipeline: List[Dict[str, Any]] = []
            if match_stage:
                pipeline.append(match_stage)
            pipeline += [
                {"$group": {
                    "_id": "$host",
                    "n": {"$sum": 1},
                    "first": {"$min": "$ts"},
                    "last": {"$max": "$ts"},
                }},
                {"$sort": {"n": -1}},
            ]
            async for r in db.referrers.aggregate(pipeline, allowDiskUse=True):
                if not r.get("_id"):
                    continue
                first_dt = r.get("first")
                last_dt = r.get("last")
                full.append({
                    "host": r["_id"],
                    "count": int(r.get("n") or 0),
                    "first_call": first_dt.isoformat() if first_dt else None,
                    "last_call": last_dt.isoformat() if last_dt else None,
                })
            await _cache_set_json(cache_key, full, 60)
        except Exception as e:
            logger.warning(f"top-referrers aggregate failed: {e}")
            full = []

    # Sort in-process. For date sorts, missing timestamps go to the bottom
    # (treated as the most extreme value in the opposite direction).
    reverse = order == "desc"

    def _date_key(row: Dict[str, Any], field: str) -> str:
        v = row.get(field)
        # ISO-8601 strings sort chronologically as plain strings (same UTC offset).
        # Empty string sorts before any real date; we push None to the far end so
        # hosts without a timestamp never crowd the top.
        if v:
            return v
        return "" if reverse else "9999"

    if sort == "count":
        full_sorted = sorted(full, key=lambda x: x.get("count", 0), reverse=reverse)
    elif sort == "last":
        full_sorted = sorted(full, key=lambda x: _date_key(x, "last_call"), reverse=reverse)
    else:  # first
        full_sorted = sorted(full, key=lambda x: _date_key(x, "first_call"), reverse=reverse)

    total = len(full_sorted)
    page = full_sorted[offset:offset + limit]

    return {
        "referrers": page,
        "total": total,
        "offset": offset,
        "limit": limit,
        "sort": sort,
        "order": order,
        "window_hours": hours,
        "all_time": hours == 0,
    }


@api_router.get("/admin/stats-timeseries")
async def admin_stats_timeseries(
    authorization: Optional[str] = Header(None),
    range_: str = Query("7d", alias="range"),
):
    """Time-series of view metrics over a chosen range.

    Range options (bucket size in parentheses):
      * 24h  → 24 hourly buckets
      * 7d   → 7 daily buckets   (default)
      * 30d  → 30 daily buckets
      * 1y   → 365 daily buckets

    For each bucket we return:
      * total          — total plays
      * member_plays   — plays by a logged-in non-VIP user
      * vip_plays      — plays by a VIP user
      * guest_plays    — plays without a Bearer JWT
      * embed_plays    — plays initiated from an /embed/* page (or 3rd-party iframe)
      * unique_visitors — distinct client IPs that played at least once

    Returns:
      {
        "range": "7d",
        "bucket": "day",          # or "hour"
        "buckets": [
          {"t": "2026-05-15T00:00:00Z",
           "total": 123, "member_plays": 30, "vip_plays": 12,
           "guest_plays": 81, "embed_plays": 40, "unique_visitors": 78},
          ...
        ],
        "totals": { same keys, summed over the whole range }
      }
    """
    jwt = (authorization or "").removeprefix("Bearer ").strip()
    await _require_admin(jwt)

    now = datetime.now(timezone.utc)
    rng = (range_ or "7d").lower()
    if rng == "24h":
        bucket = "hour"
        start = now - timedelta(hours=24)
        n_buckets = 24
        # Truncate start to the hour
        start = start.replace(minute=0, second=0, microsecond=0)
    elif rng == "30d":
        bucket = "day"
        start = (now - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
        n_buckets = 30
    elif rng in ("1y", "365d"):
        bucket = "day"
        start = (now - timedelta(days=365)).replace(hour=0, minute=0, second=0, microsecond=0)
        n_buckets = 365
    else:
        rng = "7d"
        bucket = "day"
        start = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
        n_buckets = 7

    date_fmt = "%Y-%m-%dT%H:00:00Z" if bucket == "hour" else "%Y-%m-%dT00:00:00Z"

    # Serve from cache if fresh. The heavy aggregation (full scan + $addToSet of
    # client IPs, up to a year of data) runs at most once per minute per range,
    # instead of on every 30-60 s dashboard refresh.
    cache_key = f"ns:timeseries:{rng}"
    cached = await _cache_get_json(cache_key)
    if cached is not None:
        return cached

    # Single pass over the matched docs:
    #   * byBucket    — per-bucket counts (+ per-bucket distinct IPs for the chart)
    #   * rangeUnique — distinct IPs over the WHOLE range (only the COUNT is
    #                   returned, so the big IP set never crosses the wire). This
    #                   is the correct "unique visitors over the period" figure;
    #                   summing the per-bucket uniques would double-count anyone
    #                   active on more than one day.
    pipeline = [
        {"$match": {"ts": {"$gte": start}}},
        {"$facet": {
            "byBucket": [
                {"$group": {
                    "_id": {
                        "$dateToString": {
                            "format": "%Y-%m-%dT%H:00:00Z" if bucket == "hour" else "%Y-%m-%dT00:00:00Z",
                            "date": "$ts",
                            "timezone": "UTC",
                        }
                    },
                    "total": {"$sum": 1},
                    "members_raw": {"$sum": {"$cond": [{"$eq": ["$is_member", True]}, 1, 0]}},
                    "vip_plays": {"$sum": {"$cond": [{"$eq": ["$is_vip", True]}, 1, 0]}},
                    "embed_plays": {"$sum": {"$cond": [{"$eq": ["$is_embed", True]}, 1, 0]}},
                    "ips": {"$addToSet": "$ip"},
                }},
                {"$sort": {"_id": 1}},
            ],
            "rangeUnique": [
                {"$match": {"ip": {"$nin": [None, ""]}}},
                {"$group": {"_id": None, "ips": {"$addToSet": "$ip"}}},
                {"$project": {"_id": 0, "n": {"$size": "$ips"}}},
            ],
        }},
    ]

    raw_by_t: Dict[str, Dict[str, Any]] = {}
    range_unique_visitors = 0
    try:
        agg = await db.views.aggregate(pipeline, allowDiskUse=True).to_list(1)
        facet = agg[0] if agg else {}
        for r in facet.get("byBucket", []):
            ips = [ip for ip in (r.get("ips") or []) if ip]
            members_raw = int(r.get("members_raw") or 0)
            vip_plays = int(r.get("vip_plays") or 0)
            # vip_plays is a subset of members_raw (a VIP is also a member),
            # so "member but not VIP" = members_raw - vip_plays
            member_only = max(0, members_raw - vip_plays)
            total = int(r.get("total") or 0)
            raw_by_t[r["_id"]] = {
                "total": total,
                "member_plays": member_only,
                "vip_plays": vip_plays,
                "guest_plays": max(0, total - members_raw),
                "embed_plays": int(r.get("embed_plays") or 0),
                "unique_visitors": len(set(ips)),
            }
        ru = facet.get("rangeUnique") or []
        range_unique_visitors = int(ru[0]["n"]) if ru else 0
    except Exception as e:
        logger.warning(f"stats-timeseries aggregate failed: {e}")
        raw_by_t = {}
        range_unique_visitors = 0

    # Build the full bucket list (fill missing slots with zeros so the chart
    # is continuous even on empty days).
    buckets: List[Dict[str, Any]] = []
    totals = {
        "total": 0, "member_plays": 0, "vip_plays": 0,
        "guest_plays": 0, "embed_plays": 0, "unique_visitors": 0,
    }
    step = timedelta(hours=1) if bucket == "hour" else timedelta(days=1)
    cur = start
    for _ in range(n_buckets):
        key = cur.strftime(date_fmt)
        b = raw_by_t.get(key, {
            "total": 0, "member_plays": 0, "vip_plays": 0,
            "guest_plays": 0, "embed_plays": 0, "unique_visitors": 0,
        })
        buckets.append({"t": key, **b})
        for k in totals:
            totals[k] += b[k]
        cur += step

    result = {
        "range": rng,
        "bucket": bucket,
        "start": start.isoformat(),
        "buckets": buckets,
        "totals": totals,
        # Correct distinct-visitors-over-the-whole-range count (NOT the sum of
        # per-bucket uniques). The KPI card uses this value.
        "range_unique_visitors": range_unique_visitors,
    }
    await _cache_set_json(cache_key, result, 60)
    return result


@api_router.get("/admin/global-stats")
async def admin_global_stats(authorization: Optional[str] = Header(None)):
    """Total users, admins, vips, channels count (admin-only, uses Supabase service role)."""
    jwt = (authorization or "").removeprefix("Bearer ").strip()
    await _require_admin(jwt)

    cached = await _cache_get_json("ns:global-stats")
    if cached is not None:
        return cached

    # Supabase counts via Prefer: count=exact, head request
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Prefer": "count=exact",
        "Range": "0-0",
    }
    http = await get_http_client()

    async def _count(path: str, params: Dict[str, Any]) -> int:
        try:
            params_clean = {**params, "select": "id"}
            r = await http.get(
                f"{SUPABASE_URL}/rest/v1/{path}",
                headers=headers,
                params=params_clean,
                timeout=8.0,
            )
            cr = r.headers.get("content-range") or ""
            # format: "0-0/123" or "*/123"
            if "/" in cr:
                tail = cr.split("/", 1)[1]
                if tail.isdigit():
                    return int(tail)
            return 0
        except Exception as e:
            logger.warning(f"supabase count {path} failed: {e}")
            return 0

    total_users, admins, vips, all_channels_safe = await asyncio.gather(
        _count("user_profiles", {}),
        _count("user_profiles", {"role": "eq.admin"}),
        # VIPs are users with role=vip OR is_vip=true (some accounts have one but not the other)
        _count("user_profiles", {"or": "(role.eq.vip,is_vip.eq.true)"}),
        get_channels(),
        return_exceptions=False,
    )
    try:
        total_channels = len(all_channels_safe) if all_channels_safe else 0
    except Exception:
        total_channels = 0

    result = {
        "total_users": total_users,
        "admins": admins,
        "vips": vips,
        "total_channels": total_channels,
    }
    await _cache_set_json("ns:global-stats", result, 60)
    return result



# ----------------- Extensions (DaddyTV / Sports / Football / Admin keys) -----------------
from extensions import ext_router, init_extensions  # noqa: E402

init_extensions(
    get_http_client=get_http_client,
    supabase_query=_supabase_query,
    require_admin=_require_admin,
    extract_bearer=_extract_bearer,
    db=db,
    record_view=_record_view,
)
api_router.include_router(ext_router)

# ----------------- EPG (XMLTV index for in-player programme info) -----------------
from epg import epg_router, init_epg  # noqa: E402

init_epg(get_http_client=get_http_client)
api_router.include_router(epg_router)


# ----------------- App setup -----------------
app.include_router(api_router)
# ----------------- Static React (SPA) -----------------
# Le frontend buildé (CRA) est copié dans /app/static au build de l'image.
# - /api/* est servi par le router ci-dessus (déjà inclus)
# - /static/* (assets CRA hashés) et / (SPA) sont servis ici
# - Toute route inconnue renvoie index.html (fallback SPA pour react-router)
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

STATIC_DIR = Path(os.environ.get("STATIC_DIR", "/app/static"))

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR / "static")), name="static")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        index = STATIC_DIR / "index.html"
        if index.is_file():
            return FileResponse(str(index))
        raise HTTPException(status_code=404, detail="Not found")
else:
    logger.warning(f"STATIC_DIR {STATIC_DIR} not found")

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
    Done in a background task so the server starts immediately.

    Also starts a recurring background job that refreshes the channels list
    every 15 min so users always hit a hot cache (no 30 s wait on cache miss)."""
    async def _warmup():
        try:
            # First build the logo index so the catalog can attach real URLs
            await _refresh_logo_index()
            await _ensure_views_index()
            await _ensure_referrers_index()
            await get_signature()
            channels = await get_channels()
            logger.info(f"warmup done: {len(channels)} channels cached")
        except Exception as e:
            logger.warning(f"warmup failed (will retry on first request): {e}")

    async def _periodic_refresh():
        # Wait for warmup to finish before the first periodic refresh.
        await asyncio.sleep(15 * 60)
        while True:
            try:
                await get_channels(force=True)
                logger.info("periodic channels refresh OK")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"periodic refresh failed: {e}")
            await asyncio.sleep(15 * 60)

    asyncio.create_task(_warmup())
    asyncio.create_task(_periodic_refresh())

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
    global _http_client, _redis
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
