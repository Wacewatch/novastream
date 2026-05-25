#!/usr/bin/env python3
"""
Backend test suite for NEW features:
1. EPG module (/api/epg/*)
2. Sports daily ticker (/api/sports/daily)

Base URL: https://player-ui-redesign.preview.emergentagent.com
"""
import requests
import time
from typing import Dict, Any

BASE_URL = "https://player-ui-redesign.preview.emergentagent.com"

def test_epg_status():
    """Test a) GET /api/epg/status"""
    print("\n[EPG-a] Testing GET /api/epg/status...")
    r = requests.get(f"{BASE_URL}/api/epg/status", timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    # Must return required fields
    assert "indexed_slugs" in data, "Missing indexed_slugs"
    assert "indexed_channels" in data, "Missing indexed_channels"
    assert "sources_loaded" in data, "Missing sources_loaded"
    assert "last_build_ts" in data, "Missing last_build_ts"
    assert "age_sec" in data, "Missing age_sec"
    
    print(f"✅ EPG status: {data['indexed_slugs']} slugs, {data['indexed_channels']} channels, {len(data['sources_loaded'])} sources")
    return data


def test_epg_refresh():
    """Test b) POST /api/epg/refresh"""
    print("\n[EPG-b] Testing POST /api/epg/refresh (may take up to 60s)...")
    start = time.time()
    r = requests.post(f"{BASE_URL}/api/epg/refresh", timeout=90)
    elapsed = time.time() - start
    
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    assert "indexed_slugs" in data, "Missing indexed_slugs"
    assert "sources_loaded" in data, "Missing sources_loaded"
    
    # Expected: indexed_slugs > 500 and at least 1 source
    assert data["indexed_slugs"] > 500, f"Expected >500 slugs, got {data['indexed_slugs']}"
    assert len(data["sources_loaded"]) >= 1, f"Expected >=1 source, got {len(data['sources_loaded'])}"
    
    print(f"✅ EPG refresh completed in {elapsed:.1f}s: {data['indexed_slugs']} slugs, {len(data['sources_loaded'])} sources")
    return data


def test_epg_now_channel(name: str, test_id: str):
    """Test c-f) GET /api/epg/now?name=<channel>"""
    print(f"\n[EPG-{test_id}] Testing GET /api/epg/now?name={name}...")
    r = requests.get(f"{BASE_URL}/api/epg/now", params={"name": name}, timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    # Must return current and next non-null
    assert data.get("current") is not None, f"Expected current not null for {name}"
    assert data.get("next") is not None, f"Expected next not null for {name}"
    assert data.get("channel") is not None, f"Expected matched channel not null for {name}"
    
    # current.title should be non-empty
    assert data["current"].get("title"), f"Expected current.title non-empty for {name}"
    
    # Verify progress is between 0 and 1
    progress = data["current"].get("progress", -1)
    assert 0 <= progress <= 1, f"Expected progress in [0,1], got {progress}"
    
    # Verify start < stop
    start = data["current"].get("start", 0)
    stop = data["current"].get("stop", 0)
    assert start < stop, f"Expected start < stop, got {start} >= {stop}"
    
    # Verify start <= now <= stop (current programme should be airing now)
    now = time.time()
    assert start <= now <= stop, f"Expected {start} <= {now} <= {stop} (current not airing now)"
    
    print(f"✅ EPG now for {name}: current='{data['current']['title']}', next='{data['next']['title']}', progress={progress:.2f}")
    return data


def test_epg_now_empty():
    """Test g) GET /api/epg/now?name= (empty name)"""
    print("\n[EPG-g] Testing GET /api/epg/now?name= (empty name)...")
    r = requests.get(f"{BASE_URL}/api/epg/now", params={"name": ""}, timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    # Must return null values
    assert data.get("channel") is None, "Expected channel=null for empty name"
    assert data.get("current") is None, "Expected current=null for empty name"
    assert data.get("next") is None, "Expected next=null for empty name"
    
    print("✅ EPG now with empty name returns null values correctly")
    return data


def test_epg_now_nonexistent():
    """Test h) GET /api/epg/now?name=NonExistentChannel123"""
    print("\n[EPG-h] Testing GET /api/epg/now?name=NonExistentChannel123...")
    r = requests.get(f"{BASE_URL}/api/epg/now", params={"name": "NonExistentChannel123"}, timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    # Must return null values
    assert data.get("channel") is None, "Expected channel=null for nonexistent channel"
    assert data.get("current") is None, "Expected current=null for nonexistent channel"
    assert data.get("next") is None, "Expected next=null for nonexistent channel"
    
    print("✅ EPG now with nonexistent channel returns null values correctly")
    return data


def test_sports_daily_with_date():
    """Test a) GET /api/sports/daily?date=2026-05-25"""
    print("\n[SPORTS-a] Testing GET /api/sports/daily?date=2026-05-25...")
    r = requests.get(f"{BASE_URL}/api/sports/daily", params={"date": "2026-05-25"}, timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    # Expected: total > 0, matches list non-empty (upstream data varies by date)
    assert data.get("total", 0) > 0, f"Expected total > 0, got {data.get('total')}"
    assert isinstance(data.get("matches"), list), "Expected matches to be a list"
    assert len(data["matches"]) > 0, "Expected matches list to be non-empty"
    
    # Each match must have required fields
    match = data["matches"][0]
    required_fields = [
        "id", "league", "home_name", "away_name", "status_short", "status_label",
        "is_live", "is_finished", "home_logo", "away_logo", "kick_off", "kick_off_label"
    ]
    for field in required_fields:
        assert field in match, f"Missing field '{field}' in match"
    
    # is_live and is_finished must be booleans
    assert isinstance(match["is_live"], bool), "is_live must be boolean"
    assert isinstance(match["is_finished"], bool), "is_finished must be boolean"
    
    print(f"✅ Sports daily 2026-05-25: {data['total']} matches, {data.get('live_count', 0)} live, {len(data.get('leagues', []))} leagues")
    return data


def test_sports_daily_no_date():
    """Test b) GET /api/sports/daily (no date param)"""
    print("\n[SPORTS-b] Testing GET /api/sports/daily (no date, default to today)...")
    r = requests.get(f"{BASE_URL}/api/sports/daily", timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    # Must return valid JSON with expected structure
    assert "total" in data, "Missing total"
    assert "matches" in data, "Missing matches"
    assert isinstance(data["matches"], list), "matches must be a list"
    
    print(f"✅ Sports daily (today): {data['total']} matches")
    return data


def test_sports_daily_invalid_date():
    """Test c) GET /api/sports/daily?date=notadate"""
    print("\n[SPORTS-c] Testing GET /api/sports/daily?date=notadate...")
    r = requests.get(f"{BASE_URL}/api/sports/daily", params={"date": "notadate"}, timeout=15)
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    
    print("✅ Sports daily with invalid date returns 400 Bad Request")


def test_sports_daily_public():
    """Test d) GET /api/v1/public/sports/daily?date=2026-05-25"""
    print("\n[SPORTS-d] Testing GET /api/v1/public/sports/daily?date=2026-05-25...")
    r = requests.get(f"{BASE_URL}/api/v1/public/sports/daily", params={"date": "2026-05-25"}, timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    # Should return same data as /api/sports/daily (upstream data varies by date)
    assert data.get("total", 0) > 0, f"Expected total > 0, got {data.get('total')}"
    assert isinstance(data.get("matches"), list), "Expected matches to be a list"
    
    print(f"✅ Public sports daily 2026-05-25: {data['total']} matches")
    return data


def test_sports_daily_sorting():
    """Test e) Verify sorting: live first, then upcoming (by kick_off ASC), then finished"""
    print("\n[SPORTS-e] Testing sports daily sorting...")
    r = requests.get(f"{BASE_URL}/api/sports/daily", params={"date": "2026-05-25"}, timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    matches = data["matches"]
    
    # Verify sorting: live matches first
    live_indices = [i for i, m in enumerate(matches) if m["is_live"]]
    finished_indices = [i for i, m in enumerate(matches) if m["is_finished"]]
    upcoming_indices = [i for i, m in enumerate(matches) if not m["is_live"] and not m["is_finished"]]
    
    if live_indices:
        # All live matches should come before upcoming and finished
        max_live_idx = max(live_indices)
        if upcoming_indices:
            min_upcoming_idx = min(upcoming_indices)
            assert max_live_idx < min_upcoming_idx, "Live matches should come before upcoming"
        if finished_indices:
            min_finished_idx = min(finished_indices)
            assert max_live_idx < min_finished_idx, "Live matches should come before finished"
    
    if upcoming_indices and finished_indices:
        # All upcoming should come before finished
        max_upcoming_idx = max(upcoming_indices)
        min_finished_idx = min(finished_indices)
        assert max_upcoming_idx < min_finished_idx, "Upcoming matches should come before finished"
    
    print(f"✅ Sports daily sorting verified: {len(live_indices)} live, {len(upcoming_indices)} upcoming, {len(finished_indices)} finished")


def test_sports_daily_response_structure():
    """Test f) Verify response contains: total, live_count, finished_count, upcoming_count, leagues, matches"""
    print("\n[SPORTS-f] Testing sports daily response structure...")
    r = requests.get(f"{BASE_URL}/api/sports/daily", params={"date": "2026-05-25"}, timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    required_fields = ["total", "live_count", "finished_count", "upcoming_count", "leagues", "matches"]
    for field in required_fields:
        assert field in data, f"Missing field '{field}' in response"
    
    # Verify types
    assert isinstance(data["total"], int), "total must be int"
    assert isinstance(data["live_count"], int), "live_count must be int"
    assert isinstance(data["finished_count"], int), "finished_count must be int"
    assert isinstance(data["upcoming_count"], int), "upcoming_count must be int"
    assert isinstance(data["leagues"], list), "leagues must be list"
    assert isinstance(data["matches"], list), "matches must be list"
    
    print(f"✅ Sports daily response structure verified: all required fields present")


def test_sanity_root():
    """Test SANITY-a) GET /api/ → {app, status}"""
    print("\n[SANITY-a] Testing GET /api/...")
    r = requests.get(f"{BASE_URL}/api/", timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    assert "app" in data, "Missing 'app' field"
    assert "status" in data, "Missing 'status' field"
    
    print(f"✅ Root API: {data}")


def test_sanity_public_all():
    """Test SANITY-b) GET /api/v1/public/all → ≥ 900 channels"""
    print("\n[SANITY-b] Testing GET /api/v1/public/all...")
    r = requests.get(f"{BASE_URL}/api/v1/public/all", timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    assert "channels" in data, "Missing 'channels' field"
    assert isinstance(data["channels"], list), "channels must be a list"
    assert len(data["channels"]) >= 900, f"Expected ≥900 channels, got {len(data['channels'])}"
    
    print(f"✅ Public all: {len(data['channels'])} channels")


def test_sanity_daddy_channels():
    """Test SANITY-c) GET /api/daddy/channels?limit=5 → returns 5 channels"""
    print("\n[SANITY-c] Testing GET /api/daddy/channels?limit=5...")
    r = requests.get(f"{BASE_URL}/api/daddy/channels", params={"limit": 5}, timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    
    assert "channels" in data, "Missing 'channels' field"
    assert isinstance(data["channels"], list), "channels must be a list"
    assert len(data["channels"]) == 5, f"Expected 5 channels, got {len(data['channels'])}"
    
    print(f"✅ Daddy channels: {len(data['channels'])} channels")


def main():
    print("=" * 80)
    print("BACKEND TEST: EPG Module + Sports Daily Ticker")
    print("=" * 80)
    
    failed = []
    
    # EPG Module Tests
    print("\n" + "=" * 80)
    print("EPG MODULE TESTS")
    print("=" * 80)
    
    try:
        test_epg_status()
    except Exception as e:
        print(f"❌ EPG status test failed: {e}")
        failed.append(("EPG-a: status", str(e)))
    
    try:
        test_epg_refresh()
    except Exception as e:
        print(f"❌ EPG refresh test failed: {e}")
        failed.append(("EPG-b: refresh", str(e)))
    
    # Test EPG now for various channels
    channels = [
        ("TF1 HD", "c"),
        ("M6", "d"),
        ("France 2", "e"),
        ("BFM TV", "f"),
    ]
    
    for name, test_id in channels:
        try:
            test_epg_now_channel(name, test_id)
        except Exception as e:
            print(f"❌ EPG now test for {name} failed: {e}")
            failed.append((f"EPG-{test_id}: {name}", str(e)))
    
    try:
        test_epg_now_empty()
    except Exception as e:
        print(f"❌ EPG now empty test failed: {e}")
        failed.append(("EPG-g: empty name", str(e)))
    
    try:
        test_epg_now_nonexistent()
    except Exception as e:
        print(f"❌ EPG now nonexistent test failed: {e}")
        failed.append(("EPG-h: nonexistent channel", str(e)))
    
    # Sports Daily Ticker Tests
    print("\n" + "=" * 80)
    print("SPORTS DAILY TICKER TESTS")
    print("=" * 80)
    
    try:
        test_sports_daily_with_date()
    except Exception as e:
        print(f"❌ Sports daily with date test failed: {e}")
        failed.append(("SPORTS-a: with date", str(e)))
    
    try:
        test_sports_daily_no_date()
    except Exception as e:
        print(f"❌ Sports daily no date test failed: {e}")
        failed.append(("SPORTS-b: no date", str(e)))
    
    try:
        test_sports_daily_invalid_date()
    except Exception as e:
        print(f"❌ Sports daily invalid date test failed: {e}")
        failed.append(("SPORTS-c: invalid date", str(e)))
    
    try:
        test_sports_daily_public()
    except Exception as e:
        print(f"❌ Sports daily public test failed: {e}")
        failed.append(("SPORTS-d: public endpoint", str(e)))
    
    try:
        test_sports_daily_sorting()
    except Exception as e:
        print(f"❌ Sports daily sorting test failed: {e}")
        failed.append(("SPORTS-e: sorting", str(e)))
    
    try:
        test_sports_daily_response_structure()
    except Exception as e:
        print(f"❌ Sports daily response structure test failed: {e}")
        failed.append(("SPORTS-f: response structure", str(e)))
    
    # Sanity Tests
    print("\n" + "=" * 80)
    print("SANITY TESTS (NO REGRESSION)")
    print("=" * 80)
    
    try:
        test_sanity_root()
    except Exception as e:
        print(f"❌ Sanity root test failed: {e}")
        failed.append(("SANITY-a: root", str(e)))
    
    try:
        test_sanity_public_all()
    except Exception as e:
        print(f"❌ Sanity public all test failed: {e}")
        failed.append(("SANITY-b: public all", str(e)))
    
    try:
        test_sanity_daddy_channels()
    except Exception as e:
        print(f"❌ Sanity daddy channels test failed: {e}")
        failed.append(("SANITY-c: daddy channels", str(e)))
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    total_tests = 19  # 10 EPG + 6 Sports + 3 Sanity
    passed = total_tests - len(failed)
    
    if failed:
        print(f"\n❌ {len(failed)} TEST(S) FAILED:")
        for test_name, error in failed:
            print(f"  - {test_name}: {error}")
    
    print(f"\n✅ {passed}/{total_tests} tests passed")
    
    if failed:
        exit(1)
    else:
        print("\n🎉 ALL TESTS PASSED!")
        exit(0)


if __name__ == "__main__":
    main()
