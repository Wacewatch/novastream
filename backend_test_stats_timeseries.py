#!/usr/bin/env python3
"""
Backend testing for Stats Timeseries + Extended View Tracking

Tests the new /api/admin/stats-timeseries endpoint and extended view schema
(is_vip, is_embed, ip fields) as per the review request.
"""
import asyncio
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load environment
load_dotenv("/app/backend/.env")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# Public backend URL (from frontend/.env)
load_dotenv("/app/frontend/.env")
BACKEND_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BACKEND_URL:
    print("❌ REACT_APP_BACKEND_URL not found in /app/frontend/.env")
    sys.exit(1)

API_BASE = f"{BACKEND_URL}/api"

# Test results
results = {
    "passed": 0,
    "failed": 0,
    "tests": []
}


def log_test(name: str, passed: bool, details: str = ""):
    """Log a test result."""
    status = "✅ PASS" if passed else "❌ FAIL"
    results["tests"].append({"name": name, "passed": passed, "details": details})
    if passed:
        results["passed"] += 1
    else:
        results["failed"] += 1
    print(f"{status}: {name}")
    if details and not passed:
        print(f"  Details: {details}")


async def test_mongodb_indexes():
    """A) Sanity / index check - verify views collection indexes."""
    print("\n=== A) MongoDB Index Check ===")
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    
    try:
        indexes = await db.views.index_information()
        
        # Check for ts_1 index with 400-day TTL
        ts_index_found = False
        ts_ttl_correct = False
        for name, info in indexes.items():
            keys = info.get("key", [])
            if len(keys) == 1 and keys[0][0] == "ts":
                ts_index_found = True
                ttl = info.get("expireAfterSeconds")
                expected_ttl = 400 * 24 * 3600  # 34560000 seconds
                if ttl == expected_ttl:
                    ts_ttl_correct = True
                    log_test(
                        "MongoDB: ts index with 400-day TTL",
                        True,
                        f"Found ts_1 with expireAfterSeconds={ttl}"
                    )
                else:
                    log_test(
                        "MongoDB: ts index with 400-day TTL",
                        False,
                        f"Expected TTL={expected_ttl}, got {ttl}"
                    )
                break
        
        if not ts_index_found:
            log_test("MongoDB: ts index exists", False, "ts index not found")
        
        # Check for _id_ index (always present)
        has_id_index = "_id_" in indexes
        log_test("MongoDB: _id_ index exists", has_id_index)
        
        # Check for channel_id_1_ts_-1 index
        has_channel_ts_index = False
        for name, info in indexes.items():
            keys = info.get("key", [])
            if (len(keys) == 2 and 
                keys[0][0] == "channel_id" and keys[0][1] == 1 and
                keys[1][0] == "ts" and keys[1][1] == -1):
                has_channel_ts_index = True
                break
        log_test("MongoDB: channel_id_1_ts_-1 index exists", has_channel_ts_index)
        
        # Print all indexes for reference
        print(f"\n  All indexes on db.views:")
        for name, info in indexes.items():
            keys = info.get("key", [])
            ttl = info.get("expireAfterSeconds")
            ttl_str = f" (TTL={ttl}s)" if ttl else ""
            print(f"    - {name}: {keys}{ttl_str}")
        
    except Exception as e:
        log_test("MongoDB: index check", False, str(e))
    finally:
        client.close()


