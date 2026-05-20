#!/usr/bin/env python3
"""
Comprehensive test suite for the NEW dedicated DaddyTV proxy endpoint /api/daddy/proxy.

Tests the SPLIT proxy logic:
- /api/football/proxy: UNCHANGED, exclusively for RapidAPI football streams (iPhone UA, buffered)
- /api/daddy/proxy: NEW endpoint, exclusively for DaddyTV (Chrome UA, Referer, streaming, Range, video/mp2t forcing)
"""
import os
import sys
import time
import requests
from urllib.parse import urlparse, parse_qs

# Backend URL from frontend/.env
BACKEND_URL = os.getenv("REACT_APP_BACKEND_URL", "https://embed-gateway.preview.emergentagent.com")
BASE_URL = f"{BACKEND_URL}/api"

# Test configuration
TIMEOUT = 30
TEST_CHANNEL_ID = "35"  # Sky Sports Football UK
INVALID_CHANNEL_ID = "9999999"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

def log_test(name):
    print(f"\n{Colors.BLUE}{'='*80}{Colors.RESET}")
    print(f"{Colors.BLUE}TEST: {name}{Colors.RESET}")
    print(f"{Colors.BLUE}{'='*80}{Colors.RESET}")

def log_pass(msg):
    print(f"{Colors.GREEN}✅ PASS: {msg}{Colors.RESET}")

def log_fail(msg):
    print(f"{Colors.RED}❌ FAIL: {msg}{Colors.RESET}")

def log_info(msg):
    print(f"{Colors.YELLOW}ℹ️  INFO: {msg}{Colors.RESET}")

def extract_url_from_proxy(proxy_url):
    """Extract the upstream URL from a proxy URL."""
    parsed = urlparse(proxy_url)
    qs = parse_qs(parsed.query)
    return qs.get('url', [None])[0]

# ============================================================================
# TEST 1: /api/daddy/stream/35 returns stream_url with /api/daddy/proxy
# ============================================================================
def test_1_daddy_stream_endpoint():
    log_test("1. GET /api/daddy/stream/35 - Verify stream_url uses /api/daddy/proxy")
    
    url = f"{BASE_URL}/daddy/stream/{TEST_CHANNEL_ID}"
    resp = requests.get(url, timeout=TIMEOUT)
    
    if resp.status_code != 200:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False
    
    data = resp.json()
    
    # Check required keys
    required_keys = ["id", "name", "stream_url", "iframe_url", "embed_url"]
    for key in required_keys:
        if key not in data:
            log_fail(f"Missing key: {key}")
            return False
    
    log_pass(f"All required keys present: {required_keys}")
    
    # CRITICAL: stream_url must contain /api/daddy/proxy (NOT /api/football/proxy)
    stream_url = data["stream_url"]
    if "/api/daddy/proxy?url=" not in stream_url:
        log_fail(f"stream_url does NOT contain '/api/daddy/proxy?url=': {stream_url}")
        return False
    
    log_pass(f"stream_url correctly uses /api/daddy/proxy: {stream_url[:100]}...")
    
    # Verify iframe_url format
    iframe_url = data["iframe_url"]
    if not iframe_url.startswith("https://chat.cfbu247.sbs/api/proxy/player"):
        log_fail(f"iframe_url does NOT start with expected prefix: {iframe_url}")
        return False
    
    log_pass(f"iframe_url correct: {iframe_url[:80]}...")
    
    # Verify embed_url equals iframe_url
    if data["embed_url"] != iframe_url:
        log_fail(f"embed_url != iframe_url")
        return False
    
    log_pass("embed_url equals iframe_url (backward compat)")
    
    return True, stream_url

