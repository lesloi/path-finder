# BRouter loop spike: results (PROTOTYPE, issue #1)

BRouter 1.7.10, stock `hiking-mountain` profile with overrides, 20 headings per request, 4 concurrent requests, radius = target / 5.0. Peak server RSS: **1142 MB** (-Xmx2g).

| Start | Config | Target | OK/fail | Median km | ±10% | ±20% | Median retrace | Retrace ≤15% | Mean overlap | Distinct (<50% overlap) | Median unpaved | p50 / max latency (s) | Wall for 20 (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| urban (Lyon Bellecour) | run/paved | 5 km | 20/0 | 5.5 | 10 | 16 | 0.14 | 13 | 0.25 | 10 | 0.04 | 0.44 / 1.00 | 2.7 |
| urban (Lyon Bellecour) | run/paved | 10 km | 20/0 | 10.8 | 12 | 13 | 0.11 | 15 | 0.19 | 14 | 0.03 | 0.42 / 0.48 | 2.2 |
| urban (Lyon Bellecour) | run/paved | 20 km | 20/0 | 19.8 | 20 | 20 | 0.07 | 18 | 0.19 | 15 | 0.03 | 0.54 / 0.86 | 2.8 |
| urban (Lyon Bellecour) | run/unpaved | 5 km | 20/0 | 5.9 | 6 | 12 | 0.11 | 14 | 0.27 | 8 | 0.16 | 0.42 / 0.61 | 2.2 |
| urban (Lyon Bellecour) | run/unpaved | 10 km | 20/0 | 11.5 | 6 | 12 | 0.14 | 10 | 0.23 | 11 | 0.10 | 0.63 / 0.69 | 3.2 |
| urban (Lyon Bellecour) | run/unpaved | 20 km | 20/0 | 22.2 | 9 | 16 | 0.11 | 14 | 0.24 | 10 | 0.19 | 0.95 / 1.21 | 5.0 |
| urban (Lyon Bellecour) | hike/paved | 5 km | 20/0 | 5.5 | 10 | 16 | 0.14 | 13 | 0.25 | 10 | 0.04 | 0.33 / 0.57 | 1.8 |
| urban (Lyon Bellecour) | hike/paved | 10 km | 20/0 | 10.8 | 12 | 13 | 0.11 | 15 | 0.19 | 14 | 0.03 | 0.40 / 0.45 | 2.0 |
| urban (Lyon Bellecour) | hike/paved | 20 km | 20/0 | 19.8 | 20 | 20 | 0.07 | 18 | 0.19 | 15 | 0.03 | 0.50 / 0.77 | 2.7 |
| urban (Lyon Bellecour) | hike/unpaved | 5 km | 20/0 | 5.9 | 6 | 12 | 0.11 | 14 | 0.27 | 8 | 0.16 | 0.41 / 0.62 | 2.2 |
| urban (Lyon Bellecour) | hike/unpaved | 10 km | 20/0 | 11.5 | 6 | 12 | 0.14 | 10 | 0.23 | 11 | 0.10 | 0.62 / 0.73 | 3.2 |
| urban (Lyon Bellecour) | hike/unpaved | 20 km | 20/0 | 22.2 | 9 | 16 | 0.11 | 14 | 0.24 | 10 | 0.19 | 0.98 / 1.30 | 5.2 |
| peri-urban (Chaponost) | run/paved | 5 km | 20/0 | 5.9 | 2 | 11 | 0.14 | 11 | 0.27 | 9 | 0.15 | 0.03 / 0.07 | 0.2 |
| peri-urban (Chaponost) | run/paved | 10 km | 20/0 | 12.3 | 0 | 7 | 0.24 | 4 | 0.24 | 10 | 0.27 | 0.06 / 0.09 | 0.3 |
| peri-urban (Chaponost) | run/paved | 20 km | 20/0 | 22.2 | 8 | 18 | 0.10 | 17 | 0.21 | 13 | 0.27 | 0.12 / 0.18 | 0.6 |
| peri-urban (Chaponost) | run/unpaved | 5 km | 20/0 | 6.3 | 1 | 3 | 0.23 | 6 | 0.31 | 9 | 0.33 | 0.05 / 0.08 | 0.3 |
| peri-urban (Chaponost) | run/unpaved | 10 km | 20/0 | 13.2 | 1 | 1 | 0.27 | 4 | 0.30 | 7 | 0.42 | 0.08 / 0.12 | 0.4 |
| peri-urban (Chaponost) | run/unpaved | 20 km | 20/0 | 25.2 | 0 | 6 | 0.15 | 10 | 0.31 | 7 | 0.49 | 0.19 / 0.38 | 1.1 |
| peri-urban (Chaponost) | hike/paved | 5 km | 20/0 | 5.9 | 2 | 11 | 0.14 | 11 | 0.27 | 9 | 0.15 | 0.04 / 0.07 | 0.2 |
| peri-urban (Chaponost) | hike/paved | 10 km | 20/0 | 12.3 | 0 | 7 | 0.24 | 4 | 0.24 | 10 | 0.27 | 0.06 / 0.08 | 0.3 |
| peri-urban (Chaponost) | hike/paved | 20 km | 20/0 | 22.2 | 8 | 18 | 0.10 | 17 | 0.21 | 13 | 0.27 | 0.11 / 0.18 | 0.6 |
| peri-urban (Chaponost) | hike/unpaved | 5 km | 20/0 | 6.3 | 1 | 3 | 0.23 | 6 | 0.31 | 9 | 0.33 | 0.05 / 0.08 | 0.3 |
| peri-urban (Chaponost) | hike/unpaved | 10 km | 20/0 | 13.2 | 1 | 1 | 0.27 | 4 | 0.30 | 7 | 0.42 | 0.07 / 0.13 | 0.4 |
| peri-urban (Chaponost) | hike/unpaved | 20 km | 20/0 | 25.2 | 0 | 6 | 0.15 | 10 | 0.31 | 7 | 0.49 | 0.18 / 0.38 | 1.1 |
| mountain (Chamonix) | run/paved | 5 km | 9/11 | 5.7 | 3 | 6 | 0.47 | 0 | 0.39 | 5 | 0.10 | 30.03 / 30.03 | 90.3 |
| mountain (Chamonix) | run/paved | 10 km | 0/20 | – | 0 | 0 | – | 0 | – | 0 | – | 30.03 / 30.03 | 150.1 |
| mountain (Chamonix) | run/paved | 20 km | 0/20 | – | 0 | 0 | – | 0 | – | 0 | – | 15.08 / 30.03 | 90.1 |
| mountain (Chamonix) | run/unpaved | 5 km | 20/0 | 7.8 | 0 | 0 | 0.30 | 2 | 0.30 | 5 | 0.58 | 0.07 / 0.16 | 0.4 |
| mountain (Chamonix) | run/unpaved | 10 km | 20/0 | 19.1 | 0 | 0 | 0.10 | 12 | 0.30 | 7 | 0.90 | 0.09 / 0.13 | 0.5 |
| mountain (Chamonix) | run/unpaved | 20 km | 9/11 | 40.9 | 0 | 0 | 0.48 | 0 | 0.37 | 5 | 0.92 | 0.13 / 30.03 | 30.6 |
| mountain (Chamonix) | hike/paved | 5 km | 11/9 | 5.5 | 5 | 9 | 0.30 | 1 | 0.32 | 6 | 0.19 | 0.11 / 30.03 | 90.1 |
| mountain (Chamonix) | hike/paved | 10 km | 1/19 | 21.3 | 0 | 0 | 0.71 | 0 | – | 1 | 0.81 | 30.03 / 30.03 | 150.1 |
| mountain (Chamonix) | hike/paved | 20 km | 0/20 | – | 0 | 0 | – | 0 | – | 0 | – | 15.09 / 30.03 | 90.1 |
| mountain (Chamonix) | hike/unpaved | 5 km | 20/0 | 7.6 | 0 | 0 | 0.18 | 8 | 0.28 | 8 | 0.65 | 0.06 / 0.13 | 0.4 |
| mountain (Chamonix) | hike/unpaved | 10 km | 20/0 | 18.9 | 0 | 0 | 0.17 | 9 | 0.29 | 7 | 0.88 | 0.09 / 0.10 | 0.4 |
| mountain (Chamonix) | hike/unpaved | 20 km | 16/4 | 32.8 | 0 | 0 | 0.30 | 2 | 0.28 | 7 | 0.95 | 0.11 / 0.13 | 0.6 |