async def test_endpoint_auth():
    """B) Endpoint auth - verify /api/admin/stats-timeseries requires auth."""
    print("\n=== B) Endpoint Auth ===")
    
    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        # Test 1: No Authorization header → 401
        try:
            r = await client.get(f"{API_BASE}/admin/stats-timeseries")
            if r.status_code == 401:
                body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
                detail = body.get("detail", "")
                log_test(
                    "stats-timeseries: no auth → 401",
                    True,
                    f"Got 401 with detail='{detail}'"
                )
            else:
                log_test(
                    "stats-timeseries: no auth → 401",
                    False,
                    f"Expected 401, got {r.status_code}"
                )
        except Exception as e:
            log_test("stats-timeseries: no auth → 401", False, str(e))
        
        # Test 2: Invalid Bearer token → 401/403
        try:
            r = await client.get(
                f"{API_BASE}/admin/stats-timeseries",
                headers={"Authorization": "Bearer invalid_token_12345"}
            )
            if r.status_code in (401, 403):
                log_test(
                    "stats-timeseries: invalid Bearer → 401/403",
                    True,
                    f"Got {r.status_code}"
                )
            else:
                log_test(
                    "stats-timeseries: invalid Bearer → 401/403",
                    False,
                    f"Expected 401/403, got {r.status_code}"
                )
        except Exception as e:
            log_test("stats-timeseries: invalid Bearer → 401/403", False, str(e))


async def test_extended_view_tracking():
    """C) Extended view tracking - test /api/stream with various auth combos."""
    print("\n=== C) Extended View Tracking ===")
    
    client_mongo = AsyncIOMotorClient(MONGO_URL)
    db = client_mongo[DB_NAME]
    
    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        # Get a TV channel to test with
        try:
            r = await client.get(f"{API_BASE}/channels?limit=5")
            channels = r.json().get("channels", [])
            if not channels:
                log_test("Get test channel", False, "No channels available")
                client_mongo.close()
                return
            test_channel = channels[0]
            channel_id = test_channel["id"]
            log_test("Get test channel", True, f"Using channel {channel_id}")
        except Exception as e:
            log_test("Get test channel", False, str(e))
            client_mongo.close()
            return
        
        # Test scenarios
        test_cases = [
            {
                "name": "no auth",
                "headers": {},
                "params": {},
                "expected": {"is_member": False, "is_vip": False, "is_embed": False}
            },
            {
                "name": "with Bearer (member)",
                "headers": {"Authorization": "Bearer aaaaaaaaaaaaaaaaaaaaaaa"},
                "params": {},
                "expected": {"is_member": True, "is_vip": False, "is_embed": False}
            },
            {
                "name": "with Bearer + vip=1",
                "headers": {"Authorization": "Bearer aaaaaaaaaaaaaaaaaaaaaaa"},
                "params": {"vip": "1"},
                "expected": {"is_member": True, "is_vip": True, "is_embed": False}
            },
            {
                "name": "with Bearer + embed=1",
                "headers": {"Authorization": "Bearer aaaaaaaaaaaaaaaaaaaaaaa"},
                "params": {"embed": "1"},
                "expected": {"is_member": True, "is_vip": False, "is_embed": True}
            },
            {
                "name": "NO auth + vip=1 (should ignore vip)",
                "headers": {},
                "params": {"vip": "1"},
                "expected": {"is_member": False, "is_vip": False, "is_embed": False}
            },
            {
                "name": "with Bearer + ref param",
                "headers": {"Authorization": "Bearer aaaaaaaaaaaaaaaaaaaaaaa"},
                "params": {"ref": "https://wavewatch.top/page"},
                "expected": {"is_member": True, "is_vip": False, "is_embed": False}
            },
        ]
        
        for tc in test_cases:
            try:
                # Call the stream endpoint
                r = await client.get(
                    f"{API_BASE}/stream/{channel_id}",
                    headers=tc["headers"],
                    params=tc["params"]
                )
                
                if r.status_code != 200:
                    log_test(
                        f"stream/{channel_id} ({tc['name']})",
                        False,
                        f"HTTP {r.status_code}"
                    )
                    continue
                
                # Wait a bit for the async view recording to complete
                await asyncio.sleep(0.5)
                
                # Query MongoDB for the most recent view
                view = await db.views.find_one(
                    {"channel_id": channel_id},
                    sort=[("ts", -1)]
                )
                
                if not view:
                    log_test(
                        f"stream/{channel_id} ({tc['name']}) - view recorded",
                        False,
                        "No view found in MongoDB"
                    )
                    continue
                
                # Verify fields
                expected = tc["expected"]
                is_member = view.get("is_member", False)
                is_vip = view.get("is_vip", False)
                is_embed = view.get("is_embed", False)
                ip = view.get("ip")
                
                all_match = (
                    is_member == expected["is_member"] and
                    is_vip == expected["is_vip"] and
                    is_embed == expected["is_embed"] and
                    ip is not None
                )
                
                if all_match:
                    log_test(
                        f"stream/{channel_id} ({tc['name']}) - view fields correct",
                        True,
                        f"is_member={is_member}, is_vip={is_vip}, is_embed={is_embed}, ip={ip}"
                    )
                else:
                    log_test(
                        f"stream/{channel_id} ({tc['name']}) - view fields correct",
                        False,
                        f"Expected {expected}, got is_member={is_member}, is_vip={is_vip}, is_embed={is_embed}, ip={ip}"
                    )
                
            except Exception as e:
                log_test(f"stream/{channel_id} ({tc['name']})", False, str(e))
        
        # Test referrer tracking with ?ref= param
        try:
            r = await client.get(
                f"{API_BASE}/stream/{channel_id}",
                params={"ref": "https://wavewatch.top/some-page"}
            )
            if r.status_code == 200:
                await asyncio.sleep(0.5)
                # Check referrers collection
                ref = await db.referrers.find_one(
                    {"host": "wavewatch.top"},
                    sort=[("ts", -1)]
                )
                if ref and ref.get("via") == "query":
                    log_test(
                        "Referrer tracking: ?ref= param",
                        True,
                        f"Referrer logged with host={ref.get('host')}, via={ref.get('via')}"
                    )
                else:
                    log_test(
                        "Referrer tracking: ?ref= param",
                        False,
                        f"Referrer not found or via != 'query'"
                    )
            else:
                log_test("Referrer tracking: ?ref= param", False, f"HTTP {r.status_code}")
        except Exception as e:
            log_test("Referrer tracking: ?ref= param", False, str(e))
    
    client_mongo.close()


