"""LiveWatch admin stats modules backend tests
Covers:
- /api/admin/system-stats   (auth gated)
- /api/admin/live-stats     (auth gated)
- /api/admin/top-referrers  (auth gated)
- /api/admin/global-stats   (auth gated)
- regression for /api/countries, /api/channels, /api/stats, /api/channels/by-ids
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


# --- Auth gating on the four new admin endpoints ---

@pytest.mark.parametrize("path", [
    "/admin/system-stats",
    "/admin/live-stats",
    "/admin/top-referrers",
    "/admin/global-stats",
])
def test_admin_endpoint_requires_auth(session, path):
    """Without Authorization header → must respond 401."""
    r = session.get(f"{API}{path}", timeout=15)
    assert r.status_code == 401, f"{path}: expected 401, got {r.status_code} body={r.text[:200]}"
    # Should return a JSON error body, not HTML
    try:
        body = r.json()
    except ValueError:
        pytest.fail(f"{path}: 401 response is not JSON: {r.text[:200]}")
    assert "detail" in body, f"{path}: missing 'detail' key: {body}"


@pytest.mark.parametrize("path", [
    "/admin/system-stats",
    "/admin/live-stats",
    "/admin/top-referrers",
    "/admin/global-stats",
])
def test_admin_endpoint_rejects_bad_token(session, path):
    """With invalid token → must respond 401 or 403."""
    r = session.get(
        f"{API}{path}",
        headers={"Authorization": "Bearer not-a-real-jwt"},
        timeout=15,
    )
    assert r.status_code in (401, 403), (
        f"{path}: expected 401/403, got {r.status_code} body={r.text[:200]}"
    )


def test_admin_endpoint_rejects_malformed_auth_header(session):
    """Authorization header without 'Bearer ' prefix → still 401."""
    r = session.get(
        f"{API}/admin/system-stats",
        headers={"Authorization": "garbage-no-bearer"},
        timeout=15,
    )
    assert r.status_code in (401, 403)


# --- Top referrers query params still gated ---

def test_top_referrers_with_query_params_still_401(session):
    r = session.get(f"{API}/admin/top-referrers?hours=12&limit=5", timeout=15)
    assert r.status_code == 401


# --- Regression: pre-existing public endpoints still work ---

def test_regression_countries(session):
    r = session.get(f"{API}/countries", timeout=30)
    assert r.status_code == 200
    assert "France" in r.json().get("countries", [])


def test_regression_channels_france(session):
    r = session.get(f"{API}/channels", params={"country": "France"}, timeout=60)
    assert r.status_code == 200
    chans = r.json().get("channels", [])
    assert isinstance(chans, list) and len(chans) > 0


def test_regression_stats(session):
    r = session.get(f"{API}/stats", timeout=30)
    assert r.status_code == 200
    data = r.json()
    for k in ("total_24h", "live_total", "per_channel"):
        assert k in data


def test_regression_channels_by_ids(session):
    # Pull a couple of real ids first
    r = session.get(f"{API}/channels", params={"country": "France", "limit": 10}, timeout=60)
    ids = [c["id"] for c in r.json().get("channels", [])[:2]]
    if not ids:
        pytest.skip("No channels to test by-ids")
    r2 = session.post(f"{API}/channels/by-ids", json={"ids": ids}, timeout=15)
    assert r2.status_code == 200
    out = r2.json().get("channels", [])
    returned_ids = {c["id"] for c in out}
    assert set(ids).issubset(returned_ids)


# --- Backend root liveness (psutil import must not break startup) ---

def test_root_after_psutil_import(session):
    r = session.get(f"{API}/", timeout=30)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"
