#!/usr/bin/env python3
"""
BossTV Backend Test Suite
Tests all BossTV endpoints + regression tests for existing endpoints
"""
import requests
import time

BASE_URL = "https://universal-player-16.preview.emergentagent.com"

def test_bosstv_matches():
    """Test 1: GET /api/bosstv/matches - basic structure"""
    print("\n=== Test 1: GET /api/bosstv/matches ===")
    r = requests.get(f"{BASE_URL}/api/bosstv/matches", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    print(f"Response keys: {list(data.keys())}")
    
    # Check required top-level fields
    required_fields = ["total", "live_count", "upcoming_count", "finished_count", 
                      "league_count", "leagues", "matches", "cache_age_sec"]
    for field in required_fields:
        assert field in data, f"Missing field: {field}"
        print(f"✓ {field}: {data[field] if field != 'matches' else f'{len(data[field])} matches'}")
    
    # Check total >= 1 (live matches should exist)
    assert data["total"] >= 1, f"Expected total >= 1, got {data['total']}"
    print(f"✓ Total matches >= 1: {data['total']}")
    
    # Check leagues is an array
    assert isinstance(data["leagues"], list), "leagues should be a list"
    print(f"✓ Leagues is array with {len(data['leagues'])} leagues")
    
    # Check matches is an array
    assert isinstance(data["matches"], list), "matches should be a list"
    print(f"✓ Matches is array with {len(data['matches'])} matches")
    
    # Check first match structure
    if data["matches"]:
        match = data["matches"][0]
        print(f"\nFirst match structure:")
        match_fields = ["id", "title", "home", "away", "home_logo", "away_logo", 
                       "league", "status", "is_live", "is_finished", "timestamp", 
                       "time_label", "has_servers", "server_count"]
        for field in match_fields:
            assert field in match, f"Match missing field: {field}"
            print(f"  {field}: {match[field]}")
        
        # Check types
        assert isinstance(match["id"], str), "id should be string"
        assert isinstance(match["is_live"], bool), "is_live should be bool"
        assert isinstance(match["is_finished"], bool), "is_finished should be bool"
        assert isinstance(match["timestamp"], int), "timestamp should be int"
        assert isinstance(match["has_servers"], bool), "has_servers should be bool"
        assert isinstance(match["server_count"], int), "server_count should be int"
        print("✓ All match fields present with correct types")
    
    print("✅ Test 1 PASSED\n")
    return data


def test_bosstv_matches_status_live(all_matches_data):
    """Test 2: GET /api/bosstv/matches?status=live - only live matches"""
    print("\n=== Test 2: GET /api/bosstv/matches?status=live ===")
    r = requests.get(f"{BASE_URL}/api/bosstv/matches?status=live", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    print(f"Total: {data['total']}, Live count: {data['live_count']}")
    
    # Check live_count == total
    assert data["live_count"] == data["total"], \
        f"Expected live_count ({data['live_count']}) == total ({data['total']})"
    print(f"✓ live_count == total: {data['total']}")
    
    # Check all matches are live
    for match in data["matches"]:
        assert match["is_live"] is True, f"Match {match['id']} is not live"
    print(f"✓ All {len(data['matches'])} matches have is_live=true")
    
    print("✅ Test 2 PASSED\n")
    return data


def test_bosstv_matches_status_finished():
    """Test 3: GET /api/bosstv/matches?status=finished - only finished matches"""
    print("\n=== Test 3: GET /api/bosstv/matches?status=finished ===")
    r = requests.get(f"{BASE_URL}/api/bosstv/matches?status=finished", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    print(f"Total: {data['total']}, Finished count: {data['finished_count']}")
    
    # Check all matches are finished
    for match in data["matches"]:
        assert match["is_finished"] is True, f"Match {match['id']} is not finished"
    print(f"✓ All {len(data['matches'])} matches have is_finished=true")
    
    print("✅ Test 3 PASSED\n")


def test_bosstv_matches_search():
    """Test 4: GET /api/bosstv/matches?search=vs - search filter"""
    print("\n=== Test 4: GET /api/bosstv/matches?search=vs ===")
    r = requests.get(f"{BASE_URL}/api/bosstv/matches?search=vs", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    print(f"Total matches with 'vs': {data['total']}")
    
    # Should not error (may be 0 if none match)
    assert isinstance(data["total"], int), "total should be int"
    print(f"✓ Search filter works (returned {data['total']} matches)")
    
    print("✅ Test 4 PASSED\n")


def test_bosstv_streams_no_mid():
    """Test 5: GET /api/bosstv/streams (no mid) - should return empty servers"""
    print("\n=== Test 5: GET /api/bosstv/streams (no mid) ===")
    r = requests.get(f"{BASE_URL}/api/bosstv/streams", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    print(f"Response: {data}")
    
    assert "servers" in data, "Missing 'servers' field"
    assert data["servers"] == [], f"Expected empty servers list, got {data['servers']}"
    print("✓ Returns empty servers list when no mid provided")
    
    print("✅ Test 5 PASSED\n")


def test_bosstv_streams_with_live_match(live_matches_data):
    """Test 6: GET /api/bosstv/streams?mid=<live_match_id> - should return servers"""
    print("\n=== Test 6: GET /api/bosstv/streams?mid=<live_match_id> ===")
    
    # Find a live match with servers
    live_match = None
    for match in live_matches_data["matches"]:
        if match["has_servers"] and match["server_count"] > 0:
            live_match = match
            break
    
    if not live_match:
        print("⚠️  No live matches with servers found, skipping test")
        return
    
    print(f"Testing with match: {live_match['title']} (id: {live_match['id']})")
    print(f"Expected server_count: {live_match['server_count']}")
    
    r = requests.get(f"{BASE_URL}/api/bosstv/streams?mid={live_match['id']}", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    print(f"Response keys: {list(data.keys())}")
    
    assert "servers" in data, "Missing 'servers' field"
    servers = data["servers"]
    print(f"Number of servers: {len(servers)}")
    
    # Should have at least 1 server
    assert len(servers) >= 1, f"Expected at least 1 server, got {len(servers)}"
    print(f"✓ Has {len(servers)} server(s)")
    
    # Check server structure
    for i, server in enumerate(servers):
        print(f"\nServer {i+1}:")
        assert "name" in server, f"Server {i} missing 'name'"
        assert "stream_url" in server, f"Server {i} missing 'stream_url'"
        print(f"  name: {server['name']}")
        print(f"  stream_url: {server['stream_url'][:80]}...")
        
        # Check stream_url format
        assert server["stream_url"].startswith("https://"), \
            f"stream_url should start with https://, got {server['stream_url'][:20]}"
        assert ".m3u8" in server["stream_url"], \
            f"stream_url should contain .m3u8, got {server['stream_url']}"
        print(f"  ✓ stream_url starts with https:// and contains .m3u8")
    
    print("✅ Test 6 PASSED\n")


def test_public_bosstv():
    """Test 7: GET /api/v1/public/bosstv - public endpoint structure"""
    print("\n=== Test 7: GET /api/v1/public/bosstv ===")
    r = requests.get(f"{BASE_URL}/api/v1/public/bosstv", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    print(f"Response keys: {list(data.keys())}")
    
    # Check required fields (same as /bosstv/matches)
    required_fields = ["total", "live_count", "upcoming_count", "finished_count", 
                      "league_count", "leagues", "matches", "cache_age_sec"]
    for field in required_fields:
        assert field in data, f"Missing field: {field}"
        print(f"✓ {field}: {data[field] if field != 'matches' else f'{len(data[field])} matches'}")
    
    # Check first match structure
    if data["matches"]:
        match = data["matches"][0]
        print(f"\nFirst match structure:")
        
        # Should have embeds[] instead of has_servers/server_count
        assert "embeds" in match, "Match missing 'embeds' field"
        assert "has_servers" not in match, "Match should NOT have 'has_servers' in public API"
        assert "server_count" not in match, "Match should NOT have 'server_count' in public API"
        print(f"✓ Has 'embeds' field, no 'has_servers' or 'server_count'")
        
        # Check embeds structure
        embeds = match["embeds"]
        print(f"Number of embeds: {len(embeds)}")
        
        if embeds:
            embed = embeds[0]
            print(f"\nFirst embed:")
            assert "label" in embed, "Embed missing 'label'"
            assert "embed_url" in embed, "Embed missing 'embed_url'"
            print(f"  label: {embed['label']}")
            print(f"  embed_url: {embed['embed_url']}")
            
            # Check embed_url format
            assert "/embed/bosstv/t/" in embed["embed_url"], \
                f"embed_url should contain '/embed/bosstv/t/', got {embed['embed_url']}"
            print(f"  ✓ embed_url contains '/embed/bosstv/t/'")
            
            # Check that embed_url does NOT contain raw m3u8 URLs or bosstvmm.com
            assert ".m3u8" not in embed["embed_url"], \
                f"embed_url should NOT contain .m3u8, got {embed['embed_url']}"
            assert "bosstvmm.com" not in embed["embed_url"], \
                f"embed_url should NOT contain bosstvmm.com, got {embed['embed_url']}"
            print(f"  ✓ embed_url does NOT contain .m3u8 or bosstvmm.com")
    
    print("✅ Test 7 PASSED\n")


def test_public_bosstv_status_live():
    """Test 8: GET /api/v1/public/bosstv?status=live - only live matches"""
    print("\n=== Test 8: GET /api/v1/public/bosstv?status=live ===")
    r = requests.get(f"{BASE_URL}/api/v1/public/bosstv?status=live", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    print(f"Total: {data['total']}, Live count: {data['live_count']}")
    
    # Check all matches are live
    for match in data["matches"]:
        assert match["is_live"] is True, f"Match {match['id']} is not live"
    print(f"✓ All {len(data['matches'])} matches have is_live=true")
    
    print("✅ Test 8 PASSED\n")


def test_regression_existing_endpoints():
    """Test 9: Regression - ensure existing endpoints still work"""
    print("\n=== Test 9: Regression - Existing Endpoints ===")
    
    endpoints = [
        "/api/v1/public/football",
        "/api/v1/public/sports",
        "/api/v1/public/all",
        "/api/v1/public/daddy/channels",
    ]
    
    for endpoint in endpoints:
        print(f"\nTesting {endpoint}...")
        r = requests.get(f"{BASE_URL}{endpoint}", timeout=15)
        print(f"  Status: {r.status_code}")
        assert r.status_code == 200, f"Expected 200 for {endpoint}, got {r.status_code}"
        
        data = r.json()
        print(f"  Response type: {type(data)}")
        assert isinstance(data, dict), f"Expected dict response for {endpoint}"
        print(f"  ✓ {endpoint} working")
    
    print("\n✅ Test 9 PASSED - All existing endpoints working\n")


def main():
    print("=" * 80)
    print("BossTV Backend Test Suite")
    print("=" * 80)
    
    try:
        # Test 1: Basic matches endpoint
        all_matches_data = test_bosstv_matches()
        
        # Test 2: Filter by status=live
        live_matches_data = test_bosstv_matches_status_live(all_matches_data)
        
        # Test 3: Filter by status=finished
        test_bosstv_matches_status_finished()
        
        # Test 4: Search filter
        test_bosstv_matches_search()
        
        # Test 5: Streams without mid
        test_bosstv_streams_no_mid()
        
        # Test 6: Streams with live match id
        test_bosstv_streams_with_live_match(live_matches_data)
        
        # Test 7: Public endpoint
        test_public_bosstv()
        
        # Test 8: Public endpoint with status=live
        test_public_bosstv_status_live()
        
        # Test 9: Regression tests
        test_regression_existing_endpoints()
        
        print("=" * 80)
        print("✅ ALL TESTS PASSED (9/9)")
        print("=" * 80)
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        raise
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        raise


if __name__ == "__main__":
    main()