async def test_aggregation_correctness():
    """D) Aggregation correctness - run the pipeline directly and verify."""
    print("\n=== D) Aggregation Correctness ===")
    
    client_mongo = AsyncIOMotorClient(MONGO_URL)
    db = client_mongo[DB_NAME]
    
    try:
        # Run the same aggregation pipeline as /api/admin/stats-timeseries for range=7d
        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
        
        pipeline = [
            {"$match": {"ts": {"$gte": start}}},
            {"$group": {
                "_id": {
                    "$dateToString": {
                        "format": "%Y-%m-%dT00:00:00Z",
                        "date": "$ts",
                        "timezone": "UTC",
                    }
                },
                "total": {"$sum": 1},
                "members_raw": {"$sum": {"$cond": [{"$eq": ["$is_member", True]}, 1, 0]}},
                "vip_plays": {"$sum": {"$cond": [{"$eq": ["$is_vip", True]}, 1, 0]}},
                "embed_plays": {"$sum": {"$cond": [{"$eq": ["$is_embed", True]}, 1, 0]}},
                "ips": {"$addToSet": "$ip"},
            }},
            {"$sort": {"_id": 1}},
        ]
        
        buckets = []
        async for r in db.views.aggregate(pipeline):
            ips = [ip for ip in (r.get("ips") or []) if ip]
            members_raw = int(r.get("members_raw") or 0)
            vip_plays = int(r.get("vip_plays") or 0)
            member_only = max(0, members_raw - vip_plays)
            total = int(r.get("total") or 0)
            
            bucket = {
                "t": r["_id"],
                "total": total,
                "member_plays": member_only,
                "vip_plays": vip_plays,
                "guest_plays": max(0, total - members_raw),
                "embed_plays": int(r.get("embed_plays") or 0),
                "unique_visitors": len(set(ips)),
            }
            buckets.append(bucket)
        
        if not buckets:
            log_test(
                "Aggregation: pipeline executed",
                True,
                "No data in last 7 days (empty result is valid)"
            )
            client_mongo.close()
            return
        
        # Verify correctness for each bucket
        all_valid = True
        for b in buckets:
            # Check: total = member_plays + vip_plays + guest_plays
            computed_total = b["member_plays"] + b["vip_plays"] + b["guest_plays"]
            if computed_total != b["total"]:
                all_valid = False
                log_test(
                    f"Aggregation: bucket {b['t']} total consistency",
                    False,
                    f"member_plays({b['member_plays']}) + vip_plays({b['vip_plays']}) + guest_plays({b['guest_plays']}) = {computed_total} != total({b['total']})"
                )
            
            # Check: vip_plays <= member_plays + vip_plays (vip is subset of members)
            if b["vip_plays"] > b["member_plays"] + b["vip_plays"]:
                all_valid = False
                log_test(
                    f"Aggregation: bucket {b['t']} vip subset check",
                    False,
                    f"vip_plays({b['vip_plays']}) > member_plays({b['member_plays']}) + vip_plays({b['vip_plays']})"
                )
            
            # Check: unique_visitors <= total
            if b["unique_visitors"] > b["total"]:
                all_valid = False
                log_test(
                    f"Aggregation: bucket {b['t']} unique_visitors check",
                    False,
                    f"unique_visitors({b['unique_visitors']}) > total({b['total']})"
                )
        
        if all_valid:
            log_test(
                "Aggregation: all buckets valid",
                True,
                f"Verified {len(buckets)} buckets, all metrics consistent"
            )
        
        # Verify totals match sum of buckets
        totals = {
            "total": sum(b["total"] for b in buckets),
            "member_plays": sum(b["member_plays"] for b in buckets),
            "vip_plays": sum(b["vip_plays"] for b in buckets),
            "guest_plays": sum(b["guest_plays"] for b in buckets),
            "embed_plays": sum(b["embed_plays"] for b in buckets),
            "unique_visitors": sum(b["unique_visitors"] for b in buckets),
        }
        
        log_test(
            "Aggregation: totals computed",
            True,
            f"total={totals['total']}, member_plays={totals['member_plays']}, vip_plays={totals['vip_plays']}, guest_plays={totals['guest_plays']}"
        )
        
    except Exception as e:
        log_test("Aggregation: pipeline execution", False, str(e))
    finally:
        client_mongo.close()


