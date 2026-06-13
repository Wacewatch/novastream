"""
Iter 10 backend tests — Jack07 manifest-proxy strategy + expanded sports
+ all-matches combined endpoint + regular TV channel cache headers.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Accept": "application/json"})
    return sess


# ----- Sports list expanded -----
class TestJack07Sports:
    def test_sports_list_has_at_least_14(self, s):
        r = s.get(f"{API}/jack07/sports", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        sports = data["sports"]
        ids = {sp["id"] for sp in sports}
        # Original 7 + new 7
        required = {1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16}
        assert required.issubset(ids), f"Missing ids: {required - ids}"
        assert len(sports) >= 14


# ----- All-matches combined endpoint -----
class TestJack07AllMatches:
    def test_all_matches_returns_combined_payload(self, s):
        r = s.get(f"{API}/jack07/all-matches", timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["sport"] == "Tous les sports"
        assert data["sport_slug"] == "all"
        assert data["sport_type"] == 0
        matches = data["matches"]
        assert isinstance(matches, list)
        # If upstream healthy, expect many
        assert data["total"] == len(matches)
        # diverse sports
        unique_sports = {m.get("sport") for m in matches if m.get("sport")}
        # At least 3 distinct sport names
        assert len(unique_sports) >= 3, f"Only saw sports: {unique_sports}"


# ----- Streams: dual-mode (manifest_url + api_url) -----
class TestJack07StreamsDualMode:
    def test_streams_have_both_manifest_and_api_url(self, s):
        # Find a match with sources from live football
        r = s.get(f"{API}/jack07/matches?sport=1", timeout=45)
        assert r.status_code == 200
        matches = r.json().get("matches", [])
        # Try live first, then any
        candidates = [m for m in matches if m.get("is_live")] + matches
        match_with_streams = None
        used_streams = None
        for m in candidates[:15]:
            mid = m.get("id")
            if not mid:
                continue
            sr = s.get(f"{API}/jack07/streams/{mid}?sport=1", timeout=30)
            if sr.status_code != 200:
                continue
            streams = sr.json().get("streams") or []
            if streams:
                match_with_streams = mid
                used_streams = streams
                break
        if not match_with_streams:
            pytest.skip("No match with streams available right now")
        for st in used_streams:
            assert "manifest_url" in st
            assert st["manifest_url"].startswith("/api/jack07/manifest/"), st["manifest_url"]
            assert "api_url" in st
            assert st["api_url"].startswith("https://apis-data10.tcore131ybdf.ru/"), st["api_url"]


# ----- Manifest proxy endpoint -----
class TestJack07ManifestProxy:
    def test_manifest_proxy_returns_m3u8_with_absolute_segments(self, s):
        # Locate a live match + stream id
        r = s.get(f"{API}/jack07/matches?sport=1", timeout=45)
        matches = r.json().get("matches", [])
        live = [m for m in matches if m.get("is_live")]
        if not live:
            pytest.skip("No live football match available to test manifest proxy")
        match_id = None
        stream_id = None
        site_type = 2001
        for m in live[:10]:
            mid = m.get("id")
            sr = s.get(f"{API}/jack07/streams/{mid}?sport=1", timeout=30)
            if sr.status_code != 200:
                continue
            streams = sr.json().get("streams") or []
            if streams:
                match_id = mid
                stream_id = streams[0]["id"]
                # parse site_type from manifest_url
                if "site_type=" in streams[0]["manifest_url"]:
                    try:
                        site_type = int(streams[0]["manifest_url"].split("site_type=")[1].split("&")[0])
                    except Exception:
                        pass
                break
        if not match_id:
            pytest.skip("No live stream available to resolve manifest")
        mr = s.get(
            f"{API}/jack07/manifest/{match_id}/{stream_id}",
            params={"site_type": site_type, "sport": 1},
            timeout=30,
        )
        if mr.status_code != 200:
            pytest.skip(f"Upstream manifest returned {mr.status_code} (geo/CDN may have blocked our IP)")
        # Headers
        ct = mr.headers.get("content-type", "")
        assert "application/vnd.apple.mpegurl" in ct, ct
        assert mr.headers.get("Access-Control-Allow-Origin") == "*"
        # Body
        body = mr.text
        assert body.startswith("#EXTM3U"), body[:80]
        # At least one segment line should be absolute upstream URL
        seg_lines = [ln for ln in body.splitlines() if ln and not ln.startswith("#")]
        assert seg_lines, "No segment lines in manifest"
        # Should be absolute http(s) URLs - not relative or proxied
        for ln in seg_lines[:5]:
            assert ln.startswith("http"), f"Segment not absolute: {ln}"
            assert "/api/hls" not in ln, f"Segment proxied through /api/hls: {ln}"


# ----- Regular TV channel headers -----
class TestRegularChannelStream:
    def test_channel_stream_has_cors_header(self, s):
        # Pick first channel
        r = s.get(f"{API}/channels?limit=1", timeout=20)
        if r.status_code != 200:
            pytest.skip(f"/api/channels returned {r.status_code}")
        items = r.json()
        if isinstance(items, dict):
            items = items.get("channels") or items.get("items") or []
        if not items:
            pytest.skip("No channels available")
        cid = items[0].get("id") or items[0].get("_id") or items[0].get("channel_id")
        if not cid:
            pytest.skip("Channel has no id")
        sr = s.get(f"{API}/stream/{cid}", timeout=30)
        if sr.status_code != 200:
            pytest.skip(f"/api/stream/{cid} returned {sr.status_code}")
        proxy_url = sr.json().get("proxy_url") or sr.json().get("url")
        if not proxy_url:
            pytest.skip("No proxy_url in stream response")
        # Backend may return relative path
        if proxy_url.startswith("/"):
            proxy_url = BASE_URL + proxy_url
        pr = s.get(proxy_url, timeout=30)
        assert pr.status_code == 200, pr.text[:200]
        assert pr.headers.get("Access-Control-Allow-Origin") == "*"
        # Should be m3u8
        ct = pr.headers.get("content-type", "")
        assert any(t in ct.lower() for t in ["mpegurl", "octet-stream", "text/plain", "application/x"]), ct
        assert pr.text.startswith("#EXT"), pr.text[:80]
