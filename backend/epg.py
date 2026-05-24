"""LiveWatch EPG module.

Downloads free XMLTV guides (FR + UK + global) once every 6 hours, parses
them in a memory-efficient way (iterparse over the gzipped XML) and exposes
``/api/epg/now`` to return the current + next programmes for a given channel
name. Channel matching is done via a normalized slug derived from the
``<display-name>`` and ``id`` attributes.

Notes:
- No API key required (free, public XMLTV mirrors).
- Cached in-memory; safe for 1000+ concurrent viewers.
- Falls back silently if every upstream source fails.
"""
from __future__ import annotations

import asyncio
import gzip
import io
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger("livewatch.epg")

# ---------- Sources (free, public, no key required) ----------
# epgshare01 publishes daily-updated XMLTV files for many regions. We pull
# only the regions we care about (FR primary, BE, CH, UK, ES, IT, DE, US).
EPG_SOURCES: List[str] = [
    "https://epgshare01.online/epgshare01/epg_ripper_FR1.xml.gz",
    "https://epgshare01.online/epgshare01/epg_ripper_BE1.xml.gz",
    "https://epgshare01.online/epgshare01/epg_ripper_CH1.xml.gz",
    "https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz",
    "https://epgshare01.online/epgshare01/epg_ripper_ES1.xml.gz",
    "https://epgshare01.online/epgshare01/epg_ripper_IT1.xml.gz",
    "https://epgshare01.online/epgshare01/epg_ripper_DE1.xml.gz",
    "https://epgshare01.online/epgshare01/epg_ripper_US1.xml.gz",
]

REFRESH_TTL = 6 * 3600.0  # 6 hours
NEGATIVE_TTL = 600.0      # retry after 10 min if all sources fail

_index_lock = asyncio.Lock()
_state: Dict[str, Any] = {
    "ts": 0.0,            # last successful build timestamp
    "last_try": 0.0,      # last attempt (incl. failures)
    "by_slug": {},        # slug -> [{start, stop, title, desc, sub_title, category, channel}]
    "channels": {},       # channel_id -> {display_names: [...], slugs: [...]}
    "sources_loaded": [], # urls that were merged successfully
}

_get_http_client = None  # type: ignore


def init_epg(*, get_http_client) -> None:
    global _get_http_client
    _get_http_client = get_http_client


# ---------- Slug helpers ----------
_HD_SUFFIX_RE = re.compile(
    r"\b(uhd|fhd|hd|sd|4k|hevc|h265|h\.265|backup|main|alt|fr|en|de|es|it|tnt|live|stream)\b",
    re.I,
)
_PAREN_RE = re.compile(r"[\[\(].*?[\]\)]")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    if not name:
        return ""
    s = name.lower()
    s = _PAREN_RE.sub(" ", s)
    s = _HD_SUFFIX_RE.sub(" ", s)
    s = _NON_ALNUM_RE.sub("", s)
    return s


def candidate_slugs(name: str) -> List[str]:
    """Return several variants because some EPG ids are like 'TF1.fr' while
    Vavoo gives 'TF1 HD' — also try with/without numbers attached."""
    if not name:
        return []
    out = []
    s = slugify(name)
    if s:
        out.append(s)
    # Without trailing digits ("france2" -> "france")
    s2 = re.sub(r"\d+$", "", s)
    if s2 and s2 != s:
        out.append(s2)
    # First word
    first = re.split(r"\s+", name.strip(), maxsplit=1)[0] if name.strip() else ""
    sf = slugify(first)
    if sf and sf not in out:
        out.append(sf)
    return out


# ---------- XMLTV parse ----------
def _parse_xmltv_time(s: str) -> Optional[float]:
    """XMLTV format: 'YYYYMMDDHHMMSS +0200' or '+HHMM'."""
    if not s:
        return None
    try:
        s = s.strip()
        # Split offset
        m = re.match(r"^(\d{14})\s*([+-]\d{4})?$", s)
        if not m:
            return None
        base = m.group(1)
        off = m.group(2) or "+0000"
        dt = datetime.strptime(base, "%Y%m%d%H%M%S")
        sign = 1 if off[0] == "+" else -1
        oh = int(off[1:3])
        om = int(off[3:5])
        # We treat the time as that local tz, convert to UTC epoch
        offset_seconds = sign * (oh * 3600 + om * 60)
        utc_dt = dt.replace(tzinfo=timezone.utc)
        return utc_dt.timestamp() - offset_seconds
    except Exception:
        return None


