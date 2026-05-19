"""Iteration 5 — DaddyTV / Sports / Football extension endpoints.

Validates the public surfaces wired in /app/backend/extensions.py against the
preview deployment URL. Admin endpoints are exercised for the unauthenticated
path only (no admin JWT seeded in this environment).
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if "REACT_APP_BACKEND_URL" in os.environ else "https://novastream-tv.preview.emergentagent.com"

TIMEOUT = 30


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---------- DaddyTV catalog ----------
class TestDaddy:
    def test_channels_listing(self, s):
        r = s.get(f"{BASE_URL}/api/daddy/channels", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "total" in data and "channels" in data and "countries" in data
        assert isinstance(data["channels"], list)
        # Required: catalog should expose > 700 channels per acceptance criteria
        assert data["total"] > 700, f"Expected >700 channels, got {data['total']}"
        # Shape check on a sample
        sample = data["channels"][0]
        for k in ("id", "name", "country", "category", "embed_url"):
            assert k in sample, f"missing key {k} in channel sample"
        # Countries list non-empty
        assert len(data["countries"]) > 0

    def test_channel_116_bein_sports(self, s):
        r = s.get(f"{BASE_URL}/api/daddy/channel/116", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == "116"
        assert "embed_url" in data and data["embed_url"]
        assert "bein" in data["name"].lower() or "sport" in data["name"].lower()

    def test_channel_not_found(self, s):
        r = s.get(f"{BASE_URL}/api/daddy/channel/999999999", timeout=TIMEOUT)
        assert r.status_code == 404

    def test_stream_proxy(self, s):
        r = s.get(f"{BASE_URL}/api/daddy/stream/116", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == "116"
        assert "stream_url" in data and "/api/football/proxy?url=" in data["stream_url"]
        assert "embed_url" in data


# ---------- DaddyTV admin (auth required → 401 path) ----------
class TestDaddyAdmin:
    def test_admin_config_requires_auth(self, s):
        r = s.get(f"{BASE_URL}/api/admin/daddy/config", timeout=TIMEOUT)
        assert r.status_code in (401, 403), r.text

    def test_admin_config_invalid_token(self, s):
        r = s.get(
            f"{BASE_URL}/api/admin/daddy/config",
            headers={"Authorization": "Bearer invalid.token.value"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (401, 403)

    def test_admin_patch_requires_auth(self, s):
        r = s.patch(
            f"{BASE_URL}/api/admin/daddy/config",
            json={"enabled": True},
            timeout=TIMEOUT,
        )
        assert r.status_code in (401, 403)

    def test_admin_test_requires_auth(self, s):
        r = s.post(
            f"{BASE_URL}/api/admin/daddy/test",
            json={"channels_url": "", "m3u8_url": ""},
            timeout=TIMEOUT,
        )
        assert r.status_code in (401, 403)


# ---------- Sports (streamed.pk) ----------
class TestSports:
    def test_sports_matches(self, s):
        r = s.get(f"{BASE_URL}/api/sports/matches", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("total", "sports", "sportCounts", "liveCount", "events"):
            assert k in data, f"missing {k}"
        assert isinstance(data["events"], list)
        assert isinstance(data["sportCounts"], dict)

    def test_sports_info(self, s):
        r = s.get(f"{BASE_URL}/api/sports/info", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "days" in data and "total_days" in data
        assert isinstance(data["days"], list)


# ---------- Football (RapidAPI) ----------
class TestFootball:
    def test_football_matches(self, s):
        r = s.get(f"{BASE_URL}/api/football/matches", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("total", "matches", "leagues", "live_count"):
            assert k in data, f"missing {k}"
        assert isinstance(data["matches"], list)

    def test_football_streams_empty_mid(self, s):
        r = s.get(f"{BASE_URL}/api/football/streams", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json() == {"servers": []}

    def test_football_streams_for_first_match(self, s):
        r = s.get(f"{BASE_URL}/api/football/matches", timeout=60)
        assert r.status_code == 200
        matches = r.json().get("matches") or []
        # Find a match with servers if any
        target = next((m for m in matches if m.get("has_servers")), None)
        if not target:
            pytest.skip("No match with servers available in upstream right now")
        rs = s.get(
            f"{BASE_URL}/api/football/streams",
            params={"mid": target["id"]},
            timeout=TIMEOUT,
        )
        assert rs.status_code == 200, rs.text
        data = rs.json()
        assert "servers" in data
        assert isinstance(data["servers"], list)
        if data["servers"]:
            srv = data["servers"][0]
            assert "stream_url" in srv and "/api/football/proxy" in srv["stream_url"]
            assert "name" in srv
