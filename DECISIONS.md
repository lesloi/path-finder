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
- **A search never waits in a queue.** A loop costs about 11 CPU-seconds, an A→B route a few
  milliseconds, so concurrent searches are capped per kind (chi `Throttle`) and the answer is `429`
  beyond it. A search watches its `context.Context`, so a departed client frees its CPU.
- **The server and the web app share bounds and cases, not code.** `apps/server/contract/contract.json`
  holds the bounds and error codes, and the cases of the tests that both sides run. The server alone
  decides what is valid; the web app checks early to name the wrong field. Two languages, one
  vocabulary, and a test fails on the side left behind.
- **The data is one directory, a volume (`DATA_DIR`).** Fixed file names (`graph.bin`, `hike.alt`,
  `run.alt`) rather than a variable per file, written atomically by the build commands, so a pod only
  needs a volume mounted read-only; a rebuild is a restart.

## Routing

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
