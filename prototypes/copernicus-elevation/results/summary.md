# Copernicus elevation gain spike: results (PROTOTYPE, issue #3)

Reference: IGN RGE ALTI sampled every 5 m, 25 m moving average. Error = (gain − reference) / max(reference, 100 m).

## Per track

| Track | Kind | km | Reference D+ | BRouter SRTM (filtered) | Copernicus raw, 30 m | Best method (30 m, 120 m smoothing, 2 m threshold) |
|---|---|---|---|---|---|---|
| lyon-road-10 | road | 9.8 | 50 m | 4 m (-46 %) | 331 m (+281 %) | 100 m (+50 %) |
| lyon-fourviere-10 | road | 12.7 | 263 m | 212 m (-20 %) | 446 m (+69 %) | 267 m (+1 %) |
| chaponost-road-20 | road | 23.0 | 585 m | 483 m (-17 %) | 622 m (+6 %) | 466 m (-20 %) |
| chaponost-trail-10 | trail | 12.8 | 142 m | 96 m (-32 %) | 173 m (+22 %) | 101 m (-29 %) |
| chamonix-mixed-10 | mixed | 13.5 | 863 m | 816 m (-5 %) | 943 m (+9 %) | 789 m (-9 %) |
| chamonix-trail-5 | trail | 9.9 | 751 m | 711 m (-5 %) | 774 m (+3 %) | 633 m (-16 %) |
| chamonix-trail-10 | trail | 15.0 | 1347 m | 1230 m (-9 %) | 1366 m (+1 %) | 1122 m (-17 %) |
| annecy-trail-20 | trail | 29.5 | 960 m | 847 m (-12 %) | 1121 m (+17 %) | 872 m (-9 %) |

## Best 15 methods (of 85)

| Step | Smoothing window | Threshold | Mean abs error | Max abs error | lyon-road-10 | lyon-fourviere-10 | chaponost-road-20 | chaponost-trail-10 | chamonix-mixed-10 | chamonix-trail-5 | chamonix-trail-10 | annecy-trail-20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 30 m | 120 m (5 pts) | 2 m | 18.8 % | 49.6 % | +50 % | +1 % | -20 % | -29 % | -9 % | -16 % | -17 % | -9 % |
| 50 m | 120 m (3 pts) | 2 m | 18.8 % | 54.9 % | +55 % | +2 % | -20 % | -27 % | -8 % | -15 % | -16 % | -8 % |
| 20 m | 120 m (7 pts) | 5 m | 18.9 % | 42.8 % | +14 % | -11 % | -26 % | -43 % | -11 % | -17 % | -18 % | -12 % |
| 10 m | 120 m (13 pts) | 2 m | 19.1 % | 56.2 % | +56 % | +2 % | -20 % | -28 % | -8 % | -15 % | -16 % | -8 % |
| 30 m | 60 m (3 pts) | 5 m | 19.3 % | 43.7 % | +44 % | -3 % | -24 % | -37 % | -9 % | -14 % | -16 % | -8 % |
| 50 m | 120 m (3 pts) | 3 m | 19.3 % | 47.2 % | +47 % | -2 % | -21 % | -33 % | -9 % | -16 % | -17 % | -9 % |
| 10 m | 120 m (13 pts) | 5 m | 19.4 % | 37.6 % | +29 % | -7 % | -26 % | -38 % | -10 % | -16 % | -18 % | -11 % |
| 30 m | 200 m (7 pts) | 1 m | 19.5 % | 46.9 % | +47 % | -2 % | -20 % | -30 % | -10 % | -17 % | -19 % | -11 % |
| 10 m | 120 m (13 pts) | 3 m | 19.5 % | 47.4 % | +47 % | -4 % | -22 % | -33 % | -8 % | -15 % | -17 % | -10 % |
| 20 m | 120 m (7 pts) | 2 m | 19.5 % | 58.3 % | +58 % | +2 % | -20 % | -28 % | -8 % | -15 % | -16 % | -9 % |
| 10 m | 60 m (7 pts) | 5 m | 19.6 % | 52.4 % | +52 % | -2 % | -23 % | -38 % | -6 % | -12 % | -15 % | -7 % |
| 50 m | 200 m (5 pts) | 1 m | 19.9 % | 40.3 % | +40 % | -5 % | -21 % | -31 % | -11 % | -18 % | -21 % | -12 % |
| 20 m | 120 m (7 pts) | 3 m | 19.9 % | 52.0 % | +52 % | -2 % | -22 % | -32 % | -10 % | -16 % | -17 % | -10 % |
| 90 m | none | 5 m | 20.0 % | 56.0 % | +56 % | +6 % | -21 % | -42 % | -7 % | -11 % | -14 % | -4 % |
| 10 m | 200 m (21 pts) | 1 m | 20.0 % | 48.6 % | +49 % | -3 % | -20 % | -30 % | -10 % | -17 % | -19 % | -11 % |

