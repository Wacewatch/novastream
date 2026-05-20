#!/usr/bin/env python3
"""
DaddyTV DLStream Resolver Test Suite
Tests the newly implemented DLStream resolver fix for DaddyTV channels.

Focus areas:
1. GET /api/daddy/channels?limit=5 — no regression
2. GET /api/daddy/channel/35 — channel metadata
3. GET /api/daddy/stream/35 — MUST return JSON with id, name, stream_url, iframe_url, embed_url
   - stream_url MUST contain "/api/football/proxy?url=" and "chat.cfbu247.sbs" (URL-encoded)
   - iframe_url MUST start with "https://chat.cfbu247.sbs/api/proxy/player?token="
   - embed_url MUST equal iframe_url
4. GET /api/daddy/stream/9999999 — should return 404
5. GET /api/daddy/stream/35 twice — second call should be < 200ms (4-min cache)
6. Follow stream_url and verify it returns valid m3u8
7. GET /api/v1/public/daddy/channel/35 — public alias
"""

import httpx
import time
from urllib.parse import unquote, urlparse, parse_qs
from typing import Dict, Any

# Backend URL from frontend/.env
BASE_URL = "https://embed-gateway.preview.emergentagent.com"

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
        print("DLSTREAM RESOLVER TEST SUMMARY")
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
        
        return len(self.failed) == 0

results = TestResults()

# =====================================================================
# Test 1: No regression on /api/daddy/channels
# =====================================================================

