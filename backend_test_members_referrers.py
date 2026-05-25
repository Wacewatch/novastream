#!/usr/bin/env python3
"""
Backend testing for Members/Guests split + Referrer attribution fixes.

Tests:
A) /api/stream/{channel_id} — TV play action with/without Authorization
B) /api/stream/{channel_id}?ref=<url> — explicit referrer tracking
C) /api/daddy/stream/{channel_id} — DaddyTV with Authorization + referrer
D) /api/admin/top-referrers — admin endpoint (401 check)
E) MongoDB indexes verification
F) Regression tests
"""

import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
import httpx

# Configuration
BASE_URL = os.getenv("REACT_APP_BACKEND_URL", "https://player-ui-redesign.preview.emergentagent.com")
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "test_database")

# Test results
results = {
    "passed": 0,
    "failed": 0,
    "tests": []
}

def log_test(name: str, passed: bool, details: str = ""):
    """Log a test result."""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  {details}")
    results["tests"].append({"name": name, "passed": passed, "details": details})
    if passed:
        results["passed"] += 1
    else:
        results["failed"] += 1

async def test_tv_stream_guest_view():
    """Test A1: GET /api/stream/{id} WITHOUT Authorization → guest view (is_member=false)"""
    try:
        # First get a valid channel ID
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            r = await client.get(f"{BASE_URL}/api/channels?limit=5")
            if r.status_code != 200:
                log_test("A1: TV stream guest view", False, f"Failed to get channels: {r.status_code}")
                return None
            
            data = r.json()
            if not data.get("channels"):
                log_test("A1: TV stream guest view", False, "No channels available")
                return None
            
            channel_id = data["channels"][0]["id"]
            
            # Call /api/stream/{id} WITHOUT Authorization
            r = await client.get(f"{BASE_URL}/api/stream/{channel_id}")
            
            if r.status_code != 200:
                log_test("A1: TV stream guest view", False, f"Status {r.status_code}, expected 200")
                return None
            
            stream_data = r.json()
            if not all(k in stream_data for k in ["id", "name", "proxy_url"]):
                log_test("A1: TV stream guest view", False, f"Missing keys in response: {stream_data.keys()}")
                return None
            
            log_test("A1: TV stream guest view", True, f"Channel {channel_id} returned stream URL")
            
            # Wait a moment for the view to be recorded
            await asyncio.sleep(0.5)
            
            return channel_id
    except Exception as e:
        log_test("A1: TV stream guest view", False, f"Exception: {e}")
        return None

async def verify_guest_view_in_db(channel_id: str):
    """Test A1b: Verify guest view was recorded with is_member=false in MongoDB"""
    try:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        
        # Find the most recent view for this channel
        view = await db.views.find_one(
            {"channel_id": channel_id},
            sort=[("ts", -1)]
        )
        
        if not view:
            log_test("A1b: Verify guest view in DB", False, f"No view found for channel {channel_id}")
            return
        
        if view.get("is_member") is False:
            log_test("A1b: Verify guest view in DB", True, f"View has is_member=false as expected")
        else:
            log_test("A1b: Verify guest view in DB", False, f"View has is_member={view.get('is_member')}, expected False")
        
        client.close()
    except Exception as e:
        log_test("A1b: Verify guest view in DB", False, f"Exception: {e}")

