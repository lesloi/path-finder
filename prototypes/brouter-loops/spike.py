"""PROTOTYPE (issue #1): measure BRouter loop quality. Throwaway, not production code.

Starts the local BRouter server (run-server.sh), asks ~20 loops per request
(one per heading) for every start point x activity x surface x target distance,
and writes results/summary.md, results/candidates.jsonl and 10 km GeoJSON samples.

Run: python3 spike.py
"""

import json
import math
import os
import statistics
import subprocess
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from itertools import combinations

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://127.0.0.1:17777/brouter"
THREADS = 4
TIMEOUT_S = 30  # API latency budget; slower candidates count as failures
HEADINGS = list(range(0, 360, 18))  # 20 candidates per request
RADIUS_RATIO = 5.0  # loop length ~= 5 x roundTripDistance (measured on a first probe)

START_POINTS = {
    "urban (Lyon Bellecour)": (4.8320, 45.7578),
    "peri-urban (Chaponost)": (4.7430, 45.7100),
    "mountain (Chamonix)": (6.8694, 45.9237),
}
TARGETS_KM = [5, 10, 20]

# Activity x surface preference -> overrides on the stock hiking-mountain profile.
# path_preference > 0 penalises paved/non-path ways; SAC_scale_limit caps trail difficulty.
CONFIGS = {
    "run/paved": {"SAC_scale_limit": 0, "path_preference": 0},
    "run/unpaved": {"SAC_scale_limit": 2, "path_preference": 20},
    "hike/paved": {"SAC_scale_limit": 1, "path_preference": 0},
    "hike/unpaved": {"SAC_scale_limit": 3, "path_preference": 20},
}

PAVED = {"asphalt", "concrete", "paved", "paving_stones", "sett", "cobblestone", "concrete:plates", "metal", "wood"}
UNPAVED = {"gravel", "fine_gravel", "compacted", "ground", "dirt", "earth", "grass", "unpaved", "rock",
           "pebblestone", "sand", "mud", "woodchips", "grass_paver", "stone"}
UNPAVED_HIGHWAYS = {"path", "track", "bridleway"}


def request(lon, lat, overrides, radius, heading):
    params = [
        f"lonlats={lon},{lat}", "profile=hiking-mountain", "engineMode=4",
        f"roundTripDistance={radius}", f"direction={heading}", "format=geojson",
    ] + [f"profile:{k}={v}" for k, v in overrides.items()]
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(f"{BASE}?{'&'.join(params)}", timeout=TIMEOUT_S) as r:
            body = r.read()
        feature = json.loads(body)["features"][0]
    except Exception as e:  # noqa: BLE001 - a failed candidate is a data point
        return {"error": str(e)[:200], "latency": time.monotonic() - t0}
    return {"feature": feature, "latency": time.monotonic() - t0}


def surface_breakdown(messages):
    header, rows = messages[0], messages[1:]
    d_i, t_i = header.index("Distance"), header.index("WayTags")
    out = {"paved": 0, "unpaved": 0, "unknown": 0}
    for row in rows:
        tags = dict(kv.split("=", 1) for kv in row[t_i].split() if "=" in kv)
        s, hw = tags.get("surface"), tags.get("highway")
        kind = ("paved" if s in PAVED else "unpaved" if s in UNPAVED else
                "unpaved" if hw in UNPAVED_HIGHWAYS and s is None else
                "unknown" if s is None and hw in {"footway", "steps", "pedestrian", None} else "paved")
        out[kind] += int(row[d_i])
    total = sum(out.values()) or 1
    return {k: v / total for k, v in out.items()}