# ============================================================================
# TEST 2: Fetch stream_url - expect m3u8 playlist
# ============================================================================
def test_2_fetch_master_playlist(stream_url):
    log_test("2. Fetch stream_url - Verify m3u8 playlist with /api/daddy/proxy URLs")
    
    resp = requests.get(stream_url, timeout=TIMEOUT)
    
    if resp.status_code != 200:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False
    
    log_pass(f"Status: {resp.status_code}")
    
    # Check content-type
    ct = resp.headers.get("content-type", "")
    if "application/vnd.apple.mpegurl" not in ct:
        log_fail(f"Expected content-type 'application/vnd.apple.mpegurl', got '{ct}'")
        return False
    
    log_pass(f"Content-Type: {ct}")
    
    # Check body starts with #EXTM3U
    body = resp.text
    if not body.startswith("#EXTM3U"):
        log_fail(f"Body does NOT start with '#EXTM3U': {body[:50]}")
        return False
    
    log_pass("Body starts with '#EXTM3U'")
    
    # Check body contains URLs pointing to /api/daddy/proxy
    if "/api/daddy/proxy?url=" not in body:
        log_fail(f"Body does NOT contain '/api/daddy/proxy?url='")
        return False
    
    log_pass("Body contains URLs pointing to /api/daddy/proxy")
    
    # Extract first variant URL (first non-# line)
    variant_url = None
    for line in body.split('\n'):
        line = line.strip()
        if line and not line.startswith('#'):
            variant_url = line
            break
    
    if not variant_url:
        log_fail("Could not extract variant URL from playlist")
        return False
    
    log_info(f"Extracted variant URL: {variant_url[:100]}...")
    
    return True, variant_url

# ============================================================================
# TEST 3: Fetch variant URL via /api/daddy/proxy
# ============================================================================
def test_3_fetch_variant_playlist(variant_url):
    log_test("3. Fetch variant URL via /api/daddy/proxy - Verify m3u8 playlist")
    
    resp = requests.get(variant_url, timeout=TIMEOUT)
    
    if resp.status_code != 200:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False
    
    log_pass(f"Status: {resp.status_code}")
    
    # Check content-type
    ct = resp.headers.get("content-type", "")
    if "application/vnd.apple.mpegurl" not in ct:
        log_fail(f"Expected content-type 'application/vnd.apple.mpegurl', got '{ct}'")
        return False
    
    log_pass(f"Content-Type: {ct}")
    
    # Extract segment URLs
    body = resp.text
    segment_urls = []
    for line in body.split('\n'):
        line = line.strip()
        if line and not line.startswith('#'):
            segment_urls.append(line)
    
    if not segment_urls:
        log_fail("No segment URLs found in variant playlist")
        return False
    
    log_pass(f"Found {len(segment_urls)} segment URLs")
    log_info(f"First segment URL: {segment_urls[0][:100]}...")
    
    return True, segment_urls[0]

# ============================================================================
# TEST 4: Fetch segment URL via /api/daddy/proxy
# ============================================================================
def test_4_fetch_segment(segment_url):
    log_test("4. Fetch segment URL via /api/daddy/proxy - Verify video/mp2t content")
    
    resp = requests.get(segment_url, timeout=TIMEOUT)
    
    if resp.status_code != 200:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False
    
    log_pass(f"Status: {resp.status_code}")
    
    # Check content-type (MUST be video/mp2t, forced even if upstream says image/jpeg)
    ct = resp.headers.get("content-type", "")
    if "video/mp2t" not in ct and "video/iso.segment" not in ct:
        log_fail(f"Expected content-type 'video/mp2t' or 'video/iso.segment', got '{ct}'")
        return False
    
    log_pass(f"Content-Type: {ct} (forced by proxy)")
    
    # Check first byte is 0x47 (MPEG-TS sync byte)
    body = resp.content
    if len(body) == 0:
        log_fail("Empty response body")
        return False
    
    first_byte = body[0]
    if first_byte != 0x47:
        log_fail(f"First byte is 0x{first_byte:02x}, expected 0x47 (MPEG-TS sync)")
        return False
    
    log_pass(f"First byte is 0x47 (MPEG-TS sync byte)")
    
    # Check CORS header
    cors = resp.headers.get("access-control-allow-origin", "")
    if cors != "*":
        log_fail(f"Expected 'Access-Control-Allow-Origin: *', got '{cors}'")
        return False
    
    log_pass("Access-Control-Allow-Origin: * present")
    
    log_info(f"Segment size: {len(body) / 1024 / 1024:.2f} MB")
    
    return True, segment_url