async def test_tv_stream_member_view():
    """Test A2: GET /api/stream/{id} WITH Authorization → member view (is_member=true)"""
    try:
        # First get a valid channel ID
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            r = await client.get(f"{BASE_URL}/api/channels?limit=5")
            if r.status_code != 200:
                log_test("A2: TV stream member view", False, f"Failed to get channels: {r.status_code}")
                return None
            
            data = r.json()
            if not data.get("channels"):
                log_test("A2: TV stream member view", False, "No channels available")
                return None
            
            channel_id = data["channels"][0]["id"]
            
            # Call /api/stream/{id} WITH Authorization header
            headers = {"Authorization": "Bearer dummy_long_enough_token_aaaaaaaaaaaa"}
            r = await client.get(f"{BASE_URL}/api/stream/{channel_id}", headers=headers)
            
            if r.status_code != 200:
                log_test("A2: TV stream member view", False, f"Status {r.status_code}, expected 200")
                return None
            
            stream_data = r.json()
            if not all(k in stream_data for k in ["id", "name", "proxy_url"]):
                log_test("A2: TV stream member view", False, f"Missing keys in response: {stream_data.keys()}")
                return None
            
            log_test("A2: TV stream member view", True, f"Channel {channel_id} returned stream URL with auth")
            
            # Wait a moment for the view to be recorded
            await asyncio.sleep(0.5)
            
            return channel_id
    except Exception as e:
        log_test("A2: TV stream member view", False, f"Exception: {e}")
        return None

async def verify_member_view_in_db(channel_id: str):
    """Test A2b: Verify member view was recorded with is_member=true in MongoDB"""
    try:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        
        # Find the most recent view for this channel
        view = await db.views.find_one(
            {"channel_id": channel_id},
            sort=[("ts", -1)]
        )
        
        if not view:
            log_test("A2b: Verify member view in DB", False, f"No view found for channel {channel_id}")
            return
        
        if view.get("is_member") is True:
            log_test("A2b: Verify member view in DB", True, f"View has is_member=true as expected")
        else:
            log_test("A2b: Verify member view in DB", False, f"View has is_member={view.get('is_member')}, expected True")
        
        client.close()
    except Exception as e:
        log_test("A2b: Verify member view in DB", False, f"Exception: {e}")

async def test_referrer_query_param():
    """Test B1: GET /api/stream/{id}?ref=https://wavewatch.top/some-page → referrer via query"""
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            r = await client.get(f"{BASE_URL}/api/channels?limit=5")
            if r.status_code != 200:
                log_test("B1: Referrer via ?ref= query", False, f"Failed to get channels: {r.status_code}")
                return
            
            data = r.json()
            if not data.get("channels"):
                log_test("B1: Referrer via ?ref= query", False, "No channels available")
                return
            
            channel_id = data["channels"][0]["id"]
            
            # Call with ?ref= query param
            r = await client.get(f"{BASE_URL}/api/stream/{channel_id}?ref=https://wavewatch.top/some-page")
            
            if r.status_code != 200:
                log_test("B1: Referrer via ?ref= query", False, f"Status {r.status_code}, expected 200")
                return
            
            log_test("B1: Referrer via ?ref= query", True, f"Request succeeded")
            
            # Wait for referrer to be logged
            await asyncio.sleep(0.5)
            
            # Verify in MongoDB
            client_db = AsyncIOMotorClient(MONGO_URL)
            db = client_db[DB_NAME]
            
            referrer = await db.referrers.find_one(
                {"host": "wavewatch.top"},
                sort=[("ts", -1)]
            )
            
            if not referrer:
                log_test("B1b: Verify referrer in DB", False, "No referrer found for wavewatch.top")
            elif referrer.get("via") == "query":
                log_test("B1b: Verify referrer in DB", True, f"Referrer logged with via='query' and host='wavewatch.top'")
            else:
                log_test("B1b: Verify referrer in DB", False, f"Referrer via={referrer.get('via')}, expected 'query'")
            
            client_db.close()
    except Exception as e:
        log_test("B1: Referrer via ?ref= query", False, f"Exception: {e}")

