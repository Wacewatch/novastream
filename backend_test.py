#!/usr/bin/env python3
"""
LiveWatch Backend API Test Suite
Tests all backend endpoints with focus on:
- Branding sanity
- Public API v1 validation
- Legacy API logo cleanup
- Stream resolution + caching
- HLS proxy + micro-caching
- Concurrency handling
"""

import httpx
import time
import asyncio
from urllib.parse import unquote, urlparse, parse_qs
from typing import Dict, Any, List

# Public preview URL
BASE_URL = "https://quad-view-page.preview.emergentagent.com"

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

def test_branding():
    """Test 1: Branding sanity - GET /api/ must return LiveWatch"""
    print("\n[TEST 1] Branding Sanity Check")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/", timeout=10.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Response: {data}")
        
        if response.status_code == 200:
            if data.get("app") == "LiveWatch" and data.get("status") == "ok":
                results.add_pass("Branding check", "Returns LiveWatch correctly")
            else:
                results.add_fail("Branding check", f"Expected app='LiveWatch' and status='ok', got {data}")
        else:
            results.add_fail("Branding check", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Branding check", f"Exception: {e}")

def test_public_api_countries():
    """Test 2a: Public API - GET /api/v1/public/countries"""
    print("\n[TEST 2a] Public API - Countries")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/countries", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total countries: {data.get('total', 0)}")
        print(f"Sample countries: {data.get('countries', [])[:5]}")
        
        if response.status_code == 200:
            countries = data.get("countries", [])
            total = data.get("total", 0)
            
            if total > 0 and len(countries) > 0:
                if "France" in countries:
                    results.add_pass("Public API countries", f"Returns {total} countries including France")
                else:
                    results.add_fail("Public API countries", "France not found in countries list")
            else:
                results.add_fail("Public API countries", "Empty countries list")
        else:
            results.add_fail("Public API countries", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Public API countries", f"Exception: {e}")

def test_public_api_categories():
    """Test 2b: Public API - GET /api/v1/public/categories"""
    print("\n[TEST 2b] Public API - Categories")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/categories", timeout=10.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Categories: {data.get('categories', [])}")
        
        if response.status_code == 200:
            categories = data.get("categories", [])
            if len(categories) > 0:
                results.add_pass("Public API categories", f"Returns {len(categories)} categories")
            else:
                results.add_fail("Public API categories", "Empty categories list")
        else:
            results.add_fail("Public API categories", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Public API categories", f"Exception: {e}")

def test_public_api_channels_by_country():
    """Test 2c: Public API - GET /api/v1/public/channels?country=France&limit=5"""
    print("\n[TEST 2c] Public API - Channels by Country (France, limit=5)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/channels?country=France&limit=5", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total returned: {data.get('total', 0)}")
        
        if response.status_code == 200:
            channels = data.get("channels", [])
            total = data.get("total", 0)
            
            if total > 5:
                results.add_fail("Channels by country", f"Limit=5 but got {total} channels")
                return
            
            if total == 0:
                results.add_fail("Channels by country", "No France channels returned")
                return
            
            # Validate structure of each channel
            all_valid = True
            for i, ch in enumerate(channels):
                print(f"\nChannel {i+1}:")
                print(f"  ID: {ch.get('id')}")
                print(f"  Name: {ch.get('name')}")
                print(f"  Country: {ch.get('country')}")
                print(f"  Categories: {ch.get('categories')}")
                print(f"  Stream URL: {ch.get('stream_url')}")
                print(f"  Embed URL: {ch.get('embed_url')}")
                
                # Validate required fields
                if not ch.get("id"):
                    results.add_fail("Channels by country", f"Channel {i+1} missing 'id'")
                    all_valid = False
                if not ch.get("name"):
                    results.add_fail("Channels by country", f"Channel {i+1} missing 'name'")
                    all_valid = False
                if ch.get("country") != "France":
                    results.add_fail("Channels by country", f"Channel {i+1} country is '{ch.get('country')}', expected 'France'")
                    all_valid = False
                if not isinstance(ch.get("categories"), list):
                    results.add_fail("Channels by country", f"Channel {i+1} categories not a list")
                    all_valid = False
                
                # Validate stream_url
                stream_url = ch.get("stream_url", "")
                if not stream_url.startswith(BASE_URL):
                    results.add_fail("Channels by country", f"Channel {i+1} stream_url doesn't start with {BASE_URL}")
                    all_valid = False
                if not stream_url.endswith(f"/api/stream/{ch.get('id')}"):
                    results.add_fail("Channels by country", f"Channel {i+1} stream_url doesn't end with /api/stream/{ch.get('id')}")
                    all_valid = False
                
                # Validate embed_url
                embed_url = ch.get("embed_url", "")
                if not embed_url.startswith(BASE_URL):
                    results.add_fail("Channels by country", f"Channel {i+1} embed_url doesn't start with {BASE_URL}")
                    all_valid = False
                if not embed_url.endswith(f"/embed/{ch.get('id')}"):
                    results.add_fail("Channels by country", f"Channel {i+1} embed_url doesn't end with /embed/{ch.get('id')}")
                    all_valid = False
            
            if all_valid:
                results.add_pass("Channels by country", f"All {total} France channels valid with correct URLs")
        else:
            results.add_fail("Channels by country", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Channels by country", f"Exception: {e}")

def test_public_api_channels_by_category():
    """Test 2d: Public API - GET /api/v1/public/channels?category=Sport&limit=3"""
    print("\n[TEST 2d] Public API - Channels by Category (Sport, limit=3)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/channels?category=Sport&limit=3", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total returned: {data.get('total', 0)}")
        
        if response.status_code == 200:
            channels = data.get("channels", [])
            total = data.get("total", 0)
            
            if total > 3:
                results.add_fail("Channels by category", f"Limit=3 but got {total} channels")
                return
            
            if total == 0:
                results.add_fail("Channels by category", "No Sport channels returned")
                return
            
            # Validate each channel contains "Sport" in categories
            all_valid = True
            for i, ch in enumerate(channels):
                print(f"\nChannel {i+1}: {ch.get('name')} - Categories: {ch.get('categories')}")
                if "Sport" not in ch.get("categories", []):
                    results.add_fail("Channels by category", f"Channel '{ch.get('name')}' doesn't have 'Sport' in categories")
                    all_valid = False
            
            if all_valid:
                results.add_pass("Channels by category", f"All {total} channels contain 'Sport' category")
        else:
            results.add_fail("Channels by category", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Channels by category", f"Exception: {e}")

def test_public_api_channels_by_search():
    """Test 2e: Public API - GET /api/v1/public/channels?search=tf1&limit=3"""
    print("\n[TEST 2e] Public API - Channels by Search (tf1, limit=3)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/channels?search=tf1&limit=3", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total returned: {data.get('total', 0)}")
        
        if response.status_code == 200:
            channels = data.get("channels", [])
            total = data.get("total", 0)
            
            if total > 3:
                results.add_fail("Channels by search", f"Limit=3 but got {total} channels")
                return
            
            if total == 0:
                results.add_warning("Channels by search", "No channels matching 'tf1' found")
                return
            
            # Validate each channel name contains "tf1" (case-insensitive)
            all_valid = True
            for i, ch in enumerate(channels):
                name = ch.get("name", "").lower()
                print(f"\nChannel {i+1}: {ch.get('name')}")
                if "tf1" not in name:
                    results.add_fail("Channels by search", f"Channel '{ch.get('name')}' doesn't contain 'tf1'")
                    all_valid = False
            
            if all_valid:
                results.add_pass("Channels by search", f"All {total} channels contain 'tf1' in name")
        else:
            results.add_fail("Channels by search", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Channels by search", f"Exception: {e}")

def test_public_api_single_channel():
    """Test 2f: Public API - GET /api/v1/public/channel/{id}"""
    print("\n[TEST 2f] Public API - Single Channel by ID")
    print("-" * 60)
    
    # First get a valid channel ID
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/channels?limit=1", timeout=15.0)
        data = response.json()
        channels = data.get("channels", [])
        
        if not channels:
            results.add_fail("Single channel", "No channels available to test")
            return
        
        channel_id = channels[0].get("id")
        print(f"Testing with channel ID: {channel_id}")
        
        # Now fetch single channel
        response = httpx.get(f"{BASE_URL}/api/v1/public/channel/{channel_id}", timeout=10.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Response: {data}")
        
        if response.status_code == 200:
            # Validate structure
            if all(k in data for k in ["id", "name", "country", "categories", "stream_url", "embed_url"]):
                results.add_pass("Single channel", f"Valid channel data for ID {channel_id}")
            else:
                results.add_fail("Single channel", f"Missing required fields in response")
        else:
            results.add_fail("Single channel", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Single channel", f"Exception: {e}")

def test_public_api_invalid_channel():
    """Test 2g: Public API - GET /api/v1/public/channel/INVALID_ID_FOO (should 404)"""
    print("\n[TEST 2g] Public API - Invalid Channel ID (404 test)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/channel/INVALID_ID_FOO", timeout=10.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 404:
            data = response.json()
            print(f"Response: {data}")
            if data.get("detail") == "Chaîne introuvable":
                results.add_pass("Invalid channel 404", "Returns correct 404 with French message")
            else:
                results.add_fail("Invalid channel 404", f"Wrong error message: {data.get('detail')}")
        else:
            results.add_fail("Invalid channel 404", f"Expected 404, got HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Invalid channel 404", f"Exception: {e}")

def test_legacy_channels_empty_logos():
    """Test 3: Legacy /api/channels - logos must be empty strings"""
    print("\n[TEST 3] Legacy API - Empty Logos Check")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/channels?country=France&limit=20", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total channels: {data.get('total', 0)}")
        
        if response.status_code == 200:
            channels = data.get("channels", [])
            
            if not channels:
                results.add_fail("Legacy empty logos", "No channels returned")
                return
            
            # Check all logos are empty strings
            all_empty = True
            for i, ch in enumerate(channels):
                logo = ch.get("logo")
                if logo != "":
                    print(f"Channel {i+1} '{ch.get('name')}' has logo: {logo}")
                    all_empty = False
            
            if all_empty:
                results.add_pass("Legacy empty logos", f"All {len(channels)} channels have empty logo field")
            else:
                results.add_fail("Legacy empty logos", "Some channels have non-empty logo field")
        else:
            results.add_fail("Legacy empty logos", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Legacy empty logos", f"Exception: {e}")

def test_stream_resolution_and_cache():
    """Test 4: Stream resolution + cache timing"""
    print("\n[TEST 4] Stream Resolution + Cache")
    print("-" * 60)
    
    # Get a valid channel ID
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/channels?limit=1", timeout=15.0)
        data = response.json()
        channels = data.get("channels", [])
        
        if not channels:
            results.add_fail("Stream resolution", "No channels available to test")
            return
        
        channel_id = channels[0].get("id")
        print(f"Testing with channel ID: {channel_id}")
        
        # First call (cold cache)
        print("\n--- First call (cold cache) ---")
        start = time.time()
        response1 = httpx.get(f"{BASE_URL}/api/stream/{channel_id}", timeout=30.0)
        elapsed1 = (time.time() - start) * 1000  # ms
        
        print(f"Status: {response1.status_code}")
        print(f"Elapsed: {elapsed1:.0f} ms")
        
        if response1.status_code != 200:
            results.add_fail("Stream resolution", f"First call failed with HTTP {response1.status_code}")
            return
        
        data1 = response1.json()
        print(f"Response: {data1}")
        
        # Validate response structure
        if not all(k in data1 for k in ["id", "name", "proxy_url"]):
            results.add_fail("Stream resolution", "Missing required fields in response")
            return
        
        proxy_url = data1.get("proxy_url", "")
        if not proxy_url.startswith("/api/hls?u="):
            results.add_fail("Stream resolution", f"proxy_url doesn't start with /api/hls?u=, got: {proxy_url}")
            return
        
        # Second call (warm cache)
        print("\n--- Second call (warm cache) ---")
        start = time.time()
        response2 = httpx.get(f"{BASE_URL}/api/stream/{channel_id}", timeout=30.0)
        elapsed2 = (time.time() - start) * 1000  # ms
        
        print(f"Status: {response2.status_code}")
        print(f"Elapsed: {elapsed2:.0f} ms")
        
        if response2.status_code != 200:
            results.add_fail("Stream cache", f"Second call failed with HTTP {response2.status_code}")
            return
        
        data2 = response2.json()
        
        # Validate cache hit (should be much faster)
        print(f"\nCache performance: {elapsed1:.0f} ms → {elapsed2:.0f} ms")
        
        if elapsed2 < 100:
            results.add_pass("Stream cache", f"Cache hit confirmed ({elapsed1:.0f}ms → {elapsed2:.0f}ms)")
        elif elapsed2 < elapsed1 * 0.5:
            results.add_pass("Stream cache", f"Cache working but slower than expected ({elapsed2:.0f}ms)")
        else:
            results.add_warning("Stream cache", f"Cache may not be working effectively ({elapsed1:.0f}ms → {elapsed2:.0f}ms)")
        
        # Validate same proxy_url
        if data1.get("proxy_url") == data2.get("proxy_url"):
            results.add_pass("Stream consistency", "Same proxy_url returned on cache hit")
        else:
            results.add_fail("Stream consistency", "Different proxy_url on second call")
        
    except Exception as e:
        results.add_fail("Stream resolution", f"Exception: {e}")

async def test_stream_concurrency():
    """Test 4b: Concurrent stream requests (thundering herd protection)"""
    print("\n[TEST 4b] Stream Concurrency (Thundering Herd Protection)")
    print("-" * 60)
    
    # Get a valid channel ID
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/channels?limit=1", timeout=15.0)
        data = response.json()
        channels = data.get("channels", [])
        
        if not channels:
            results.add_fail("Stream concurrency", "No channels available to test")
            return
        
        channel_id = channels[0].get("id")
        print(f"Testing with channel ID: {channel_id}")
        print("Firing 8 parallel requests...")
        
        async def fetch_stream():
            async with httpx.AsyncClient(timeout=30.0) as client:
                start = time.time()
                response = await client.get(f"{BASE_URL}/api/stream/{channel_id}")
                elapsed = (time.time() - start) * 1000
                return response, elapsed
        
        # Fire 8 concurrent requests
        start_all = time.time()
        tasks = [fetch_stream() for _ in range(8)]
        results_list = await asyncio.gather(*tasks, return_exceptions=True)
        total_elapsed = (time.time() - start_all) * 1000
        
        print(f"Total time for 8 parallel requests: {total_elapsed:.0f} ms")
        
        # Validate all succeeded
        proxy_urls = set()
        all_success = True
        for i, result in enumerate(results_list):
            if isinstance(result, Exception):
                print(f"Request {i+1}: FAILED - {result}")
                all_success = False
            else:
                response, elapsed = result
                if response.status_code == 200:
                    data = response.json()
                    proxy_urls.add(data.get("proxy_url"))
                    print(f"Request {i+1}: {response.status_code} in {elapsed:.0f} ms")
                else:
                    print(f"Request {i+1}: HTTP {response.status_code}")
                    all_success = False
        
        if not all_success:
            results.add_fail("Stream concurrency", "Some requests failed")
            return
        
        # All should return the same proxy_url
        if len(proxy_urls) == 1:
            results.add_pass("Stream concurrency", f"All 8 requests returned same proxy_url in {total_elapsed:.0f}ms")
        else:
            results.add_fail("Stream concurrency", f"Got {len(proxy_urls)} different proxy_urls")
        
        # Should complete quickly (lock prevents thundering herd)
        if total_elapsed < 5000:  # 5 seconds for 8 parallel requests is reasonable
            results.add_pass("Stream concurrency speed", f"Completed in {total_elapsed:.0f}ms")
        else:
            results.add_warning("Stream concurrency speed", f"Took {total_elapsed:.0f}ms (may indicate lock contention)")
        
    except Exception as e:
        results.add_fail("Stream concurrency", f"Exception: {e}")

def test_hls_proxy_and_microcache():
    """Test 5: HLS proxy + micro-cache"""
    print("\n[TEST 5] HLS Proxy + Micro-Cache")
    print("-" * 60)
    
    # Get a stream URL first
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/channels?limit=1", timeout=15.0)
        data = response.json()
        channels = data.get("channels", [])
        
        if not channels:
            results.add_fail("HLS proxy", "No channels available to test")
            return
        
        channel_id = channels[0].get("id")
        
        # Get proxy_url
        response = httpx.get(f"{BASE_URL}/api/stream/{channel_id}", timeout=30.0)
        if response.status_code != 200:
            results.add_fail("HLS proxy", f"Failed to get stream URL: HTTP {response.status_code}")
            return
        
        stream_data = response.json()
        proxy_url = stream_data.get("proxy_url", "")
        
        if not proxy_url.startswith("/api/hls?u="):
            results.add_fail("HLS proxy", f"Invalid proxy_url format: {proxy_url}")
            return
        
        # Extract upstream URL
        parsed = urlparse(proxy_url)
        params = parse_qs(parsed.query)
        upstream_url = params.get("u", [""])[0]
        
        print(f"Proxy URL: {proxy_url[:80]}...")
        print(f"Upstream URL: {upstream_url[:80]}...")
        
        # First call to HLS proxy
        print("\n--- First HLS call (cold cache) ---")
        start = time.time()
        response1 = httpx.get(f"{BASE_URL}{proxy_url}", timeout=30.0)
        elapsed1 = (time.time() - start) * 1000
        
        print(f"Status: {response1.status_code}")
        print(f"Content-Type: {response1.headers.get('content-type')}")
        print(f"Elapsed: {elapsed1:.0f} ms")
        
        if response1.status_code != 200:
            results.add_fail("HLS proxy", f"First call failed with HTTP {response1.status_code}")
            return
        
        # Validate content type
        content_type = response1.headers.get("content-type", "").lower()
        if "mpegurl" not in content_type and "application/vnd.apple" not in content_type:
            results.add_warning("HLS proxy", f"Unexpected content-type: {content_type}")
        
        # Validate m3u8 content
        body1 = response1.text
        if not body1.startswith("#EXTM3U"):
            results.add_fail("HLS proxy", "Response doesn't start with #EXTM3U")
            return
        
        print(f"Body preview: {body1[:200]}...")
        
        # Check URL rewriting
        lines = body1.split("\n")
        rewritten_count = 0
        non_comment_lines = 0
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                non_comment_lines += 1
                if stripped.startswith("/api/hls?u="):
                    rewritten_count += 1
        
        print(f"Non-comment lines: {non_comment_lines}, Rewritten: {rewritten_count}")
        
        if non_comment_lines > 0 and rewritten_count == non_comment_lines:
            results.add_pass("HLS URL rewriting", f"All {non_comment_lines} URLs rewritten correctly")
        elif non_comment_lines > 0:
            results.add_fail("HLS URL rewriting", f"Only {rewritten_count}/{non_comment_lines} URLs rewritten")
        
        # Check URI= rewriting in tags
        uri_pattern_found = False
        for line in lines:
            if 'URI="' in line and line.strip().startswith("#"):
                uri_pattern_found = True
                if '/api/hls?u=' in line:
                    results.add_pass("HLS URI tag rewriting", "URI attributes rewritten correctly")
                else:
                    results.add_fail("HLS URI tag rewriting", f"URI not rewritten in: {line[:100]}")
                break
        
        # Second call (micro-cache hit)
        print("\n--- Second HLS call (micro-cache, <2s) ---")
        start = time.time()
        response2 = httpx.get(f"{BASE_URL}{proxy_url}", timeout=30.0)
        elapsed2 = (time.time() - start) * 1000
        
        print(f"Status: {response2.status_code}")
        print(f"Elapsed: {elapsed2:.0f} ms")
        
        if response2.status_code != 200:
            results.add_fail("HLS micro-cache", f"Second call failed with HTTP {response2.status_code}")
            return
        
        # Validate micro-cache hit (should be <50ms)
        print(f"\nMicro-cache performance: {elapsed1:.0f} ms → {elapsed2:.0f} ms")
        
        if elapsed2 < 50:
            results.add_pass("HLS micro-cache", f"Cache hit confirmed ({elapsed1:.0f}ms → {elapsed2:.0f}ms)")
        elif elapsed2 < 100:
            results.add_pass("HLS micro-cache", f"Cache working ({elapsed1:.0f}ms → {elapsed2:.0f}ms, slightly slower than expected)")
        else:
            results.add_warning("HLS micro-cache", f"Cache may not be working ({elapsed1:.0f}ms → {elapsed2:.0f}ms)")
        
        # Wait 3 seconds and call again (cache should expire)
        print("\n--- Third HLS call (after 3s, cache expired) ---")
        time.sleep(3)
        start = time.time()
        response3 = httpx.get(f"{BASE_URL}{proxy_url}", timeout=30.0)
        elapsed3 = (time.time() - start) * 1000
        
        print(f"Status: {response3.status_code}")
        print(f"Elapsed: {elapsed3:.0f} ms")
        
        if elapsed3 > 100:
            results.add_pass("HLS cache expiry", f"Cache expired correctly ({elapsed3:.0f}ms > 100ms)")
        else:
            results.add_warning("HLS cache expiry", f"May still be cached ({elapsed3:.0f}ms)")
        
    except Exception as e:
        results.add_fail("HLS proxy", f"Exception: {e}")

def test_unknown_stream():
    """Test 6: Unknown channel stream (should 404)"""
    print("\n[TEST 6] Unknown Channel Stream (404 test)")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/stream/UNKNOWN_FOO_123", timeout=10.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 404:
            data = response.json()
            print(f"Response: {data}")
            if data.get("detail") == "Chaîne introuvable":
                results.add_pass("Unknown stream 404", "Returns correct 404 with French message")
            else:
                results.add_fail("Unknown stream 404", f"Wrong error message: {data.get('detail')}")
        else:
            results.add_fail("Unknown stream 404", f"Expected 404, got HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("Unknown stream 404", f"Exception: {e}")

def main():
    print("="*80)
    print("LiveWatch Backend API Test Suite")
    print("="*80)
    print(f"Testing: {BASE_URL}")
    print("="*80)
    
    # Run all tests
    test_branding()
    test_public_api_countries()
    test_public_api_categories()
    test_public_api_channels_by_country()
    test_public_api_channels_by_category()
    test_public_api_channels_by_search()
    test_public_api_single_channel()
    test_public_api_invalid_channel()
    test_legacy_channels_empty_logos()
    test_stream_resolution_and_cache()
    
    # Async concurrency test
    print("\nRunning async concurrency test...")
    asyncio.run(test_stream_concurrency())
    
    test_hls_proxy_and_microcache()
    test_unknown_stream()
    
    # Print summary
    results.print_summary()
    
    # Exit with appropriate code
    if results.failed:
        exit(1)
    else:
        exit(0)

if __name__ == "__main__":
    main()