def haversine(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def retrace_ratio(coords):
    """Share of the length on edges walked more than once (out-and-back sections)."""
    seen, total, repeated = {}, 0.0, 0.0
    edges = []
    for a, b in zip(coords, coords[1:]):
        key = tuple(sorted(((round(a[0], 5), round(a[1], 5)), (round(b[0], 5), round(b[1], 5)))))
        d = haversine(a, b)
        edges.append((key, d))
        seen[key] = seen.get(key, 0) + 1
        total += d
    repeated = sum(d for key, d in edges if seen[key] > 1)
    return repeated / total if total else 0.0


def cells(coords, size_m=25):
    lat0 = coords[0][1]
    kx = 111320 * math.cos(math.radians(lat0)) / size_m
    ky = 110540 / size_m
    return {(int(c[0] * kx), int(c[1] * ky)) for c in coords}


def overlap(a, b):
    return len(a & b) / min(len(a), len(b))


def distinct_count(cell_sets, threshold=0.5):
    picked = []
    for s in cell_sets:
        if all(overlap(s, p) < threshold for p in picked):
            picked.append(s)
    return len(picked)


def rss_mb(pid):
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS"):
                    return int(line.split()[1]) / 1024
    except FileNotFoundError:
        return 0.0
    return 0.0


def main():
    os.makedirs(os.path.join(HERE, "results", "samples"), exist_ok=True)
    server = subprocess.Popen([os.path.join(HERE, "run-server.sh")],
                              stdout=open(os.path.join(HERE, "data", "server.log"), "w"), stderr=subprocess.STDOUT)
    for _ in range(60):
        try:
            urllib.request.urlopen("http://127.0.0.1:17777/", timeout=1)
        except Exception as e:  # noqa: BLE001
            if "Connection refused" not in str(e) and "refused" not in str(e):
                break
            time.sleep(1)
    java_pid = int(subprocess.check_output(["pgrep", "-P", str(server.pid)]).split()[0]) if subprocess.run(
        ["pgrep", "-P", str(server.pid)], capture_output=True).stdout else server.pid
    peak = {"rss": 0.0}
    stop = threading.Event()

    def sampler():
        while not stop.is_set():
            peak["rss"] = max(peak["rss"], rss_mb(java_pid))
            time.sleep(0.2)

    threading.Thread(target=sampler, daemon=True).start()

    rows = []
    groups = []
    raw = open(os.path.join(HERE, "results", "candidates.jsonl"), "w")
    try:
        with ThreadPoolExecutor(THREADS) as pool:
            for sp_name, (lon, lat) in START_POINTS.items():
                for cfg_name, overrides in CONFIGS.items():
                    for km in TARGETS_KM:
                        radius = int(km * 1000 / RADIUS_RATIO)
                        t0 = time.monotonic()
                        results = list(pool.map(lambda h: request(lon, lat, overrides, radius, h), HEADINGS))
                        wall = time.monotonic() - t0
                        ok = [r for r in results if "feature" in r]
                        cand = []
                        for h, r in zip(HEADINGS, results):
                            rec = {"start": sp_name, "config": cfg_name, "target_km": km, "heading": h,
                                   "latency_s": round(r["latency"], 3)}
                            if "feature" in r:
                                p = r["feature"]["properties"]
                                coords = r["feature"]["geometry"]["coordinates"]
                                rec.update({
                                    "length_km": int(p["track-length"]) / 1000,
                                    "retrace": round(retrace_ratio(coords), 3),
                                    "surface": {k: round(v, 3) for k, v in surface_breakdown(p["messages"]).items()},
                                })
                                cand.append((rec, coords))
                            else:
                                rec["error"] = r["error"]
                            raw.write(json.dumps(rec) + "\n")
                        cell_sets = [cells(c) for _, c in cand]
                        lengths = [r["length_km"] for r, _ in cand]
                        errs = [abs(l - km) / km for l in lengths]
                        pair = [overlap(a, b) for a, b in combinations(cell_sets, 2)]
                        g = {
                            "start": sp_name, "config": cfg_name, "target_km": km,
                            "ok": len(ok), "failed": len(results) - len(ok),
                            "median_len": statistics.median(lengths) if lengths else None,
                            "within_10pct": sum(e <= 0.10 for e in errs),
                            "within_20pct": sum(e <= 0.20 for e in errs),
                            "median_retrace": statistics.median(r["retrace"] for r, _ in cand) if cand else None,
                            "low_retrace": sum(r["retrace"] <= 0.15 for r, _ in cand),
                            "mean_overlap": statistics.mean(pair) if pair else None,
                            "distinct": distinct_count(cell_sets),
                            "unpaved": statistics.median(r["surface"]["unpaved"] for r, _ in cand) if cand else None,
                            "p50_latency": statistics.median(r["latency"] for r in results),
                            "max_latency": max(r["latency"] for r in results),
                            "wall_20": wall,
                        }
                        groups.append(g)
                        print(json.dumps({k: (round(v, 2) if isinstance(v, float) else v) for k, v in g.items()}), flush=True)
                        if km == 10:
                            slug = f"{sp_name.split()[0]}-{cfg_name.replace('/', '-')}-10km"
                            fc = {"type": "FeatureCollection", "features": [
                                {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [c[:2] for c in coords]},
                                 "properties": {"heading": r["heading"], "length_km": r["length_km"], "retrace": r["retrace"]}}
                                for r, coords in cand]}
                            with open(os.path.join(HERE, "results", "samples", f"{slug}.geojson"), "w") as f:
                                json.dump(fc, f)
    finally:
        stop.set()
        raw.close()
        server.terminate()
        subprocess.run(["pkill", "-P", str(server.pid)])
        try:
            os.kill(java_pid, 15)
        except ProcessLookupError:
            pass

    write_summary(groups, peak["rss"])


def write_summary(groups, peak_rss):
    lines = [
        "# BRouter loop spike: results (PROTOTYPE, issue #1)", "",
        f"BRouter 1.7.10, stock `hiking-mountain` profile with overrides, {len(HEADINGS)} headings per request, "
        f"{THREADS} concurrent requests, radius = target / {RADIUS_RATIO}. Peak server RSS: **{peak_rss:.0f} MB** "
        f"(-Xmx{os.environ.get('BROUTER_XMX', '2g')}).", "",
        "| Start | Config | Target | OK/fail | Median km | ±10% | ±20% | Median retrace | Retrace ≤15% | "
        "Mean overlap | Distinct (<50% overlap) | Median unpaved | p50 / max latency (s) | Wall for 20 (s) |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for g in groups:
        f = lambda v, n=2: "–" if v is None else f"{v:.{n}f}"  # noqa: E731
        lines.append(
            f"| {g['start']} | {g['config']} | {g['target_km']} km | {g['ok']}/{g['failed']} | {f(g['median_len'], 1)} | "
            f"{g['within_10pct']} | {g['within_20pct']} | {f(g['median_retrace'])} | {g['low_retrace']} | "
            f"{f(g['mean_overlap'])} | {g['distinct']} | {f(g['unpaved'])} | "
            f"{g['p50_latency']:.2f} / {g['max_latency']:.2f} | {g['wall_20']:.1f} |")
    with open(os.path.join(HERE, "results", "summary.md"), "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
