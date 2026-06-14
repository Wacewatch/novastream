"""Jack07 TV scraper — decodes protobuf-encoded match data from the
jack07eo.mpstickv5m73jgravity.my API and exposes a clean JSON view.

Source of truth: https://jack07eo.mpstickv5m73jgravity.my (Football).
All upstream responses are protobuf (application/x-protobuf). We use a
generic wire-format decoder (no .proto schema needed) and a hand-rolled
projection layer that maps the observed shape into ergonomic dicts.

Stream resolution flow (reverse-engineered from /statics/*.js bundles):

  1. /api/match/detail returns each match's available stream sources as
     {streamId, name, siteType}. The display names are FIFA US, DAZN ES,
     Canal FR, Movistar2, TyR, Fubo US, etc.
  2. For a given source: GET /api/stream/detail?streamId=<sid>&siteType=<st>
     &matchId=<mid>&sportType=1&country=US&continent=NA&digit=seth — returns
     a protobuf with field (10,2,4) holding the URL ROT47-encrypted + an
     8-byte prefix. Decoding it gives the **direct, playable** m3u8 URL.
  3. The m3u8 plays without any AES `/token-XXXX/` segment — the token
     only helps the upstream rate-limit; the unsigned manifest is served
     just fine. We proxy it through our /api/hls handler so we can hide
     the upstream host and tap into the same caching layer used by Vavoo.
"""
import asyncio
import logging
import struct
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("livewatch.jack07")

# --------------------------------------------------------------------- #
# Endpoints (discovered by parsing the SPA JS bundle)
# --------------------------------------------------------------------- #
JACK07_SITE_DEFAULT = "https://jack09eo.mpstickv5m73jgravity.my"
# Mutable site URL — overridable at runtime via set_site_url() (admin module).
JACK07_SITE = JACK07_SITE_DEFAULT


def get_site_url() -> str:
    """Return current Jack07 / JackTV site URL (admin-mutable)."""
    return JACK07_SITE


def set_site_url(url: str) -> str:
    """Set the runtime Jack07 site URL. Falls back to default on empty."""
    global JACK07_SITE
    url = (url or "").strip().rstrip("/")
    if not url:
        url = JACK07_SITE_DEFAULT
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    JACK07_SITE = url
    return JACK07_SITE
# Upstream API hosts (rotated regularly; the SPA bundle hot-swaps them).
# Try each in order — the first responsive one wins. defra10 is currently
# blocked from some clouds, apis-data10 is the public mirror.
JACK07_API_HOSTS = [
    "https://apis-data10.tcore131ybdf.ru",
    "https://apis-data-defra10.tcore131ybdf.ru",
]
JACK07_API = JACK07_API_HOSTS[0]  # kept for backwards compat with imports
LANG = 6   # French
SPORT_FOOTBALL = 1

# Sport types supported by the Jack07 API (mapping verified empirically by
# probing /api/match/live with various sportType values and inspecting the
# leagues returned). Display labels are in French (matches the rest of UI).
SPORTS: Dict[int, Dict[str, str]] = {
    1: {"slug": "football",     "label": "Football"},
    2: {"slug": "basketball",   "label": "Basketball"},
    3: {"slug": "tennis",       "label": "Tennis"},
    4: {"slug": "baseball",     "label": "Baseball"},
    6: {"slug": "cricket",      "label": "Cricket"},
    7: {"slug": "motorsport",   "label": "Motorsport"},
    8: {"slug": "rugby",        "label": "Rugby"},
    10: {"slug": "aussie-rules","label": "Aussie Rules"},
    11: {"slug": "hockey",      "label": "Hockey"},
    12: {"slug": "badminton",   "label": "Badminton"},
    13: {"slug": "volleyball",  "label": "Volleyball"},
    14: {"slug": "fighting",    "label": "Combat (MMA / Boxe)"},
    15: {"slug": "cycling",     "label": "Cyclisme"},
    16: {"slug": "handball",    "label": "Handball"},
}