async def test_referrer_header():
    """Test B2: GET /api/stream/{id} with Referer header → referrer via header"""
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            r = await client.get(f"{BASE_URL}/api/channels?limit=5")
            if r.status_code != 200:
                log_test("B2: Referrer via Referer header", False, f"Failed to get channels: {r.status_code}")
                return
            
            data = r.json()
            if not data.get("channels"):
                log_test("B2: Referrer via Referer header", False, "No channels available")
                return
            
            channel_id = data["channels"][0]["id"]
            
            # Call with Referer header
            headers = {"Referer": "https://example.org/foo"}
            r = await client.get(f"{BASE_URL}/api/stream/{channel_id}", headers=headers)
            
            if r.status_code != 200:
                log_test("B2: Referrer via Referer header", False, f"Status {r.status_code}, expected 200")
                return
            
            log_test("B2: Referrer via Referer header", True, f"Request succeeded")
            
            # Wait for referrer to be logged
            await asyncio.sleep(0.5)
            
            # Verify in MongoDB
            client_db = AsyncIOMotorClient(MONGO_URL)
            db = client_db[DB_NAME]
            
            referrer = await db.referrers.find_one(
                {"host": "example.org"},
                sort=[("ts", -1)]
            )
            
            if not referrer:
                log_test("B2b: Verify referrer in DB", False, "No referrer found for example.org")
            elif referrer.get("via") == "header":
                log_test("B2b: Verify referrer in DB", True, f"Referrer logged with via='header' and host='example.org'")
            else:
                log_test("B2b: Verify referrer in DB", False, f"Referrer via={referrer.get('via')}, expected 'header'")
            
            client_db.close()
    except Exception as e:
        log_test("B2: Referrer via Referer header", False, f"Exception: {e}")

async def test_same_host_referrer():
    """Test B3: Same-host referrer should now be logged (legacy filter removed)"""
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            r = await client.get(f"{BASE_URL}/api/channels?limit=5")
            if r.status_code != 200:
                log_test("B3: Same-host referrer logging", False, f"Failed to get channels: {r.status_code}")
                return
            
            data = r.json()
            if not data.get("channels"):
                log_test("B3: Same-host referrer logging", False, "No channels available")
                return
            
            channel_id = data["channels"][0]["id"]
            
            # Call with same-host Referer (livewatch.top)
            headers = {"Referer": "https://livewatch.top/"}
            r = await client.get(f"{BASE_URL}/api/stream/{channel_id}", headers=headers)
            
            if r.status_code != 200:
                log_test("B3: Same-host referrer logging", False, f"Status {r.status_code}, expected 200")
                return
            
            log_test("B3: Same-host referrer logging", True, f"Request succeeded")
            
            # Wait for referrer to be logged
            await asyncio.sleep(0.5)
            
            # Verify in MongoDB - should now be logged (not filtered)
            client_db = AsyncIOMotorClient(MONGO_URL)
            db = client_db[DB_NAME]
            
            referrer = await db.referrers.find_one(
                {"host": "livewatch.top"},
                sort=[("ts", -1)]
            )
            
            if referrer:
                log_test("B3b: Verify same-host in DB", True, f"Same-host referrer logged (host='livewatch.top')")
            else:
                log_test("B3b: Verify same-host in DB", False, "Same-host referrer NOT logged (should be logged now)")
            
            client_db.close()
    except Exception as e:
        log_test("B3: Same-host referrer logging", False, f"Exception: {e}")

async def test_daddy_stream_guest():
    """Test C1: GET /api/daddy/stream/{id} WITHOUT Authorization → guest view"""
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            # Get a valid daddy channel
            r = await client.get(f"{BASE_URL}/api/daddy/channels?limit=5")
            if r.status_code != 200:
                log_test("C1: DaddyTV stream guest view", False, f"Failed to get daddy channels: {r.status_code}")
                return None
            
            data = r.json()
            if not data.get("channels"):
                log_test("C1: DaddyTV stream guest view", False, "No daddy channels available")
                return None
            
            channel_id = data["channels"][0]["id"]
            
            # Call /api/daddy/stream/{id} WITHOUT Authorization
            r = await client.get(f"{BASE_URL}/api/daddy/stream/{channel_id}")
            
            if r.status_code != 200:
                log_test("C1: DaddyTV stream guest view", False, f"Status {r.status_code}, expected 200")
                return None
            
            stream_data = r.json()
            if not all(k in stream_data for k in ["id", "name", "stream_url"]):
                log_test("C1: DaddyTV stream guest view", False, f"Missing keys in response: {stream_data.keys()}")
                return None
            
            log_test("C1: DaddyTV stream guest view", True, f"DaddyTV channel {channel_id} returned stream URL")
            
            # Wait for view to be recorded
            await asyncio.sleep(0.5)
            
            return channel_id
    except Exception as e:
        log_test("C1: DaddyTV stream guest view", False, f"Exception: {e}")
        return None

