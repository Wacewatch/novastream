"""
Iteration 9 — Jack07 score-on-scheduled fix, client-side stream resolution,
bulk stream-counts, and DELTAWATCH (regular TV channel) playback.

Validates:
- /api/jack07/matches?sport=1 → every scheduled match has home_score=None AND away_score=None
- /api/jack07/streams/{id} → returns api_url (NOT proxy_url) starting with
  https://apis-data10.tcore131ybdf.ru/api/stream/detail
- /api/jack07/stream-counts?ids=csv → returns {counts:{id: int>=0}} for every requested id
- /api/channels + /api/stream/{id} → DELTAWATCH-backed channel returns an HLS
  proxy URL whose body is real #EXTM3U HLS (env vars correctly restored)
"""
import os
import re
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


# ---------- Bug #1 — scheduled matches must have null scores ----------
class TestScheduledMatchesHaveNoScores:
    def test_no_score_on_scheduled_football_matches(self, session):
        r = session.get(f"{BASE_URL}/api/jack07/matches?sport=1", timeout=60)
        assert r.status_code == 200, r.text[:300]
        matches = r.json().get("matches", [])
        assert matches, "no football matches returned"

        offenders = []
        scheduled_seen = 0
        for m in matches:
            if m.get("status_kind") == "scheduled":
                scheduled_seen += 1
                if m.get("home_score") is not None or m.get("away_score") is not None:
                    offenders.append({
                        "id": m.get("id"),
                        "title": m.get("title"),
                        "status": m.get("status"),
                        "status_label": m.get("status_label"),
                        "home_score": m.get("home_score"),
                        "away_score": m.get("away_score"),
                    })
        assert scheduled_seen > 0, "no scheduled matches found in payload — cannot validate fix"
        assert not offenders, (
            f"{len(offenders)} scheduled match(es) still expose a score: "
            f"{offenders[:5]}"
        )

    def test_live_or_finished_may_carry_scores(self, session):
        """Sanity: confirm we still surface scores for live/finished matches."""
        r = session.get(f"{BASE_URL}/api/jack07/matches?sport=1", timeout=60)
        assert r.status_code == 200
        matches = r.json().get("matches", [])
        non_scheduled = [m for m in matches if m.get("status_kind") in ("live", "finished")]
        # If there are no live/finished matches at all, skip (off-hours scenario).
        if not non_scheduled:
            pytest.skip("no live/finished matches to validate the inverse case")
        # We don't *require* all of them to have integers (some upstream may
        # legitimately be null on kickoff minute zero), but at least the field
        # type must be int|None, not garbage.
        for m in non_scheduled:
            for k in ("home_score", "away_score"):
                v = m.get(k)
                assert v is None or isinstance(v, int), f"bad type for {k}: {v!r}"


# ---------- Bug #2 — client-side resolution endpoint ----------
class TestStreamsReturnClientSideApiUrl:
    @pytest.fixture(scope="class")
    def live_match_id(self):
        r = requests.get(f"{BASE_URL}/api/jack07/matches?sport=1", timeout=60)
        assert r.status_code == 200
        matches = r.json().get("matches", [])
        live = [m for m in matches if m.get("is_live")]
        # Find a live match that has at least one stream
        for m in live:
            try:
                rr = requests.get(
                    f"{BASE_URL}/api/jack07/streams/{m['id']}?sport=1", timeout=30
                )
                if rr.status_code == 200 and rr.json().get("streams"):
                    return m["id"], rr.json()
            except requests.RequestException:
                continue
        if live:
            return live[0]["id"], None
        pytest.skip("no live football matches at all")

    def test_streams_have_client_side_api_url(self, live_match_id):
        mid, cached = live_match_id
        if cached is None:
            r = requests.get(f"{BASE_URL}/api/jack07/streams/{mid}?sport=1", timeout=30)
            assert r.status_code == 200
            cached = r.json()

        assert "streams" in cached
        assert "site_url" in cached
        if not cached["streams"]:
            pytest.skip("live match has no resolvable streams right now")

        for s in cached["streams"]:
            # Per iter9 contract: client-side resolution
            assert "api_url" in s, f"missing api_url on stream: {s}"
            assert "id" in s and "name" in s, f"missing id/name on stream: {s}"
            api_url = s["api_url"]
            assert api_url.startswith(
                "https://apis-data10.tcore131ybdf.ru/api/stream/detail"
            ), f"api_url not client-side endpoint: {api_url}"
            # Required query params
            for needle in ("streamId=", "matchId=", "sportType=", "siteType="):
                assert needle in api_url, f"missing {needle} in {api_url}"


