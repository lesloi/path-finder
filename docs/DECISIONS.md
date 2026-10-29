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
- **A stale tab is told to reload by the ID of the build, a hash of its sources.** A random ID changed on every deploy,
  so a fix to the docs, the CI or a label of the server asked everyone to reload for nothing, and emptied the service
  worker's cache. The hash moves only with what the web app is built from, `contract.json` included. A change of the API
  that breaks a tab built before changes the web app too, so it moves the hash. `apiVersion` in `contract.json` is a
  lever, read by no code, for the rest: raising it by hand gives the build a new ID.
- **A country's graph is built in one go, on disk; a server maps one graph per territory (`DATA_DIR`).** The build sorts its
  records on disk and reads them back in order, instead of keeping every node in memory: metropolitan France takes
  185 s and 2.4 GB of resident memory at its peak on 16 cores (the build in memory needs 11.6 GB), its landmarks 158 s and
  0.4 GB of heap (9.9 GB in memory), and the files are the same byte for byte. The landmarks run one per CPU, eight at
  most (`-workers` lowers it), each holding one distance per node (about 4 bytes, whatever the graph, since its column
  is written in blocks): on a 20.6 M-node graph on 16 cores, 2 workers took 19.8 s and 8 took 9.2 s. It needs about
  13 GB of temporary disk, put
  beside the output, never on a memory-backed `/tmp`. Served as one 4.2 GB file, France answers as fast as a zone did and
  with the same routes (the heap stays near 35 MB; the page cache fills). An overseas territory stays a graph of its own in a subdirectory: its
  tiles come in another projection and its extract is far from the others. No routing sits in front of the servers:
  opening a graph costs no memory, since its spatial index is in `graph.bin`, and a start point is answered by the graph
  holding it with the most room. Fixed file names (`graph.bin`, and `any.alt`, `paved.alt`, `unpaved.alt`, one landmark
  file per surface preference), written atomically, so a server only needs the directory read-only. The components too
  small to hold a loop and the long edges are found by the build and stored in `graph.bin`, with the two parameters in its
  header, so that the first search reads no more of the file than the ones after it (France: 127 ms cold, 0.15 GB at
  most in memory instead of 3.2 GB). Before, a country was cut into zones (`plan-zones`, `build-graph -bbox`) because
  its build did not fit in 2 GB; loops near the edge of a zone could not close beyond it.
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
- **Alpine ways (`sac_scale` T4 and up) are left out of the graph; T3 stays in and is only flagged.** A surface
  preference stays a weight, and there is no criterion to exclude anything: ways asking for more than hands, ropes or
  chains have no place in a generator of running and hiking routes, and are dropped when the graph is built. T3 ways
  are kept, and flagged so that a route holding one carries a badge, because the mountain massifs cannot be crossed
  without them. An earlier switch to allow them, off by default, was removed: it hid every mountain route behind a
  setting, and the badge tells what a route holds. The change moved the graph format to `PFGRAPH7`, and a graph of an
  older format is refused.
- **Loops go through 2–4 control points on a circle through the start point**, each leg avoiding what the
  earlier ones used, resized up to four times, then ranked on distance, overlap and elevation gain.
  A resizing also moves each point to the highest or lowest node around it when the gain is off the target
  by more than a match allows, and a loop stops being resized only when its distance and gain are both in
  range: a circle alone left a high gain to chance, and a set of five matches came up for 29 % of the
  requests at +1000 m. A point may snap as far as 0.3 times the circle's radius (400 m at least), since
  on a long loop in a valley most of the circle falls where no way is mapped within 400 m. A circle with a
  point beyond that reach is turned by the golden angle, up to eight times, and no point is placed on a
  component of fewer than 1,000 nodes, which no leg reaches from the rest of the graph.
  For an explicit target gain, the circle is first aimed at the highest ground within reach (the mean elevation of
  one of 16 sectors around the start), and stays random when no sector is 10 m above the start. Half the circles keep
  a random direction, so a sector that kills its loops cannot empty a set.
  With waypoints, the circle's points are only detours: each goes into the leg between two
  fixed points that it is nearest to, and only the detour is resized. The loop straight through
  the waypoints is a candidate too, and it is offered even when it is beyond the target, as a suggestion: a summit
  with a single access is where the loop goes back over its steps, farther than the target says, and nothing resizes a
  route the waypoints fix. It is not ranked down for retracing (the other loops are, and stay so), and the
  ranking keeps a place for it, which matches would otherwise fill. Beyond the target by more than a wide suggestion,
  it is offered alone, as no loop through the waypoints is nearer. Only waypoints that make a route longer than the
  longest a request may ask for are refused, by the straight lines first and by the loop through them then. A waypoint is
  moved to the nearest way within 250 m, beyond which the criteria are refused, naming the waypoint by its number.
- **Avoided areas are circles that forbid the ways they touch, up to three per set of criteria.** A penalty, as the
  loop legs get for the ways of the earlier ones, would not keep a route out of a closed trail, which is what the
  user asks for. A way is forbidden when its straight line between nodes comes within the radius, so a long way
  with both ends outside is caught too; removing ways keeps the landmark bounds valid, and the graph format does
  not change. A start point or waypoint inside an area is refused by the criteria check, and the points the
  engine snaps (start, waypoints, control points) skip the nodes inside, so no candidate dies unseen. Polygons
  and picking one way wait: a way has no stable identifier across graph builds.
- **A route set sends what it has when time is up.** Loops are searched in parallel and the search
  stops at eight matches (seven with the direct loop through the waypoints, which keeps a place), after 60 loops in a row that add no match, or at the timeout; the routes found by
  then are ranked and sent, and `504` is for none at all. Asking for more would only make the user wait
  longer for what they can already pick. The budget is 100 candidates: the production pod has one CPU
  and one search at a time, where a budget of 400 doubled the median time of the hardest criteria (1.8 to
  3.9 s at 40 km, +2000 m) for 0.2 more matches, while 100 with the stop costs no more than 80 without it
  and finds a few more. Raising the budget buys matches at +1000 m only, at the price of the other requests'
  `429`.
- **The duration comes from the slope of each stretch, and a target duration makes the search aim at that effort.**
  The estimated duration of a route is its effort distance times the pace, where the effort distance sums
  each stretch's length weighted by a slope curve (Tobler's hiking function, chosen over Minetti's energy cost because it slows steep
  descents, which Minetti does not when the goal is time) shared by the server and the web app (the elevation cursor needs it
  per stretch), and independent of the pace. A target duration still becomes a distance at the flat `climbPerEffortKm`
  rate (400 m for 1 km), which sizes the first circle of a loop without waypoints; with waypoints, the detour is
  sized from the effort the direct chain lacks. The engine then sizes and ranks loops on their effort distance with
  the same curve, so the loop it aims at is the one the ranking estimates at the target duration. On the benchmark
  graph (4 starts, 2 seeds, one core), a 120 min target at 6 min/km filled 3.75 matches of 5, and a full set for
  75 % of the requests, with the flat distance alone; aiming at the effort filled 5.00 and 100 %, the p90 fell from
  1.05 s to 0.39 s (the median rose from 0.25 to 0.28 s, within the noise of 8 requests), and the loops were
  shorter (17.4 km on average against 19.7). A duration target is an effort, not a length: a loop of the right
  duration can be longer than the distance the `maxDistanceKm` cap derives, which bounds the distance a request
  asks for, as a distance target already accepts the match tolerance. The cost of the search (climb penalty,
  landmarks) is a separate model and does not change. Revisit if a target duration still misses often on the hard
  starts (#324).

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
