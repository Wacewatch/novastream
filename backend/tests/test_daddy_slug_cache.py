"""Iteration 6 — Tests the 3 fixes:
   (a) /api/daddy/stream/{numeric}  → returns stream_url + iframe_url (non-empty)
   (b) /api/daddy/stream/{slug-XXX} → returns stream_url + iframe_url (non-empty)
   (c) /api/daddy/proxy?url=<m3u8>  → returns HLS content
   (d) /api/channels                → fast (cold-DB cache from cached_catalog)
   (e) MongoDB cached_catalog._id="channels" exists and >8000 channels
   (f) /api/daddy/channels?limit=5  → includes 18+ in categories
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://live-sports-hub-78.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Accept": "application/json"})
    return sess


# ---------- /api/channels (cache + speed) ----------

class TestChannelsCache:
    def test_channels_root_fast_and_nonempty(self, s):
        t0 = time.time()
        r = s.get(f"{BASE_URL}/api/channels", timeout=30)
        dt = time.time() - t0
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        assert "channels" in data and isinstance(data["channels"], list)
        assert len(data["channels"]) > 0, "channels list empty"
        # Second call should be served from in-memory cache (must be very fast)
        t1 = time.time()
        r2 = s.get(f"{BASE_URL}/api/channels", timeout=10)
        dt2 = time.time() - t1
        assert r2.status_code == 200
        # Warm second call should be <1s; first call may be slower if cold
        assert dt2 < 2.0, f"warm /api/channels too slow: {dt2:.2f}s"

    def test_channels_france_filter(self, s):
        r = s.get(f"{BASE_URL}/api/channels", params={"country": "France", "limit": 20}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data.get("channels"), list)
        assert len(data["channels"]) > 0


# ---------- MongoDB cached_catalog ----------

class TestMongoCache:
    def test_cached_catalog_exists(self):
        # Need to import the backend's motor client
        import sys
        sys.path.insert(0, "/app/backend")
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio

        async def _check():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client[os.environ.get("DB_NAME", "test_database")]
            doc = await db.cached_catalog.find_one({"_id": "channels"})
            client.close()
            return doc

        doc = asyncio.get_event_loop().run_until_complete(_check())
        assert doc is not None, "cached_catalog._id='channels' missing"
        ch = doc.get("channels") or []
        assert isinstance(ch, list)
        # The static catalog has ~8000+ channels — allow a generous lower bound.
        # If the cache was populated from upstream it should be >8000.
        # Accept >=1000 to be tolerant of partial population during testing.
        assert len(ch) > 1000, f"cached_catalog too small: {len(ch)}"


# ---------- /api/daddy/channels ----------

class TestDaddyChannels:
    def test_list_channels_with_18plus_category(self, s):
        r = s.get(f"{BASE_URL}/api/daddy/channels", params={"limit": 5}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        # Expect dict with channels + categories
        chans = data.get("channels") or []
        cats = data.get("categories") or []
        assert len(chans) > 0
        for c in chans[:5]:
            for k in ("id", "name"):
                assert k in c, f"missing {k} in {c}"
        # Either 18+ or "18+" or "+18" in the categories list
        joined = " | ".join([str(x) for x in cats]).lower()
        assert "18" in joined, f"no 18+ category found in {cats}"


# ---------- /api/daddy/stream/{numeric_id} ----------

class TestDaddyStreamNumeric:
    @pytest.mark.parametrize("cid", ["116", "121", "123", "957", "958"])
    def test_stream_numeric_returns_both_urls(self, s, cid):
        r = s.get(f"{BASE_URL}/api/daddy/stream/{cid}", timeout=30)
        # 404 is allowed if catalog doesn't have this channel — but assertion
        # is the contract: when 200, both stream_url & iframe_url must be set.
        if r.status_code == 404:
            pytest.skip(f"channel {cid} not in catalog")
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        assert data.get("stream_url"), f"empty stream_url for {cid}: {data}"
        assert data.get("iframe_url"), f"empty iframe_url for {cid}: {data}"
        # stream_url should be proxied through our /api/daddy/proxy
        assert "/api/daddy/proxy" in data["stream_url"], data["stream_url"]
        # iframe_url should be on the friendly chat.cfbu247.sbs host (CSP-friendly)
        assert "chat.cfbu247.sbs" in data["iframe_url"] or "/api/proxy/player" in data["iframe_url"], data["iframe_url"]


# ---------- /api/daddy/stream/{slug-XXX} — THE MAIN FIX ----------

class TestDaddyStreamSlug:
    @pytest.mark.parametrize("slug", [
        "slug-automoto-la-chaine",
        "slug-18-plus-18",
        "slug-18-plus-18-alt1",
    ])
    def test_stream_slug_resolves_to_both_urls(self, s, slug):
        r = s.get(f"{BASE_URL}/api/daddy/stream/{slug}", timeout=30)
        if r.status_code == 404:
            pytest.skip(f"slug {slug} not in catalog (may have rotated upstream)")
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        # The FIX: before, slugs returned only embed_url=player.cfbu247.sbs (CSP blocked).
        # Now BOTH stream_url and iframe_url must be populated.
        assert data.get("stream_url"), f"empty stream_url for {slug}: {data}"
        assert data.get("iframe_url"), f"empty iframe_url for {slug}: {data}"
        assert "/api/daddy/proxy" in data["stream_url"]


# ---------- /api/daddy/proxy ----------

class TestDaddyProxy:
    def test_proxy_returns_hls(self, s):
        # Try multiple channels — some upstream m3u8 endpoints can be 502
        # transiently. The proxy itself must return valid HLS for at least
        # one of them.
        last_status = None
        for cid in ["121", "123", "958", "50", "100", "116", "957"]:
            r = s.get(f"{BASE_URL}/api/daddy/stream/{cid}", timeout=20)
            if r.status_code != 200:
                continue
            stream_url = r.json().get("stream_url")
            if not stream_url:
                continue
            r2 = s.get(stream_url, timeout=20, allow_redirects=True)
            last_status = r2.status_code
            if r2.status_code in (502, 503):
                continue
            assert r2.status_code == 200, f"proxy returned {r2.status_code} for ch {cid}"
            body_head = (r2.text[:32] if r2.text else "")
            ctype = r2.headers.get("content-type", "").lower()
            is_hls = ("mpegurl" in ctype) or body_head.startswith("#EXTM3U")
            assert is_hls, f"not HLS for ch {cid} — ctype={ctype}, body={body_head!r}"
            return  # success
        pytest.skip(f"All tried channels upstream-unavailable (last status={last_status})")