def _ingest_xml_bytes(xml_bytes: bytes, into: Dict[str, Any]) -> int:
    """Parse one XMLTV blob and merge into `into` state. Returns # programmes."""
    by_slug: Dict[str, List[Dict[str, Any]]] = into["by_slug"]
    channels: Dict[str, Dict[str, Any]] = into["channels"]
    count = 0

    # Build channel slug map from <channel> blocks first (iterparse).
    f = io.BytesIO(xml_bytes)
    chan_to_slugs: Dict[str, List[str]] = {}
    try:
        for event, elem in ET.iterparse(f, events=("end",)):
            if elem.tag == "channel":
                cid = elem.attrib.get("id", "")
                names: List[str] = []
                for dn in elem.findall("display-name"):
                    if dn.text:
                        names.append(dn.text.strip())
                slugs: List[str] = []
                for n in [cid] + names:
                    for s in candidate_slugs(n):
                        if s and s not in slugs:
                            slugs.append(s)
                if cid:
                    chan_to_slugs[cid] = slugs
                    channels[cid] = {"display_names": names, "slugs": slugs}
                elem.clear()
            elif elem.tag == "programme":
                # Skip in first pass
                pass
    except ET.ParseError as e:
        logger.warning("epg parse (channels) error: %s", e)

    # Second pass: programmes.
    f2 = io.BytesIO(xml_bytes)
    try:
        for event, elem in ET.iterparse(f2, events=("end",)):
            if elem.tag == "programme":
                cid = elem.attrib.get("channel", "")
                if cid and cid in chan_to_slugs:
                    title_el = elem.find("title")
                    desc_el = elem.find("desc")
                    sub_el = elem.find("sub-title")
                    cat_el = elem.find("category")
                    title = (title_el.text or "").strip() if title_el is not None else ""
                    desc = (desc_el.text or "").strip() if desc_el is not None else ""
                    sub_title = (sub_el.text or "").strip() if sub_el is not None else ""
                    category = (cat_el.text or "").strip() if cat_el is not None else ""
                    start = _parse_xmltv_time(elem.attrib.get("start", ""))
                    stop = _parse_xmltv_time(elem.attrib.get("stop", ""))
                    if start and stop and stop > start and title:
                        entry = {
                            "start": start,
                            "stop": stop,
                            "title": title,
                            "desc": desc,
                            "sub_title": sub_title,
                            "category": category,
                            "channel": cid,
                        }
                        for s in chan_to_slugs[cid]:
                            by_slug.setdefault(s, []).append(entry)
                        count += 1
                elem.clear()
    except ET.ParseError as e:
        logger.warning("epg parse (programmes) error: %s", e)

    return count


async def _fetch_source(url: str) -> Optional[bytes]:
    if _get_http_client is None:
        return None
    cx: httpx.AsyncClient = await _get_http_client()
    try:
        r = await cx.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (LiveWatch EPG)"},
            timeout=60.0,
            follow_redirects=True,
        )
        if r.status_code != 200:
            logger.warning("epg fetch %s -> %s", url, r.status_code)
            return None
        body = r.content
        # Try gzip decompress (sources end with .xml.gz)
        if url.endswith(".gz") or body[:2] == b"\x1f\x8b":
            try:
                body = gzip.decompress(body)
            except Exception:
                pass
        return body
    except Exception as e:  # noqa: BLE001
        logger.warning("epg fetch %s exc: %s", url, e)
        return None


async def _build_index() -> None:
    now = time.time()
    if now - _state["last_try"] < NEGATIVE_TTL and not _state["by_slug"]:
        return
    if _state["by_slug"] and now - _state["ts"] < REFRESH_TTL:
        return
    async with _index_lock:
        if _state["by_slug"] and time.time() - _state["ts"] < REFRESH_TTL:
            return
        _state["last_try"] = time.time()
        new_state: Dict[str, Any] = {"by_slug": {}, "channels": {}, "sources_loaded": []}
        # Fetch all sources concurrently
        results = await asyncio.gather(*[_fetch_source(u) for u in EPG_SOURCES], return_exceptions=True)
        for url, body in zip(EPG_SOURCES, results):
            if isinstance(body, Exception) or not body:
                continue
            try:
                n = _ingest_xml_bytes(body, new_state)
                if n > 0:
                    new_state["sources_loaded"].append(url)
                    logger.info("epg merged %s (%d programmes)", url, n)
            except Exception as e:  # noqa: BLE001
                logger.warning("epg ingest %s failed: %s", url, e)
        if new_state["by_slug"]:
            # Sort programmes per slug by start
            for slug, progs in new_state["by_slug"].items():
                progs.sort(key=lambda p: p["start"])
            _state["by_slug"] = new_state["by_slug"]
            _state["channels"] = new_state["channels"]
            _state["sources_loaded"] = new_state["sources_loaded"]
            _state["ts"] = time.time()
            logger.info(
                "epg index built: %d slugs, %d sources",
                len(_state["by_slug"]),
                len(_state["sources_loaded"]),
            )


