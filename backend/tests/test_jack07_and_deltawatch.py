"""
Backend tests for iteration 8:
1. Jack07 TV endpoints (/api/jack07/*)
2. Public Jack07 endpoints (/api/v1/public/jack07/*) - no leakage
3. Embed redirect (/embed/jack07/t/<token>)
4. Vavoo TV channel resolution + Deltawatch HLS proxy (manifest + segments)
"""
import base64
import os
import re
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://preview-env-40.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def matches_payload(session):
    r = session.get(f"{BASE_URL}/api/jack07/matches", timeout=60)
    assert r.status_code == 200, f"status {r.status_code} body={r.text[:300]}"
    return r.json()


# ---------- Jack07 matches ----------
class TestJack07Matches:
    def test_matches_returns_at_least_one(self, matches_payload):
        data = matches_payload
        assert "matches" in data
        assert isinstance(data["matches"], list)
        assert len(data["matches"]) >= 1

    def test_match_shape(self, matches_payload):
        m = matches_payload["matches"][0]
        for k in ["id", "title", "league", "home", "away",
                  "status_label", "is_live", "kick_off_iso", "status_kind"]:
            assert k in m, f"missing {k}; keys={list(m.keys())}"
        assert isinstance(m["league"].get("name"), str)
        for side in ("home", "away"):
            s = m[side]
            assert "id" in s and "name" in s and "logo" in s
        assert isinstance(m["is_live"], bool)

    def test_totals_consistent(self, matches_payload):
        d = matches_payload
        for key in ("total", "live_count", "upcoming_count", "finished_count", "leagues"):
            assert key in d, f"missing top-level key {key}"
        assert d["total"] == d["live_count"] + d["upcoming_count"] + d["finished_count"], \
            f"total mismatch: {d['total']} vs {d['live_count']}+{d['upcoming_count']}+{d['finished_count']}"