def test_daddy_channels_no_regression():
    """Test 1: GET /api/daddy/channels?limit=5 — should still work (no regression)"""
    print("\n[TEST 1] DaddyTV Channels - No Regression")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/daddy/channels?limit=5", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Total: {data.get('total', 0)}")
        print(f"Channels returned: {len(data.get('channels', []))}")
        
        if response.status_code == 200:
            channels = data.get("channels", [])
            if len(channels) == 5:
                results.add_pass("GET /api/daddy/channels?limit=5", f"Returned {len(channels)} channels")
                
                # Validate structure
                if channels:
                    ch = channels[0]
                    required_keys = ["id", "name", "country", "category", "embed_url"]
                    missing = [k for k in required_keys if k not in ch]
                    if not missing:
                        results.add_pass("Channel structure", "All required keys present")
                    else:
                        results.add_fail("Channel structure", f"Missing keys: {missing}")
            else:
                results.add_fail("GET /api/daddy/channels?limit=5", f"Expected 5 channels, got {len(channels)}")
        else:
            results.add_fail("GET /api/daddy/channels?limit=5", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("GET /api/daddy/channels?limit=5", str(e))

# =====================================================================
# Test 2: Channel metadata
# =====================================================================

def test_daddy_channel_metadata():
    """Test 2: GET /api/daddy/channel/35 — should return channel metadata"""
    print("\n[TEST 2] DaddyTV Channel Metadata")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/daddy/channel/35", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Channel ID: {data.get('id')}")
        print(f"Channel Name: {data.get('name')}")
        print(f"Country: {data.get('country')}")
        print(f"Category: {data.get('category')}")
        print(f"Embed URL: {data.get('embed_url')}")
        
        if response.status_code == 200:
            required_keys = ["id", "name", "country", "category", "embed_url"]
            missing = [k for k in required_keys if k not in data]
            if not missing:
                results.add_pass("GET /api/daddy/channel/35", "All required keys present")
                
                # Validate ID
                if data.get("id") == "35":
                    results.add_pass("Channel ID", "Correct ID returned")
                else:
                    results.add_fail("Channel ID", f"Expected '35', got '{data.get('id')}'")
            else:
                results.add_fail("GET /api/daddy/channel/35", f"Missing keys: {missing}")
        else:
            results.add_fail("GET /api/daddy/channel/35", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("GET /api/daddy/channel/35", str(e))

# =====================================================================
# Test 3: DLStream resolver - main test
# =====================================================================

def test_daddy_stream_dlstream_resolver():
    """Test 3: GET /api/daddy/stream/35 — MUST return correct DLStream resolver response"""
    print("\n[TEST 3] DaddyTV Stream - DLStream Resolver")
    print("-" * 60)
    
    try:
        start_time = time.time()
        response = httpx.get(f"{BASE_URL}/api/daddy/stream/35", timeout=20.0)
        elapsed = (time.time() - start_time) * 1000
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Response time: {elapsed:.0f}ms")
        print(f"ID: {data.get('id')}")
        print(f"Name: {data.get('name')}")
        print(f"Stream URL: {data.get('stream_url', '')[:100]}...")
        print(f"Iframe URL: {data.get('iframe_url', '')[:100]}...")
        print(f"Embed URL: {data.get('embed_url', '')[:100]}...")
        
        if response.status_code == 200:
            # Check required keys
            required_keys = ["id", "name", "stream_url", "iframe_url", "embed_url"]
            missing = [k for k in required_keys if k not in data]
            if missing:
                results.add_fail("GET /api/daddy/stream/35 - Keys", f"Missing keys: {missing}")
                return
            
            results.add_pass("GET /api/daddy/stream/35 - Keys", "All required keys present")
            
            # Validate stream_url
            stream_url = data.get("stream_url", "")
            if "/api/football/proxy?url=" in stream_url:
                results.add_pass("stream_url format", "Contains /api/football/proxy?url=")
                
                # Extract the encoded URL
                parsed = urlparse(stream_url)
                query_params = parse_qs(parsed.query)
                if "url" in query_params:
                    encoded_url = query_params["url"][0]
                    decoded_url = unquote(encoded_url)
                    print(f"\nDecoded upstream URL: {decoded_url[:100]}...")
                    
                    if "chat.cfbu247.sbs" in decoded_url:
                        results.add_pass("stream_url upstream", "Contains chat.cfbu247.sbs")
                    else:
                        results.add_fail("stream_url upstream", f"Does not contain chat.cfbu247.sbs: {decoded_url[:100]}")
                else:
                    results.add_fail("stream_url format", "Missing 'url' query parameter")
            else:
                results.add_fail("stream_url format", f"Does not contain /api/football/proxy?url=: {stream_url[:100]}")
            
            # Validate iframe_url
            iframe_url = data.get("iframe_url", "")
            if iframe_url.startswith("https://chat.cfbu247.sbs/api/proxy/player?token="):
                results.add_pass("iframe_url format", "Starts with https://chat.cfbu247.sbs/api/proxy/player?token=")
            else:
                results.add_fail("iframe_url format", f"Does not start with expected URL: {iframe_url[:100]}")
            
            # Validate embed_url equals iframe_url
            embed_url = data.get("embed_url", "")
            if embed_url == iframe_url:
                results.add_pass("embed_url", "Equals iframe_url (backward compat)")
            else:
                results.add_fail("embed_url", f"Does not equal iframe_url")
        else:
            results.add_fail("GET /api/daddy/stream/35", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("GET /api/daddy/stream/35", str(e))

# =====================================================================
# Test 4: Non-existent channel
# =====================================================================

def test_daddy_stream_not_found():
    """Test 4: GET /api/daddy/stream/9999999 — should return 404"""
    print("\n[TEST 4] DaddyTV Stream - Non-existent Channel")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/daddy/stream/9999999", timeout=15.0)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 404:
            results.add_pass("GET /api/daddy/stream/9999999", "Correctly returns 404")
        else:
            results.add_fail("GET /api/daddy/stream/9999999", f"Expected 404, got {response.status_code}")
    except Exception as e:
        results.add_fail("GET /api/daddy/stream/9999999", str(e))

# =====================================================================
# Test 5: Cache test (4-min TTL)
# =====================================================================

def test_daddy_stream_cache():
    """Test 5: GET /api/daddy/stream/35 twice — second call should be < 200ms (4-min cache)"""
    print("\n[TEST 5] DaddyTV Stream - Cache Test")
    print("-" * 60)
    
    try:
        # First call (cold cache)
        print("First call (cold cache)...")
        start1 = time.time()
        response1 = httpx.get(f"{BASE_URL}/api/daddy/stream/35", timeout=20.0)
        elapsed1 = (time.time() - start1) * 1000
        
        if response1.status_code != 200:
            results.add_fail("Cache test - First call", f"HTTP {response1.status_code}")
            return
        
        print(f"First call: {elapsed1:.0f}ms")
        
        # Second call (warm cache)
        print("Second call (warm cache)...")
        time.sleep(0.5)  # Small delay
        start2 = time.time()
        response2 = httpx.get(f"{BASE_URL}/api/daddy/stream/35", timeout=20.0)
        elapsed2 = (time.time() - start2) * 1000
        
        if response2.status_code != 200:
            results.add_fail("Cache test - Second call", f"HTTP {response2.status_code}")
            return
        
        print(f"Second call: {elapsed2:.0f}ms")
        print(f"Speedup: {elapsed1/elapsed2:.1f}x")
        
        # Second call should be significantly faster (< 200ms)
        if elapsed2 < 200:
            results.add_pass("Cache test", f"Second call {elapsed2:.0f}ms < 200ms (cache hit)")
        else:
            results.add_warning("Cache test", f"Second call {elapsed2:.0f}ms >= 200ms (possible cache miss)")
        
        # Verify responses are identical
        data1 = response1.json()
        data2 = response2.json()
        if data1.get("stream_url") == data2.get("stream_url"):
            results.add_pass("Cache consistency", "Both calls returned identical stream_url")
        else:
            results.add_fail("Cache consistency", "stream_url differs between calls")
    except Exception as e:
        results.add_fail("Cache test", str(e))

# =====================================================================
# Test 6: Follow stream_url and verify m3u8
# =====================================================================

def test_daddy_stream_m3u8_validation():
    """Test 6: Follow stream_url and verify it returns valid m3u8"""
    print("\n[TEST 6] DaddyTV Stream - M3U8 Validation")
    print("-" * 60)
    
    try:
        # First get the stream URL
        response = httpx.get(f"{BASE_URL}/api/daddy/stream/35", timeout=20.0)
        if response.status_code != 200:
            results.add_fail("M3U8 validation - Get stream", f"HTTP {response.status_code}")
            return
        
        data = response.json()
        stream_url = data.get("stream_url", "")
        
        if not stream_url:
            results.add_fail("M3U8 validation", "No stream_url in response")
            return
        
        # Construct full URL
        if stream_url.startswith("/"):
            full_url = f"{BASE_URL}{stream_url}"
        else:
            full_url = stream_url
        
        print(f"Following stream_url: {full_url[:80]}...")
        
        # Follow the stream URL
        m3u8_response = httpx.get(full_url, timeout=20.0, follow_redirects=True)
        
        print(f"Status: {m3u8_response.status_code}")
        print(f"Content-Type: {m3u8_response.headers.get('content-type', 'N/A')}")
        print(f"Content length: {len(m3u8_response.content)} bytes")
        
        if m3u8_response.status_code == 200:
            results.add_pass("M3U8 fetch", "Successfully fetched stream")
            
            # Check content-type
            content_type = m3u8_response.headers.get("content-type", "").lower()
            if "application/vnd.apple.mpegurl" in content_type or "mpegurl" in content_type:
                results.add_pass("M3U8 content-type", f"Correct: {content_type}")
            else:
                results.add_warning("M3U8 content-type", f"Unexpected: {content_type}")
            
            # Check content
            content = m3u8_response.text
            if "#EXTM3U" in content:
                results.add_pass("M3U8 content", "Valid m3u8 playlist (contains #EXTM3U)")
                print(f"\nFirst 200 chars of playlist:\n{content[:200]}")
            else:
                results.add_fail("M3U8 content", "Does not contain #EXTM3U header")
        else:
            results.add_fail("M3U8 fetch", f"HTTP {m3u8_response.status_code}")
    except Exception as e:
        results.add_fail("M3U8 validation", str(e))

# =====================================================================
# Test 7: Public alias
# =====================================================================

def test_daddy_public_alias():
    """Test 7: GET /api/v1/public/daddy/channel/35 — should still return channel info"""
    print("\n[TEST 7] DaddyTV Public Alias")
    print("-" * 60)
    
    try:
        response = httpx.get(f"{BASE_URL}/api/v1/public/daddy/channel/35", timeout=15.0)
        data = response.json()
        
        print(f"Status: {response.status_code}")
        print(f"Channel ID: {data.get('id')}")
        print(f"Channel Name: {data.get('name')}")
        
        if response.status_code == 200:
            required_keys = ["id", "name", "country", "category", "embed_url"]
            missing = [k for k in required_keys if k not in data]
            if not missing:
                results.add_pass("GET /api/v1/public/daddy/channel/35", "All required keys present")
            else:
                results.add_fail("GET /api/v1/public/daddy/channel/35", f"Missing keys: {missing}")
        else:
            results.add_fail("GET /api/v1/public/daddy/channel/35", f"HTTP {response.status_code}")
    except Exception as e:
        results.add_fail("GET /api/v1/public/daddy/channel/35", str(e))

# =====================================================================
# Main execution
# =====================================================================

def main():
    print("="*80)
    print("DADDYTV DLSTREAM RESOLVER TEST SUITE")
    print("="*80)
    print(f"Backend URL: {BASE_URL}")
    print(f"Test focus: DLStream resolver fix (chat.cfbu247.sbs integration)")
    print("="*80)
    
    # Run all tests
    test_daddy_channels_no_regression()
    test_daddy_channel_metadata()
    test_daddy_stream_dlstream_resolver()
    test_daddy_stream_not_found()
    test_daddy_stream_cache()
    test_daddy_stream_m3u8_validation()
    test_daddy_public_alias()
    
    # Print summary
    success = results.print_summary()
    
    return 0 if success else 1

if __name__ == "__main__":
    exit(main())