# CDN host rotation — the upstream protobuf occasionally embeds logo URLs on
# a *previous* CDN hostname (e.g. logos1.tcrbg61levl.cfd) that no longer
# resolves. We rewrite known stale hosts to the current active CDN so logos
# render in the SPA. Verified active 2026-02: logos1.tcore131ybdf.ru.
_LOGO_HOST_REWRITES = {
    "logos1.tcrbg61levl.cfd": "logos1.tcore131ybdf.ru",
    "logos2.tcrbg61levl.cfd": "logos1.tcore131ybdf.ru",
    "logos3.tcrbg61levl.cfd": "logos1.tcore131ybdf.ru",
}


def _fix_logo(url: str) -> str:
    """Rewrite stale CDN hosts in a logo URL to the active one. Returns the
    string unchanged when it's not a recognized stale host."""
    if not url or not isinstance(url, str):
        return url
    for stale, live in _LOGO_HOST_REWRITES.items():
        if stale in url:
            return url.replace(stale, live)
    return url

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)


# --------------------------------------------------------------------- #
# Generic protobuf wire-format decoder (no schema required)
# --------------------------------------------------------------------- #
def _read_varint(buf: bytes, pos: int) -> Tuple[int, int]:
    n = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        n |= (b & 0x7F) << shift
        if not (b & 0x80):
            return n, pos
        shift += 7


def pb_decode(buf: bytes, depth: int = 0) -> Optional[Dict[int, Any]]:
    """Decode a protobuf message into a {field_num: value | [value, …]} dict.
    Length-delimited fields are recursively decoded when they look like
    nested messages; otherwise they're returned as a utf-8 string. Returns
    None if the buffer is not a valid protobuf message at the given depth.
    """
    out: Dict[int, Any] = {}
    pos = 0
    L = len(buf)
    while pos < L:
        try:
            tag, pos = _read_varint(buf, pos)
        except Exception:  # noqa: BLE001
            return None
        field = tag >> 3
        wire = tag & 7
        if wire == 0:  # varint
            try:
                v, pos = _read_varint(buf, pos)
            except Exception:  # noqa: BLE001
                return None
            _pb_push(out, field, v)
        elif wire == 1:  # 64-bit double
            if pos + 8 > L:
                return None
            v = struct.unpack_from("<d", buf, pos)[0]
            pos += 8
            _pb_push(out, field, v)
        elif wire == 2:  # length-delimited
            try:
                ln, pos = _read_varint(buf, pos)
            except Exception:  # noqa: BLE001
                return None
            if pos + ln > L:
                return None
            data = buf[pos:pos + ln]
            pos += ln
            sub = pb_decode(data, depth + 1) if depth < 12 else None
            if sub is not None and len(sub) > 0:
                _pb_push(out, field, sub)
            else:
                try:
                    s = data.decode("utf-8")
                    if all((0x20 <= ord(c) <= 0x7E) or ord(c) >= 0x80 for c in s):
                        _pb_push(out, field, s)
                    else:
                        _pb_push(out, field, data.hex())
                except UnicodeDecodeError:
                    _pb_push(out, field, data.hex())
        elif wire == 5:  # 32-bit float
            if pos + 4 > L:
                return None
            v = struct.unpack_from("<f", buf, pos)[0]
            pos += 4
            _pb_push(out, field, v)
        else:
            return None
    return out


def _pb_push(d: Dict[int, Any], k: int, v: Any) -> None:
    if k in d:
        if not isinstance(d[k], list):
            d[k] = [d[k]]
        d[k].append(v)
    else:
        d[k] = v


def _as_list(x: Any) -> List[Any]:
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def _g(d: Optional[Dict[int, Any]], *path: int, default: Any = None) -> Any:
    """Safely read d[path[0]][path[1]]… Returns default if any step is missing."""
    cur: Any = d
    for k in path:
        if not isinstance(cur, dict):
            return default
        if k not in cur:
            return default
        cur = cur[k]
    return cur if cur is not None else default


# --------------------------------------------------------------------- #
# HTTP helper
# --------------------------------------------------------------------- #
_client: Optional[httpx.AsyncClient] = None


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=8.0),
            headers={
                "User-Agent": _UA,
                "Origin": JACK07_SITE,
                "Referer": JACK07_SITE + "/",
                "Accept-Language": "fr-FR,fr;q=0.9",
            },
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
        )
    return _client


