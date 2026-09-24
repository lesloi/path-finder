# BD ALTI 25 m elevation gain spike: results (PROTOTYPE, issue #14)

Reference: IGN RGE ALTI every 5 m, 25 m moving average (same as #3). Error = (gain − reference) / max(reference, 100 m).

## Per track (chosen method: 30 m step, no smoothing, 1 m threshold)

| Track | Reference D+ | BD ALTI 25 m | Height bias vs RGE ALTI | Height RMSE |
|---|---|---|---|---|
| paris-seine-10 | 91 m | 80 m (-11 %) | -0.1 m | 0.7 m |
| paris-montmartre-10 | 43 m | 27 m (-16 %) | 0.1 m | 0.2 m |
| paris-west-20 | 143 m | 115 m (-20 %) | 0.1 m | 0.4 m |
| chevreuse-road-20 | 227 m | 201 m (-12 %) | -0.0 m | 0.2 m |
| chevreuse-trail-10 | 255 m | 230 m (-10 %) | -0.0 m | 0.3 m |
| chevreuse-trail-20 | 450 m | 417 m (-7 %) | -0.0 m | 0.5 m |
| chamonix-mixed-10 | 863 m | 844 m (-2 %) | 0.1 m | 0.6 m |
| chamonix-trail-5 | 751 m | 718 m (-4 %) | 0.0 m | 0.7 m |
| chamonix-trail-10 | 1347 m | 1315 m (-2 %) | 0.1 m | 0.9 m |

## All methods (21), sorted by mean abs error

| Step | Smoothing | Threshold | Mean abs | Mean abs outside Paris | Max abs | paris-seine-10 | paris-montmartre-10 | paris-west-20 | chevreuse-road-20 | chevreuse-trail-10 | chevreuse-trail-20 | chamonix-mixed-10 | chamonix-trail-5 | chamonix-trail-10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 25 m | none | 0 m | 2.5 % | 1.0 % | 13.6 % | +14 % | +2 % | +1 % | -1 % | -1 % | +1 % | -1 % | -1 % | +0 % |
| 30 m | none | 0 m | 2.6 % | 2.2 % | 7.6 % | +8 % | +1 % | +2 % | -2 % | -4 % | -1 % | -1 % | -3 % | -2 % |
| 50 m | none | 0 m | 5.9 % | 5.2 % | 10.4 % | -9 % | -3 % | -10 % | -5 % | -6 % | -5 % | -3 % | -3 % | -8 % |
| 10 m | none | 0 m | 7.6 % | 3.6 % | 28.5 % | +28 % | +5 % | +12 % | +2 % | +2 % | +4 % | +3 % | +3 % | +7 % |
| 10 m | none | 1 m | 8.0 % | 5.7 % | 17.6 % | -5 % | -16 % | -18 % | -11 % | -10 % | -8 % | +0 % | -0 % | +5 % |
| 25 m | none | 1 m | 8.9 % | 5.5 % | 22.2 % | -9 % | -16 % | -22 % | -13 % | -8 % | -7 % | -2 % | -3 % | -0 % |
| 30 m | none | 1 m | 9.4 % | 6.3 % | 20.0 % | -11 % | -16 % | -20 % | -12 % | -10 % | -7 % | -2 % | -4 % | -2 % |
| 10 m | 60 m (7 pts) | 0 m | 10.1 % | 8.7 % | 16.7 % | -16 % | -6 % | -17 % | -8 % | -10 % | -7 % | -6 % | -9 % | -12 % |
| 25 m | 60 m (3 pts) | 0 m | 10.9 % | 9.3 % | 18.7 % | -19 % | -6 % | -18 % | -8 % | -11 % | -8 % | -6 % | -10 % | -13 % |
| 50 m | none | 1 m | 12.1 % | 8.0 % | 25.9 % | -19 % | -16 % | -26 % | -12 % | -11 % | -9 % | -4 % | -4 % | -9 % |
| 30 m | 60 m (3 pts) | 0 m | 13.1 % | 10.6 % | 24.7 % | -25 % | -8 % | -22 % | -9 % | -12 % | -9 % | -6 % | -12 % | -14 % |
| 10 m | none | 2 m | 13.4 % | 8.6 % | 30.4 % | -19 % | -20 % | -30 % | -17 % | -16 % | -14 % | -2 % | -3 % | +0 % |
| 25 m | none | 2 m | 15.6 % | 9.4 % | 31.5 % | -30 % | -22 % | -32 % | -19 % | -13 % | -15 % | -3 % | -4 % | -2 % |
| 30 m | none | 2 m | 16.8 % | 10.2 % | 37.6 % | -38 % | -24 % | -29 % | -18 % | -15 % | -14 % | -4 % | -6 % | -5 % |
| 25 m | 60 m (3 pts) | 1 m | 17.8 % | 12.4 % | 36.8 % | -37 % | -19 % | -29 % | -14 % | -15 % | -14 % | -7 % | -11 % | -14 % |
| 10 m | 60 m (7 pts) | 1 m | 18.2 % | 12.5 % | 33.5 % | -33 % | -23 % | -32 % | -14 % | -16 % | -14 % | -7 % | -11 % | -13 % |
| 50 m | none | 2 m | 18.4 % | 10.6 % | 37.6 % | -38 % | -28 % | -36 % | -18 % | -13 % | -14 % | -4 % | -5 % | -9 % |
| 30 m | 60 m (3 pts) | 1 m | 19.2 % | 13.5 % | 37.9 % | -38 % | -20 % | -34 % | -15 % | -17 % | -14 % | -7 % | -13 % | -15 % |
| 25 m | 60 m (3 pts) | 2 m | 22.5 % | 14.9 % | 45.3 % | -45 % | -27 % | -41 % | -17 % | -20 % | -17 % | -8 % | -13 % | -15 % |
| 10 m | 60 m (7 pts) | 2 m | 22.9 % | 15.3 % | 51.1 % | -51 % | -26 % | -37 % | -19 % | -19 % | -19 % | -8 % | -12 % | -15 % |
| 30 m | 60 m (3 pts) | 2 m | 24.5 % | 16.1 % | 52.9 % | -53 % | -30 % | -41 % | -19 % | -21 % | -19 % | -8 % | -14 % | -16 % |

## Lookup time per route (30 m step)

| Track | Points | Cold, tiles read from disk (ms) | Warm, tiles cached (ms) | No cache, one pread per cell (ms) |
|---|---|---|---|---|
| paris-seine-10 | 307 | 0.7 | 0.1 | 1.7 |
| paris-montmartre-10 | 302 | 1.0 | 0.2 | 0.9 |
| paris-west-20 | 615 | 2.8 | 0.2 | 2.2 |
| chevreuse-road-20 | 695 | 0.6 | 0.2 | 2.0 |
| chevreuse-trail-10 | 434 | 1.0 | 0.1 | 1.2 |
| chevreuse-trail-20 | 811 | 1.7 | 0.2 | 2.2 |
| chamonix-mixed-10 | 450 | 1.6 | 0.1 | 1.3 |
| chamonix-trail-5 | 330 | 2.8 | 0.5 | 0.8 |
| chamonix-trail-10 | 502 | 1.0 | 0.1 | 1.2 |