# ---------- Bug #3 — bulk source-counts endpoint ----------
class TestStreamCounts:
    def test_stream_counts_returns_counts_per_id(self, session):
        r = session.get(f"{BASE_URL}/api/jack07/matches?sport=1", timeout=60)
        assert r.status_code == 200
        matches = r.json().get("matches", [])
        # Take up to 5 live matches first, then top up with any
        live_ids = [m["id"] for m in matches if m.get("is_live")][:5]
        ids = live_ids or [m["id"] for m in matches[:5]]
        assert ids, "no match ids to test stream-counts"

        csv = ",".join(ids)
        rr = session.get(
            f"{BASE_URL}/api/jack07/stream-counts?sport=1&ids={csv}", timeout=60
        )
        assert rr.status_code == 200, rr.text[:300]
        data = rr.json()
        assert "counts" in data and isinstance(data["counts"], dict)
        counts = data["counts"]
        # Every requested id must be in response, count must be int >= 0
        for mid in ids:
            assert mid in counts, f"id {mid} missing in counts response: {counts}"
            v = counts[mid]
            assert isinstance(v, int), f"count for {mid} not int: {v!r}"
            assert v >= 0, f"negative count for {mid}: {v}"

    def test_stream_counts_empty_ids(self, session):
        r = session.get(
            f"{BASE_URL}/api/jack07/stream-counts?sport=1&ids=", timeout=20
        )
        assert r.status_code == 200
        assert r.json() == {"counts": {}}


# ---------- Bug #5 — regular TV channel via DELTAWATCH proxy ----------
class TestRegularTvChannelStream:
    def test_channel_stream_returns_valid_hls(self, session):
        # Grab a couple of channels
        r = session.get(f"{BASE_URL}/api/channels?limit=5", timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        # /api/channels may return a list or {channels:[...]}.
        if isinstance(body, dict):
            channels = body.get("channels") or body.get("items") or body.get("data") or []
        else:
            channels = body
        assert isinstance(channels, list) and channels, f"no channels: {body!r}"

        last_err = None
        ok = False
        for ch in channels[:5]:
            cid = ch.get("id") or ch.get("_id") or ch.get("channel_id")
            if not cid:
                continue
            try:
                sr = session.get(f"{BASE_URL}/api/stream/{cid}", timeout=30)
            except requests.RequestException as e:
                last_err = f"{cid}: {e}"
                continue
            if sr.status_code != 200:
                last_err = f"{cid}: stream endpoint status {sr.status_code} body={sr.text[:200]}"
                continue
            sj = sr.json() if "json" in sr.headers.get("content-type", "") or sr.text.lstrip().startswith("{") else {}
            proxy = sj.get("proxy_url") or sj.get("hls_url") or sj.get("url")
            if not proxy:
                last_err = f"{cid}: no proxy_url in {sj}"
                continue
            full = proxy if proxy.startswith("http") else f"{BASE_URL}{proxy}"
            try:
                mr = requests.get(full, timeout=45)
            except requests.RequestException as e:
                last_err = f"{cid}: manifest fetch {e}"
                continue
            ct = mr.headers.get("content-type", "").lower()
            txt = mr.text
            if mr.status_code == 200 and ("mpegurl" in ct or txt.startswith("#EXTM3U")):
                assert txt.startswith("#EXTM3U"), f"body not m3u8: {txt[:120]!r}"
                ok = True
                break
            last_err = f"{cid}: status={mr.status_code} ct={ct} body={txt[:120]!r}"
        if not ok:
            pytest.fail(f"no channel returned a valid HLS manifest. last_err={last_err}")