# ============================================================================
# TEST 5: Range request on segment URL
# ============================================================================
def test_5_range_request(segment_url):
    log_test("5. Range request on segment URL - Verify partial content")
    
    headers = {"Range": "bytes=0-1023"}
    resp = requests.get(segment_url, headers=headers, timeout=TIMEOUT)
    
    # Accept both 200 (full content) and 206 (partial content)
    if resp.status_code not in [200, 206]:
        log_fail(f"Expected 200 or 206, got {resp.status_code}")
        return False
    
    log_pass(f"Status: {resp.status_code}")
    
    # Check body received
    body = resp.content
    if len(body) == 0:
        log_fail("Empty response body")
        return False
    
    log_pass(f"Body received: {len(body)} bytes")
    
    # If 206, verify we got the requested range
    if resp.status_code == 206:
        if len(body) > 1024:
            log_fail(f"Expected max 1024 bytes, got {len(body)}")
            return False
        log_pass(f"Partial content: {len(body)} bytes (as requested)")
    
    return True

# ============================================================================
# TEST 6: Open-relay protection
# ============================================================================
def test_6_open_relay_protection():
    log_test("6. Open-relay protection - Verify host allow-list")
    
    # Test 6a: google.com should be blocked
    url = f"{BASE_URL}/daddy/proxy?url=https://google.com/"
    resp = requests.get(url, timeout=TIMEOUT)
    
    if resp.status_code != 400:
        log_fail(f"Expected 400 for google.com, got {resp.status_code}")
        return False
    
    if "Host not allowed" not in resp.text:
        log_fail(f"Expected 'Host not allowed' message, got: {resp.text}")
        return False
    
    log_pass("google.com blocked with 400 'Host not allowed'")
    
    # Test 6b: Missing url parameter
    url = f"{BASE_URL}/daddy/proxy"
    resp = requests.get(url, timeout=TIMEOUT)
    
    if resp.status_code != 400:
        log_fail(f"Expected 400 for missing url, got {resp.status_code}")
        return False
    
    if "Missing url" not in resp.text:
        log_fail(f"Expected 'Missing url' message, got: {resp.text}")
        return False
    
    log_pass("Missing url parameter returns 400 'Missing url'")
    
    # Test 6c: Invalid URL scheme
    url = f"{BASE_URL}/daddy/proxy?url=foo://bar"
    resp = requests.get(url, timeout=TIMEOUT)
    
    if resp.status_code != 400:
        log_fail(f"Expected 400 for invalid scheme, got {resp.status_code}")
        return False
    
    if "Invalid url" not in resp.text:
        log_fail(f"Expected 'Invalid url' message, got: {resp.text}")
        return False
    
    log_pass("Invalid URL scheme returns 400 'Invalid url'")
    
    return True

# ============================================================================
# TEST 7: Confirm /api/football/proxy is UNCHANGED
# ============================================================================
def test_7_football_proxy_unchanged():
    log_test("7. Confirm /api/football/proxy is UNCHANGED")
    
    # Test 7a: Missing url parameter
    url = f"{BASE_URL}/football/proxy"
    resp = requests.get(url, timeout=TIMEOUT)
    
    if resp.status_code != 400:
        log_fail(f"Expected 400 for missing url, got {resp.status_code}")
        return False
    
    if "Missing url" not in resp.text:
        log_fail(f"Expected 'Missing url' message, got: {resp.text}")
        return False
    
    log_pass("GET /api/football/proxy (no url) returns 400 'Missing url'")
    
    # Test 7b: Try with a DaddyTV URL (should not crash, just verify no error)
    url = f"{BASE_URL}/football/proxy?url=https://chat.cfbu247.sbs/"
    try:
        resp = requests.get(url, timeout=TIMEOUT)
        log_pass(f"GET /api/football/proxy?url=https://chat.cfbu247.sbs/ returns {resp.status_code} (no crash)")
    except Exception as e:
        log_fail(f"Exception: {e}")
        return False
    
    return True

# ============================================================================
# TEST 8: Invalid channel ID returns 404
# ============================================================================
def test_8_invalid_channel():
    log_test("8. GET /api/daddy/stream/9999999 - Verify 404")
    
    url = f"{BASE_URL}/daddy/stream/{INVALID_CHANNEL_ID}"
    resp = requests.get(url, timeout=TIMEOUT)
    
    if resp.status_code != 404:
        log_fail(f"Expected 404, got {resp.status_code}")
        return False
    
    log_pass(f"Status: {resp.status_code}")
    
    return True

