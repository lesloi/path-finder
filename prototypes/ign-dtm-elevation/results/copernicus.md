# Copernicus elevation gain spike: results (PROTOTYPE, issue #3)

Reference: IGN RGE ALTI sampled every 5 m, 25 m moving average. Error = (gain − reference) / max(reference, 100 m).

## Per track

| Track | Kind | km | Reference D+ | BRouter SRTM (filtered) | Copernicus raw, 30 m | Best method (30 m, 120 m smoothing, 5 m threshold) |
|---|---|---|---|---|---|---|
| paris-seine-10 | urban | 9.2 | 91 m | 15 m (-76 %) | 342 m (+251 %) | 78 m (-12 %) |
| paris-montmartre-10 | urban | 9.0 | 43 m | 11 m (-32 %) | 364 m (+321 %) | 56 m (+12 %) |
| paris-west-20 | urban | 18.4 | 143 m | 54 m (-62 %) | 777 m (+442 %) | 175 m (+22 %) |
| chevreuse-road-20 | road | 20.8 | 227 m | 168 m (-26 %) | 446 m (+96 %) | 208 m (-9 %) |
| chevreuse-trail-10 | trail | 13.0 | 255 m | 199 m (-22 %) | 378 m (+48 %) | 231 m (-10 %) |
| chevreuse-trail-20 | trail | 24.3 | 450 m | 339 m (-25 %) | 741 m (+65 %) | 423 m (-6 %) |
| chamonix-mixed-10 | mixed | 13.5 | 863 m | 816 m (-5 %) | 943 m (+9 %) | 771 m (-11 %) |
| chamonix-trail-5 | trail | 9.9 | 751 m | 711 m (-5 %) | 774 m (+3 %) | 617 m (-18 %) |
| chamonix-trail-10 | trail | 15.0 | 1347 m | 1230 m (-9 %) | 1366 m (+1 %) | 1103 m (-18 %) |

## Best 15 methods (of 85)

| Step | Smoothing window | Threshold | Mean abs error | Max abs error | paris-seine-10 | paris-montmartre-10 | paris-west-20 | chevreuse-road-20 | chevreuse-trail-10 | chevreuse-trail-20 | chamonix-mixed-10 | chamonix-trail-5 | chamonix-trail-10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 30 m | 120 m (5 pts) | 5 m | 13.1 % | 22.4 % | -12 % | +12 % | +22 % | -9 % | -10 % | -6 % | -11 % | -18 % | -18 % |
| 20 m | 120 m (7 pts) | 5 m | 14.0 % | 41.4 % | -3 % | +17 % | +41 % | -9 % | -8 % | -2 % | -11 % | -17 % | -18 % |
| 50 m | 120 m (3 pts) | 5 m | 14.0 % | 25.7 % | -26 % | +9 % | +20 % | -14 % | -8 % | -3 % | -11 % | -17 % | -19 % |
| 10 m | 120 m (13 pts) | 5 m | 14.4 % | 39.4 % | -4 % | +21 % | +39 % | -10 % | -7 % | -4 % | -10 % | -16 % | -18 % |
| 30 m | 200 m (7 pts) | 3 m | 15.0 % | 22.5 % | -21 % | +17 % | +22 % | -15 % | -7 % | -3 % | -11 % | -19 % | -20 % |
| 20 m | 200 m (11 pts) | 3 m | 15.1 % | 25.9 % | -26 % | +11 % | +20 % | -14 % | -8 % | -6 % | -12 % | -19 % | -20 % |
| 90 m | 200 m (3 pts) | 3 m | 15.8 % | 32.3 % | -32 % | +14 % | +6 % | -18 % | -8 % | -10 % | -12 % | -20 % | -22 % |
| 10 m | 200 m (21 pts) | 2 m | 15.9 % | 43.4 % | -16 % | +18 % | +43 % | -9 % | -7 % | -0 % | -11 % | -18 % | -20 % |
| 30 m | 120 m (5 pts) | 3 m | 16.0 % | 59.3 % | +2 % | +28 % | +59 % | +2 % | -5 % | +4 % | -10 % | -16 % | -18 % |
| 20 m | 200 m (11 pts) | 2 m | 16.1 % | 38.6 % | -14 % | +22 % | +39 % | -12 % | -7 % | -2 % | -11 % | -18 % | -20 % |
| 30 m | 200 m (7 pts) | 2 m | 16.1 % | 42.7 % | -16 % | +25 % | +43 % | -7 % | -6 % | +0 % | -10 % | -18 % | -20 % |
| 10 m | 200 m (21 pts) | 3 m | 16.1 % | 23.1 % | -23 % | +18 % | +23 % | -17 % | -8 % | -6 % | -12 % | -18 % | -21 % |
| 50 m | 200 m (5 pts) | 2 m | 16.1 % | 28.6 % | -18 % | +21 % | +29 % | -14 % | -8 % | -4 % | -12 % | -18 % | -21 % |
| 20 m | 200 m (11 pts) | 5 m | 16.3 % | 37.9 % | -38 % | -1 % | +7 % | -26 % | -10 % | -11 % | -13 % | -19 % | -22 % |
| 30 m | 200 m (7 pts) | 5 m | 16.4 % | 40.4 % | -40 % | +2 % | +10 % | -23 % | -9 % | -12 % | -12 % | -18 % | -21 % |