async def verify_daddy_guest_view_in_db(channel_id: str):
    """Test C1b: Verify DaddyTV guest view with channel_id='daddy:{id}' and is_member=false"""
    try:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        
        # Find the most recent view for this daddy channel (prefixed with "daddy:")
        prefixed_id = f"daddy:{channel_id}"
        view = await db.views.find_one(
            {"channel_id": prefixed_id},
            sort=[("ts", -1)]
        )
        
        if not view:
            log_test("C1b: Verify DaddyTV guest view in DB", False, f"No view found for channel_id={prefixed_id}")
            return
        
        if view.get("is_member") is False:
            log_test("C1b: Verify DaddyTV guest view in DB", True, f"View has channel_id='daddy:{channel_id}' and is_member=false")
        else:
            log_test("C1b: Verify DaddyTV guest view in DB", False, f"View has is_member={view.get('is_member')}, expected False")
        
        client.close()
    except Exception as e:
        log_test("C1b: Verify DaddyTV guest view in DB", False, f"Exception: {e}")

async def test_daddy_stream_member():
    """Test C2: GET /api/daddy/stream/{id} WITH Authorization → member view"""
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            # Get a valid daddy channel
            r = await client.get(f"{BASE_URL}/api/daddy/channels?limit=5")
            if r.status_code != 200:
                log_test("C2: DaddyTV stream member view", False, f"Failed to get daddy channels: {r.status_code}")
                return None
            
            data = r.json()
            if not data.get("channels"):
                log_test("C2: DaddyTV stream member view", False, "No daddy channels available")
                return None
            
            channel_id = data["channels"][0]["id"]
            
            # Call /api/daddy/stream/{id} WITH Authorization
            headers = {"Authorization": "Bearer aaaaaaaaaaaaaaaaaaaaaa"}
            r = await client.get(f"{BASE_URL}/api/daddy/stream/{channel_id}", headers=headers)
            
            if r.status_code != 200:
                log_test("C2: DaddyTV stream member view", False, f"Status {r.status_code}, expected 200")
                return None
            
            stream_data = r.json()
            if not all(k in stream_data for k in ["id", "name", "stream_url"]):
                log_test("C2: DaddyTV stream member view", False, f"Missing keys in response: {stream_data.keys()}")
                return None
            
            log_test("C2: DaddyTV stream member view", True, f"DaddyTV channel {channel_id} returned stream URL with auth")
            
            # Wait for view to be recorded
            await asyncio.sleep(0.5)
            
            return channel_id
    except Exception as e:
        log_test("C2: DaddyTV stream member view", False, f"Exception: {e}")
        return None

async def verify_daddy_member_view_in_db(channel_id: str):
    """Test C2b: Verify DaddyTV member view with channel_id='daddy:{id}' and is_member=true"""
    try:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        
        # Find the most recent view for this daddy channel (prefixed with "daddy:")
        prefixed_id = f"daddy:{channel_id}"
        view = await db.views.find_one(
            {"channel_id": prefixed_id},
            sort=[("ts", -1)]
        )
        
        if not view:
            log_test("C2b: Verify DaddyTV member view in DB", False, f"No view found for channel_id={prefixed_id}")
            return
        
        if view.get("is_member") is True:
            log_test("C2b: Verify DaddyTV member view in DB", True, f"View has channel_id='daddy:{channel_id}' and is_member=true")
        else:
            log_test("C2b: Verify DaddyTV member view in DB", False, f"View has is_member={view.get('is_member')}, expected True")
        
        client.close()
    except Exception as e:
        log_test("C2b: Verify DaddyTV member view in DB", False, f"Exception: {e}")

