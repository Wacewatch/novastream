"""
Load test — 1000 viewers on same channel, measuring REAL backend performance.

Two targets:
  - LOCAL  : http://localhost:8001  (direct backend, no ingress)
  - PUBLIC : the external URL       (through Kubernetes ingress, real conditions)

For each target we run:
  Phase 1 : 1000 concurrent GET /api/stream/{id}  (after warmup)
  Phase 2 : 1000 concurrent GET /api/hls?u=...m3u8 (after warmup)
  Phase 3 : Verify ZERO upstream amplification by counting
            'vavoo.to/mediahubmx-resolve.json' POSTs in backend.out.log
            before vs after the test.
"""

import asyncio
import os
import re
import statistics
import subprocess
import time

import httpx

LOCAL = "http://localhost:8001"
PUBLIC = "https://api-redesign-2.preview.emergentagent.com"
CONCURRENCY = 1000
TIMEOUT = 30.0
LOG_FILE = "/var/log/supervisor/backend.out.log"


def count_upstream_calls():
    """Count vavoo resolve POSTs in current backend log."""
    try:
        out = subprocess.run(
            ["grep", "-c", "mediahubmx-resolve.json", LOG_FILE],
            capture_output=True, text=True, timeout=5,
        )
        return int(out.stdout.strip() or 0)
    except Exception:
        return -1


def fmt(name, latencies, errors, wall):
    n = len(latencies)
    if not n:
        print(f"  [{name}] no successful response (errors={errors})")
        return
    s = sorted(latencies)
    def pct(p):
        k = max(0, min(n - 1, int(round((p / 100) * (n - 1)))))
        return s[k]
    rps = n / wall if wall > 0 else 0
    print(f"  [{name}] n={n:4d}  err={errors:3d}  wall={wall*1000:6.0f}ms  rps={rps:5.0f}")
    print(f"           min={min(latencies)*1000:5.0f} p50={pct(50)*1000:5.0f} "
          f"p95={pct(95)*1000:5.0f} p99={pct(99)*1000:5.0f} max={max(latencies)*1000:5.0f}ms  "
          f"mean={statistics.mean(latencies)*1000:5.0f}ms")


async def hit(client, url, sem):
    async with sem:
        t0 = time.perf_counter()
        try:
            r = await client.get(url, timeout=TIMEOUT)
            return (time.perf_counter() - t0, r.status_code == 200,
                    r.json() if r.status_code == 200 and "application/json" in r.headers.get("content-type", "")
                    else len(r.content))
        except Exception as e:
            return (time.perf_counter() - t0, False, repr(e))


async def run_target(base, label, channel_id):
    print(f"\n========== TARGET = {label} ({base}) ==========")
    limits = httpx.Limits(max_keepalive_connections=300, max_connections=2000)
    async with httpx.AsyncClient(limits=limits, follow_redirects=True) as client:
        # ---- warm + fresh proxy_url (m3u8 tokens are short-lived)
        rw = await client.get(f"{base}/api/stream/{channel_id}", timeout=TIMEOUT)
        if rw.status_code != 200:
            print(f"  warmup failed: {rw.status_code} {rw.text[:120]}")
            return
        proxy_url = rw.json()["proxy_url"]
        # Make m3u8 URL absolute (proxy_url already is) — but if test uses LOCAL
        # backend, the proxy_url's host is the PUBLIC ingress (X-Forwarded-Host).
        # For testing LOCAL backend, force the same host as `base`.
        if not proxy_url.startswith(base):
            # extract the query part after /api/hls
            m = re.search(r"/api/hls\?u=.*$", proxy_url)
            if m:
                proxy_url = base + m.group(0)
        wm = await client.get(proxy_url, timeout=TIMEOUT)
        print(f"  warmup ok — proxy_url len={len(proxy_url)}  m3u8 size={len(wm.content)}B")

        # snapshot upstream call counter
        upstream_before = count_upstream_calls()

        # ---- PHASE 1: /api/stream
        sem = asyncio.Semaphore(CONCURRENCY)
        t0 = time.perf_counter()
        res1 = await asyncio.gather(
            *[hit(client, f"{base}/api/stream/{channel_id}", sem) for _ in range(CONCURRENCY)]
        )
        wall1 = time.perf_counter() - t0
        lats1 = [r[0] for r in res1 if r[1]]
        errs1 = sum(1 for r in res1 if not r[1])
        proxies = {r[2]["proxy_url"] for r in res1 if r[1] and isinstance(r[2], dict)}
        print(f"  PHASE 1 — 1000x GET /api/stream/{{id}}")
        fmt("/api/stream", lats1, errs1, wall1)
        print(f"           distinct proxy_url returned: {len(proxies)} (expected 1)")

        # re-warm playlist (token may have expired)
        rw2 = await client.get(f"{base}/api/stream/{channel_id}", timeout=TIMEOUT)
        proxy_url = rw2.json()["proxy_url"]
        if not proxy_url.startswith(base):
            m = re.search(r"/api/hls\?u=.*$", proxy_url)
            if m:
                proxy_url = base + m.group(0)
        await client.get(proxy_url, timeout=TIMEOUT)  # micro-cache warmup

        # ---- PHASE 2: /api/hls (m3u8)
        sem2 = asyncio.Semaphore(CONCURRENCY)
        t0 = time.perf_counter()
        res2 = await asyncio.gather(
            *[hit(client, proxy_url, sem2) for _ in range(CONCURRENCY)]
        )
        wall2 = time.perf_counter() - t0
        lats2 = [r[0] for r in res2 if r[1]]
        errs2 = sum(1 for r in res2 if not r[1])
        print(f"  PHASE 2 — 1000x GET /api/hls (m3u8 playlist)")
        fmt("/api/hls", lats2, errs2, wall2)

        # snapshot upstream call counter AFTER
        upstream_after = count_upstream_calls()
        print(f"  UPSTREAM AMPLIFICATION : vavoo resolve POSTs before={upstream_before} "
              f"after={upstream_after}  delta={upstream_after - upstream_before} "
              f"(expected 0 — single resolve cached for 240s)")


async def main():
    # Use LOCAL backend just to find a stable TF1-like channel ID
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{LOCAL}/api/channels", params={"country": "France", "limit": 200})
        r.raise_for_status()
        chans = r.json().get("channels", [])
    # Pick TF1 exact
    target = next((c for c in chans if c["name"].strip().upper() == "TF1"), None)
    if not target:
        target = chans[0]
    print(f"Channel under test : {target['name']}  id={target['id']}")

    # Run LOCAL first (clean backend perf), then PUBLIC (real conditions)
    await run_target(LOCAL,  "LOCAL  (direct backend)", target["id"])
    await asyncio.sleep(1)
    await run_target(PUBLIC, "PUBLIC (through ingress)", target["id"])


if __name__ == "__main__":
    asyncio.run(main())
