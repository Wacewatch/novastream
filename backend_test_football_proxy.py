#!/usr/bin/env python3
"""
Comprehensive test suite for the football proxy endpoint after the overhaul.
Tests streaming + Chrome UA + Range support.
"""
import asyncio
import re
import time
from urllib.parse import parse_qs, urlparse

import httpx

# Backend URL from frontend/.env
BASE_URL = "https://live-sports-hub-78.preview.emergentagent.com"

# Test results
results = {
    "passed": 0,
    "failed": 0,
    "tests": []
}


def log_test(name: str, passed: bool, details: str = ""):
    """Log test result."""
    status = "✅ PASS" if passed else "❌ FAIL"
    results["tests"].append({"name": name, "passed": passed, "details": details})
    if passed:
        results["passed"] += 1
    else:
        results["failed"] += 1
    print(f"{status}: {name}")
    if details:
        print(f"  {details}")


async def test_1_extract_stream_url():
    """Test 1: GET /api/daddy/stream/35 — extract stream_url."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(f"{BASE_URL}/api/daddy/stream/35")
            if r.status_code != 200:
                log_test(
                    "1. Extract stream_url from /api/daddy/stream/35",
                    False,
                    f"Expected 200, got {r.status_code}"
                )
                return None
            
            data = r.json()
            stream_url = data.get("stream_url", "")
            
            if not stream_url:
                log_test(
                    "1. Extract stream_url from /api/daddy/stream/35",
                    False,
                    "stream_url is empty"
                )
                return None
            
            if "/api/football/proxy?url=" not in stream_url:
                log_test(
                    "1. Extract stream_url from /api/daddy/stream/35",
                    False,
                    f"stream_url doesn't contain /api/football/proxy?url=: {stream_url}"
                )
                return None
            
            log_test(
                "1. Extract stream_url from /api/daddy/stream/35",
                True,
                f"stream_url: {stream_url[:100]}..."
            )
            return stream_url
        except Exception as e:
            log_test(
                "1. Extract stream_url from /api/daddy/stream/35",
                False,
                f"Exception: {e}"
            )
            return None


async def test_2_fetch_master_playlist(stream_url: str):
    """Test 2: Fetch stream_url and validate m3u8 format."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(stream_url)
            
            # Check status
            if r.status_code != 200:
                log_test(
                    "2. Fetch master playlist (status 200)",
                    False,
                    f"Expected 200, got {r.status_code}"
                )
                return None
            
            log_test("2. Fetch master playlist (status 200)", True)
            
            # Check Content-Type
            ct = r.headers.get("content-type", "")
            if "application/vnd.apple.mpegurl" not in ct:
                log_test(
                    "2. Content-Type is application/vnd.apple.mpegurl",
                    False,
                    f"Got: {ct}"
                )
            else:
                log_test("2. Content-Type is application/vnd.apple.mpegurl", True)
            
            # Check body starts with #EXTM3U
            body = r.text
            if not body.startswith("#EXTM3U"):
                log_test(
                    "2. Body starts with #EXTM3U",
                    False,
                    f"Body starts with: {body[:50]}"
                )
                return None
            
            log_test("2. Body starts with #EXTM3U", True)
            
            # Check contains at least one URL pointing to /api/football/proxy?url=
            proxy_urls = re.findall(r'https?://[^\s\n]+/api/football/proxy\?url=[^\s\n]+', body)
            if not proxy_urls:
                log_test(
                    "2. Contains URLs pointing to /api/football/proxy?url=",
                    False,
                    "No proxy URLs found in playlist"
                )
                return None
            
            log_test(
                "2. Contains URLs pointing to /api/football/proxy?url=",
                True,
                f"Found {len(proxy_urls)} proxy URLs"
            )
            
            return body, proxy_urls
        except Exception as e:
            log_test(
                "2. Fetch master playlist",
                False,
                f"Exception: {e}"
            )
            return None


async def test_3_fetch_variant_playlist(proxy_urls: list):
    """Test 3: Extract variant URL and fetch it."""
    if not proxy_urls:
        log_test("3. Fetch variant playlist", False, "No proxy URLs provided")
        return None
    
    # Use the first proxy URL as the variant
    variant_url = proxy_urls[0]
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(variant_url)
            
            # Check status
            if r.status_code != 200:
                log_test(
                    "3. Fetch variant playlist (status 200)",
                    False,
                    f"Expected 200, got {r.status_code}"
                )
                return None
            
            log_test("3. Fetch variant playlist (status 200)", True)
            
            # Check Content-Type
            ct = r.headers.get("content-type", "")
            if "application/vnd.apple.mpegurl" not in ct:
                log_test(
                    "3. Variant Content-Type is application/vnd.apple.mpegurl",
                    False,
                    f"Got: {ct}"
                )
            else:
                log_test("3. Variant Content-Type is application/vnd.apple.mpegurl", True)
            
            # Check body contains at least one segment URL
            body = r.text
            lines = [l.strip() for l in body.split('\n') if l.strip() and not l.startswith('#')]
            
            if not lines:
                log_test(
                    "3. Variant contains at least one segment URL",
                    False,
                    "No segment URLs found"
                )
                return None
            
            log_test(
                "3. Variant contains at least one segment URL",
                True,
                f"Found {len(lines)} segment URLs"
            )
            
            return lines
        except Exception as e:
            log_test(
                "3. Fetch variant playlist",
                False,
                f"Exception: {e}"
            )
            return None