async def test_daddy_referrer():
    """Test C3: /api/daddy/stream/* also logs referrers"""
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            # Get a valid daddy channel
            r = await client.get(f"{BASE_URL}/api/daddy/channels?limit=5")
            if r.status_code != 200:
                log_test("C3: DaddyTV referrer logging", False, f"Failed to get daddy channels: {r.status_code}")
                return
            
            data = r.json()
            if not data.get("channels"):
                log_test("C3: DaddyTV referrer logging", False, "No daddy channels available")
                return
            
            channel_id = data["channels"][0]["id"]
            
            # Call with ?ref= query param
            r = await client.get(f"{BASE_URL}/api/daddy/stream/{channel_id}?ref=https://test-embed-host.com")
            
            if r.status_code != 200:
                log_test("C3: DaddyTV referrer logging", False, f"Status {r.status_code}, expected 200")
                return
            
            log_test("C3: DaddyTV referrer logging", True, f"Request succeeded")
            
            # Wait for referrer to be logged
            await asyncio.sleep(0.5)
            
            # Verify in MongoDB
            client_db = AsyncIOMotorClient(MONGO_URL)
            db = client_db[DB_NAME]
            
            referrer = await db.referrers.find_one(
                {"host": "test-embed-host.com"},
                sort=[("ts", -1)]
            )
            
            if referrer:
                log_test("C3b: Verify DaddyTV referrer in DB", True, f"DaddyTV referrer logged (host='test-embed-host.com')")
            else:
                log_test("C3b: Verify DaddyTV referrer in DB", False, "DaddyTV referrer NOT logged")
            
            client_db.close()
    except Exception as e:
        log_test("C3: DaddyTV referrer logging", False, f"Exception: {e}")

async def test_admin_top_referrers_401():
    """Test D: GET /api/admin/top-referrers without auth → 401"""
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            r = await client.get(f"{BASE_URL}/api/admin/top-referrers")
            
            if r.status_code == 401:
                log_test("D: Admin top-referrers 401", True, "Returns 401 without auth as expected")
            else:
                log_test("D: Admin top-referrers 401", False, f"Status {r.status_code}, expected 401")
    except Exception as e:
        log_test("D: Admin top-referrers 401", False, f"Exception: {e}")

async def test_mongodb_indexes():
    """Test E: Verify MongoDB indexes"""
    try:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        
        # Check referrers indexes
        referrers_indexes = await db.referrers.index_information()
        
        # Should have: _id_, ts_1 (no TTL), host_1_ts_-1
        has_ts_index = False
        has_host_ts_index = False
        ts_has_ttl = False
        
        for name, info in referrers_indexes.items():
            if name == "_id_":
                continue
            keys = info.get("key", [])
            if len(keys) == 1 and keys[0][0] == "ts":
                has_ts_index = True
                if "expireAfterSeconds" in info:
                    ts_has_ttl = True
            if len(keys) == 2 and keys[0][0] == "host" and keys[1][0] == "ts":
                has_host_ts_index = True
        
        if not has_ts_index:
            log_test("E1: Referrers ts index", False, "Missing ts index")
        elif ts_has_ttl:
            log_test("E1: Referrers ts index", False, "ts index has TTL (should not have)")
        else:
            log_test("E1: Referrers ts index", True, "ts index exists without TTL")
        
        if has_host_ts_index:
            log_test("E2: Referrers host+ts index", True, "host_1_ts_-1 index exists")
        else:
            log_test("E2: Referrers host+ts index", False, "Missing host_1_ts_-1 index")
        
        # Check views indexes
        views_indexes = await db.views.index_information()
        
        has_views_ts_ttl = False
        has_views_channel_ts = False
        
        for name, info in views_indexes.items():
            if name == "_id_":
                continue
            keys = info.get("key", [])
            if len(keys) == 1 and keys[0][0] == "ts" and "expireAfterSeconds" in info:
                has_views_ts_ttl = True
            if len(keys) == 2 and keys[0][0] == "channel_id" and keys[1][0] == "ts":
                has_views_channel_ts = True
        
        if has_views_ts_ttl:
            log_test("E3: Views ts TTL index", True, "ts index with TTL exists")
        else:
            log_test("E3: Views ts TTL index", False, "Missing ts TTL index")
        
        if has_views_channel_ts:
            log_test("E4: Views channel_id+ts index", True, "channel_id_1_ts_-1 index exists")
        else:
            log_test("E4: Views channel_id+ts index", False, "Missing channel_id_1_ts_-1 index")
        
        client.close()
    except Exception as e:
        log_test("E: MongoDB indexes", False, f"Exception: {e}")

