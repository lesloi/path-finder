# PROTOTYPE: elevation gain from IGN BD ALTI 25 m (issue #14)

Throwaway code that answers one question: **does IGN BD ALTI 25 m give accurate elevation gain
where Copernicus GLO-30 failed (#3)?** It lives only on the `prototype/ign-dtm-elevation`
branch, which also carries the #3 prototype it builds on.

## Run it

```sh
# BD ALTI 25 m for departments 74, 75, 78, 91, 92, 93, 94 (7z, ~30 MB each) extracted into data/, from
#   https://data.geopf.fr/telechargement/resource/BDALTI
node fetch-tracks.mjs   # BRouter data of the #1 spike in ../brouter-loops/data; IGN reference
node convert.mjs        # ASC -> data/grid/*.u16
node spike.mjs          # -> results/summary.md
TRACKS=$PWD/data/tracks.json OUT=$PWD/results/copernicus.md node ../copernicus-elevation/spike.mjs
```

- **Test loops** (chosen with the owner): Paris (3 urban loops, 9–18 km), Vallée de Chevreuse
  (road and forest trails, 13–24 km), and Chamonix (the 3 loops from #3). Each covers one way
  a terrain model can go wrong: buildings and bridges, forest on rolling hills, and steep slopes.
- **Reference**: IGN RGE ALTI every 5 m via the Géoplateforme altimetry API, as in #3.
- `convert.mjs` turns each 25 km ASCII tile into a 2 MB file of Uint16 (height in
  decimetres + 1000, 0 = no data). Any cell can then be read with a single read at a known
  offset, with no decoding.
- `spike.mjs` projects WGS84 to Lambert-93 (IGN formulas, no dependency), then does a bilinear
  interpolation on the 25 m grid.

## Findings

Error = (gain − reference) / max(reference, 100 m). Full tables are in `results/summary.md` and
`results/copernicus.md`.

1. **BD ALTI is accurate everywhere, including Paris.** With a point every 30 m, no smoothing,
   and no threshold, the mean error is **2.6 %** and the maximum +8 % (Seine loop). On the
   first run with the #3 loops (Lyon, Chaponost, Chamonix, Annecy), the same method gave a 1.1 %
   mean and a 3 % max.
2. **Don't add a threshold on BD ALTI.** The 25 m grid is already smooth. A 1 m threshold
   (the right setting for Copernicus) cuts real gentle climbs: −16 % to −20 % in Paris.
3. **Copernicus fails in the forest too, not only in town.** On the same loops: Paris +251 %
   to +442 %, and **Vallée de Chevreuse +48 % to +96 %** (forest canopy), against +1 % to +9 %
   in Chamonix. No Copernicus setting fixes both Paris and Chamonix. BRouter's SRTM figure is
   too low everywhere (−5 % to −76 %).
4. **Heights match RGE ALTI closely**: bias ±0.1 m and RMSE 0.2–0.9 m. BD ALTI V2 is resampled
   from RGE ALTI, so the comparison measures what the 25 m resolution loses, not the absolute
   accuracy of the IGN data.
5. **The reference is finer than 25 m.** Sampled every 1 m on a Chamonix slope, the API returns
   steps every 3–4 m. So it is not BD ALTI in disguise.
6. **Lookup is fast.** **0.6–2.8 ms per route** when the tiles are read from disk, 0.1–0.5 ms
   when they are cached, and 0.8–2.2 ms with no cache at all (one read per cell). By
   comparison, Copernicus took ~55 ms per route.
7. **Size.** BD ALTI for all 96 metropolitan departments is **3.05 GB** of 7z archives. As
   Uint16 tiles, metropolitan France is about 1,000 tiles (~550,000 km² / 625 km², plus
   partial tiles on borders and coasts), so **~2 GB**. Copernicus needed 5.0 GB. Conversion
   runs at ~95 MB of ASCII per second.

## Recommendation: go on BD ALTI 25 m

- **Source:** IGN BD ALTI 25 m (Licence Ouverte), converted at build time into Uint16 tiles
  in Lambert-93. Copernicus is dropped: it is wrong in town and in forest.
- **Method:** a point every 30 m along the route, bilinear, no smoothing, no threshold.
- **Lookup:** tiles on a volume, with a small LRU in memory. At ~2 MB a tile, 64 tiles fit
  in ~128 MB.

## Not covered here

- Absolute accuracy against a barometric recording. The reference is RGE ALTI, the source of
  BD ALTI.
- Overseas departments. Coverage is metropolitan France only (ADR 0001).
- Loops crossing the border: BD ALTI stops at the French border (no data = 0).
