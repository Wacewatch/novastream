"""Iteration 7 — validate the public API contracts:
 - /api/v1/public/daddy/channels  → embed_url must point to OUR /embed/daddy/{id},
   never to player.cfbu247.sbs / chat.cfbu247.sbs. No m3u8 / stream URL exposed.
 - /api/v1/public/daddy/channel/{id}  → same.
 - /api/v1/public/sports  → events have `embeds:[{label,embed_url}]`. embed_url
   starts with our domain + /embed/sports/t/{token}. No `source`, no `embedUrl`,
   no upstream streamed.pk URL anywhere in the response.
 - /api/v1/public/football  → matches have `embeds:[]`. embed_url uses our
   /embed/football/t/{token}. No `url`, no `stream_url`, no `has_servers`.
 - /api/v1/public/sports/info  → tv247.us days+channels passthrough.
 - /api/daddy/stream/slug-automoto-la-chaine + slug-18-plus-18 still resolve
   (slug rotation didn't break the resolver).
 - /api/channels?country=France&limit=20 still fast (<2s) thanks to MongoDB cache.
"""
import json
import os
import re
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL is required"

# Public host (host portion of BASE_URL) — used to verify the embed_url
# is hosted on OUR domain.
OUR_HOST_RE = re.compile(r"^https?://[^/]*live-sports-hub-78\.preview\.emergentagent\.com")

# Strings that MUST NEVER appear in the public API responses (regardless of
# their position — JSON value, URL path, anywhere).
LEAK_NEEDLES = (
    "player.cfbu247.sbs",
    "chat.cfbu247.sbs",
    ".m3u8",
    "dlhd.click",
)
# streamed.pk / streamed.su appear legitimately as team-badge image CDNs
# (host_badge / away_badge .webp). They are NOT stream URLs — they're
# public CDN-hosted images. We exclude them from the generic leak scan,
# but we still assert that no `source`/`embedUrl` field is present.


def _assert_no_leaks(payload, label):
    """Recursively scan a JSON-decoded payload — fail if any LEAK_NEEDLES
    string appears as a substring of any string value."""
    blob = json.dumps(payload, ensure_ascii=False)
    found = [n for n in LEAK_NEEDLES if n in blob]
    assert not found, f"{label}: leaked upstream tokens {found} in public payload"
    # Also assert no streamed.pk/su stream-path URL leak (api/match, watch,
    # api/stream are all upstream stream-discovery paths — badge images
    # under /api/images/badge/ are fine).
    for needle in ("streamed.pk/api/match", "streamed.pk/api/stream",
                   "streamed.pk/watch", "streamed.su/api/match",
                   "streamed.su/watch"):
        assert needle not in blob, f"{label}: leaked stream path {needle!r}"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Accept": "application/json"})
    return sess


# ---- Daddy public ---------------------------------------------------------


def test_public_daddy_channels_embed_url_is_ours(s):
    r = s.get(f"{BASE_URL}/api/v1/public/daddy/channels?limit=2", timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data.get("channels"), list) and data["channels"], data
    for ch in data["channels"]:
        assert "embed_url" in ch
        eu = ch["embed_url"]
        assert OUR_HOST_RE.match(eu), f"embed_url not on our host: {eu}"
        assert "/embed/daddy/" in eu, f"embed_url path wrong: {eu}"
        # No upstream / stream fields should be exposed
        for forbidden in ("stream_url", "iframe_url", "m3u8", "source"):
            assert forbidden not in ch, f"forbidden field {forbidden!r} in {ch}"
    _assert_no_leaks(data, "/v1/public/daddy/channels")