async def test_regression():
    """Test F: Regression tests"""
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            # F1: GET /api/channels
            r = await client.get(f"{BASE_URL}/api/channels?limit=5")
            if r.status_code == 200 and r.json().get("channels"):
                log_test("F1: Regression /api/channels", True, f"Returns {len(r.json()['channels'])} channels")
            else:
                log_test("F1: Regression /api/channels", False, f"Status {r.status_code}")
            
            # F2: GET /api/daddy/channels
            r = await client.get(f"{BASE_URL}/api/daddy/channels?limit=5")
            if r.status_code == 200 and r.json().get("channels"):
                log_test("F2: Regression /api/daddy/channels", True, f"Returns {len(r.json()['channels'])} channels")
            else:
                log_test("F2: Regression /api/daddy/channels", False, f"Status {r.status_code}")
            
            # F3: GET /api/health or /api/
            r = await client.get(f"{BASE_URL}/api/")
            if r.status_code == 200:
                data = r.json()
                if data.get("app") == "LiveWatch" and data.get("status") == "ok":
                    log_test("F3: Regression /api/ health", True, "Returns LiveWatch status ok")
                else:
                    log_test("F3: Regression /api/ health", False, f"Unexpected response: {data}")
            else:
                log_test("F3: Regression /api/ health", False, f"Status {r.status_code}")
            
            # F4: Verify /api/stream/{id} response shape unchanged
            r = await client.get(f"{BASE_URL}/api/channels?limit=1")
            if r.status_code == 200 and r.json().get("channels"):
                channel_id = r.json()["channels"][0]["id"]
                r = await client.get(f"{BASE_URL}/api/stream/{channel_id}")
                if r.status_code == 200:
                    data = r.json()
                    if all(k in data for k in ["id", "name", "proxy_url"]):
                        log_test("F4: Regression /api/stream response shape", True, "Response has id, name, proxy_url")
                    else:
                        log_test("F4: Regression /api/stream response shape", False, f"Missing keys: {data.keys()}")
                else:
                    log_test("F4: Regression /api/stream response shape", False, f"Status {r.status_code}")
            else:
                log_test("F4: Regression /api/stream response shape", False, "No channels available")
    except Exception as e:
        log_test("F: Regression tests", False, f"Exception: {e}")