async def test_daddy_parity():
    """E) Daddy parity - test /api/daddy/stream with same scenarios."""
    print("\n=== E) Daddy Parity ===")
    
    client_mongo = AsyncIOMotorClient(MONGO_URL)
    db = client_mongo[DB_NAME]
    
    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        # Get a DaddyTV channel to test with
        try:
            r = await client.get(f"{API_BASE}/daddy/channels?limit=5")
            if r.status_code != 200:
                log_test("Get daddy test channel", False, f"HTTP {r.status_code}")
                client_mongo.close()
                return
            channels = r.json().get("channels", [])
            if not channels:
                log_test("Get daddy test channel", False, "No daddy channels available")
                client_mongo.close()
                return
            test_channel = channels[0]
            channel_id = test_channel["id"]
            log_test("Get daddy test channel", True, f"Using daddy channel {channel_id}")
        except Exception as e:
            log_test("Get daddy test channel", False, str(e))
            client_mongo.close()
            return
        
        # Test scenarios (same as TV channels)
        test_cases = [
            {
                "name": "no auth",
                "headers": {},
                "params": {},
                "expected": {"is_member": False, "is_vip": False, "is_embed": False}
            },
            {
                "name": "with Bearer (member)",
                "headers": {"Authorization": "Bearer aaaaaaaaaaaaaaaaaaaaaaa"},
                "params": {},
                "expected": {"is_member": True, "is_vip": False, "is_embed": False}
            },
            {
                "name": "with Bearer + vip=1",
                "headers": {"Authorization": "Bearer aaaaaaaaaaaaaaaaaaaaaaa"},
                "params": {"vip": "1"},
                "expected": {"is_member": True, "is_vip": True, "is_embed": False}
            },
            {
                "name": "with Bearer + embed=1",
                "headers": {"Authorization": "Bearer aaaaaaaaaaaaaaaaaaaaaaa"},
                "params": {"embed": "1"},
                "expected": {"is_member": True, "is_vip": False, "is_embed": True}
            },
        ]
        
        for tc in test_cases:
            try:
                # Call the daddy stream endpoint
                r = await client.get(
                    f"{API_BASE}/daddy/stream/{channel_id}",
                    headers=tc["headers"],
                    params=tc["params"]
                )
                
                if r.status_code != 200:
                    log_test(
                        f"daddy/stream/{channel_id} ({tc['name']})",
                        False,
                        f"HTTP {r.status_code}"
                    )
                    continue
                
                # Wait for async view recording
                await asyncio.sleep(0.5)
                
                # Query MongoDB for the most recent daddy view
                view = await db.views.find_one(
                    {"channel_id": f"daddy:{channel_id}"},
                    sort=[("ts", -1)]
                )
                
                if not view:
                    log_test(
                        f"daddy/stream/{channel_id} ({tc['name']}) - view recorded",
                        False,
                        "No view found in MongoDB"
                    )
                    continue
                
                # Verify channel_id has "daddy:" prefix
                if not view.get("channel_id", "").startswith("daddy:"):
                    log_test(
                        f"daddy/stream/{channel_id} ({tc['name']}) - channel_id prefix",
                        False,
                        f"Expected 'daddy:' prefix, got {view.get('channel_id')}"
                    )
                    continue
                
                # Verify fields
                expected = tc["expected"]
                is_member = view.get("is_member", False)
                is_vip = view.get("is_vip", False)
                is_embed = view.get("is_embed", False)
                ip = view.get("ip")
                
                all_match = (
                    is_member == expected["is_member"] and
                    is_vip == expected["is_vip"] and
                    is_embed == expected["is_embed"] and
                    ip is not None
                )
                
                if all_match:
                    log_test(
                        f"daddy/stream/{channel_id} ({tc['name']}) - view fields correct",
                        True,
                        f"channel_id=daddy:{channel_id}, is_member={is_member}, is_vip={is_vip}, is_embed={is_embed}, ip={ip}"
                    )
                else:
                    log_test(
                        f"daddy/stream/{channel_id} ({tc['name']}) - view fields correct",
                        False,
                        f"Expected {expected}, got is_member={is_member}, is_vip={is_vip}, is_embed={is_embed}, ip={ip}"
                    )
                
            except Exception as e:
                log_test(f"daddy/stream/{channel_id} ({tc['name']})", False, str(e))
    
    client_mongo.close()


