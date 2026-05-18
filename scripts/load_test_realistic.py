"""
Realistic load test : 1000 viewers arriving over 10 seconds (100 viewers/s).
Each viewer behaves like a real HLS player:
  - GET /api/stream/{id}     once
  - GET /api/hls?u=...m3u8   3 times (simulates ~12 s of live playback,
                              one poll every 4 s — what hls.js does)

This is much closer to what '1000 simultaneous viewers' means in production.
"""

import asyncio
import re
import statistics
import subprocess
import time

import httpx

LOCAL = "http://localhost:8001"
NUM_VIEWERS = 1000
ARRIVAL_WINDOW_S = 10.0
PLAYLIST_POLLS_PER_VIEWER = 3
TIMEOUT = 20.0
LOG_FILE = "/var/log/supervisor/backend.out.log"


def count_upstream_calls():
    try:
        out = subprocess.run(["grep", "-c", "mediahubmx-resolve.json", LOG_FILE],
                             capture_output=True, text=True, timeout=5)
        return int(out.stdout.strip() or 0)
    except Exception:
        return -1


def fmt(name, latencies, errors):
    n = len(latencies)
    if not n:
        print(f"  [{name:14}] no successful response (errors={errors})")
        return
    s = sorted(latencies)
    def pct(p):
        k = max(0, min(n - 1, int(round((p / 100) * (n - 1)))))
        return s[k]
    print(f"  [{name:14}] n={n:5d}  err={errors:3d}  "
          f"min={min(latencies)*1000:5.0f}  p50={pct(50)*1000:5.0f}  "
          f"p95={pct(95)*1000:5.0f}  p99={pct(99)*1000:5.0f}  "
          f"max={max(latencies)*1000:5.0f}  mean={statistics.mean(latencies)*1000:5.0f} ms")


async def viewer_session(client, base, channel_id, arrival_delay, stream_lat, hls_lat, errs):
    """One viewer: arrives at `arrival_delay` seconds, fetches /api/stream
    then polls /api/hls 3 times every 4 seconds."""
    await asyncio.sleep(arrival_delay)
    # 1) resolve
    t0 = time.perf_counter()
    try:
        r = await client.get(f"{base}/api/stream/{channel_id}", timeout=TIMEOUT)
        if r.status_code != 200:
            errs.append(("stream", r.status_code))
            return
        stream_lat.append(time.perf_counter() - t0)
        proxy_url = r.json()["proxy_url"]
        if not proxy_url.startswith(base):
            m = re.search(r"/api/hls\?u=.*$", proxy_url)
            if m:
                proxy_url = base + m.group(0)
    except Exception as e:
        errs.append(("stream-exc", repr(e)[:60]))
        return

    # 2) playlist polls
    for _ in range(PLAYLIST_POLLS_PER_VIEWER):
        t0 = time.perf_counter()
        try:
            r = await client.get(proxy_url, timeout=TIMEOUT)
            if r.status_code != 200:
                errs.append(("hls", r.status_code))
            else:
                hls_lat.append(time.perf_counter() - t0)
        except Exception as e:
            errs.append(("hls-exc", repr(e)[:60]))
        await asyncio.sleep(4.0)


async def main():
    print(f"REALISTIC LOAD TEST  —  {NUM_VIEWERS} viewers, arriving over {ARRIVAL_WINDOW_S}s")
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{LOCAL}/api/channels", params={"country": "France", "limit": 200})
        r.raise_for_status()
        chans = r.json().get("channels", [])
    target = next((c for c in chans if c["name"].strip().upper() == "TF1"), None) or chans[0]
    print(f"Channel under test  : {target['name']}  id={target['id']}")

    upstream_before = count_upstream_calls()

    limits = httpx.Limits(max_keepalive_connections=500, max_connections=2000)
    async with httpx.AsyncClient(limits=limits, follow_redirects=True) as client:
        # Warmup so the 240s cache is hot when the first real viewer arrives
        rw = await client.get(f"{LOCAL}/api/stream/{target['id']}", timeout=TIMEOUT)
        rw.raise_for_status()
        proxy_url = rw.json()["proxy_url"]
        if not proxy_url.startswith(LOCAL):
            m = re.search(r"/api/hls\?u=.*$", proxy_url)
            if m:
                proxy_url = LOCAL + m.group(0)
        await client.get(proxy_url, timeout=TIMEOUT)
        print("  warmup done — caches hot\n")

        stream_lat, hls_lat, errs = [], [], []
        t0 = time.perf_counter()
        tasks = []
        for i in range(NUM_VIEWERS):
            delay = (i / NUM_VIEWERS) * ARRIVAL_WINDOW_S
            tasks.append(viewer_session(client, LOCAL, target["id"], delay,
                                        stream_lat, hls_lat, errs))
        await asyncio.gather(*tasks)
        wall = time.perf_counter() - t0

    upstream_after = count_upstream_calls()

    print(f"  TOTAL WALL TIME     : {wall:.1f}s")
    fmt("/api/stream",  stream_lat, sum(1 for e in errs if e[0].startswith("stream")))
    fmt("/api/hls m3u8", hls_lat,    sum(1 for e in errs if e[0].startswith("hls")))
    print(f"\n  UPSTREAM AMPLIFICATION (vavoo POSTs):")
    print(f"    before = {upstream_before}")
    print(f"    after  = {upstream_after}")
    print(f"    delta  = {upstream_after - upstream_before}   "
          f"(expected 0 — single upstream resolve for ALL {NUM_VIEWERS} viewers)")
    if errs:
        # Show first 10 distinct error types
        from collections import Counter
        cnt = Counter([f"{e[0]}:{e[1]}" for e in errs])
        print(f"\n  Errors breakdown (top 10):")
        for k, v in cnt.most_common(10):
            print(f"    {v:4d}x  {k}")


if __name__ == "__main__":
    asyncio.run(main())