async def test_4_fetch_segment(segment_urls: list):
    """Test 4: Fetch first segment and verify it's video/mp2t with 0x47 sync byte."""
    if not segment_urls:
        log_test("4. Fetch segment", False, "No segment URLs provided")
        return None
    
    segment_url = segment_urls[0]
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(segment_url)
            
            # Check status
            if r.status_code != 200:
                log_test(
                    "4. Fetch segment (status 200)",
                    False,
                    f"Expected 200, got {r.status_code}"
                )
                return None
            
            log_test("4. Fetch segment (status 200)", True)
            
            # Check Content-Type
            ct = r.headers.get("content-type", "")
            if "video/mp2t" not in ct:
                log_test(
                    "4. Segment Content-Type is video/mp2t",
                    False,
                    f"Got: {ct}"
                )
            else:
                log_test("4. Segment Content-Type is video/mp2t", True)
            
            # Check body starts with 0x47 (MPEG-TS sync byte)
            body = r.content
            if len(body) == 0:
                log_test(
                    "4. Segment body is not empty",
                    False,
                    "Body is empty"
                )
                return None
            
            if body[0] != 0x47:
                log_test(
                    "4. Segment starts with 0x47 (MPEG-TS sync byte)",
                    False,
                    f"First byte is 0x{body[0]:02x}, expected 0x47"
                )
            else:
                log_test(
                    "4. Segment starts with 0x47 (MPEG-TS sync byte)",
                    True,
                    f"Segment size: {len(body)} bytes"
                )
            
            return segment_url
        except Exception as e:
            log_test(
                "4. Fetch segment",
                False,
                f"Exception: {e}"
            )
            return None


async def test_5_range_request(segment_url: str):
    """Test 5: Send Range request (bytes=0-1023) to segment URL."""
    if not segment_url:
        log_test("5. Range request", False, "No segment URL provided")
        return
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(
                segment_url,
                headers={"Range": "bytes=0-1023"}
            )
            
            # Check status (200 or 206)
            if r.status_code not in (200, 206):
                log_test(
                    "5. Range request returns 200 or 206",
                    False,
                    f"Expected 200 or 206, got {r.status_code}"
                )
                return
            
            log_test(
                "5. Range request returns 200 or 206",
                True,
                f"Status: {r.status_code}"
            )
            
            # Check body size (should be at least 1 KB)
            body = r.content
            if len(body) < 1024:
                log_test(
                    "5. Range request returns at least 1 KB",
                    False,
                    f"Got {len(body)} bytes"
                )
            else:
                log_test(
                    "5. Range request returns at least 1 KB",
                    True,
                    f"Got {len(body)} bytes"
                )
            
            # Check first byte is still 0x47
            if len(body) > 0 and body[0] == 0x47:
                log_test(
                    "5. Range response starts with 0x47",
                    True
                )
            else:
                log_test(
                    "5. Range response starts with 0x47",
                    False,
                    f"First byte is 0x{body[0]:02x}" if len(body) > 0 else "Empty body"
                )
        except Exception as e:
            log_test(
                "5. Range request",
                False,
                f"Exception: {e}"
            )


async def test_6_cors_headers(stream_url: str):
    """Test 6: Verify CORS headers on proxy responses."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(stream_url)
            
            cors_header = r.headers.get("access-control-allow-origin", "")
            if cors_header != "*":
                log_test(
                    "6. CORS header Access-Control-Allow-Origin: *",
                    False,
                    f"Got: {cors_header}"
                )
            else:
                log_test(
                    "6. CORS header Access-Control-Allow-Origin: *",
                    True
                )
        except Exception as e:
            log_test(
                "6. CORS headers",
                False,
                f"Exception: {e}"
            )


async def test_7_bad_input():
    """Test 7: Bad input validation."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Test 7a: No url parameter
        try:
            r = await client.get(f"{BASE_URL}/api/football/proxy")
            if r.status_code == 400:
                log_test(
                    "7a. GET /api/football/proxy (no url) returns 400",
                    True
                )
            else:
                log_test(
                    "7a. GET /api/football/proxy (no url) returns 400",
                    False,
                    f"Expected 400, got {r.status_code}"
                )
        except Exception as e:
            log_test(
                "7a. GET /api/football/proxy (no url) returns 400",
                False,
                f"Exception: {e}"
            )
        
        # Test 7b: Invalid url
        try:
            r = await client.get(f"{BASE_URL}/api/football/proxy?url=foo://bar")
            if r.status_code == 400:
                log_test(
                    "7b. GET /api/football/proxy?url=foo://bar returns 400",
                    True
                )
            else:
                log_test(
                    "7b. GET /api/football/proxy?url=foo://bar returns 400",
                    False,
                    f"Expected 400, got {r.status_code}"
                )
        except Exception as e:
            log_test(
                "7b. GET /api/football/proxy?url=foo://bar returns 400",
                False,
                f"Exception: {e}"
            )