async def reset_client():
    """Close cached httpx client so the next call rebuilds it with fresh headers (after set_site_url)."""
    global _client
    if _client is not None and not _client.is_closed:
        try:
            await _client.aclose()
        except Exception:
            pass
    _client = None


async def _fetch_pb(path: str, params: Dict[str, Any]) -> Optional[Dict[int, Any]]:
    cx = await _get_client()
    last_err: Optional[Exception] = None
    for host in JACK07_API_HOSTS:
        try:
            r = await cx.get(f"{host}{path}", params=params, headers={
                # Don't request brotli (httpx may not auto-decompress br).
                "Accept-Encoding": "gzip, deflate",
            })
            if r.status_code != 200 or not r.content:
                continue
            decoded = pb_decode(r.content)
            if decoded is None:
                continue
            return decoded
        except Exception as e:  # noqa: BLE001
            last_err = e
            continue
    if last_err:
        logger.warning(f"jack07 fetch failed {path}: {last_err}")
    return None


async def _fetch_pb_with_headers(path: str, params: Dict[str, Any]) -> Optional[Tuple[Dict[int, Any], Dict[str, str]]]:
    """Like _fetch_pb but also returns the upstream response headers — we
    need `rb-session` from /api/stream/detail to build the AES `/token-…/`
    URL prefix that gates segment authentication."""
    cx = await _get_client()
    last_err: Optional[Exception] = None
    for host in JACK07_API_HOSTS:
        try:
            r = await cx.get(f"{host}{path}", params=params, headers={
                "Accept-Encoding": "gzip, deflate",
            })
            if r.status_code != 200 or not r.content:
                continue
            decoded = pb_decode(r.content)
            if decoded is None:
                continue
            return decoded, dict(r.headers)
        except Exception as e:  # noqa: BLE001
            last_err = e
            continue
    if last_err:
        logger.warning(f"jack07 fetch failed {path}: {last_err}")
    return None


# --------------------------------------------------------------------- #
# Projection: protobuf → clean dicts
# --------------------------------------------------------------------- #
# Status codes (observed empirically). 101+ = live, 0 = scheduled,
# 4 = finished. Anything else is reported as "scheduled".
_STATUS_LABELS = {
    0: "scheduled",
    1: "scheduled",
    3: "scheduled",
    4: "finished",
    101: "1H",
    102: "HT",
    103: "2H",
    104: "ET",
    105: "BT",
    106: "P",
    13: "AET",
}


def _status_kind(s: int) -> str:
    if s == 4:
        return "finished"
    if 100 <= s <= 110 or s == 13:
        return "live"
    return "scheduled"


def _s(x: Any) -> str:
    """Coerce a protobuf-decoded value to a clean string. Dicts/lists become ''."""
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    if isinstance(x, (int, float)):
        return str(x)
    return ""


