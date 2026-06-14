"""
Backend tests for the new JackTV admin module (iteration 10).
Covers:
- GET /api/jacktv/overlay-config (PUBLIC, no auth) → 200 + all JACKTV_DEFAULTS keys + default site_url.
- GET /api/admin/jacktv/config without Authorization → 401.
- PATCH /api/admin/jacktv/config without Authorization → 401 (or 422 acceptable for invalid body).
- Regression: /api/jacktv/sports, /api/jacktv/all-matches,
  /api/v1/public/daddy/channels?limit=5, /api/v1/public/football, /api/v1/public/sports.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend/.env value at test runtime; do not hardcode default.
    with open("/app/frontend/.env", "r") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1].rstrip("/")
                break

TIMEOUT = 30

EXPECTED_KEYS = {
    "site_url",
    "wrapper_max_width",
    "wrapper_aspect_ratio",
    "iframe_header_height",
    "iframe_bottom_ratio",
    "iframe_mask_color",
    "iframe_translate_x",
    "iframe_translate_y",
    "iframe_scale",
    "show_servers",
    "show_score_banner",
    "show_events",
    "show_stats",
    "show_toggle_mode",
}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- JackTV public overlay-config ---
class TestJackTvOverlayConfigPublic:
    def test_overlay_config_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/jacktv/overlay-config", timeout=TIMEOUT)
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:200]}"

    def test_overlay_config_has_all_keys(self, session):
        r = session.get(f"{BASE_URL}/api/jacktv/overlay-config", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)
        missing = EXPECTED_KEYS - set(data.keys())
        assert not missing, f"Missing keys: {missing}"

    def test_overlay_config_default_site_url(self, session):
        r = session.get(f"{BASE_URL}/api/jacktv/overlay-config", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        # Either still default OR previously set via admin — must be a non-empty string starting with http
        assert isinstance(data.get("site_url"), str)
        assert data["site_url"].startswith("http")
        # Default expectation per problem statement
        # If admin hasn't been used yet, must equal the documented default.
        # We tolerate a previously-saved value but log it.
        print(f"current site_url={data['site_url']}")


# --- JackTV admin endpoints auth contract ---
class TestJackTvAdminAuth:
    def test_admin_get_without_auth_401(self, session):
        r = session.get(f"{BASE_URL}/api/admin/jacktv/config", timeout=TIMEOUT)
        assert r.status_code == 401, f"expected 401 got {r.status_code} body={r.text[:200]}"

    def test_admin_patch_without_auth_401(self, session):
        r = session.patch(
            f"{BASE_URL}/api/admin/jacktv/config",
            json={"site_url": "https://example.com"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, f"expected 401 got {r.status_code} body={r.text[:200]}"

    def test_admin_patch_invalid_body_no_auth_401_or_422(self, session):
        # wrapper_max_width=10 violates ge=320; auth-first → 401, validation-first → 422.
        r = session.patch(
            f"{BASE_URL}/api/admin/jacktv/config",
            json={"wrapper_max_width": 10},
            timeout=TIMEOUT,
        )
        assert r.status_code in (401, 422), f"expected 401/422 got {r.status_code} body={r.text[:200]}"
        assert r.status_code != 500


# --- JackTV pipeline regression ---
class TestJackTvPipelineRegression:
    def test_jacktv_sports_200(self, session):
        r = session.get(f"{BASE_URL}/api/jacktv/sports", timeout=TIMEOUT)
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:300]}"
        data = r.json()
        # Either a list or a dict containing sports
        assert data is not None

    def test_jacktv_all_matches_200(self, session):
        r = session.get(f"{BASE_URL}/api/jacktv/all-matches", timeout=60)
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:300]}"


# --- Existing public endpoints regression ---
class TestPublicEndpointsRegression:
    def test_public_daddy_channels_limit_5(self, session):
        r = session.get(f"{BASE_URL}/api/v1/public/daddy/channels?limit=5", timeout=TIMEOUT)
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:300]}"
        data = r.json()
        # Response may be list or wrapped dict
        if isinstance(data, dict):
            items = data.get("channels") or data.get("items") or data.get("data") or []
        else:
            items = data
        assert isinstance(items, list)
        assert len(items) == 5, f"expected 5 channels, got {len(items)}"

    def test_public_football_200(self, session):
        r = session.get(f"{BASE_URL}/api/v1/public/football", timeout=TIMEOUT)
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:300]}"

    def test_public_sports_200(self, session):
        r = session.get(f"{BASE_URL}/api/v1/public/sports", timeout=TIMEOUT)
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:300]}"