def test_public_daddy_channel_single(s):
    # pick a known stable channel id
    r0 = s.get(f"{BASE_URL}/api/v1/public/daddy/channels?limit=5", timeout=20)
    cid = r0.json()["channels"][0]["id"]
    r = s.get(f"{BASE_URL}/api/v1/public/daddy/channel/{cid}", timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    eu = data["embed_url"]
    assert OUR_HOST_RE.match(eu), eu
    assert f"/embed/daddy/{cid}" in eu, eu
    _assert_no_leaks(data, "/v1/public/daddy/channel/{id}")


# ---- Sports public --------------------------------------------------------


def test_public_sports_uses_opaque_token(s):
    r = s.get(f"{BASE_URL}/api/v1/public/sports", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data.get("events"), list)
    if not data["events"]:
        pytest.skip("No sports events available right now")
    sample = None
    for ev in data["events"]:
        assert "source" not in ev, f"`source` leaked at top of event: {ev}"
        assert "embedUrl" not in ev, f"`embedUrl` leaked at top of event: {ev}"
        assert "embeds" in ev and isinstance(ev["embeds"], list)
        for e in ev["embeds"]:
            assert set(e.keys()) <= {"label", "embed_url"}, e
            assert OUR_HOST_RE.match(e["embed_url"]), e["embed_url"]
            assert "/embed/sports/t/" in e["embed_url"], e["embed_url"]
            # token after /t/ should be base64url-ish (no +, /, =)
            tail = e["embed_url"].split("/embed/sports/t/", 1)[1].split("?", 1)[0]
            assert re.match(r"^[A-Za-z0-9_-]+$", tail), f"token not base64url: {tail!r}"
            sample = e["embed_url"]
        if ev["embeds"]:
            break
    assert sample, "No event had any embeds — cannot validate token shape"
    _assert_no_leaks(data, "/v1/public/sports")


# ---- Football public ------------------------------------------------------


def test_public_football_no_raw_stream_fields(s):
    r = s.get(f"{BASE_URL}/api/v1/public/football", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data.get("matches"), list)
    for m in data["matches"]:
        for forbidden in ("url", "stream_url", "has_servers", "server_count"):
            assert forbidden not in m, f"`{forbidden}` leaked in football match {m.get('id')}"
        assert "embeds" in m and isinstance(m["embeds"], list)
        for e in m["embeds"]:
            assert set(e.keys()) <= {"label", "embed_url"}, e
            assert OUR_HOST_RE.match(e["embed_url"]), e["embed_url"]
            assert "/embed/football/t/" in e["embed_url"], e["embed_url"]
    _assert_no_leaks(data, "/v1/public/football")


# ---- Sports info passthrough ----------------------------------------------


def test_public_sports_info(s):
    r = s.get(f"{BASE_URL}/api/v1/public/sports/info", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    # tv247.us schema: { days: [ { date, channels: [...] } ], ... }
    assert "days" in data or "schedule" in data, list(data.keys())
    _assert_no_leaks(data, "/v1/public/sports/info")


# ---- Slug rotation resolver ----------------------------------------------


@pytest.mark.parametrize("slug", ["slug-automoto-la-chaine", "slug-18-plus-18"])
def test_daddy_stream_slug_resolver(s, slug):
    r = s.get(f"{BASE_URL}/api/daddy/stream/{slug}", timeout=45)
    assert r.status_code == 200, f"{slug} -> {r.status_code} {r.text[:300]}"
    data = r.json()
    # The slug resolver must yield at least one playable URL (iframe_url
    # is always populated; stream_url may be empty on upstream 502 but the
    # endpoint itself should not 404/500).
    assert data.get("iframe_url") or data.get("stream_url"), f"{slug}: no urls -> {data}"


# ---- Cache regression -----------------------------------------------------


def test_channels_france_under_2s(s):
    # Warm-up
    s.get(f"{BASE_URL}/api/channels?country=France&limit=20", timeout=10)
    t0 = time.time()
    r = s.get(f"{BASE_URL}/api/channels?country=France&limit=20", timeout=10)
    dt = time.time() - t0
    assert r.status_code == 200
    assert dt < 2.0, f"/api/channels France took {dt:.2f}s (>=2s)"
    data = r.json()
    assert isinstance(data.get("channels"), list)
    assert len(data["channels"]) > 0
