"""LiveWatch Supabase + extras backend tests
Covers:
- /api/stats
- /api/channels/by-ids
- /api/admin/vip-keys/generate auth protection
- /api/auth/redeem-vip auth protection
- /api/hls single-flight under 10 concurrent requests
- Supabase service role key shape (full JWT)
"""
import os
import base64
import json
import asyncio
import pytest
import requests
from urllib.parse import urlparse

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


# --- /api/stats ---
def test_stats_returns_required_fields(session):
    r = session.get(f"{API}/stats", timeout=30)
    assert r.status_code == 200
    data = r.json()
    for k in ("total_24h", "live_total", "per_channel"):
        assert k in data, f"Missing key {k}"
    assert isinstance(data["total_24h"], int)
    assert isinstance(data["live_total"], int)
    assert isinstance(data["per_channel"], dict)


# --- /api/channels/by-ids ---
def test_channels_by_ids_returns_enriched_list(session):
    # First grab a few real channel ids
    r = session.get(f"{API}/channels", params={"country": "France", "limit": 50}, timeout=60)
    assert r.status_code == 200
    chans = r.json()["channels"]
    assert len(chans) >= 3
    sample_ids = [c["id"] for c in chans[:3]]

    r2 = session.post(f"{API}/channels/by-ids", json={"ids": sample_ids}, timeout=30)
    assert r2.status_code == 200
    out = r2.json()["channels"]
    returned_ids = {c["id"] for c in out}
    assert set(sample_ids).issubset(returned_ids)
    # Each item carries name + logo keys
    for c in out:
        assert "name" in c and "logo" in c and "country" in c


def test_channels_by_ids_empty_returns_empty(session):
    r = session.post(f"{API}/channels/by-ids", json={"ids": []}, timeout=15)
    assert r.status_code == 200
    assert r.json() == {"channels": []}


# --- Admin / VIP endpoint auth gating ---
def test_admin_generate_keys_requires_auth(session):
    r = session.post(f"{API}/admin/vip-keys/generate", json={"count": 1}, timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"


def test_admin_generate_keys_rejects_bad_token(session):
    r = session.post(
        f"{API}/admin/vip-keys/generate",
        json={"count": 1},
        headers={"Authorization": "Bearer not-a-real-jwt"},
        timeout=15,
    )
    assert r.status_code in (401, 403)


def test_redeem_vip_requires_auth(session):
    r = session.post(f"{API}/auth/redeem-vip", json={"key": "VIP-AAAA-BBBB-CCCC"}, timeout=15)
    assert r.status_code in (401, 403)


def test_redeem_vip_rejects_bad_token(session):
    r = session.post(
        f"{API}/auth/redeem-vip",
        json={"key": "VIP-AAAA-BBBB-CCCC"},
        headers={"Authorization": "Bearer not-a-real-jwt"},
        timeout=15,
    )
    assert r.status_code in (401, 403)


# --- Supabase service role key shape verification (decode JWT payload) ---
def test_supabase_service_role_key_is_full_jwt():
    """Decode the JWT payload locally and assert role == service_role.
    This guards against the previously truncated key bug."""
    from pathlib import Path
    env_path = Path("/app/backend/.env")
    raw = env_path.read_text()
    key = None
    for line in raw.splitlines():
        if line.startswith("SUPABASE_SERVICE_ROLE_KEY"):
            key = line.split("=", 1)[1].strip().strip('"')
            break
    assert key, "SUPABASE_SERVICE_ROLE_KEY not found in backend/.env"
    parts = key.split(".")
    assert len(parts) == 3, f"Service role key is not a 3-part JWT (got {len(parts)} parts)"
    # base64-url-decode payload, pad as needed
    payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
    payload = json.loads(base64.urlsafe_b64decode(payload_b64))
    assert payload.get("role") == "service_role", f"Unexpected role: {payload.get('role')}"


# --- /api/hls single-flight: 10 concurrent requests to the same playlist ---
def test_hls_single_flight_concurrent(session):
    # Resolve a working stream first
    r = session.get(f"{API}/channels", params={"country": "France", "limit": 20}, timeout=60)
    chans = r.json()["channels"]
    proxy_url = None
    for ch in chans:
        rs = session.get(f"{API}/stream/{ch['id']}", timeout=30)
        if rs.status_code == 200:
            data = rs.json()
            if data.get("proxy_url", "").startswith("/api/hls?u="):
                proxy_url = data["proxy_url"]
                break
    if not proxy_url:
        pytest.skip("Could not resolve any French stream for hls single-flight test")

    full = f"{BASE_URL}{proxy_url}"

    import concurrent.futures
    def fetch():
        return requests.get(full, timeout=30).status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        codes = list(ex.map(lambda _: fetch(), range(10)))
    # All must be 200
    assert all(c == 200 for c in codes), f"Some HLS requests failed: {codes}"
