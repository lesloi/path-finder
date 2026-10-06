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
- **The data is a set of zones, each a directory (`DATA_DIR`).** A country's graph does not build in
  2 GB of memory (the build keeps every candidate node and the whole output in memory), so it is built by
  zone from the country's sorted extract in one pass (`build-graph -bbox`), and every server maps all the
  zones. Opening a zone costs no memory, because the spatial index is in `graph.bin`; a start point is answered
  by the zone holding it with the most room, and falls to the next only when the first has no way near it.
  Fixed file names per zone (`graph.bin`, `hike.alt`, `run.alt`), written atomically, so a server only needs
  the directory read-only and a rebuild is a restart; a zone that did not finish building stops the server.
  Landmarks carry the CRC of their graph, so a graph built again refuses the old ones. Revisit if a country's
  graph ever builds in one go: zones would then only cost borders.

## Routing

- **Nodes are numbered along a Hilbert curve, and the grid index is stored in the graph file.** A route set
  then touches about 3 MB of the mapped files instead of about 66 MB, which is what lets a server with 2 GB of
  memory serve a whole country. The file formats carry a version in their magic: change a layout, change
  the magic.
- **The engine is our own A\* with landmark lower bounds (ALT)** on a pedestrian graph from OSM, not
  BRouter. ALT made routes about 25 times faster, and a search only allocates in proportion to the
  nodes it reaches. The landmarks' metric includes the climb penalty, so the bound stays valid.
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

- **A route is named after its activity and day**, with the distance and elevation gain
  (`Course · 28 sept. · 12,3 km · +340 m`), not after a place. The name only has to tell routes apart in
  a watch vendor's app, and a commune would need a runtime call or a heavy file.
