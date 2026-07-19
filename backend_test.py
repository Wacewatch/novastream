#!/usr/bin/env python3
"""
Backend API tests for LiveWatch - Testing GET /api/admin/analytics-overview endpoint
"""
import requests
import json
import sys
from typing import Optional

# Configuration
SUPABASE_URL = "https://atrhxsizjjqjdhjafgei.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cmh4c2l6ampxamRoamFmZ2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxMzQ3NzAsImV4cCI6MjA4MzcxMDc3MH0.Mc_XTxmG8zwX34WrLIasHp5C1mydTRJfaOibFtwLOb8"
ADMIN_EMAIL = "shot.admin@livewatch.app"
ADMIN_PASSWORD = "Shot!2345Admin"

# Backend can be accessed via localhost:8001 or through the public URL
BACKEND_URL = "http://localhost:8001"

def get_admin_token() -> Optional[str]:
    """Get admin access token from Supabase"""
    print("\n=== Getting Admin Token ===")
    try:
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Content-Type": "application/json"
            },
            json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            },
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            token = data.get("access_token")
            print(f"✅ Successfully obtained admin token")
            return token
        else:
            print(f"❌ Failed to get admin token: {response.status_code}")
            print(f"Response: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Exception getting admin token: {e}")
        return None


def test_analytics_without_auth():
    """Test 1: GET /api/admin/analytics-overview without Authorization header -> expect 401"""
    print("\n=== Test 1: Analytics Overview WITHOUT Authorization ===")
    try:
        response = requests.get(
            f"{BACKEND_URL}/api/admin/analytics-overview?range=7d",
            timeout=10
        )
        
        if response.status_code == 401:
            print(f"✅ PASS: Got expected 401 status code")
            return True
        else:
            print(f"❌ FAIL: Expected 401, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False


def test_analytics_with_admin_token(token: str, range_param: str = "7d"):
    """Test analytics endpoint with admin token"""
    print(f"\n=== Testing Analytics Overview with Admin Token (range={range_param}) ===")
    try:
        response = requests.get(
            f"{BACKEND_URL}/api/admin/analytics-overview?range={range_param}",
            headers={
                "Authorization": f"Bearer {token}"
            },
            timeout=15
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAIL: Expected 200, got {response.status_code}")
            print(f"Response: {response.text[:500]}")
            return False
        
        # Parse JSON response
        try:
            data = response.json()
        except json.JSONDecodeError as e:
            print(f"❌ FAIL: Invalid JSON response: {e}")
            return False
        
        # Verify required keys
        required_keys = ["range", "bucket", "start", "kpis", "distribution", "top_channels", "top_countries", "peak"]
        missing_keys = [key for key in required_keys if key not in data]
        
        if missing_keys:
            print(f"❌ FAIL: Missing required keys: {missing_keys}")
            return False
        
        print(f"✅ All required top-level keys present: {required_keys}")
        
        # Verify kpis structure
        kpis = data.get("kpis", {})
        required_kpi_keys = ["total_plays", "unique_visitors", "member_plays", "vip_plays", "guest_plays", "embed_plays"]
        missing_kpi_keys = [key for key in required_kpi_keys if key not in kpis]
        
        if missing_kpi_keys:
            print(f"❌ FAIL: Missing KPI keys: {missing_kpi_keys}")
            return False
        
        print(f"✅ All required KPI keys present: {required_kpi_keys}")
        
        # Verify each KPI has current, previous, delta_pct
        for kpi_name in required_kpi_keys:
            kpi_data = kpis[kpi_name]
            if not isinstance(kpi_data, dict):
                print(f"❌ FAIL: KPI '{kpi_name}' is not a dict")
                return False
            
            required_sub_keys = ["current", "previous", "delta_pct"]
            missing_sub_keys = [key for key in required_sub_keys if key not in kpi_data]
            
            if missing_sub_keys:
                print(f"❌ FAIL: KPI '{kpi_name}' missing sub-keys: {missing_sub_keys}")
                return False
        
        print(f"✅ All KPIs have required sub-keys (current, previous, delta_pct)")
        
        # Verify distribution structure
        distribution = data.get("distribution", {})
        required_dist_keys = ["member", "vip", "guest", "embed"]
        missing_dist_keys = [key for key in required_dist_keys if key not in distribution]
        
        if missing_dist_keys:
            print(f"❌ FAIL: Missing distribution keys: {missing_dist_keys}")
            return False
        
        print(f"✅ Distribution has all required keys: {required_dist_keys}")
        
        # Verify top_channels is a list
        top_channels = data.get("top_channels", [])
        if not isinstance(top_channels, list):
            print(f"❌ FAIL: top_channels is not a list")
            return False
        
        print(f"✅ top_channels is a list with {len(top_channels)} items")
        
        # Verify top_channels items have required keys
        if top_channels:
            channel_required_keys = ["id", "name", "country", "plays"]
            first_channel = top_channels[0]
            missing_channel_keys = [key for key in channel_required_keys if key not in first_channel]
            
            if missing_channel_keys:
                print(f"❌ FAIL: top_channels items missing keys: {missing_channel_keys}")
                return False
            
            print(f"✅ top_channels items have required keys: {channel_required_keys}")
        
        # Verify top_countries is a list
        top_countries = data.get("top_countries", [])
        if not isinstance(top_countries, list):
            print(f"❌ FAIL: top_countries is not a list")
            return False
        
        print(f"✅ top_countries is a list with {len(top_countries)} items")
        
        # Verify top_countries items have required keys
        if top_countries:
            country_required_keys = ["country", "plays"]
            first_country = top_countries[0]
            missing_country_keys = [key for key in country_required_keys if key not in first_country]
            
            if missing_country_keys:
                print(f"❌ FAIL: top_countries items missing keys: {missing_country_keys}")
                return False
            
            print(f"✅ top_countries items have required keys: {country_required_keys}")
        
        # Verify bucket value based on range
        bucket = data.get("bucket")
        expected_bucket = "hour" if range_param == "24h" else "day"
        if bucket != expected_bucket:
            print(f"❌ FAIL: Expected bucket '{expected_bucket}' for range '{range_param}', got '{bucket}'")
            return False
        
        print(f"✅ Bucket is correct: '{bucket}' for range '{range_param}'")
        
        # Print summary of values
        print(f"\n📊 Summary for range={range_param}:")
        print(f"  - Total plays: {kpis['total_plays']['current']} (previous: {kpis['total_plays']['previous']}, delta: {kpis['total_plays']['delta_pct']}%)")
        print(f"  - Unique visitors: {kpis['unique_visitors']['current']}")
        print(f"  - VIP plays: {kpis['vip_plays']['current']}")
        print(f"  - Embed plays: {kpis['embed_plays']['current']}")
        print(f"  - Top channels: {len(top_channels)}")
        print(f"  - Top countries: {len(top_countries)}")
        print(f"  - Peak: {data.get('peak')}")
        
        # Check if values are non-zero for 7d and 30d ranges
        if range_param in ["7d", "30d"]:
            total_plays = kpis['total_plays']['current']
            if total_plays == 0:
                print(f"⚠️  WARNING: total_plays is 0 for range {range_param} (expected non-zero with seeded data)")
            else:
                print(f"✅ Total plays is non-zero ({total_plays}) as expected with seeded data")
        
        print(f"\n✅ PASS: All validations passed for range={range_param}")
        return True
        
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests"""
    print("=" * 80)
    print("BACKEND API TESTS - GET /api/admin/analytics-overview")
    print("=" * 80)
    
    results = []
    
    # Test 1: Without authorization
    results.append(("Test 1: 401 without auth", test_analytics_without_auth()))
    
    # Get admin token
    admin_token = get_admin_token()
    
    if not admin_token:
        print("\n❌ CRITICAL: Could not obtain admin token. Skipping remaining tests.")
        print("\n" + "=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        for test_name, result in results:
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{status}: {test_name}")
        print(f"\nTotal: {sum(results)} / {len(results)} tests passed")
        sys.exit(1)
    
    # Test 2: With admin token - range=7d
    results.append(("Test 2: 200 with admin token (7d)", test_analytics_with_admin_token(admin_token, "7d")))
    
    # Test 3: With admin token - range=24h
    results.append(("Test 3: 200 with admin token (24h)", test_analytics_with_admin_token(admin_token, "24h")))
    
    # Test 4: With admin token - range=30d
    results.append(("Test 4: 200 with admin token (30d)", test_analytics_with_admin_token(admin_token, "30d")))
    
    # Test 5: With admin token - range=1y
    results.append(("Test 5: 200 with admin token (1y)", test_analytics_with_admin_token(admin_token, "1y")))
    
    # Print summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    print(f"\nTotal: {passed} / {total} tests passed")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