def _team(t: Optional[Dict[int, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(t, dict):
        return None
    tid = _g(t, 1, default=0)
    name = _s(_g(t, 3, 2, default=""))
    logo = _fix_logo(_s(_g(t, 4, default="")))
    if not (tid or name):
        return None
    return {"id": int(tid) if tid else 0, "name": name, "logo": logo}


def _project_match(m: Dict[int, Any], sport_type: int = SPORT_FOOTBALL) -> Optional[Dict[str, Any]]:
    """Map a raw match protobuf dict to a clean JSON-friendly object."""
    if not isinstance(m, dict):
        return None
    match_id = _g(m, 1)
    if not match_id:
        return None
    kickoff_ms = _g(m, 3, default=0) or 0
    status = int(_g(m, 4, default=0) or 0)
    league = _g(m, 10) or {}
    season = _g(m, 11) or {}

    # field 30 carries [title, team1, team2] (one entry has just `2`=title,
    # the others have `1`=side, `10`=team object).
    teams_raw = _as_list(_g(m, 30))
    title = ""
    home: Optional[Dict[str, Any]] = None
    away: Optional[Dict[str, Any]] = None
    for entry in teams_raw:
        if not isinstance(entry, dict):
            continue
        if not _g(entry, 1) and _g(entry, 2):
            title = _s(_g(entry, 2, default="")) or title
            continue
        team_obj = _team(_g(entry, 10))
        if team_obj is None:
            continue
        # Empirically, 1st team entry is home, 2nd is away
        if home is None:
            home = team_obj
        else:
            away = team_obj
            break

    # field 100 holds scores: {1:home_scores, 2:away_scores}.
    # Sub-fields, observed empirically:
    #   10 = total goals (FT/current)     ← what we want
    #   11 = 2nd-half goals (additive)
    #   15 = shots on goal (or some stat)
    #   16 = corner-kicks / fouls (NOT goals; can be 5-8, 9-4 etc.)
    # We surface field 10 only; fall back to 0 when missing (away teams in
    # 0-X matches sometimes omit the field entirely).
    def _score(side: Dict[int, Any]) -> Optional[int]:
        if not isinstance(side, dict):
            return None
        v = side.get(10)
        if v is None:
            return 0
        try:
            return int(v)
        except Exception:  # noqa: BLE001
            return None

    scores_obj = _g(m, 100) or {}
    # Only surface scores for matches that are actually live or finished.
    # Upstream populates these fields even for scheduled matches (carry-over
    # from the previous fixture between the same teams) which made the UI
    # show "Naftan 3-1 Isloch" on a kick-off-later card. status 4 = FT,
    # 100-110 + 13 = in-play.
    status_kind_now = _status_kind(status)
    if status_kind_now in ("live", "finished"):
        home_score = _score(_g(scores_obj, 1)) if home else None
        away_score = _score(_g(scores_obj, 2)) if away else None
    else:
        home_score = None
        away_score = None

    # Individual sports (tennis, motorsport, fighting) often leave the team
    # entries empty and only populate the title 'Player A vs Player B'.
    # Synthesise lightweight competitor objects from the title so the SPA
    # card / overlay still renders two names.
    if (home is None or away is None) and isinstance(title, str) and " vs " in title.lower():
        # Case-insensitive split on " vs " or " VS " (preserves original case)
        idx = title.lower().find(" vs ")
        if idx > 0:
            a = title[:idx].strip()
            b = title[idx + 4:].strip()
            if a and b:
                if home is None:
                    home = {"id": 0, "name": a, "logo": ""}
                if away is None:
                    away = {"id": 0, "name": b, "logo": ""}

    extras = _g(m, 150) or {}
    match_slug = _s(_g(extras, 20, default=""))
    league_slug = _s(_g(extras, 21, default=""))
    season_slug = _s(_g(extras, 22, default=""))

    # Build the jack07 site URL we will iframe
    site_url = ""
    if match_id and league_slug and match_slug:
        sport_slug = (SPORTS.get(sport_type) or {}).get("slug") or "football"
        site_url = (
            f"{get_site_url()}/fr/{sport_slug}/{league_slug}-{match_id}/"
            f"{match_slug}.html"
        )

    sport_info = SPORTS.get(sport_type) or SPORTS[SPORT_FOOTBALL]

    return {
        "id": str(match_id),
        "title": title or (f"{home['name']} vs {away['name']}" if home and away else ""),
        "kick_off_ts": int(kickoff_ms / 1000) if kickoff_ms else 0,
        "kick_off_iso": (
            datetime.fromtimestamp(kickoff_ms / 1000, tz=timezone.utc).isoformat()
            if kickoff_ms else ""
        ),
        "status": status,
        "status_label": _STATUS_LABELS.get(status, ""),
        "status_kind": _status_kind(status),
        "is_live": _status_kind(status) == "live",
        "is_finished": _status_kind(status) == "finished",
        "sport_type": sport_type,
        "sport": sport_info["label"],
        "sport_slug": sport_info["slug"],
        "league": {
            "id": int(_g(league, 1, default=0) or 0),
            "name": _s(_g(league, 3, 2, default="")),
            "logo": _fix_logo(_s(_g(league, 4, default=""))),
            "country": _s(_g(league, 80, 3, 2, default="")),
            "country_logo": _fix_logo(_s(_g(league, 80, 4, default=""))),
        },
        "season": {
            "id": int(_g(season, 1, default=0) or 0),
            "name": _s(_g(season, 50, 1, default="")) or _s(_g(season, 3, 2, default="")),
        },
        "home": home,
        "away": away,
        "home_score": home_score,
        "away_score": away_score,
        "match_slug": match_slug,
        "league_slug": league_slug,
        "season_slug": season_slug,
        "site_url": site_url,
    }


def _project_streams(detail_root: Dict[int, Any]) -> List[Dict[str, Any]]:
    """field 10.2 in /match/detail = list of stream entries.
    Each: {1:streamId, 3:name "FIFA US", 5:1, 8:?, 9:type=2001}"""
    streams_raw = _as_list(_g(detail_root, 10, 2))
    out: List[Dict[str, Any]] = []
    for s in streams_raw:
        if not isinstance(s, dict):
            continue
        sid = _g(s, 1, default=0)
        name = _s(_g(s, 3, default=""))
        if not sid or not name:
            continue
        out.append({
            "id": str(sid),
            "name": name,
            "type": int(_g(s, 9, default=0) or 0),
            "quality": int(_g(s, 11, default=0) or 0),
        })
    return out


# Event type codes observed:
#   101 = Goal,  102 = Penalty goal, 103 = Own goal, 104 = Missed penalty,
#   106 = Foul,  108 = Substitution, 110 = Yellow card, 111 = Red card,
#   112 = Second yellow, 10001 = period marker (kickoff/half-time/full-time)
_EVENT_LABELS = {
    101: "Goal", 102: "Penalty", 103: "Own goal", 104: "Missed penalty",
    106: "Foul", 108: "Substitution", 110: "Yellow card", 111: "Red card",
    112: "Second yellow", 10001: "Period",
}


def _project_events(root: Dict[int, Any]) -> List[Dict[str, Any]]:
    items = _as_list(_g(root, 10, 1))
    out: List[Dict[str, Any]] = []
    for ev in items:
        if not isinstance(ev, dict):
            continue
        kind = int(_g(ev, 3, default=0) or 0)
        if kind == 10001:
            continue  # skip period markers
        team_id = _g(ev, 2, 1) if isinstance(_g(ev, 2), dict) else None
        minute = _s(_g(ev, 4, default=""))
        score = _s(_g(ev, 5, default=""))
        # field 6 sometimes carries a free-text label (e.g. "Foul")
        label_raw = _s(_g(ev, 6, default=""))
        side = int(_g(ev, 7, default=0) or 0)  # 1=home, 2=away
        player = _g(ev, 10) or _g(ev, 20) or {}
        player_name = _s(_g(player, 3, 2, default="")) if isinstance(player, dict) else ""
        out.append({
            "kind": kind,
            "label": _EVENT_LABELS.get(kind, label_raw or "Event"),
            "minute": minute,
            "score": score,
            "side": "home" if side == 1 else ("away" if side == 2 else ""),
            "team_id": int(team_id) if team_id else 0,
            "player": player_name,
        })
    return out


# Statistic-type codes observed empirically (sportType=1 / football).
_STAT_LABELS = {
    100: "Attaques",
    101: "Attaques dangereuses",
    102: "Possession %",
    103: "Tirs cadrés",
    104: "Tirs non cadrés",
    105: "Corners",
    106: "Fautes",
    107: "Hors-jeux",
    108: "Touches",
    109: "Cartons jaunes",
    110: "Cartons rouges",
    111: "Coups francs",
    112: "Passes",
    113: "Précision passes %",
    114: "Sauvegardes",
    115: "Tacles",
}


def _project_stats(root: Dict[int, Any]) -> List[Dict[str, Any]]:
    """Each stat row carries a metric code (field 3) and home/away values
    (fields 10, 11). We map the code to a human label via _STAT_LABELS."""
    items = _as_list(_g(root, 10, 1))
    out: List[Dict[str, Any]] = []
    for s in items:
        if not isinstance(s, dict):
            continue
        # Prefer the upstream-provided text label if present (path 1.2 / 2),
        # otherwise fall back to the numeric code → French label map.
        code = int(_g(s, 3, default=0) or 0)
        label = (
            _s(_g(s, 1, 2, default=""))
            or _s(_g(s, 2, default=""))
            or _STAT_LABELS.get(code)
            or f"Stat {code}"
        )
        # home/away numeric values are at fields 10 & 11
        home_v = _g(s, 10, default=None)
        away_v = _g(s, 11, default=None)
        if home_v is None and away_v is None:
            home_v = _g(s, 3, default=None)
            away_v = _g(s, 4, default=None)
        if home_v is None and away_v is None and not label:
            continue
        out.append({
            "code": code,
            "label": label,
            "home": _to_num(home_v),
            "away": _to_num(away_v),
        })
    return out


def _to_num(x: Any) -> Any:
    if isinstance(x, dict):
        # nested values are common for stats — try to surface a string repr
        return _g(x, 2, default=None) or _g(x, 1, default=None)
    if isinstance(x, float):
        return round(x, 2)
    return x


# --------------------------------------------------------------------- #
# Public async API used by /api/jack07/*
# --------------------------------------------------------------------- #
@dataclass
class _CacheEntry:
    value: Any
    exp: float


_cache: Dict[str, _CacheEntry] = {}
_locks: Dict[str, asyncio.Lock] = {}


async def _cached(key: str, ttl: float, loader):
    now = time.time()
    ent = _cache.get(key)
    if ent and ent.exp > now:
        return ent.value
    lk = _locks.setdefault(key, asyncio.Lock())
    async with lk:
        # double-check after the lock
        ent = _cache.get(key)
        if ent and ent.exp > now:
            return ent.value
        val = await loader()
        if val is not None:
            _cache[key] = _CacheEntry(val, now + ttl)
        return val


async def fetch_matches(sport_type: int = SPORT_FOOTBALL, language: int = LANG) -> List[Dict[str, Any]]:
    """List live + upcoming matches. Cached 60 s (live data changes fast)."""
    async def _load() -> List[Dict[str, Any]]:
        root = await _fetch_pb("/api/match/live", {"sportType": sport_type, "language": language})
        if not root:
            return []
        items = _as_list(_g(root, 10, 1))
        out = [m for m in (_project_match(x, sport_type) for x in items) if m]
        # Sort: live first (by status), then upcoming by kick-off
        out.sort(key=lambda x: (
            0 if x["is_live"] else (1 if x["status_kind"] == "scheduled" else 2),
            x.get("kick_off_ts") or 0,
        ))
        return out

    return await _cached(f"matches:{sport_type}:{language}", ttl=60.0, loader=_load) or []


async def fetch_detail(match_id: str, sport_type: int = SPORT_FOOTBALL) -> Optional[Dict[str, Any]]:
    """Match details + stream sources list (streamId, name)."""
    async def _load() -> Optional[Dict[str, Any]]:
        root = await _fetch_pb("/api/match/detail", {
            "matchId": match_id, "sportType": sport_type, "language": LANG, "stream": "true",
        })
        if not root:
            return None
        match = _project_match(_g(root, 10, 1) or {}, sport_type)
        if not match:
            return None
        match["streams"] = _project_streams(root)
        return match

    return await _cached(f"detail:{match_id}:{sport_type}", ttl=30.0, loader=_load)


async def fetch_events(match_id: str, sport_type: int = SPORT_FOOTBALL) -> List[Dict[str, Any]]:
    async def _load() -> List[Dict[str, Any]]:
        root = await _fetch_pb("/api/match/event", {
            "matchId": match_id, "sportType": sport_type, "language": LANG,
        })
        return _project_events(root) if root else []

    return await _cached(f"events:{match_id}:{sport_type}", ttl=15.0, loader=_load) or []


async def fetch_stats(match_id: str, sport_type: int = SPORT_FOOTBALL) -> List[Dict[str, Any]]:
    async def _load() -> List[Dict[str, Any]]:
        root = await _fetch_pb("/api/match/statistic", {
            "matchId": match_id, "sportType": sport_type, "language": LANG,
        })
        return _project_stats(root) if root else []

    return await _cached(f"stats:{match_id}:{sport_type}", ttl=15.0, loader=_load) or []



# --------------------------------------------------------------------- #
# Stream URL resolution (ROT47 cipher reversed from /statics/*.js)
# --------------------------------------------------------------------- #
def _rot47(s: str) -> str:
    """ROT47: shift each printable ASCII char by 47 within range 33-126.
    The Jack07 stream URL is encrypted with ROT47 + an 8-byte garbage prefix.
    Their JS does ``Decipher.crypt(url).slice(8)``."""
    out = []
    for c in s:
        n = ord(c)
        if 33 <= n <= 126:
            out.append(chr(33 + ((n - 33 + 47) % 94)))
        else:
            out.append(c)
    return "".join(out)


async def resolve_stream(match_id: str, stream_id: str, site_type: int = 2001, sport_type: int = SPORT_FOOTBALL) -> Optional[str]:
    """Resolve a Jack07 (matchId, streamId, siteType) tuple to a TOKENISED
    m3u8 URL that includes the `/token-<aes>/` path prefix.

    The Jack07 CDN gates every segment behind an outer `/token-<base64>/`
    path segment whose value is AES-CBC(rb-session) (key/iv reversed from
    /statics/*.js). Without this prefix, both the manifest and the segments
    fall into an infinite 302 redirect loop on Cloudflare. We do the AES
    server-side so the browser only ever sees our `/api/hls?t=…` proxy URL.
    """
    async def _load() -> Optional[str]:
        params = {
            "streamId": str(stream_id),
            "siteType": str(site_type),
            "continent": "NA",
            "country": "US",
            "digit": "seth",
            "matchId": str(match_id),
            "sportType": str(sport_type),
        }
        got = await _fetch_pb_with_headers("/api/stream/detail", params)
        if not got:
            return None
        root, headers = got
        enc = _s(_g(root, 10, 2, 4, default=""))
        if not enc:
            return None
        rb_session = headers.get("rb-session") or headers.get("Rb-Session") or ""
        if not rb_session:
            logger.warning("jack07 resolve_stream: rb-session header missing")
            return None
        try:
            decoded = _rot47(enc)
            if len(decoded) < 8:
                return None
            url = decoded[8:]  # strip the 8-byte garbage prefix
            if not url.lower().startswith(("http://", "https://")):
                return None
            return _wrap_with_token(url, rb_session)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"jack07 resolve_stream: {e}")
            return None

    return await _cached(
        f"stream:{match_id}:{stream_id}:{site_type}:{sport_type}",
        ttl=60.0,
        loader=_load,
    )


# AES key/IV verbatim from /statics/*.js (Jack07 SPA bundle).
_JACK07_AES_KEY = bytes([0xa7, 0x98, 0x1c, 0xc9, 0xeb, 0x2f, 0x4d, 0x19,
                         0xdc, 0xfe, 0xa5, 0x7b, 0x10, 0x1e, 0xcd, 0x89])
_JACK07_AES_IV = bytes([0x80, 0x17, 0xd3, 0xa8, 0xf1, 0x40, 0x0d, 0x2f,
                        0, 0, 0, 0, 0, 0, 0, 0])


def _wrap_with_token(url: str, rb_session: str) -> str:
    """Insert /token-{aes_b64(rb_session)}a/ between netloc and the rest of
    the path. Matches what the Jack07 SPA does in Player.vue."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives import padding as _pad
    from urllib.parse import urlparse, quote as _quote
    import base64 as _b64

    padder = _pad.PKCS7(128).padder()
    pt = padder.update(rb_session.encode("utf-8")) + padder.finalize()
    cipher = Cipher(algorithms.AES(_JACK07_AES_KEY), modes.CBC(_JACK07_AES_IV))
    ct = cipher.encryptor().update(pt) + b""
    # IMPORTANT: encode "/" too. The Jack07 SPA uses encodeURIComponent which
    # percent-encodes "/". If left raw, urljoin treats it as a path separator
    # and our /api/hls proxy ends up rewriting segments under a wrong base.
    token = _quote(_b64.b64encode(ct).decode("ascii"), safe="") + "a"

    u = urlparse(url)
    new_path = f"/token-{token}{u.path}"
    rebuilt = f"{u.scheme}://{u.netloc}{new_path}"
    if u.query:
        rebuilt += f"?{u.query}"
    return rebuilt