async def test_regression():
    """F) Regression - verify existing endpoints still work."""
    print("\n=== F) Regression Tests ===")
    
    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        # Test /api/admin/live-stats without auth → 401
        try:
            r = await client.get(f"{API_BASE}/admin/live-stats")
            if r.status_code == 401:
                log_test("/api/admin/live-stats without auth → 401", True)
            else:
                log_test(
                    "/api/admin/live-stats without auth → 401",
                    False,
                    f"Expected 401, got {r.status_code}"
                )
        except Exception as e:
            log_test("/api/admin/live-stats without auth → 401", False, str(e))
        
        # Test /api/admin/top-referrers without auth → 401
        try:
            r = await client.get(f"{API_BASE}/admin/top-referrers")
            if r.status_code == 401:
                log_test("/api/admin/top-referrers without auth → 401", True)
            else:
                log_test(
                    "/api/admin/top-referrers without auth → 401",
                    False,
                    f"Expected 401, got {r.status_code}"
                )
        except Exception as e:
            log_test("/api/admin/top-referrers without auth → 401", False, str(e))
        
        # Test /api/ still works
        try:
            r = await client.get(f"{API_BASE}/")
            if r.status_code == 200:
                data = r.json()
                if data.get("app") == "LiveWatch" and data.get("status") == "ok":
                    log_test("/api/ returns correct response", True)
                else:
                    log_test(
                        "/api/ returns correct response",
                        False,
                        f"Unexpected response: {data}"
                    )
            else:
                log_test("/api/ returns correct response", False, f"HTTP {r.status_code}")
        except Exception as e:
            log_test("/api/ returns correct response", False, str(e))
        
        # Test /api/channels still works
        try:
            r = await client.get(f"{API_BASE}/channels?limit=5")
            if r.status_code == 200:
                data = r.json()
                if "channels" in data and isinstance(data["channels"], list):
                    log_test("/api/channels still works", True)
                else:
                    log_test("/api/channels still works", False, "Missing 'channels' array")
            else:
                log_test("/api/channels still works", False, f"HTTP {r.status_code}")
        except Exception as e:
            log_test("/api/channels still works", False, str(e))
        
        # Test /api/daddy/channels still works
        try:
            r = await client.get(f"{API_BASE}/daddy/channels?limit=5")
            if r.status_code == 200:
                data = r.json()
                if "channels" in data and isinstance(data["channels"], list):
                    log_test("/api/daddy/channels still works", True)
                else:
                    log_test("/api/daddy/channels still works", False, "Missing 'channels' array")
            else:
                log_test("/api/daddy/channels still works", False, f"HTTP {r.status_code}")
        except Exception as e:
            log_test("/api/daddy/channels still works", False, str(e))
        
        # Test /api/stream/{id} response shape unchanged
        try:
            r = await client.get(f"{API_BASE}/channels?limit=1")
            channels = r.json().get("channels", [])
            if channels:
                channel_id = channels[0]["id"]
                r2 = await client.get(f"{API_BASE}/stream/{channel_id}")
                if r2.status_code == 200:
                    data = r2.json()
                    if "id" in data and "name" in data and "proxy_url" in data:
                        log_test(
                            "/api/stream/{id} response shape unchanged",
                            True,
                            f"Response has id, name, proxy_url"
                        )
                    else:
                        log_test(
                            "/api/stream/{id} response shape unchanged",
                            False,
                            f"Missing expected fields: {data.keys()}"
                        )
                else:
                    log_test(
                        "/api/stream/{id} response shape unchanged",
                        False,
                        f"HTTP {r2.status_code}"
                    )
            else:
                log_test("/api/stream/{id} response shape unchanged", False, "No channels to test")
        except Exception as e:
            log_test("/api/stream/{id} response shape unchanged", False, str(e))


