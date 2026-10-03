# go-router proof of concept

Throwaway PoC: can one Go binary replace BRouter and the TypeScript route generation? It builds a
pedestrian graph from OSM PBF files and BD ALTI 25 m tiles (elevation stored on every node), routes
with A\*, and generates round trips with a target distance and ascent.

Build with `CGO_ENABLED=0` (the PBF reader needs zlib headers otherwise).

```bash
go build -o gor .

# Build once, ahead of serving (about 14 s and 3 GB of RAM for Auvergne-Rhône-Alpes).
./gor build-graph -pbf rhone-alpes.osm.pbf -pbf auvergne.osm.pbf -dem bdalti-asc/ -out graph.bin
./gor build-alt -graph graph.bin -out graph.alt -landmarks 16 -climb 8

# Use.
./gor route -graph graph.bin -alt graph.alt -from 45.8992,6.1294 -to 45.9237,6.8694
./gor loop -graph graph.bin -alt graph.alt -n 300
./gor table -graph graph.bin -alt graph.alt
./gor bench -graph graph.bin -alt graph.alt -kind loop -clients 4 -seconds 15
./gor cancel -graph graph.bin -alt graph.alt -kind loop -runs 40
```

## Design

- The graph and landmark files are memory-mapped and read-only: the operating system's page
  cache is the only cache. Nodes and edges are packed in 12-byte records.
- A\* with landmark lower bounds (ALT, 16 landmarks, 16-bit distances) that include the climb
  penalty. Search state is a flat open-addressing table, so a query allocates in proportion to the
  nodes it reaches, not to the size of the graph.
- Loops: waypoints on a circle through the start, joined leg by leg, each leg avoiding what the
  earlier ones used. A leg is capped at 300,000 settled nodes.
- Cancellation: a search reads its `context.Context` every 1,024 settled nodes, at the start of
  each search, and before growing its table. Searchers are pooled so tables stay grown.

## Not covered

Bikes, surfaces beyond three groups, `sac_scale`, barriers, graph compression, an HTTP server,
and comparison with BRouter or drawing routes (they went with the first engine).
