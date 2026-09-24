"""PROTOTYPE (issue #1): follow-up to spike.py. Throwaway, not production code.

Checks two fixes suggested by the first run:
1. Per-candidate radius correction: ask once with radius = target / 5, then ask again with
   radius scaled by target / measured length.
2. Mountain timeouts: keep a permissive SAC scale limit for every surface preference and let
   path_preference alone express the surface preference.

Run: python3 followup.py  -> results/followup.md
"""

import os
import statistics
import subprocess
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from spike import (HEADINGS, HERE, RADIUS_RATIO, START_POINTS, TARGETS_KM, cells, distinct_count,
                   request, retrace_ratio, rss_mb, surface_breakdown)

CONFIGS = {
    "run/paved": {"SAC_scale_limit": 2, "path_preference": 0},
    "run/unpaved": {"SAC_scale_limit": 2, "path_preference": 20},
    "hike/paved": {"SAC_scale_limit": 3, "path_preference": 0},
    "hike/unpaved": {"SAC_scale_limit": 3, "path_preference": 20},
}


def corrected(lon, lat, overrides, km, heading):
    radius = int(km * 1000 / RADIUS_RATIO)
    first = request(lon, lat, overrides, radius, heading)
    if "feature" not in first:
        return first, first["latency"]
    length = int(first["feature"]["properties"]["track-length"])
    second = request(lon, lat, overrides, int(radius * km * 1000 / length), heading)
    total = first["latency"] + second["latency"]
    # Keep whichever of the two is closer to the target.
    best = min((r for r in (first, second) if "feature" in r),
               key=lambda r: abs(int(r["feature"]["properties"]["track-length"]) - km * 1000))
    return best, total


def main():
    server = subprocess.Popen([os.path.join(HERE, "run-server.sh")],
                              stdout=open(os.path.join(HERE, "data", "server-followup.log"), "w"),
                              stderr=subprocess.STDOUT)
    for _ in range(60):
        try:
            urllib.request.urlopen("http://127.0.0.1:17777/", timeout=1)
        except Exception as e:  # noqa: BLE001
            if "refused" not in str(e):
                break
            time.sleep(1)
    peak = 0.0
    lines = [
        "# BRouter loop spike: follow-up (PROTOTYPE, issue #1)", "",
        "Per-candidate radius correction (2 requests per candidate), permissive SAC limit for every surface.", "",
        "| Start | Config | Target | OK/fail | Median km | ±10% | ±20% | Median retrace | Retrace ≤15% | "
        "Distinct | Median unpaved | p50 / max latency per candidate (s) | Wall for 20 (s) |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    try:
        with ThreadPoolExecutor(4) as pool:
            for sp, (lon, lat) in START_POINTS.items():
                for cfg, ov in CONFIGS.items():
                    for km in TARGETS_KM:
                        t0 = time.monotonic()
                        res = list(pool.map(lambda h: corrected(lon, lat, ov, km, h), HEADINGS))
                        wall = time.monotonic() - t0
                        peak = max(peak, rss_mb(server.pid))
                        ok = [r["feature"] for r, _ in res if "feature" in r]
                        lens = [int(f["properties"]["track-length"]) / 1000 for f in ok]
                        errs = [abs(v - km) / km for v in lens]
                        coords = [f["geometry"]["coordinates"] for f in ok]
                        retr = [retrace_ratio(c) for c in coords]
                        cs = [cells(c) for c in coords]
                        unp = [surface_breakdown(f["properties"]["messages"])["unpaved"] for f in ok]
                        lat_ = [t for _, t in res]
                        m = lambda xs: f"{statistics.median(xs):.2f}" if xs else "–"  # noqa: E731
                        lines.append(
                            f"| {sp} | {cfg} | {km} km | {len(ok)}/{len(res) - len(ok)} | {m(lens)} | "
                            f"{sum(e <= .1 for e in errs)} | {sum(e <= .2 for e in errs)} | {m(retr)} | "
                            f"{sum(r <= .15 for r in retr)} | {distinct_count(cs)} | {m(unp)} | "
                            f"{statistics.median(lat_):.2f} / {max(lat_):.2f} | {wall:.1f} |")
                        print(lines[-1], flush=True)
    finally:
        server.terminate()
    lines.insert(3, f"Peak server RSS sampled between requests: **{peak:.0f} MB**.\n")
    with open(os.path.join(HERE, "results", "followup.md"), "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
