#!/usr/bin/env python3
"""
NovaStream Extensions Backend Test Suite
Tests the newly added modules:
- DaddyTV (/api/daddy/*)
- Sports (/api/sports/*)
- Football Live (/api/football/*)
- Admin Football API keys CRUD (/api/admin/football-keys)
- Public v1 mirrors for all new modules
"""

import httpx
import time
from typing import Dict, Any, List

# Public preview URL
BASE_URL = "https://live-sports-hub-78.preview.emergentagent.com"

class TestResults:
    def __init__(self):
        self.passed = []
        self.failed = []
        self.warnings = []
    
    def add_pass(self, test_name: str, details: str = ""):
        self.passed.append(f"✅ {test_name}" + (f": {details}" if details else ""))
    
    def add_fail(self, test_name: str, details: str):
        self.failed.append(f"❌ {test_name}: {details}")
    
    def add_warning(self, test_name: str, details: str):
        self.warnings.append(f"⚠️  {test_name}: {details}")
    
    def print_summary(self):
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        
        if self.failed:
            print("\n🔴 FAILED TESTS:")
            for f in self.failed:
                print(f"  {f}")
        
        if self.warnings:
            print("\n🟡 WARNINGS:")
            for w in self.warnings:
                print(f"  {w}")
        
        if self.passed:
            print("\n🟢 PASSED TESTS:")
            for p in self.passed:
                print(f"  {p}")
        
        print("\n" + "="*80)
        print(f"Total: {len(self.passed)} passed, {len(self.failed)} failed, {len(self.warnings)} warnings")
        print("="*80 + "\n")

results = TestResults()

# =====================================================================
# DaddyTV Tests
# =====================================================================