def _find_now_next(slug_variants: List[str], now_ts: float) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    by_slug = _state["by_slug"]
    progs: List[Dict[str, Any]] = []
    for s in slug_variants:
        if s in by_slug:
            progs = by_slug[s]
            break
    if not progs:
        return (None, None)
    cur: Optional[Dict[str, Any]] = None
    nxt: Optional[Dict[str, Any]] = None
    for p in progs:
        if p["start"] <= now_ts < p["stop"]:
            cur = p
        elif p["start"] > now_ts:
            nxt = p
            break
    return (cur, nxt)


def _serialize_prog(p: Dict[str, Any], now_ts: float) -> Dict[str, Any]:
    duration = max(1.0, p["stop"] - p["start"])
    elapsed = max(0.0, min(duration, now_ts - p["start"]))
    return {
        "title": p["title"],
        "sub_title": p.get("sub_title", ""),
        "desc": p.get("desc", ""),
        "category": p.get("category", ""),
        "start": int(p["start"]),
        "stop": int(p["stop"]),
        "start_iso": datetime.fromtimestamp(p["start"], tz=timezone.utc).isoformat(),
        "stop_iso": datetime.fromtimestamp(p["stop"], tz=timezone.utc).isoformat(),
        "duration_sec": int(duration),
        "elapsed_sec": int(elapsed),
        "progress": round(elapsed / duration, 4) if duration > 0 else 0.0,
        "remaining_sec": int(max(0.0, p["stop"] - now_ts)),
    }


# ---------- Router ----------
epg_router = APIRouter()


@epg_router.get("/epg/now")
async def epg_now(name: str = Query("", description="Channel name (e.g. 'TF1 HD')")):
    """Return current + next programme for the given channel display name.

    Response: {channel: str|None, current: {…}|None, next: {…}|None,
               sources_loaded: int, slugs_tried: [str]}
    """
    if not name.strip():
        return {"channel": None, "current": None, "next": None, "sources_loaded": 0, "slugs_tried": []}
    # Ensure index is loaded (non-blocking refresh policy enforced inside)
    if not _state["by_slug"]:
        try:
            await asyncio.wait_for(_build_index(), timeout=20.0)
        except asyncio.TimeoutError:
            logger.warning("epg build timeout — returning empty for %s", name)
    else:
        # fire-and-forget refresh if stale (don't block the request)
        if time.time() - _state["ts"] > REFRESH_TTL:
            asyncio.create_task(_build_index())

    now_ts = time.time()
    slugs = candidate_slugs(name)
    cur, nxt = _find_now_next(slugs, now_ts)
    matched = None
    if cur or nxt:
        matched = (cur or nxt)["channel"]
    return {
        "channel": matched,
        "current": _serialize_prog(cur, now_ts) if cur else None,
        "next": _serialize_prog(nxt, now_ts) if nxt else None,
        "sources_loaded": len(_state["sources_loaded"]),
        "slugs_tried": slugs,
    }


@epg_router.get("/epg/status")
async def epg_status():
    """Diagnostic endpoint — how many slugs are indexed, when, from which sources."""
    return {
        "indexed_slugs": len(_state["by_slug"]),
        "indexed_channels": len(_state["channels"]),
        "sources_loaded": _state["sources_loaded"],
        "last_build_ts": int(_state["ts"]),
        "age_sec": int(time.time() - _state["ts"]) if _state["ts"] else None,
    }


@epg_router.post("/epg/refresh")
async def epg_refresh():
    """Force a rebuild (admin convenience — not protected but cheap)."""
    _state["ts"] = 0.0
    _state["last_try"] = 0.0
    await _build_index()
    return {
        "indexed_slugs": len(_state["by_slug"]),
        "sources_loaded": _state["sources_loaded"],
    }