# ============================================================================
# TEST 9: No regression on /api/daddy/channels
# ============================================================================
def test_9_daddy_channels_no_regression():
    log_test("9. GET /api/daddy/channels?limit=5 - Verify no regression")
    
    url = f"{BASE_URL}/daddy/channels?limit=5"
    resp = requests.get(url, timeout=TIMEOUT)
    
    if resp.status_code != 200:
        log_fail(f"Expected 200, got {resp.status_code}")
        return False
    
    log_pass(f"Status: {resp.status_code}")
    
    data = resp.json()
    
    if "channels" not in data:
        log_fail("Missing 'channels' key")
        return False
    
    channels = data["channels"]
    if not isinstance(channels, list):
        log_fail("'channels' is not a list")
        return False
    
    if len(channels) != 5:
        log_fail(f"Expected 5 channels, got {len(channels)}")
        return False
    
    log_pass(f"Returned {len(channels)} channels as expected")
    
    # Check structure of first channel
    if channels:
        ch = channels[0]
        required_keys = ["id", "name", "country", "category", "embed_url"]
        for key in required_keys:
            if key not in ch:
                log_fail(f"Channel missing key: {key}")
                return False
        log_pass(f"Channel structure correct: {list(ch.keys())}")
    
    return True

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================
def main():
    print(f"\n{Colors.BLUE}{'='*80}{Colors.RESET}")
    print(f"{Colors.BLUE}DADDY PROXY SPLIT TEST SUITE{Colors.RESET}")
    print(f"{Colors.BLUE}Backend: {BACKEND_URL}{Colors.RESET}")
    print(f"{Colors.BLUE}{'='*80}{Colors.RESET}")
    
    results = []
    
    # Test 1: /api/daddy/stream/35
    result = test_1_daddy_stream_endpoint()
    if isinstance(result, tuple):
        success, stream_url = result
        results.append(("Test 1: /api/daddy/stream/35 returns stream_url with /api/daddy/proxy", success))
        
        if success:
            # Test 2: Fetch master playlist
            result = test_2_fetch_master_playlist(stream_url)
            if isinstance(result, tuple):
                success, variant_url = result
                results.append(("Test 2: Fetch master playlist (m3u8)", success))
                
                if success:
                    # Test 3: Fetch variant playlist
                    result = test_3_fetch_variant_playlist(variant_url)
                    if isinstance(result, tuple):
                        success, segment_url = result
                        results.append(("Test 3: Fetch variant playlist", success))
                        
                        if success:
                            # Test 4: Fetch segment
                            result = test_4_fetch_segment(segment_url)
                            if isinstance(result, tuple):
                                success, segment_url = result
                                results.append(("Test 4: Fetch segment (video/mp2t)", success))
                                
                                if success:
                                    # Test 5: Range request
                                    success = test_5_range_request(segment_url)
                                    results.append(("Test 5: Range request on segment", success))
                            else:
                                results.append(("Test 4: Fetch segment (video/mp2t)", result))
                    else:
                        results.append(("Test 3: Fetch variant playlist", result))
            else:
                results.append(("Test 2: Fetch master playlist (m3u8)", result))
    else:
        results.append(("Test 1: /api/daddy/stream/35 returns stream_url with /api/daddy/proxy", result))
    
    # Test 6: Open-relay protection
    success = test_6_open_relay_protection()
    results.append(("Test 6: Open-relay protection", success))
    
    # Test 7: Football proxy unchanged
    success = test_7_football_proxy_unchanged()
    results.append(("Test 7: /api/football/proxy unchanged", success))
    
    # Test 8: Invalid channel 404
    success = test_8_invalid_channel()
    results.append(("Test 8: Invalid channel returns 404", success))
    
    # Test 9: No regression on /api/daddy/channels
    success = test_9_daddy_channels_no_regression()
    results.append(("Test 9: /api/daddy/channels no regression", success))
    
    # Summary
    print(f"\n{Colors.BLUE}{'='*80}{Colors.RESET}")
    print(f"{Colors.BLUE}TEST SUMMARY{Colors.RESET}")
    print(f"{Colors.BLUE}{'='*80}{Colors.RESET}")
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    for name, success in results:
        if success:
            log_pass(name)
        else:
            log_fail(name)
    
    print(f"\n{Colors.BLUE}{'='*80}{Colors.RESET}")
    if passed == total:
        print(f"{Colors.GREEN}✅ ALL TESTS PASSED: {passed}/{total}{Colors.RESET}")
    else:
        print(f"{Colors.RED}❌ SOME TESTS FAILED: {passed}/{total} passed{Colors.RESET}")
    print(f"{Colors.BLUE}{'='*80}{Colors.RESET}\n")
    
    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())