async def test_8_stress_test(stream_url: str):
    """Test 8: Stress test - 20 back-to-back requests."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            tasks = []
            for i in range(20):
                tasks.append(client.get(stream_url))
            
            start = time.time()
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            elapsed = time.time() - start
            
            # Check all returned 200
            success_count = 0
            for r in responses:
                if isinstance(r, httpx.Response) and r.status_code == 200:
                    success_count += 1
            
            if success_count == 20:
                log_test(
                    "8. Stress test: 20 requests all return 200",
                    True,
                    f"Completed in {elapsed:.2f}s"
                )
            else:
                log_test(
                    "8. Stress test: 20 requests all return 200",
                    False,
                    f"{success_count}/20 succeeded"
                )
        except Exception as e:
            log_test(
                "8. Stress test",
                False,
                f"Exception: {e}"
            )


async def test_9_offline_channel():
    """Test 9: Test offline channel (id 60) - should return 502 with CORS."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # First get the stream URL for channel 60
            r = await client.get(f"{BASE_URL}/api/daddy/stream/60")
            if r.status_code != 200:
                log_test(
                    "9. Offline channel test (get stream URL)",
                    False,
                    f"Expected 200, got {r.status_code}"
                )
                return
            
            data = r.json()
            stream_url = data.get("stream_url", "")
            
            if not stream_url:
                log_test(
                    "9. Offline channel test (get stream URL)",
                    False,
                    "stream_url is empty"
                )
                return
            
            # Now fetch the stream URL (may return 502 if upstream is offline)
            r = await client.get(stream_url)
            
            # We expect either 200 (if online) or 502 (if offline)
            # The important part is that CORS headers are present
            cors_header = r.headers.get("access-control-allow-origin", "")
            
            if r.status_code == 502:
                if cors_header == "*":
                    log_test(
                        "9. Offline channel returns 502 with CORS headers",
                        True,
                        "Upstream is offline as expected"
                    )
                else:
                    log_test(
                        "9. Offline channel returns 502 with CORS headers",
                        False,
                        f"502 returned but CORS header is: {cors_header}"
                    )
            elif r.status_code == 200:
                log_test(
                    "9. Offline channel test",
                    True,
                    "Channel 60 is actually online (200 OK)"
                )
            else:
                log_test(
                    "9. Offline channel test",
                    False,
                    f"Unexpected status: {r.status_code}"
                )
        except Exception as e:
            log_test(
                "9. Offline channel test",
                False,
                f"Exception: {e}"
            )


async def main():
    """Run all tests."""
    print("=" * 80)
    print("FOOTBALL PROXY ENDPOINT TEST SUITE")
    print("=" * 80)
    print()
    
    # Test 1: Extract stream_url
    stream_url = await test_1_extract_stream_url()
    if not stream_url:
        print("\n❌ Cannot proceed without stream_url")
        print_summary()
        return
    
    print()
    
    # Test 2: Fetch master playlist
    result = await test_2_fetch_master_playlist(stream_url)
    if not result:
        print("\n❌ Cannot proceed without valid master playlist")
        print_summary()
        return
    
    body, proxy_urls = result
    print()
    
    # Test 3: Fetch variant playlist
    segment_urls = await test_3_fetch_variant_playlist(proxy_urls)
    if not segment_urls:
        print("\n❌ Cannot proceed without segment URLs")
        print_summary()
        return
    
    print()
    
    # Test 4: Fetch segment
    segment_url = await test_4_fetch_segment(segment_urls)
    print()
    
    # Test 5: Range request
    if segment_url:
        await test_5_range_request(segment_url)
        print()
    
    # Test 6: CORS headers
    await test_6_cors_headers(stream_url)
    print()
    
    # Test 7: Bad input
    await test_7_bad_input()
    print()
    
    # Test 8: Stress test
    await test_8_stress_test(stream_url)
    print()
    
    # Test 9: Offline channel
    await test_9_offline_channel()
    print()
    
    print_summary()


def print_summary():
    """Print test summary."""
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total tests: {results['passed'] + results['failed']}")
    print(f"✅ Passed: {results['passed']}")
    print(f"❌ Failed: {results['failed']}")
    print()
    
    if results["failed"] > 0:
        print("FAILED TESTS:")
        for test in results["tests"]:
            if not test["passed"]:
                print(f"  ❌ {test['name']}")
                if test["details"]:
                    print(f"     {test['details']}")
        print()


if __name__ == "__main__":
    asyncio.run(main())