# ---------- Jack07 detail / events / stats / streams ----------
class TestJack07Detail:
    @pytest.fixture(scope="class")
    def first_match_id(self, session):
        r = session.get(f"{BASE_URL}/api/jack07/matches", timeout=60)
        return r.json()["matches"][0]["id"]

    def test_detail(self, session, first_match_id):
        r = session.get(f"{BASE_URL}/api/jack07/detail/{first_match_id}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "site_url" in d
        assert isinstance(d["site_url"], str)
        assert "jack07eo.mpstickv5m73jgravity.my" in d["site_url"], d["site_url"]
        assert d["site_url"].endswith(".html") or "/football/" in d["site_url"]
        assert "streams" in d and isinstance(d["streams"], list)
        for s in d["streams"]:
            assert "id" in s
            assert isinstance(s.get("name"), str)
        # projection fields
        for k in ("id", "title", "league", "home", "away", "status_label", "is_live"):
            assert k in d, f"missing projection field {k}"

    def test_events(self, session, first_match_id):
        r = session.get(f"{BASE_URL}/api/jack07/events/{first_match_id}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "events" in d and isinstance(d["events"], list)
        for ev in d["events"]:
            assert isinstance(ev.get("kind"), int)
            assert isinstance(ev.get("label"), str)
            assert isinstance(ev.get("minute"), str)
            assert ev.get("side") in ("home", "away", "")
            assert isinstance(ev.get("player"), str)

    def test_stats(self, session, first_match_id):
        r = session.get(f"{BASE_URL}/api/jack07/stats/{first_match_id}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "stats" in d and isinstance(d["stats"], list)
        for st in d["stats"]:
            assert isinstance(st.get("code"), int)
            assert isinstance(st.get("label"), str)
            for fld in ("home", "away"):
                v = st.get(fld)
                assert isinstance(v, (int, float)), f"{fld}={v!r} not numeric"

    def test_streams_endpoint(self, session, first_match_id):
        r = session.get(f"{BASE_URL}/api/jack07/streams/{first_match_id}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "site_url" in d
        assert "streams" in d and isinstance(d["streams"], list)


# ---------- Public Jack07 (no leakage) ----------
class TestJack07Public:
    def test_public_matches_no_leak(self, session):
        r = session.get(f"{BASE_URL}/api/v1/public/jack07/matches", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        matches = d.get("matches", [])
        assert len(matches) >= 1, "expected at least one public match"
        sample = matches[0]
        # has embeds
        assert "embeds" in sample and isinstance(sample["embeds"], list)
        for e in sample["embeds"]:
            assert "label" in e and "embed_url" in e
            assert isinstance(e["label"], str)
            assert isinstance(e["embed_url"], str)
        # no leakage
        body = r.text
        for leak in ("jack07eo.mpstickv5m73jgravity.my",
                     "league_slug", "match_slug", "season_slug", "site_url"):
            assert leak not in body, f"public response leaks: {leak}"


# ---------- Embed redirect ----------
class TestJack07EmbedRedirect:
    def test_token_redirect(self, session):
        # use a sample match id
        r = session.get(f"{BASE_URL}/api/jack07/matches", timeout=60)
        mid = r.json()["matches"][0]["id"]
        token = base64.urlsafe_b64encode(mid.encode()).decode().rstrip("=")
        r2 = requests.get(f"{BASE_URL}/embed/jack07/t/{token}", allow_redirects=False, timeout=20)
        assert r2.status_code in (301, 302, 307, 308), f"got {r2.status_code} body={r2.text[:200]}"
        loc = r2.headers.get("location", "")
        assert f"/embed/jack07/{mid}" in loc, f"location={loc!r}"


# ---------- Vavoo + Deltawatch ----------
class TestVavooDeltawatch:
    @pytest.fixture(scope="class")
    def french_channel_id(self, session):
        r = session.get(f"{BASE_URL}/api/channels?country=France", timeout=60)
        assert r.status_code == 200, r.text[:300]
        items = r.json()
        if isinstance(items, dict):
            items = items.get("channels") or items.get("items") or []
        assert len(items) >= 1, "no French channels"
        # find first id
        cid = None
        for c in items:
            cid = c.get("id") or c.get("channel_id") or c.get("uuid")
            if cid:
                break
        assert cid, f"no id field in first French channel: {items[0]}"
        return str(cid)

    def test_stream_resolves_via_deltawatch(self, session, french_channel_id):
        r = session.get(f"{BASE_URL}/api/stream/{french_channel_id}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        # find an hls token URL
        # The response may have proxy_url or url field
        proxy = d.get("proxy_url") or d.get("url") or d.get("stream_url") or ""
        assert "/api/hls?t=" in proxy, f"no /api/hls?t= in resolved url: {proxy[:300]} | full={d}"
        token = proxy.split("t=", 1)[1].split("&", 1)[0]
        r2 = requests.get(f"{BASE_URL}/api/hls?t={token}", timeout=60)
        assert r2.status_code == 200, f"manifest status {r2.status_code} body={r2.text[:200]}"
        body = r2.text
        assert body.startswith("#EXTM3U"), f"not m3u8: {body[:120]!r}"
        # find segment urls /api/hls?t=
        seg_tokens = re.findall(r"/api/hls\?t=([A-Za-z0-9_\-]+)", body)
        assert len(seg_tokens) >= 1, f"no segment tokens in manifest:\n{body[:500]}"
        # check token decodes to deltawatch URL
        for st in seg_tokens[:3]:
            padded = st + "=" * (-len(st) % 4)
            try:
                decoded = base64.urlsafe_b64decode(padded.encode()).decode("utf-8", errors="replace")
            except Exception as e:
                pytest.fail(f"seg token decode failed: {e}")
            if "apis.wavewatch.top/deltawatch.php" in decoded and "hls_segment" in decoded:
                # found deltawatch wrap — fetch segment
                r3 = requests.get(f"{BASE_URL}/api/hls?t={st}", timeout=60, stream=True)
                assert r3.status_code == 200, f"seg status {r3.status_code}"
                ct = r3.headers.get("content-type", "").lower()
                assert any(c in ct for c in ("video/mp2t", "application/octet-stream", "video/")), f"unexpected content-type {ct}"
                content = r3.raw.read(300_000)
                assert len(content) > 100_000, f"segment too small: {len(content)}"
                return
        # If none of segment tokens wraps to deltawatch, that's a routing failure
        first_decoded = base64.urlsafe_b64decode(seg_tokens[0] + "=" * (-len(seg_tokens[0]) % 4)).decode("utf-8", errors="replace")
        pytest.fail(f"no segment routed via Deltawatch. first decoded: {first_decoded[:300]}")
