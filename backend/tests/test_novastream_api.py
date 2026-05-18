"""NovaStream backend API tests"""
import os
import re
import pytest
import requests
from urllib.parse import unquote

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://quad-view-page.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

FORBIDDEN_WORDS = ["vavoo", "kool.to"]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


# --- Root status ---
def test_root_returns_novastream_status(session):
    r = session.get(f"{API}/", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data.get("app") == "NovaStream"
    assert data.get("status") == "ok"


# --- Countries ---
def test_countries_includes_france(session):
    r = session.get(f"{API}/countries", timeout=60)
    assert r.status_code == 200
    data = r.json()
    assert "countries" in data
    assert isinstance(data["countries"], list)
    assert "France" in data["countries"]
    assert len(data["countries"]) > 1
    # Ensure no source name leaked
    body = r.text.lower()
    for w in FORBIDDEN_WORDS:
        assert w not in body


# --- Categories ---
def test_categories_returns_8_french_categories(session):
    r = session.get(f"{API}/categories", timeout=30)
    assert r.status_code == 200
    cats = r.json().get("categories", [])
    expected = {"Sport", "Info", "Cinéma", "Jeunesse", "Divertissement", "Documentaire", "Musique", "Généralistes"}
    assert expected.issubset(set(cats))
    assert len(cats) == 8


# --- Channels: France ---
def test_channels_france_returns_data_without_url_field(session):
    r = session.get(f"{API}/channels", params={"country": "France"}, timeout=60)
    assert r.status_code == 200
    data = r.json()
    assert "channels" in data
    chans = data["channels"]
    assert isinstance(chans, list)
    assert len(chans) > 0, "Expected at least 1 French channel"
    sample = chans[0]
    # Allowed keys only
    allowed = {"id", "name", "logo", "country", "categories"}
    assert set(sample.keys()) == allowed, f"Unexpected keys: {set(sample.keys()) - allowed}"
    assert "url" not in sample
    assert sample["country"].lower() == "france"
    # Sanitization check
    body = r.text.lower()
    for w in FORBIDDEN_WORDS:
        assert w not in body, f"Forbidden word {w} found in /channels response"


def test_channels_france_sport_filter(session):
    r = session.get(f"{API}/channels", params={"country": "France", "category": "Sport"}, timeout=60)
    assert r.status_code == 200
    chans = r.json()["channels"]
    # Could be empty if catalog has no Sport channels for France right now, but check structure
    for c in chans:
        assert "Sport" in c["categories"]
        assert c["country"].lower() == "france"


def test_channels_france_search_filter(session):
    r = session.get(f"{API}/channels", params={"country": "France", "search": "tf1"}, timeout=60)
    assert r.status_code == 200
    chans = r.json()["channels"]
    assert len(chans) > 0, "Expected at least one channel matching tf1"
    for c in chans:
        assert "tf1" in c["name"].lower()


# --- Stream resolution ---
@pytest.fixture(scope="module")
def french_channels(session):
    r = session.get(f"{API}/channels", params={"country": "France"}, timeout=60)
    assert r.status_code == 200
    return r.json()["channels"]


def test_stream_returns_proxy_url_hidden_source(session, french_channels):
    assert french_channels, "No channels to test stream on"
    last_err = None
    success = False
    proxy_url = None
    # Try a few channels because upstream may fail on some
    for ch in french_channels[:10]:
        r = session.get(f"{API}/stream/{ch['id']}", timeout=30)
        if r.status_code == 200:
            data = r.json()
            if data.get("proxy_url", "").startswith("/api/hls?u="):
                proxy_url = data["proxy_url"]
                success = True
                # source must not appear in response (except as encoded form in u= param)
                body_lower = r.text.lower()
                # since URL is %-encoded, raw 'vavoo' / 'kool.to' should not appear
                for w in FORBIDDEN_WORDS:
                    assert w not in body_lower, f"Forbidden {w} in /stream response"
                break
        else:
            last_err = r.text
    assert success, f"Could not resolve any French channel stream. Last error: {last_err}"
    # Stash for next test
    pytest.proxy_url = proxy_url


def test_hls_proxy_rewrites_m3u8(session):
    proxy_url = getattr(pytest, "proxy_url", None)
    if not proxy_url:
        pytest.skip("No stream resolved in prior test")
    # proxy_url looks like /api/hls?u=<encoded>
    full_url = f"{BASE_URL}{proxy_url}"
    r = session.get(full_url, timeout=30)
    assert r.status_code == 200
    text = r.text
    assert "#EXTM3U" in text
    body_lower = text.lower()
    # Upstream domain references must not appear in the m3u8
    for w in FORBIDDEN_WORDS:
        assert w not in body_lower, f"Forbidden word '{w}' leaked into m3u8 playlist"
    # Every non-comment, non-empty line should be /api/hls?u=
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        assert s.startswith("/api/hls?u="), f"Unrewritten line in m3u8: {s[:80]}"
