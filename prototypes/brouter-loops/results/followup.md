# BRouter loop spike: follow-up (PROTOTYPE, issue #1)

Per-candidate radius correction (2 requests per candidate), permissive SAC limit for every surface.
Peak server RSS sampled between requests: **961 MB**.


| Start | Config | Target | OK/fail | Median km | ±10% | ±20% | Median retrace | Retrace ≤15% | Distinct | Median unpaved | p50 / max latency per candidate (s) | Wall for 20 (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| urban (Lyon Bellecour) | run/paved | 5 km | 20/0 | 5.04 | 16 | 20 | 0.08 | 15 | 12 | 0.03 | 0.78 / 1.30 | 4.3 |
| urban (Lyon Bellecour) | run/paved | 10 km | 20/0 | 9.87 | 16 | 20 | 0.11 | 16 | 14 | 0.03 | 0.76 / 0.93 | 4.0 |
| urban (Lyon Bellecour) | run/paved | 20 km | 20/0 | 19.99 | 20 | 20 | 0.09 | 18 | 15 | 0.03 | 1.04 / 1.74 | 5.4 |
| urban (Lyon Bellecour) | run/unpaved | 5 km | 20/0 | 5.09 | 11 | 14 | 0.11 | 12 | 14 | 0.15 | 0.78 / 1.01 | 4.0 |
| urban (Lyon Bellecour) | run/unpaved | 10 km | 20/0 | 9.87 | 16 | 20 | 0.11 | 13 | 15 | 0.11 | 1.16 / 1.27 | 5.8 |
| urban (Lyon Bellecour) | run/unpaved | 20 km | 20/0 | 19.74 | 19 | 20 | 0.07 | 18 | 15 | 0.16 | 1.80 / 2.17 | 9.2 |
| urban (Lyon Bellecour) | hike/paved | 5 km | 20/0 | 5.04 | 16 | 20 | 0.08 | 15 | 12 | 0.03 | 0.61 / 1.09 | 3.3 |
| urban (Lyon Bellecour) | hike/paved | 10 km | 20/0 | 9.87 | 16 | 20 | 0.11 | 16 | 14 | 0.03 | 0.76 / 0.85 | 3.9 |
| urban (Lyon Bellecour) | hike/paved | 20 km | 20/0 | 19.99 | 20 | 20 | 0.09 | 18 | 15 | 0.03 | 0.98 / 1.68 | 5.2 |
| urban (Lyon Bellecour) | hike/unpaved | 5 km | 20/0 | 5.09 | 11 | 14 | 0.11 | 12 | 14 | 0.15 | 0.79 / 1.01 | 4.0 |
| urban (Lyon Bellecour) | hike/unpaved | 10 km | 20/0 | 9.87 | 16 | 20 | 0.11 | 13 | 15 | 0.11 | 1.16 / 1.28 | 5.9 |
| urban (Lyon Bellecour) | hike/unpaved | 20 km | 20/0 | 19.74 | 19 | 20 | 0.07 | 18 | 15 | 0.16 | 1.82 / 2.17 | 9.3 |
| peri-urban (Chaponost) | run/paved | 5 km | 20/0 | 4.83 | 13 | 18 | 0.19 | 7 | 8 | 0.11 | 0.06 / 0.11 | 0.4 |
| peri-urban (Chaponost) | run/paved | 10 km | 20/0 | 9.82 | 11 | 19 | 0.21 | 7 | 12 | 0.21 | 0.10 / 0.14 | 0.6 |
| peri-urban (Chaponost) | run/paved | 20 km | 20/0 | 20.35 | 17 | 20 | 0.07 | 15 | 15 | 0.34 | 0.21 / 0.32 | 1.2 |
| peri-urban (Chaponost) | run/unpaved | 5 km | 20/0 | 5.37 | 11 | 18 | 0.28 | 5 | 7 | 0.25 | 0.08 / 0.11 | 0.4 |
| peri-urban (Chaponost) | run/unpaved | 10 km | 20/0 | 9.80 | 11 | 16 | 0.31 | 3 | 8 | 0.41 | 0.13 / 0.18 | 0.7 |
| peri-urban (Chaponost) | run/unpaved | 20 km | 20/0 | 21.04 | 14 | 19 | 0.16 | 9 | 9 | 0.47 | 0.32 / 0.59 | 1.8 |
| peri-urban (Chaponost) | hike/paved | 5 km | 20/0 | 4.83 | 13 | 18 | 0.19 | 7 | 8 | 0.11 | 0.06 / 0.11 | 0.4 |
| peri-urban (Chaponost) | hike/paved | 10 km | 20/0 | 9.82 | 11 | 19 | 0.21 | 7 | 12 | 0.21 | 0.11 / 0.12 | 0.5 |
| peri-urban (Chaponost) | hike/paved | 20 km | 20/0 | 20.35 | 17 | 20 | 0.07 | 15 | 15 | 0.34 | 0.21 / 0.33 | 1.2 |
| peri-urban (Chaponost) | hike/unpaved | 5 km | 20/0 | 5.37 | 11 | 18 | 0.28 | 5 | 7 | 0.25 | 0.08 / 0.13 | 0.4 |
| peri-urban (Chaponost) | hike/unpaved | 10 km | 20/0 | 9.80 | 11 | 16 | 0.31 | 3 | 8 | 0.41 | 0.12 / 0.18 | 0.7 |
| peri-urban (Chaponost) | hike/unpaved | 20 km | 20/0 | 21.04 | 14 | 19 | 0.16 | 9 | 9 | 0.47 | 0.31 / 0.61 | 1.9 |
| mountain (Chamonix) | run/paved | 5 km | 20/0 | 4.32 | 4 | 16 | 0.18 | 7 | 9 | 0.36 | 0.09 / 0.13 | 0.5 |
| mountain (Chamonix) | run/paved | 10 km | 20/0 | 8.66 | 8 | 10 | 0.36 | 3 | 11 | 0.60 | 0.13 / 0.15 | 0.7 |
| mountain (Chamonix) | run/paved | 20 km | 9/11 | 18.94 | 3 | 5 | 0.11 | 6 | 5 | 0.81 | 0.19 / 30.03 | 30.8 |
| mountain (Chamonix) | run/unpaved | 5 km | 20/0 | 4.23 | 4 | 11 | 0.18 | 8 | 12 | 0.35 | 0.12 / 0.17 | 0.6 |
| mountain (Chamonix) | run/unpaved | 10 km | 20/0 | 8.46 | 7 | 11 | 0.30 | 4 | 7 | 0.62 | 0.15 / 0.16 | 0.8 |
| mountain (Chamonix) | run/unpaved | 20 km | 9/11 | 19.48 | 3 | 6 | 0.11 | 6 | 4 | 0.87 | 0.22 / 30.03 | 30.9 |
| mountain (Chamonix) | hike/paved | 5 km | 20/0 | 4.24 | 4 | 16 | 0.20 | 6 | 8 | 0.36 | 0.11 / 0.17 | 0.6 |
| mountain (Chamonix) | hike/paved | 10 km | 20/0 | 8.93 | 8 | 11 | 0.36 | 3 | 10 | 0.59 | 0.16 / 0.19 | 0.8 |
| mountain (Chamonix) | hike/paved | 20 km | 16/4 | 20.83 | 8 | 13 | 0.14 | 9 | 8 | 0.86 | 0.22 / 0.25 | 1.1 |
| mountain (Chamonix) | hike/unpaved | 5 km | 20/0 | 4.43 | 8 | 12 | 0.21 | 6 | 12 | 0.37 | 0.13 / 0.16 | 0.7 |
| mountain (Chamonix) | hike/unpaved | 10 km | 20/0 | 9.11 | 9 | 14 | 0.26 | 7 | 7 | 0.68 | 0.16 / 0.18 | 0.8 |
| mountain (Chamonix) | hike/unpaved | 20 km | 16/4 | 21.18 | 8 | 13 | 0.12 | 10 | 8 | 0.90 | 0.22 / 0.27 | 1.1 |