## Best 10 methods outside the dense city (Lyon tracks excluded from the ranking)

| Step | Smoothing window | Threshold | Mean abs error outside city | paris-seine-10 | paris-montmartre-10 | paris-west-20 | chevreuse-road-20 | chevreuse-trail-10 | chevreuse-trail-20 | chamonix-mixed-10 | chamonix-trail-5 | chamonix-trail-10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 30 m | none | 5 m | 6.6 % | +80 % | +145 % | +227 % | +9 % | +2 % | +14 % | -0 % | -8 % | -6 % |
| 10 m | 60 m (7 pts) | 5 m | 7.8 % | +36 % | +77 % | +108 % | +7 % | -4 % | +2 % | -6 % | -12 % | -15 % |
| 20 m | 60 m (3 pts) | 5 m | 8.1 % | +41 % | +84 % | +124 % | +1 % | -6 % | +6 % | -8 % | -13 % | -14 % |
| 50 m | 120 m (3 pts) | 3 m | 8.8 % | +16 % | +37 % | +69 % | -1 % | -4 % | +6 % | -9 % | -16 % | -17 % |
| 20 m | 120 m (7 pts) | 3 m | 8.8 % | +18 % | +35 % | +64 % | -3 % | -6 % | +1 % | -10 % | -16 % | -17 % |
| 10 m | 120 m (13 pts) | 3 m | 8.8 % | +17 % | +46 % | +74 % | +2 % | -5 % | +6 % | -8 % | -15 % | -17 % |
| 30 m | 120 m (5 pts) | 3 m | 9.1 % | +2 % | +28 % | +59 % | +2 % | -5 % | +4 % | -10 % | -16 % | -18 % |
| 50 m | 200 m (5 pts) | 0 m | 9.2 % | +7 % | +50 % | +61 % | -2 % | -1 % | +2 % | -10 % | -18 % | -21 % |
| 10 m | 200 m (21 pts) | 1 m | 9.2 % | -1 % | +44 % | +52 % | -3 % | -3 % | +2 % | -10 % | -17 % | -19 % |
| 30 m | 200 m (7 pts) | 1 m | 9.2 % | +1 % | +43 % | +56 % | -3 % | -3 % | +2 % | -10 % | -17 % | -19 % |

## Reference sensitivity (RGE ALTI every 5 m, D+ in m)

| Track | Raw | 25 m smoothing (used) | 55 m smoothing | 1 m threshold | 2 m threshold |
|---|---|---|---|---|---|
| paris-seine-10 | 138 | 91 | 77 | 82 | 55 |
| paris-montmartre-10 | 65 | 43 | 38 | 29 | 21 |
| paris-west-20 | 205 | 143 | 125 | 125 | 104 |
| chevreuse-road-20 | 277 | 227 | 216 | 206 | 195 |
| chevreuse-trail-10 | 318 | 255 | 238 | 252 | 233 |
| chevreuse-trail-20 | 581 | 450 | 427 | 424 | 396 |
| chamonix-mixed-10 | 1036 | 863 | 825 | 931 | 882 |
| chamonix-trail-5 | 969 | 751 | 702 | 865 | 771 |
| chamonix-trail-10 | 1889 | 1347 | 1221 | 1692 | 1461 |

## Best method per step

| Step | Smoothing | Threshold | Mean abs error | Max abs error |
|---|---|---|---|---|
| 10 m | 120 m | 5 m | 14.4 % | 39.4 % |
| 20 m | 120 m | 5 m | 14.0 % | 41.4 % |
| 30 m | 120 m | 5 m | 13.1 % | 22.4 % |
| 50 m | 120 m | 5 m | 14.0 % | 25.7 % |
| 90 m | 200 m | 3 m | 15.8 % | 32.3 % |

## Lookup time per route (geotiff.js, window read + bilinear)

| Step | Median points | Median cold (ms) | Max cold (ms) | Median warm (ms) |
|---|---|---|---|---|
| 10 m | 1348 | 55 | 109 | 57 |
| 20 m | 675 | 52 | 108 | 55 |
| 30 m | 450 | 54 | 116 | 56 |
| 50 m | 271 | 54 | 107 | 56 |
| 90 m | 151 | 51 | 101 | 55 |
