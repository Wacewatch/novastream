"""
Iteration 8 - Jack07 multi-sport tests.

Validates:
- GET /api/jack07/sports returns the 7 expected sports
- GET /api/jack07/matches?sport=N returns matches with sport/sport_slug/sport_type
- Invalid sport returns 400
- Logo URLs are not on the dead host and resolve (200 + image/*)
- GET /api/jack07/streams/{id}?sport=N returns proxy_url starting with /api/hls?t=
- The proxy_url manifest fetches as HTTP 200 with the right content-type and #EXTM3U
- Segment URLs inside the manifest are also rewritten through the proxy
"""
import os
import re
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

EXPECTED_SPORTS = {
    1: ("Football", "football"),
    2: ("Basketball", "basketball"),
    3: ("Tennis", "tennis"),
    4: ("Baseball", "baseball"),
    6: ("Cricket", "cricket"),
    7: ("Motorsport", "motorsport"),
    8: ("Rugby", "rugby"),
}

DEAD_HOST = "logos1.tcrbg61levl.cfd"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


# ---------- /api/jack07/sports ----------
class TestJack07Sports:
    def test_sports_endpoint_lists_seven(self, session):
        r = session.get(f"{BASE_URL}/api/jack07/sports", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "sports" in data
        sports = data["sports"]
        assert isinstance(sports, list)
        assert len(sports) == 7, f"expected 7 sports, got {len(sports)}: {sports}"
        by_id = {s["id"]: s for s in sports}
        for sid, (label, slug) in EXPECTED_SPORTS.items():
            assert sid in by_id, f"missing sport id {sid}"
            assert by_id[sid]["label"] == label, f"sport {sid} label mismatch {by_id[sid]}"
            assert by_id[sid]["slug"] == slug, f"sport {sid} slug mismatch {by_id[sid]}"


# ---------- /api/jack07/matches ----------
class TestJack07MatchesPerSport:
    @pytest.mark.parametrize("sport_id,label,slug", [
        (1, "Football", "football"),
        (2, "Basketball", "basketball"),
        (3, "Tennis", "tennis"),
    ])
    def test_matches_for_sport(self, session, sport_id, label, slug):
        r = session.get(f"{BASE_URL}/api/jack07/matches?sport={sport_id}", timeout=60)
        assert r.status_code == 200, f"sport={sport_id} status={r.status_code} body={r.text[:300]}"
        data = r.json()
        assert data.get("sport") == label
        assert data.get("sport_slug") == slug
        assert data.get("sport_type") == sport_id
        matches = data.get("matches", [])
        assert isinstance(matches, list)
        # Jack07 live API has live + scheduled + finished — at least some entries expected
        # but Tennis/Basketball can occasionally be empty in off-season; we only assert structure
        if matches:
            m = matches[0]
            assert m.get("sport") == label, f"per-match sport mismatch: {m.get('sport')}"
            assert m.get("sport_slug") == slug
            assert m.get("sport_type") == sport_id
            assert (m.get("league") or {}).get("name"), "league.name missing"
            # Either home/away names or a populated title with "vs" must exist for at least
            # one match (Tennis uses a different protobuf schema and may leave home/away null
            # — title still carries the player matchup).
            ok = []
            for mm in matches:
                title = (mm.get("title") or "").lower()
                h = (mm.get("home") or {}).get("name") if mm.get("home") else ""
                a = (mm.get("away") or {}).get("name") if mm.get("away") else ""
                if (h and a) or ("vs" in title and len(title) > 4):
                    ok.append(mm)
            assert ok, f"no match in {label} has identifiable opponents (title or home/away)"

    def test_football_total_positive(self, session):
        r = session.get(f"{BASE_URL}/api/jack07/matches?sport=1", timeout=60)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data.get("total", 0) > 0, "expected football to have at least one match"

    def test_invalid_sport_returns_400(self, session):
        r = session.get(f"{BASE_URL}/api/jack07/matches?sport=99", timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code} body={r.text[:300]}"


# ---------- Logo host rewrite + reachability ----------
class TestJack07LogosFixed:
    def test_logos_not_on_dead_host_and_reachable(self, session):
        r = session.get(f"{BASE_URL}/api/jack07/matches?sport=1", timeout=60)
        assert r.status_code == 200
        matches = r.json().get("matches", [])
        assert matches, "need at least one football match for logo check"

        body = r.text
        assert DEAD_HOST not in body, f"dead host {DEAD_HOST} still present in matches payload"

        # Pick a match with all three logo URLs and check at least one is reachable & image/*
        checked = 0
        for m in matches[:10]:
            for url in [
                (m.get("home") or {}).get("logo"),
                (m.get("away") or {}).get("logo"),
                (m.get("league") or {}).get("logo"),
            ]:
                if not url or not isinstance(url, str) or not url.startswith("http"):
                    continue
                try:
                    rr = requests.get(url, timeout=15, stream=True)
                    if rr.status_code == 200:
                        ct = rr.headers.get("content-type", "").lower()
                        if ct.startswith("image/") or "image" in ct:
                            checked += 1
                            break
                except requests.RequestException:
                    continue
            if checked >= 1:
                break
        assert checked >= 1, "no Football match logo returned HTTP 200 with image/* content-type"


# ---------- Streams: signed proxy + manifest fetch + segment rewrite ----------
class TestJack07ProxyStream:
    @pytest.fixture(scope="class")
    def live_football_match_id(self):
        r = requests.get(f"{BASE_URL}/api/jack07/matches?sport=1", timeout=60)
        assert r.status_code == 200
        matches = r.json().get("matches", [])
        live = [m for m in matches if m.get("is_live")]
        if not live:
            assert matches, "no football matches at all"
            return matches[0]["id"]
        # Find a live match that actually has streams resolvable right now
        for m in live:
            try:
                rr = requests.get(f"{BASE_URL}/api/jack07/streams/{m['id']}?sport=1", timeout=30)
                if rr.status_code == 200 and rr.json().get("streams"):
                    return m["id"]
            except requests.RequestException:
                continue
        # Fallback to first live anyway
        return live[0]["id"]

    def test_streams_returns_signed_proxy_url(self, live_football_match_id):
        r = requests.get(
            f"{BASE_URL}/api/jack07/streams/{live_football_match_id}?sport=1",
            timeout=60,
        )
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "streams" in d and isinstance(d["streams"], list)
        assert "site_url" in d
        if not d["streams"]:
            pytest.skip("match has no resolvable streams right now")
        for s in d["streams"]:
            proxy = s.get("proxy_url", "")
            assert proxy.startswith("/api/hls?t="), f"proxy_url not signed: {proxy[:200]}"
            # No raw upstream leak
            assert "http" not in proxy, f"proxy_url leaks raw URL: {proxy[:200]}"

    def test_manifest_fetch_via_proxy(self, live_football_match_id):
        r = requests.get(
            f"{BASE_URL}/api/jack07/streams/{live_football_match_id}?sport=1",
            timeout=60,
        )
        assert r.status_code == 200
        d = r.json()
        streams = d.get("streams") or []
        if not streams:
            pytest.skip("no resolvable streams")
        # Try each stream until one returns a playable manifest
        last_err = None
        for s in streams:
            proxy = s.get("proxy_url", "")
            if not proxy.startswith("/api/hls?t="):
                continue
            full = f"{BASE_URL}{proxy}"
            try:
                rr = requests.get(full, timeout=45)
            except requests.RequestException as e:
                last_err = str(e)
                continue
            if rr.status_code != 200:
                last_err = f"status {rr.status_code} body={rr.text[:200]}"
                continue
            ct = rr.headers.get("content-type", "").lower()
            body = rr.text
            if "mpegurl" in ct or body.startswith("#EXTM3U"):
                assert body.startswith("#EXTM3U"), f"body not m3u8: {body[:100]!r}"
                # Segment URLs must be rewritten through the proxy too
                segs = re.findall(r"/api/hls\?t=[A-Za-z0-9_\-]+", body)
                # Variant playlist may only have nested manifests; both are valid as
                # long as they go through /api/hls?t=
                assert len(segs) >= 1, f"no rewritten URLs in manifest:\n{body[:600]}"
                # No raw upstream host references
                assert "tcore131ybdf.ru" not in body, f"upstream host leak in manifest:\n{body[:600]}"
                return
            last_err = f"unexpected ct={ct} body={body[:120]!r}"
        pytest.fail(f"no playable manifest from any stream. last_err={last_err}")