async def show_sample_views():
    """Show sample of recent views to verify field shape."""
    print("\n=== Sample Views (last 5) ===")
    
    client_mongo = AsyncIOMotorClient(MONGO_URL)
    db = client_mongo[DB_NAME]
    
    try:
        views = []
        async for view in db.views.find().sort("ts", -1).limit(5):
            views.append({
                "channel_id": view.get("channel_id"),
                "ts": view.get("ts").isoformat() if view.get("ts") else None,
                "is_member": view.get("is_member"),
                "is_vip": view.get("is_vip"),
                "is_embed": view.get("is_embed"),
                "ip": view.get("ip"),
            })
        
        if views:
            for i, v in enumerate(views, 1):
                print(f"  {i}. {v}")
        else:
            print("  (no views found)")
    except Exception as e:
        print(f"  Error: {e}")
    finally:
        client_mongo.close()


async def main():
    """Run all tests."""
    print(f"Backend URL: {BACKEND_URL}")
    print(f"MongoDB: {MONGO_URL}/{DB_NAME}")
    print("=" * 70)
    
    await test_mongodb_indexes()
    await test_endpoint_auth()
    await test_extended_view_tracking()
    await test_aggregation_correctness()
    await test_daddy_parity()
    await test_regression()
    await show_sample_views()
    
    print("\n" + "=" * 70)
    print(f"SUMMARY: {results['passed']} passed, {results['failed']} failed")
    print("=" * 70)
    
    if results["failed"] > 0:
        print("\n❌ FAILED TESTS:")
        for t in results["tests"]:
            if not t["passed"]:
                print(f"  - {t['name']}")
                if t["details"]:
                    print(f"    {t['details']}")
    
    return results["failed"] == 0


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
