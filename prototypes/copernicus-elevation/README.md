# PROTOTYPE: Copernicus elevation gain spike (issue #3)

Throwaway code that answers one question: **how accurate is elevation gain when we resample
routes on Copernicus DEM GLO-30 (ADR 0003)?** It lives only on the
`prototype/copernicus-elevation` branch.

## Run it

```sh
cd prototypes/copernicus-elevation && pnpm install
# tiles: Copernicus_DSM_COG_10_N45_00_E004_00_DEM.tif and ..._E006_... into data/tiles/, from
#   https://copernicus-dem-30m.s3.amazonaws.com/<name>/<name>.tif
node fetch-tracks.mjs   # needs the BRouter data of the #1 spike in ../brouter-loops/data
node spike.mjs          # -> results/summary.md
```

- `fetch-tracks.mjs` builds 8 test loops with BRouter: road, mixed, and trail, from flat Lyon to
  1,350 m of gain around Chamonix. It keeps BRouter's SRTM ascend, then resamples each loop every
  5 m and gets the **reference** elevation from IGN RGE ALTI (1–5 m terrain model) through the
  Géoplateforme altimetry API. Only these synthetic loops were sent, never user data.
- `spike.mjs` reads Copernicus with `geotiff` (window read + bilinear), then scores 85 methods
  (sampling step × moving-average window × hysteresis threshold) against the reference.
- `geo.mjs`: resampling, smoothing, and gain with a hysteresis threshold.

## Findings

Error = (gain − reference) / max(reference, 100 m). Full tables are in `results/summary.md`.

1. **Outside dense cities, Copernicus is accurate.** With a point every 30 m, no smoothing, and a
   1 m hysteresis threshold, the mean error on the 6 peri-urban and mountain loops is **3.9 %**
   (−0 % to +13 %). BRouter's SRTM figure is systematically low on the same loops: −5 % to −32 %.
2. **In the city centre, Copernicus is badly wrong.** Copernicus is a *surface* model (DSM): it
   includes buildings, bridges, and trees. With the same method, a flat 10 km loop along the Rhône
   gets +177 m instead of +50 m (+254 %), and a loop over Fourvière +58 %. Heavy smoothing or a
   5 m threshold reduces this, but pushes the mountain loops 10–20 % low. No single setting
   serves both.
3. **A terrain model (DTM) does not have this problem.** Sampling the RGE ALTI reference itself
   every 30 m (1 m threshold) stays between −2 % and −11 % everywhere, and −22 % on the flat
   Lyon loop (only 22 m off). This is indicative only: it is 1–5 m data sampled coarsely, not a
   25 m grid.
4. **Pixel registration matters.** Copernicus tiles are *PixelIsPoint*: pixel (i, j) is centred
   on the tile corner + i × 1″. Reading them with a half-pixel shift nearly doubles the
   RMSE against RGE ALTI in the mountains (21 m vs 12 m).
5. **Copernicus sits above the terrain.** The mean height bias against RGE ALTI is +1 to +10 m,
   higher in forest and town, as expected from a DSM. It barely affects gain outside cities.
6. **The reference is itself uncertain.** Depending on light smoothing, RGE ALTI gives
   1,221–1,889 m for the same Chamonix trail. The line followed is OSM geometry, and 1 m of
   lateral offset on a steep slope looks like climbing. Treat differences under ~10 % as noise.
7. **Size and speed.** The bounding box 41–51°N, 5°W–9°E is **148 tiles, 5.0 GB** of COGs
   (some cover neighbouring countries). A route lookup takes **~55 ms median, ~110 ms max**,
   whatever the sampling step: the cost is reading and inflating the 1024-pixel internal
   blocks, not the number of points. Decoding every tile into memory would take ~7.7 GB, so
   the API must read windows or cache blocks (LRU).

## Recommendation

- **Method:** a point every 30 m, bilinear, no smoothing, 1 m hysteresis threshold.
- **Source:** Copernicus is fine for rural and mountain loops but overestimates city loops
  badly, which breaks the target elevation gain criterion for runners in town. Since coverage
  is France only (ADR 0001), consider an **IGN terrain model** instead of Copernicus: BD ALTI
  25 m or RGE ALTI 5 m, Licence Ouverte, already credited. That would amend ADR 0003, so it
  is the owner's call, and it needs its own check of size, format, and accuracy.

## Not covered here

- Only 8 loops, all in the Lyon and Alps tiles. No Mediterranean, Atlantic, or Pyrenees terrain.
- Accuracy against a real barometric recording. RGE ALTI along OSM geometry is the reference.
- A true 25 m DTM grid (finding 3 is an approximation).
