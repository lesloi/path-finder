# Decisions

Lasting choices and the reason behind each. They can be questioned: if one no longer holds,
propose another with your arguments, then rewrite the entry. Git keeps the history.

## Product

- **A web app (installable PWA), not a native app.** The flow (criteria, a few routes on a map,
  a GPX export) needs nothing native, and the web avoids store reviews and reaches iOS and desktop.
  Revisit if a store presence ever matters.

## Map

- **The IGN Plan basemap is loaded from the device.** Best French cartography at no cost and no
  operations; IGN sees the IP address and the viewed area, so the privacy policy names it. Fallback:
  self-hosted OSM PMTiles, mostly a style URL change.
- **Points of interest are static tiles** (grid at zoom 10) built from our own OSM extract. A tile
  reveals only a ~30 km area and is cacheable; a `bbox` endpoint or Overpass would reveal exactly what
  the user looks at.

## Backend

- **The graph is built ahead of serving and mapped read-only.** The server only reads it, so it holds
  no copy of the graph in its own memory and the operating system's page cache is the only cache.
- **A search never waits in a queue; the web app asks again.** Concurrent searches are capped (chi
  `Throttle`) and the answer beyond it is `429` with `Retry-After: 1`. A waiting request would hold a
  connection the proxy or the client may drop, in the memory of one instance, while a retry lands on
  whichever instance has room. A set is short, so a slot frees within a second: the web app retries twice,
  spread at random, and the user rarely sees the refusal. A search watches its `context.Context`, so a
  departed client frees its CPU.
- **The server and the web app share bounds and cases, not code.** `apps/server/contract/contract.json`
  holds the bounds and error codes, and the cases of the tests that both sides run. The server alone
  decides what is valid; the web app checks early to name the wrong field. Two languages, one
  vocabulary, and a test fails on the side left behind.
- **The graph is built by zone, and every server maps all the zones (`DATA_DIR`).** A country's build keeps
  every candidate node and its whole output in memory, which does not fit in 2 GB; a zone does
  (`build-graph -bbox`, one pass over the country's extract). No routing sits in front of the servers:
  opening a zone costs no memory, since its spatial index is in `graph.bin`, and a start point is answered by
  the zone holding it with the most room. Fixed file names (`graph.bin`, and `any.alt`, `paved.alt`, `unpaved.alt`, one landmark file per surface
  preference), written atomically, so a server only needs the
  directory read-only. Revisit if a country's graph builds in one go: zones would
  then only cost borders.
- **A rebuild is served without a restart, and a file is replaced by renaming over it, never written
  in place.** A restart drops the searches in flight and closes the port for as long as it takes. The
  files are mapped, so a swap is a new set of mappings: each set counts its searches, and the last one out
  unmaps it, which no search can fault on. A mapping follows the inode, so a file written in place is seen
  half done by the searches in flight, and a shorter one faults them. A reload that fails, such as a graph
  renamed before its landmarks, keeps the zones served.

## Routing

- **Nodes are numbered along a Hilbert curve, and the grid index is stored in the graph file.** A route set
  then touches about 3 MB of the mapped files instead of about 66 MB, which lets a server with 2 GB of memory
  serve a whole country.
- **The engine is our own A\* with landmark lower bounds (ALT)** on a pedestrian graph from OSM, not
  BRouter. ALT made routes about 25 times faster, and a search only allocates in proportion to the
  nodes it reaches. The landmarks' metric includes the climb penalty, so the bound stays valid.
- **One routing profile per surface preference, and one climb cost for all.** The user sets a length, a
  surface preference and an elevation gain; there is no activity to route for. The target elevation gain
  steers the climb, so the climb cost does not change with the preference, and a preference only reweights
  way kinds and surfaces. `paved` makes paved ways cheaper and rough or usually unpaved ones dearer, and
  `unpaved` the reverse, since the way kinds of `any` already lean towards paths and would drown a surface
  weight alone. Every multiplier stays at least 1, so that the search heuristic stays admissible.
  Revisit if the comparison with a reference (#131) shows that runners and walkers need different costs on the
  same surface.
- **Loops go through 2–4 waypoints on a circle through the start point**, each leg avoiding what the
  earlier ones used, resized up to four times, then ranked on distance, overlap and elevation gain.
  Criteria whose waypoints alone exceed the target are refused. A waypoint is moved to the nearest way
  within 250 m, beyond which the criteria are refused.
- **A route set sends what it has when time is up.** Loops are searched in parallel and the search
  stops at five matches or at the timeout; the routes found by then are ranked and sent, and `504` is
  for none at all. Asking for more would only make the user wait longer for what they can already pick.

## Elevation

- **Elevation comes from IGN BD ALTI 25 m, stored on every graph node at build time.** SRTM (about
  90 m) gives an elevation gain 5–76 % too low, BD ALTI stays within 8 % of IGN RGE ALTI. The engine
  weighs climbs with the same values it reports. Revisit if coverage extends beyond France (Copernicus
  DEM overstated gain in cities and forests).
- **A node with no elevation is left out of the graph.** Every route has an elevation gain, so the web
  app has no mode without it; where BD ALTI has no tile there are no routes.

## Naming

- **A route is named after its day**, with the distance and elevation gain
  (`28 sept. · 12,3 km · +340 m`), not after a place. The name only has to tell routes apart in
  a watch vendor's app, and a commune would need a runtime call or a heavy file.