## Best 10 methods outside the dense city (Lyon tracks excluded from the ranking)

| Step | Smoothing window | Threshold | Mean abs error outside city | lyon-road-10 | lyon-fourviere-10 | chaponost-road-20 | chaponost-trail-10 | chamonix-mixed-10 | chamonix-trail-5 | chamonix-trail-10 | annecy-trail-20 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 30 m | none | 1 m | 3.9 % | +254 % | +58 % | -0 % | +0 % | +7 % | +2 % | +1 % | +13 % |
| 10 m | 60 m (7 pts) | 0 m | 4.4 % | +167 % | +37 % | -4 % | +1 % | +1 % | -6 % | -9 % | +5 % |
| 20 m | 60 m (3 pts) | 0 m | 4.8 % | +190 % | +43 % | -2 % | +5 % | +3 % | -4 % | -8 % | +7 % |
| 50 m | none | 0 m | 5.2 % | +220 % | +51 % | +0 % | +8 % | +6 % | -1 % | -6 % | +10 % |
| 50 m | none | 1 m | 5.4 % | +212 % | +45 % | -4 % | -8 % | +5 % | -2 % | -6 % | +9 % |
| 20 m | none | 1 m | 5.7 % | +282 % | +66 % | +1 % | +2 % | +11 % | +4 % | +3 % | +14 % |
| 90 m | none | 0 m | 6.1 % | +132 % | +28 % | -9 % | -4 % | -1 % | -8 % | -12 % | +3 % |
| 30 m | 60 m (3 pts) | 0 m | 6.2 % | +142 % | +26 % | -8 % | -4 % | -2 % | -9 % | -12 % | +2 % |
| 20 m | 60 m (3 pts) | 1 m | 6.4 % | +154 % | +28 % | -8 % | -11 % | +0 % | -6 % | -9 % | +4 % |
| 20 m | none | 2 m | 6.5 % | +229 % | +41 % | -7 % | -13 % | +7 % | -0 % | -0 % | +10 % |

## Reference sensitivity (RGE ALTI every 5 m, D+ in m)

| Track | Raw | 25 m smoothing (used) | 55 m smoothing | 1 m threshold | 2 m threshold |
|---|---|---|---|---|---|
| lyon-road-10 | 84 | 50 | 41 | 34 | 22 |
| lyon-fourviere-10 | 335 | 263 | 247 | 267 | 240 |
| chaponost-road-20 | 656 | 585 | 564 | 575 | 543 |
| chaponost-trail-10 | 175 | 142 | 136 | 129 | 113 |
| chamonix-mixed-10 | 1036 | 863 | 825 | 931 | 882 |
| chamonix-trail-5 | 969 | 751 | 702 | 865 | 771 |
| chamonix-trail-10 | 1889 | 1347 | 1221 | 1692 | 1461 |
| annecy-trail-20 | 1075 | 960 | 918 | 961 | 916 |

## Best method per step

| Step | Smoothing | Threshold | Mean abs error | Max abs error |
|---|---|---|---|---|
| 10 m | 120 m | 2 m | 19.1 % | 56.2 % |
| 20 m | 120 m | 5 m | 18.9 % | 42.8 % |
| 30 m | 120 m | 2 m | 18.8 % | 49.6 % |
| 50 m | 120 m | 2 m | 18.8 % | 54.9 % |
| 90 m | none | 5 m | 20.0 % | 56.0 % |

## Lookup time per route (geotiff.js, window read + bilinear)

| Step | Median points | Median cold (ms) | Max cold (ms) | Median warm (ms) |
|---|---|---|---|---|
| 10 m | 1348 | 63 | 113 | 56 |
| 20 m | 675 | 56 | 109 | 54 |
| 30 m | 450 | 57 | 103 | 54 |
| 50 m | 271 | 57 | 102 | 52 |
| 90 m | 151 | 53 | 101 | 55 |