def test_daddy_channels_no_filter():
    """Test DaddyTV: GET /api/daddy/channels (no filters)"""
    print("\n[TEST 1] DaddyTV - List all channels (no filter)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/daddy/channels", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        print(f"Countries: {len(data.get('countries', []))}")
        print(f"Categories: {len(data.get('categories', []))}")
        print(f"Channels returned: {len(data.get('channels', []))}")
        
        if response.status_code == 200:
            total = data.get("total", 0)
            channels = data.get("channels", [])
            countries = data.get("countries", [])
            categories = data.get("categories", [])
            
            # Should return ~817 channels
            if total >= 800 and total <= 850:
                results.add_pass("DaddyTV total count", f"{total} channels (expected ~817)")
            else:
                results.add_fail("DaddyTV total count", f"Got {total} channels, expected ~817")
            
            # Validate structure of first channel
            if channels:
                ch = channels[0]
                print(f"\nSample channel:")
                print(f"  ID: {ch.get('id')}")
                print(f"  Name: {ch.get('name')}")
                print(f"  Country: {ch.get('country')}")
                print(f"  Category: {ch.get('category')}")
                print(f"  Embed URL: {ch.get('embed_url')}")
                
                required_keys = ["id", "name", "country", "category", "embed_url"]
                if all(k in ch for k in required_keys):
                    results.add_pass("DaddyTV channel structure", "All required keys present")
                else:
                    missing = [k for k in required_keys if k not in ch]
                    results.add_fail("DaddyTV channel structure", f"Missing keys: {missing}")
                
                # Validate embed_url format
                embed_url = ch.get("embed_url", "")
                if "daddylive.li/embed/stream.php?id=" in embed_url:
                    results.add_pass("DaddyTV embed URL format", "Correct format")
                else:
                    results.add_fail("DaddyTV embed URL format", f"Wrong format: {embed_url}")
            
            # Validate countries and categories lists
            if len(countries) > 0:
                results.add_pass("DaddyTV countries list", f"{len(countries)} countries")
            else:
                results.add_fail("DaddyTV countries list", "Empty")
            
            if len(categories) > 0:
                results.add_pass("DaddyTV categories list", f"{len(categories)} categories")
            else:
                results.add_fail("DaddyTV categories list", "Empty")
        else:
            results.add_fail("DaddyTV list channels", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("DaddyTV list channels", f"Exception: {e}")


def test_daddy_channels_filter_country():
    """Test DaddyTV: GET /api/daddy/channels?country=France&limit=5"""
    print("\n[TEST 2] DaddyTV - Filter by country (France, limit=5)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/daddy/channels?country=France&limit=5", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        
        if response.status_code == 200:
            channels = data.get("channels", [])
            total = data.get("total", 0)
            
            if total > 5:
                results.add_fail("DaddyTV country filter", f"Limit=5 but got {total} channels")
                return
            
            if total == 0:
                results.add_fail("DaddyTV country filter", "No France channels found")
                return
            
            # Validate all are France
            all_france = True
            for ch in channels:
                print(f"  {ch.get('name')} - Country: {ch.get('country')}")
                if ch.get("country") != "France":
                    all_france = False
                    results.add_fail("DaddyTV country filter", f"Channel '{ch.get('name')}' has country '{ch.get('country')}'")
            
            if all_france:
                results.add_pass("DaddyTV country filter", f"All {total} channels are from France")
        else:
            results.add_fail("DaddyTV country filter", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("DaddyTV country filter", f"Exception: {e}")


def test_daddy_channels_filter_search_category():
    """Test DaddyTV: GET /api/daddy/channels?search=eurosport&category=Sport"""
    print("\n[TEST 3] DaddyTV - Filter by search + category")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/daddy/channels?search=eurosport&category=Sport", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        
        if response.status_code == 200:
            channels = data.get("channels", [])
            
            if len(channels) == 0:
                results.add_warning("DaddyTV search+category", "No channels matching 'eurosport' + Sport")
                return
            
            # Validate all match criteria
            all_valid = True
            for ch in channels:
                name = ch.get("name", "").lower()
                category = ch.get("category", "")
                print(f"  {ch.get('name')} - Category: {category}")
                
                if "eurosport" not in name:
                    results.add_fail("DaddyTV search filter", f"Channel '{ch.get('name')}' doesn't contain 'eurosport'")
                    all_valid = False
                
                if category != "Sport":
                    results.add_fail("DaddyTV category filter", f"Channel '{ch.get('name')}' has category '{category}'")
                    all_valid = False
            
            if all_valid:
                results.add_pass("DaddyTV search+category filter", f"All {len(channels)} channels match criteria")
        else:
            results.add_fail("DaddyTV search+category filter", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("DaddyTV search+category filter", f"Exception: {e}")


def test_daddy_channel_by_id():
    """Test DaddyTV: GET /api/daddy/channel/35"""
    print("\n[TEST 4] DaddyTV - Get channel by ID (35)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/daddy/channel/35", timeout=10.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Response: {data}")
        
        if response.status_code == 200:
            embed_url = data.get("embed_url", "")
            
            if "daddylive.li/embed/stream.php?id=35" in embed_url:
                results.add_pass("DaddyTV get by ID", f"Correct embed URL for ID 35")
            else:
                results.add_fail("DaddyTV get by ID", f"Wrong embed URL: {embed_url}")
        else:
            results.add_fail("DaddyTV get by ID", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("DaddyTV get by ID", f"Exception: {e}")


def test_daddy_channel_invalid_id():
    """Test DaddyTV: GET /api/daddy/channel/THIS_DOES_NOT_EXIST (should 404)"""
    print("\n[TEST 5] DaddyTV - Invalid channel ID (404 test)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/daddy/channel/THIS_DOES_NOT_EXIST", timeout=10.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 404:
            data = response.json()
            print(f"Response: {data}")
            results.add_pass("DaddyTV invalid ID 404", "Returns 404 correctly")
        else:
            results.add_fail("DaddyTV invalid ID 404", f"Expected 404, got HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("DaddyTV invalid ID 404", f"Exception: {e}")


def test_daddy_embed():
    """Test DaddyTV: GET /api/daddy/embed/35"""
    print("\n[TEST 6] DaddyTV - Get embed URL (35)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/daddy/embed/35", timeout=10.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Response: {data}")
        
        if response.status_code == 200:
            if data.get("id") == "35" and "embed_url" in data:
                embed_url = data.get("embed_url", "")
                if "daddylive.li/embed/stream.php?id=35" in embed_url:
                    results.add_pass("DaddyTV embed endpoint", "Returns correct embed URL")
                else:
                    results.add_fail("DaddyTV embed endpoint", f"Wrong embed URL: {embed_url}")
            else:
                results.add_fail("DaddyTV embed endpoint", f"Missing id or embed_url in response")
        else:
            results.add_fail("DaddyTV embed endpoint", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("DaddyTV embed endpoint", f"Exception: {e}")


# =====================================================================
# Sports Tests (streamed.pk + tv247.us)
# =====================================================================

def test_sports_matches():
    """Test Sports: GET /api/sports/matches"""
    print("\n[TEST 7] Sports - List matches")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/sports/matches", timeout=20.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        print(f"Sports: {data.get('sports', [])}")
        print(f"Live count: {data.get('liveCount', 0)}")
        print(f"Popular count: {data.get('popularCount', 0)}")
        
        if response.status_code == 200:
            events = data.get("events", [])
            
            required_keys = ["total", "sports", "sportCounts", "liveCount", "popularCount", "events"]
            if all(k in data for k in required_keys):
                results.add_pass("Sports matches structure", "All required keys present")
            else:
                missing = [k for k in required_keys if k not in data]
                results.add_fail("Sports matches structure", f"Missing keys: {missing}")
            
            # Validate event structure
            if events:
                event = events[0]
                print(f"\nSample event:")
                print(f"  ID: {event.get('id')}")
                print(f"  Title: {event.get('title')}")
                print(f"  Sport: {event.get('sport')}")
                print(f"  Time: {event.get('time')}")
                print(f"  Sources: {len(event.get('sources', []))}")
                
                event_keys = ["id", "title", "sport", "time", "sources"]
                if all(k in event for k in event_keys):
                    results.add_pass("Sports event structure", "All required keys present")
                else:
                    missing = [k for k in event_keys if k not in event]
                    results.add_fail("Sports event structure", f"Missing keys: {missing}")
            else:
                results.add_warning("Sports matches", "No events returned (may be normal if no matches today)")
        else:
            results.add_fail("Sports matches", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Sports matches", f"Exception: {e}")


def test_sports_matches_filter():
    """Test Sports: GET /api/sports/matches?sport=football"""
    print("\n[TEST 8] Sports - Filter by sport (football)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/sports/matches?sport=football", timeout=20.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        
        if response.status_code == 200:
            events = data.get("events", [])
            
            if len(events) == 0:
                results.add_warning("Sports filter by sport", "No football events (may be normal)")
                return
            
            # Validate all are football
            all_football = True
            for event in events:
                sport = event.get("sport", "").lower()
                if sport != "football":
                    results.add_fail("Sports filter by sport", f"Event '{event.get('title')}' has sport '{sport}'")
                    all_football = False
            
            if all_football:
                results.add_pass("Sports filter by sport", f"All {len(events)} events are football")
        else:
            results.add_fail("Sports filter by sport", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Sports filter by sport", f"Exception: {e}")


def test_sports_streams():
    """Test Sports: GET /api/sports/streams?source=alpha&id=test"""
    print("\n[TEST 9] Sports - Get streams")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/sports/streams?source=alpha&id=test", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Response: {data}")
        
        if response.status_code == 200:
            if "streams" in data:
                results.add_pass("Sports streams", "Returns streams array (even if empty)")
            else:
                results.add_fail("Sports streams", "Missing 'streams' key in response")
        else:
            results.add_fail("Sports streams", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Sports streams", f"Exception: {e}")


def test_sports_info():
    """Test Sports Info: GET /api/sports/info"""
    print("\n[TEST 10] Sports Info - Schedule (tv247.us)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/sports/info", timeout=20.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total days: {data.get('total_days', 0)}")
        
        if response.status_code == 200:
            days = data.get("days", [])
            
            if "total_days" in data and "days" in data:
                results.add_pass("Sports info structure", "Correct structure")
            else:
                results.add_fail("Sports info structure", "Missing total_days or days")
            
            # Validate day structure
            if days:
                day = days[0]
                print(f"\nSample day: {day.get('day')}")
                print(f"  Events: {len(day.get('events', []))}")
                
                if day.get("events"):
                    event = day["events"][0]
                    print(f"  Sample event:")
                    print(f"    Time: {event.get('time')}")
                    print(f"    Event: {event.get('event')}")
                    print(f"    Channels: {len(event.get('channels', []))}")
                    
                    event_keys = ["time", "event", "channels"]
                    if all(k in event for k in event_keys):
                        results.add_pass("Sports info event structure", "All required keys present")
                    else:
                        missing = [k for k in event_keys if k not in event]
                        results.add_fail("Sports info event structure", f"Missing keys: {missing}")
            else:
                results.add_warning("Sports info", "No days returned (may be normal)")
        else:
            results.add_fail("Sports info", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Sports info", f"Exception: {e}")


# =====================================================================
# Football Live Tests (RapidAPI)
# =====================================================================

def test_football_matches():
    """Test Football: GET /api/football/matches"""
    print("\n[TEST 11] Football Live - List matches")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/football/matches", timeout=30.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        print(f"Live count: {data.get('live_count', 0)}")
        print(f"Leagues: {len(data.get('leagues', []))}")
        
        if response.status_code == 200:
            matches = data.get("matches", [])
            
            required_keys = ["total", "live_count", "leagues", "matches"]
            if all(k in data for k in required_keys):
                results.add_pass("Football matches structure", "All required keys present")
            else:
                missing = [k for k in required_keys if k not in data]
                results.add_fail("Football matches structure", f"Missing keys: {missing}")
            
            # Validate match structure
            if matches:
                match = matches[0]
                print(f"\nSample match:")
                print(f"  ID: {match.get('id')}")
                print(f"  Title: {match.get('title')}")
                print(f"  Home: {match.get('home')}")
                print(f"  Away: {match.get('away')}")
                print(f"  League: {match.get('league')}")
                print(f"  Is Live: {match.get('is_live')}")
                print(f"  Has Servers: {match.get('has_servers')}")
                
                # Check for placeholder team names (bug)
                home = match.get("home", "")
                away = match.get("away", "")
                
                if home == "Home" or away == "Away":
                    results.add_fail("Football team names", f"Placeholder team names found: {home} vs {away}")
                else:
                    results.add_pass("Football team names", "Real team names (not placeholders)")
                
                match_keys = ["id", "title", "home", "away", "league", "is_live", "has_servers"]
                if all(k in match for k in match_keys):
                    results.add_pass("Football match structure", "All required keys present")
                else:
                    missing = [k for k in match_keys if k not in match]
                    results.add_fail("Football match structure", f"Missing keys: {missing}")
            else:
                results.add_warning("Football matches", "No matches returned (may be normal)")
        else:
            results.add_fail("Football matches", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Football matches", f"Exception: {e}")


def test_football_streams():
    """Test Football: GET /api/football/streams?mid={live_match_id}"""
    print("\n[TEST 12] Football Live - Get streams for live match")
    print("-" * 60)
    
    try:
        # First get a live match with servers
        response = httpx.get(f"{BASE_URL}/api/football/matches", timeout=30.0)
        data = response.json()
        
        if response.status_code != 200:
            results.add_fail("Football streams", f"Failed to get matches: HTTP {response.status_code}")
            return
        
        matches = data.get("matches", [])
        live_match_with_servers = None
        
        for match in matches:
            if match.get("is_live") and match.get("has_servers"):
                live_match_with_servers = match
                break
        
        if not live_match_with_servers:
            results.add_warning("Football streams", "No live match with servers available to test")
            return
        
        match_id = live_match_with_servers.get("id")
        print(f"Testing with match ID: {match_id}")
        print(f"Match: {live_match_with_servers.get('title')}")
        
        # Get streams
        response = httpx.get(f"{BASE_URL}/api/football/streams?mid={match_id}", timeout=20.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Servers: {len(data.get('servers', []))}")
        
        if response.status_code == 200:
            servers = data.get("servers", [])
            
            if not servers:
                results.add_warning("Football streams", "No servers returned for live match")
                return
            
            # Validate server structure
            server = servers[0]
            print(f"\nSample server:")
            print(f"  Name: {server.get('name')}")
            print(f"  Stream URL: {server.get('stream_url', '')[:80]}...")
            
            server_keys = ["name", "stream_url"]
            if all(k in server for k in server_keys):
                results.add_pass("Football server structure", "All required keys present")
            else:
                missing = [k for k in server_keys if k not in server]
                results.add_fail("Football server structure", f"Missing keys: {missing}")
            
            # Validate stream_url contains proxy
            stream_url = server.get("stream_url", "")
            if "/api/football/proxy?url=" in stream_url:
                results.add_pass("Football HLS proxy URL", "Stream URL uses HLS proxy")
            else:
                results.add_fail("Football HLS proxy URL", f"Stream URL doesn't use proxy: {stream_url}")
        else:
            results.add_fail("Football streams", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Football streams", f"Exception: {e}")


def test_football_proxy_missing_url():
    """Test Football: GET /api/football/proxy (no url param, should 400)"""
    print("\n[TEST 13] Football Proxy - Missing url parameter (400 test)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/football/proxy", timeout=10.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 400:
            results.add_pass("Football proxy missing url", "Returns 400 correctly")
        else:
            results.add_fail("Football proxy missing url", f"Expected 400, got HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Football proxy missing url", f"Exception: {e}")


def test_football_proxy_invalid_url():
    """Test Football: GET /api/football/proxy?url=invalid (should 400)"""
    print("\n[TEST 14] Football Proxy - Invalid url parameter (400 test)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/football/proxy?url=invalid", timeout=10.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 400:
            results.add_pass("Football proxy invalid url", "Returns 400 correctly")
        else:
            results.add_fail("Football proxy invalid url", f"Expected 400, got HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Football proxy invalid url", f"Exception: {e}")


# =====================================================================
# Admin Football Keys Tests (401 checks only - no admin JWT available)
# =====================================================================

def test_admin_football_keys_get_401():
    """Test Admin: GET /api/admin/football-keys (no auth, should 401)"""
    print("\n[TEST 15] Admin Football Keys - GET without auth (401 test)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/admin/football-keys", timeout=10.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            results.add_pass("Admin GET 401", "Returns 401 without auth")
        else:
            results.add_fail("Admin GET 401", f"Expected 401, got HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Admin GET 401", f"Exception: {e}")


def test_admin_football_keys_post_401():
    """Test Admin: POST /api/admin/football-keys (no auth, should 401)"""
    print("\n[TEST 16] Admin Football Keys - POST without auth (401 test)")
    print("-" * 60)
    
    try:
        payload = {
            "api_key": "x" * 30,
            "label": "test",
            "enabled": True
        }
        response = httpx.post(f"{BASE_URL}/api/admin/football-keys", json=payload, timeout=10.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            results.add_pass("Admin POST 401", "Returns 401 without auth")
        else:
            results.add_fail("Admin POST 401", f"Expected 401, got HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Admin POST 401", f"Exception: {e}")


def test_admin_football_keys_patch_401():
    """Test Admin: PATCH /api/admin/football-keys/abc (no auth, should 401)"""
    print("\n[TEST 17] Admin Football Keys - PATCH without auth (401 test)")
    print("-" * 60)
    
    try:
        payload = {"enabled": False}
        response = httpx.patch(f"{BASE_URL}/api/admin/football-keys/abc", json=payload, timeout=10.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            results.add_pass("Admin PATCH 401", "Returns 401 without auth")
        else:
            results.add_fail("Admin PATCH 401", f"Expected 401, got HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Admin PATCH 401", f"Exception: {e}")


def test_admin_football_keys_delete_401():
    """Test Admin: DELETE /api/admin/football-keys/abc (no auth, should 401)"""
    print("\n[TEST 18] Admin Football Keys - DELETE without auth (401 test)")
    print("-" * 60)
    
    try:
        response = httpx.delete(f"{BASE_URL}/api/admin/football-keys/abc", timeout=10.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            results.add_pass("Admin DELETE 401", "Returns 401 without auth")
        else:
            results.add_fail("Admin DELETE 401", f"Expected 401, got HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Admin DELETE 401", f"Exception: {e}")


# =====================================================================
# Public v1 Endpoints Tests
# =====================================================================

def test_public_daddy_channels():
    """Test Public v1: GET /api/v1/public/daddy/channels?limit=5"""
    print("\n[TEST 19] Public v1 - DaddyTV channels")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/daddy/channels?limit=5", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        
        if response.status_code == 200:
            if "total" in data and "channels" in data:
                results.add_pass("Public v1 daddy/channels", f"Returns {data.get('total')} channels")
            else:
                results.add_fail("Public v1 daddy/channels", "Missing total or channels")
        else:
            results.add_fail("Public v1 daddy/channels", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Public v1 daddy/channels", f"Exception: {e}")


def test_public_daddy_channel():
    """Test Public v1: GET /api/v1/public/daddy/channel/35"""
    print("\n[TEST 20] Public v1 - DaddyTV single channel")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/daddy/channel/35", timeout=10.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Response: {data}")
        
        if response.status_code == 200:
            if "id" in data and "embed_url" in data:
                results.add_pass("Public v1 daddy/channel", "Returns channel data")
            else:
                results.add_fail("Public v1 daddy/channel", "Missing id or embed_url")
        else:
            results.add_fail("Public v1 daddy/channel", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Public v1 daddy/channel", f"Exception: {e}")


def test_public_daddy_countries():
    """Test Public v1: GET /api/v1/public/daddy/countries"""
    print("\n[TEST 21] Public v1 - DaddyTV countries")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/daddy/countries", timeout=10.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        
        if response.status_code == 200:
            if "total" in data and "countries" in data:
                results.add_pass("Public v1 daddy/countries", f"Returns {data.get('total')} countries")
            else:
                results.add_fail("Public v1 daddy/countries", "Missing total or countries")
        else:
            results.add_fail("Public v1 daddy/countries", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Public v1 daddy/countries", f"Exception: {e}")


def test_public_daddy_categories():
    """Test Public v1: GET /api/v1/public/daddy/categories"""
    print("\n[TEST 22] Public v1 - DaddyTV categories")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/daddy/categories", timeout=10.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        
        if response.status_code == 200:
            if "total" in data and "categories" in data:
                results.add_pass("Public v1 daddy/categories", f"Returns {data.get('total')} categories")
            else:
                results.add_fail("Public v1 daddy/categories", "Missing total or categories")
        else:
            results.add_fail("Public v1 daddy/categories", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Public v1 daddy/categories", f"Exception: {e}")


def test_public_sports():
    """Test Public v1: GET /api/v1/public/sports"""
    print("\n[TEST 23] Public v1 - Sports")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/sports", timeout=20.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        
        if response.status_code == 200:
            if "total" in data and "events" in data:
                results.add_pass("Public v1 sports", f"Returns {data.get('total')} events")
            else:
                results.add_fail("Public v1 sports", "Missing total or events")
        else:
            results.add_fail("Public v1 sports", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Public v1 sports", f"Exception: {e}")


def test_public_football():
    """Test Public v1: GET /api/v1/public/football"""
    print("\n[TEST 24] Public v1 - Football")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/football", timeout=30.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        
        if response.status_code == 200:
            if "total" in data and "matches" in data:
                results.add_pass("Public v1 football", f"Returns {data.get('total')} matches")
            else:
                results.add_fail("Public v1 football", "Missing total or matches")
        else:
            results.add_fail("Public v1 football", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Public v1 football", f"Exception: {e}")


def test_public_sports_info():
    """Test Public v1: GET /api/v1/public/sports/info"""
    print("\n[TEST 25] Public v1 - Sports Info")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/sports/info", timeout=20.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total days: {data.get('total_days', 0)}")
        
        if response.status_code == 200:
            if "total_days" in data and "days" in data:
                results.add_pass("Public v1 sports/info", f"Returns {data.get('total_days')} days")
            else:
                results.add_fail("Public v1 sports/info", "Missing total_days or days")
        else:
            results.add_fail("Public v1 sports/info", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Public v1 sports/info", f"Exception: {e}")


# =====================================================================
# Main Test Runner
# =====================================================================

def main():
    print("="*80)
    print("NovaStream Extensions Backend Test Suite")
    print("="*80)
    print(f"Testing: {BASE_URL}")
    print("="*80)
    
    # DaddyTV Tests
    print("\n" + "="*80)
    print("DADDYTV MODULE TESTS")
    print("="*80)
    test_daddy_channels_no_filter()
    test_daddy_channels_filter_country()
    test_daddy_channels_filter_search_category()
    test_daddy_channel_by_id()
    test_daddy_channel_invalid_id()
    test_daddy_embed()
    
    # Sports Tests
    print("\n" + "="*80)
    print("SPORTS MODULE TESTS (streamed.pk + tv247.us)")
    print("="*80)
    test_sports_matches()
    test_sports_matches_filter()
    test_sports_streams()
    test_sports_info()
    
    # Football Tests
    print("\n" + "="*80)
    print("FOOTBALL LIVE MODULE TESTS (RapidAPI)")
    print("="*80)
    test_football_matches()
    test_football_streams()
    test_football_proxy_missing_url()
    test_football_proxy_invalid_url()
    
    # Admin Tests
    print("\n" + "="*80)
    print("ADMIN FOOTBALL KEYS TESTS (401 checks only)")
    print("="*80)
    test_admin_football_keys_get_401()
    test_admin_football_keys_post_401()
    test_admin_football_keys_patch_401()
    test_admin_football_keys_delete_401()
    
    # Public v1 Tests
    print("\n" + "="*80)
    print("PUBLIC V1 ENDPOINTS TESTS")
    print("="*80)
    test_public_daddy_channels()
    test_public_daddy_channel()
    test_public_daddy_countries()
    test_public_daddy_categories()
    test_public_sports()
    test_public_football()
    test_public_sports_info()
    
    # Print summary
    results.print_summary()
    
    # Exit with appropriate code
    if results.failed:
        exit(1)
    else:
        exit(0)


if __name__ == "__main__":
    main()