async def verify_referrer_aggregation():
    """Test D2: Verify referrer aggregation has first/last timestamps"""
    try:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        
        # Run the same aggregation as the admin endpoint
        pipeline = [
            {"$group": {
                "_id": "$host",
                "n": {"$sum": 1},
                "first": {"$min": "$ts"},
                "last": {"$max": "$ts"},
            }},
            {"$sort": {"n": -1}},
            {"$limit": 5},
        ]
        
        rows = []
        async for r in db.referrers.aggregate(pipeline):
            rows.append(r)
        
        if not rows:
            log_test("D2: Referrer aggregation structure", True, "No referrers yet (expected for fresh DB)")
        else:
            # Check that each row has first and last timestamps
            all_have_timestamps = all(
                r.get("first") and r.get("last")
                for r in rows
            )
            if all_have_timestamps:
                log_test("D2: Referrer aggregation structure", True, f"All {len(rows)} referrers have first/last timestamps")
            else:
                log_test("D2: Referrer aggregation structure", False, "Some referrers missing first/last timestamps")
        
        client.close()
    except Exception as e:
        log_test("D2: Referrer aggregation structure", False, f"Exception: {e}")

async def show_mongodb_state():
    """Show final MongoDB state for views and referrers"""
    try:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        
        print("\n" + "="*80)
        print("FINAL MONGODB STATE")
        print("="*80)
        
        # Last 5 views
        print("\nLast 5 views:")
        views = []
        async for v in db.views.find().sort("ts", -1).limit(5):
            views.append(v)
        
        if not views:
            print("  (no views)")
        else:
            for v in views:
                print(f"  - channel_id={v.get('channel_id')}, is_member={v.get('is_member')}, ts={v.get('ts')}")
        
        # Last 5 referrers
        print("\nLast 5 referrers:")
        referrers = []
        async for r in db.referrers.find().sort("ts", -1).limit(5):
            referrers.append(r)
        
        if not referrers:
            print("  (no referrers)")
        else:
            for r in referrers:
                print(f"  - host={r.get('host')}, via={r.get('via')}, path={r.get('path')}, ts={r.get('ts')}")
        
        client.close()
    except Exception as e:
        print(f"Error showing MongoDB state: {e}")

async def main():
    print("="*80)
    print("BACKEND TESTING: Members/Guests Split + Referrer Attribution Fixes")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"MongoDB: {MONGO_URL}/{DB_NAME}")
    print()
    
    # Test A: TV stream with/without Authorization
    print("\n--- Test A: /api/stream/{channel_id} with/without Authorization ---")
    channel_id_guest = await test_tv_stream_guest_view()
    if channel_id_guest:
        await verify_guest_view_in_db(channel_id_guest)
    
    channel_id_member = await test_tv_stream_member_view()
    if channel_id_member:
        await verify_member_view_in_db(channel_id_member)
    
    # Test B: Referrer tracking
    print("\n--- Test B: Referrer tracking with ?ref= and Referer header ---")
    await test_referrer_query_param()
    await test_referrer_header()
    await test_same_host_referrer()
    
    # Test C: DaddyTV stream
    print("\n--- Test C: /api/daddy/stream/{channel_id} ---")
    daddy_channel_guest = await test_daddy_stream_guest()
    if daddy_channel_guest:
        await verify_daddy_guest_view_in_db(daddy_channel_guest)
    
    daddy_channel_member = await test_daddy_stream_member()
    if daddy_channel_member:
        await verify_daddy_member_view_in_db(daddy_channel_member)
    
    await test_daddy_referrer()
    
    # Test D: Admin endpoints
    print("\n--- Test D: Admin endpoints ---")
    await test_admin_top_referrers_401()
    await verify_referrer_aggregation()
    
    # Test E: MongoDB indexes
    print("\n--- Test E: MongoDB indexes ---")
    await test_mongodb_indexes()
    
    # Test F: Regression
    print("\n--- Test F: Regression tests ---")
    await test_regression()
    
    # Show final MongoDB state
    await show_mongodb_state()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Total tests: {results['passed'] + results['failed']}")
    print(f"✅ Passed: {results['passed']}")
    print(f"❌ Failed: {results['failed']}")
    
    if results['failed'] > 0:
        print("\nFailed tests:")
        for test in results['tests']:
            if not test['passed']:
                print(f"  - {test['name']}")
                if test['details']:
                    print(f"    {test['details']}")
    
    return 0 if results['failed'] == 0 else 1

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
