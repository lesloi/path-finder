# PROTOTYPE: BRouter loop spike (issue #1)

Throwaway code that answers one question: **can a self-hosted BRouter produce usable loops
for Path finder (ADR 0001)?** It lives only on the `prototype/brouter-loops` branch.

## Run it

```sh
# once: BRouter 1.7.10 + the two segment tiles covering Lyon and Chamonix (~380 MB) into data/
cd prototypes/brouter-loops && mkdir -p data/segments && cd data
curl -LO https://github.com/abrensch/brouter/releases/download/v1.7.10/brouter-1.7.10.zip && unzip brouter-1.7.10.zip
curl -o segments/E0_N45.rd5 https://brouter.de/brouter/segments4/E0_N45.rd5
curl -o segments/E5_N45.rd5 https://brouter.de/brouter/segments4/E5_N45.rd5
cd .. && python3 spike.py && python3 followup.py   # Java 21 + Python 3, no dependencies
```

- `spike.py`: the matrix from the issue: 3 start points × run/hike × paved/unpaved ×
  5/10/20 km, 20 headings per request. Writes `results/summary.md`, `results/candidates.jsonl`,
  and 10 km GeoJSON samples in `results/samples/`.
- `followup.py`: the two fixes the first run called for (see below). Writes
  `results/followup.md`.

## How loops are asked

BRouter's round-trip mode: `engineMode=4`, `roundTripDistance=<radius m>`,
`direction=<heading°>`. BRouter puts 4 waypoints on a 108° arc of that radius around the
start point and routes start → arc → start. `roundTripDistance` is a **radius, not a
length**: the loop comes out at about 5 × radius, with large variation by area (5× in Lyon,
up to 9.5× around Chamonix, where the valley forces detours).

Profile: stock `hiking-mountain` with `profile:` overrides. `path_preference=20` expresses
"unpaved" and `0` expresses "paved". `SAC_scale_limit` caps trail difficulty.

## Findings

Metrics: **±10 %**/**±20 %** = candidates within that distance of the target, out of 20.
**Retrace** = share of the length walked twice (out-and-back sections). **Distinct** =
candidates kept by a greedy pick with < 50 % overlap on a 25 m grid. **Unpaved** = share
of the length on unpaved surfaces (OSM `surface`, falling back to `highway`).

1. **Loops are usable in urban and peri-urban areas.** With the radius correction
   (`results/followup.md`), 14–20 candidates out of 20 are within ±20 % of the target, 7–15 are
   distinct, and latency is 0.1–2 s per candidate.
2. **A fixed radius ratio is not enough.** Without correction (`results/summary.md`),
   peri-urban unpaved loops reach 0–1 out of 20 within ±10 %, and Chamonix 0 out of 20. One
   correction request per candidate (radius × target / measured length) fixes most of it.
   It costs 2 BRouter calls per candidate.
3. **A low `SAC_scale_limit` breaks mountain requests.** With `SAC_scale_limit` 0 or 1 around
   Chamonix, BRouter searches for 30–200 s and times out on most headings (first run:
   0/20 at 10 and 20 km). With 2 (run) or 3 (hike) the same requests take ~0.2 s.
   So surface must stay a *soft* preference (`path_preference`), as `CONTEXT.md` already says,
   never a hard SAC restriction.
4. **Mountain loops are harder.** Chamonix: 5–16/20 within ±20 %, 20 km runs still
   time out on half the headings, and median retrace goes up to 0.36 at 10 km. There are
   still 4–12 distinct candidates per request, enough to fill a route set of 3 to 5.
5. **The paved preference is weak in the mountains.** Chamonix "paved" loops are still
   36–86 % unpaved: the network is mostly paths. That is expected, since the preference is
   soft.
6. **Run and hike give identical results in the lowlands.** Only the SAC limit differs, and it
   only matters where there are SAC-tagged trails. Activity should differ mostly in pace
   and ranking, not in BRouter profile.
7. **Resources.** Peak server RSS was 1.1 GB with `-Xmx2g` and 2 tiles loaded. A
   batch of 20 candidates takes 0.4–9 s of wall time with 4 concurrent requests (urban Lyon is the
   slowest; the graph is dense).

## Recommendation: go, with these settings

- `engineMode=4`, 20 headings (every 18°), radius = target / 5, then one correction request
  per candidate. Keep whichever of the two is closer to the target.
- `hiking-mountain` profile, `SAC_scale_limit=2` for run and `3` for hike,
  `path_preference=0` (paved or no preference) or `20` (unpaved).
- Per-request timeout of ~5 s on the API side. Every successful call took < 2.2 s; the
  failures only ended at the 30 s timeout, so drop them early.
- Route set selection (#5) should penalise retrace. Many peri-urban and mountain candidates
  are 20–35 % out-and-back.

## Not covered here

- **Docker.** The sandbox gives every shell command its own network namespace, so the server
  ran as a plain JVM (`run-server.sh`) instead of in a container. Docker is left to #11
  and #13.
- **Full France RAM.** Only 2 of the ~9 France tiles were loaded. `-Xmx` caps the heap,
  but check RSS with every tile before sizing the Scaleway instance (#11).
- **Elevation gain.** BRouter's ascend figures are ignored on purpose (ADR 0003, spike #3).
- **Visual review.** Quality is measured with metrics only. Open the GeoJSON files in
  `results/samples/` (QGIS or any local viewer) to check shapes by eye. These samples come
  from the first run, without radius correction.
