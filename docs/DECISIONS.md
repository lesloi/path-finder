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
  149 s and 2.4 GB of resident memory at its peak on 16 cores (the build in memory needs 11.6 GB), its unit landmarks
  30 s and a 1.5 GB file, and the files are the same byte for byte. The landmarks run one per CPU, eight at
  most (`-workers` lowers it), each holding one distance per node (about 4 bytes, whatever the graph, since its column
  is written in blocks): on a 20.6 M-node graph on 16 cores, 2 workers took 19.8 s and 8 took 9.2 s. It needs about
  13 GB of temporary disk (12.8 GB in the France build, 568 runs), put
  beside the output, never on a memory-backed `/tmp`. Served as one 4.3 GB file, France answers as fast as a zone did and
  with the same routes (the heap stays near 35 MB; the page cache fills). An overseas territory stays a graph of its own in a subdirectory: its
  tiles come in another projection and its extract is far from the others. No routing sits in front of the servers:
  opening a graph costs no memory, since its spatial index is in `graph.bin`, and a start point is answered by the graph
  holding it with the most room. Fixed file names (`graph.bin`, and `foot.alt`, the unit landmarks of walking), written
  atomically, so a server only needs the directory read-only. The components too
  small to hold a loop and the long edges are found by the build and stored in `graph.bin`, with the two parameters in its
  header, so that the first search reads no more of the file than the ones after it (France: 127 ms cold, 0.15 GB at
  most in memory instead of 3.2 GB). Before, a country was cut into zones (`plan-zones`, `build-graph -bbox`) because
  its build did not fit in 2 GB; loops near the edge of a zone could not close beyond it.
- **One graph carries both travel modes, and what a way is open to is a property of each edge.** Foot and bike access, a
  technical bit per mode (foot `sac_scale` T3, bike `mtb:scale` 0–3) and, for a bike, the direction a oneway allows are
  written on every edge, so that walking and cycling never need two graphs; the build also stores, per mode, the
  components too small to hold a loop and the nodes that have an edge of the mode, so that snapping, control points,
  lifting and the terrain heading never land where the mode cannot go, and a bike-only connector does not make a foot
  island look large. The avoided areas and the long-way list follow the same access. Walking keeps its rules:
  `access=no/private` closes a way unless a `foot` tag opens it, `foot=no/private` excludes, a trunk road needs a foot
  tag, a cycleway with a `foot` tag follows it, and a `sac_scale` of T4 and up leaves walking alone. A bike cannot use a
  `motorroad`, nor a `trunk` road or a way whose `bicycle`/`access` tag closes it, without an explicit
  `bicycle=yes/designated/permissive`; a footway, stair or pedestrian way needs such a tag (a `bicycle=dismount` opens
  those, not a way an access tag or a motorroad closes); a `mtb:scale` of 4 and up is no bike way. `oneway` is stored but not enforced: enforcing it
  would change the stored components and node bitmaps, and the format already carries the direction for that later
  change (#381). The format moved to `PFGRAPH9`, and a graph of an older one is refused.
- **Landmark distances use unit costs, one file per mode.** A distance is the shortest length, with no climb and no
  surface weight, so it is a lower bound for every surface preference of the mode, and tuning `kind × surface` or the
  climb never invalidates a file. On the bench graph, over five seeds, the unit metric made searches 8–11 % slower
  and kept every match of `any` and `paved`; the first route stayed identical in 91–96 % of the requests, 85–89 % of the
  routes were common, and two of 120 `unpaved` requests lost a match on long road loops. The owner chose no weighted
  fallback: a shared metric cannot keep A*'s exploration order, so a route set may swap one loop for another of the same
  quality. The unit file is 317 MB and 5 s instead of 629 MB and 20 s per profile, one file per mode instead of three. The `.alt` header holds the metric, the mode and the graph fingerprint, and a
  mismatch is refused. `build-alt -mode foot|bike` writes `foot.alt`; `-profile` writes `foot-<profile>.alt` for a
  profile whose own costs are needed (a fallback if the unit metric is too slow on a country), and the server prefers
  that file for that profile.
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
- **The engine is our own A\* with landmark lower bounds (ALT)** on a graph of OSM ways open to walking and
  cycling, not BRouter. ALT made routes about 25 times faster, and a search only allocates in proportion to the
  nodes it reaches. The landmarks' distances are a lower bound for every profile of the mode (unit costs), so the
  bound stays valid whatever the surface or the climb.
- **One routing profile per surface preference, and one climb cost for all.** The user sets a length, a
  surface preference and an elevation gain; there is no activity to route for. The target elevation gain
  steers the climb, so the climb cost does not change with the preference, and a preference only reweights
  way kinds and surfaces. `paved` makes paved ways cheaper and rough or usually unpaved ones dearer, and
  `unpaved` the reverse, since the way kinds of `any` already lean towards paths and would drown a surface
  weight alone. Every multiplier stays at least 1, so that the search heuristic stays admissible.
  Revisit if the comparison with a reference (#131) shows that runners and walkers need different costs on the
  same surface. Runners and walkers share them: the owner decided against splitting the costs by activity, and the
  comparison with reference routes (#378) found no surface table to change. The profile is a surface preference within a
  travel mode: `paved` and `unpaved` key road cycling and gravel/MTB riding too (#380).
- **Alpine ways (`sac_scale` T4 and up) are left out of walking; T3 stays in and is only flagged.** A surface
  preference stays a weight, and there is no criterion to exclude anything: ways asking for more than hands, ropes or
  chains have no place in a generator of running and hiking routes, and are dropped when the graph is built. T3 ways
  are kept, and flagged so that a route holding one carries a badge, because the mountain massifs cannot be crossed
  without them. An earlier switch to allow them, off by default, was removed: it hid every mountain route behind a
  setting, and the badge tells what a route holds. A bike may still use a T4 path: its own gates are `bicycle`,
  `motorroad` and `mtb:scale`.
- **Loops go through 2–4 control points on a circle through the start point**, each leg avoiding what the
  earlier ones used, resized up to four times, then ranked on distance, overlap and elevation gain.
  A resizing also moves each point to the highest or lowest node around it when the gain is off the target
  by more than a match allows, and a loop stops being resized only when its distance and gain are both in
  range: a circle alone left a high gain to chance, and a set of five matches came up for 29 % of the
  requests at +1000 m. A point may snap as far as 0.3 times the circle's radius (400 m at least), since
  on a long loop in a valley most of the circle falls where no way is mapped within 400 m. A circle with a
  point beyond that reach is turned by the golden angle, up to eight times, and no point is placed on a
  component of fewer than 1,000 nodes, which no leg reaches from the rest of the graph. The snap takes the nearest
  node in the reach that is neither on such a component nor in an avoided area; the circle is turned only when none is
  that near.
  For an explicit target gain, the circle is first aimed at the highest ground within reach (the mean elevation of
  one of 16 sectors around the start), and stays random when no sector is 10 m above the start. Half the circles keep
  a random direction, so a sector that kills its loops cannot empty a set.
  With waypoints, the circle's points are only detours: each goes into the leg between two
  fixed points that it is nearest to, and only the detour is resized. The loop straight through
  the waypoints is a candidate too, and it is offered even when it is beyond the target, as a suggestion: a summit
  with a single access is where the loop goes back over its steps, farther than the target says, and nothing resizes a
  route the waypoints fix. It is not ranked down for retracing (the other loops are, and stay so), and the
  ranking keeps a place for it, which matches would otherwise fill. On a distance target with no flat or hilly
  shortcut, it is offered alone as soon as the shortest loop through the waypoints is beyond the match bound, which
  the engine measures by routing them again with no climb penalty: every loop through them is at least that long, so
  none can match, and searching them would only cost CPU. Beyond the target by more than a wide
  suggestion, it is offered alone in every case, as no loop through the waypoints is nearer. Only waypoints that make a route longer than the
  longest a request may ask for are refused, by the straight lines first and by the loop through them then. A waypoint is
  moved to the nearest way within 250 m, beyond which the criteria are refused, naming the waypoint by its number.
- **When the circles miss a numeric gain, a summit source adds up to three loops through the high ground.** The
  circles cannot chain more than 2–4 climbs, so from a low-relief start they top out well under a target a hilly trace
  meets. The source takes up to 9 anchors, chosen from the highest usable node of each cell of a grid of 12 sectors and
  2 rings around the start, within a quarter of the target length and 8 km; it routes the cheapest leg between every
  pair, and a beam closes a tour back to the start on the length and the gain. It runs only for a plain
  length-and-gain request (no waypoints, no duration target), after the circles, including when their search stopped
  early on dry loops: the caller's `Enough` says the circles can stop, not that the gain is met. The gate is the gain,
  not the whole request: a circle within the gain band but off the distance keeps the source off. On the 25 Bosses,
  15.6 km and +500 m now finds a 17.1 km loop at +464 m where the circles topped at about 350 m; on a plateau with
  60 m of relief, 16 km and +500 m stays at about 280 m, and the answer says so. The legs are capped at 60,000 settled
  nodes each, which bounds a bad pair; the closure is the extra work after the circles.
- **A lollipop reaches a cluster farther than a circle's own reach: a stem, a local loop, the stem back.** It runs
  after the summit source, only when no circle or summit loop met the gain, and only on a plain length-and-gain
  request. The hubs are the 4 highest of up to 9 summit anchors within half the target less a minimal local loop (and
  10 km), at least 1.5 km apart; the stem ends at the lowest usable node within 800 m of a hub (mode-checked, small
  components and avoided areas left out), the foot of the cluster, and the local loop there is the circle first, then
  the summit source when the circle misses the local gain. A composed loop longer than the target by more than a tenth,
  or outside the gain band, does not stop the search; the source stops at the first one inside both, and returns at most
  three. The stem's retrace is the shape, so the ranking does not penalise a lollipop's retrace, as it does not for a
  direct loop; the local loop's own retrace is not separated. A lollipop whose local gain is short still fills the set
  as a suggestion, and the closest gain says so. On a synthetic 8 km plain with a cluster 5 km out, the lollipop reaches
  it; on the Yvelines starts near their hills, the summit source already reaches the high ground within a quarter of
  the target, so the lollipop adds little there; it matters beyond that reach. Its local loop aims at the length and
  the gain at once, which the sources sized to the whole request cannot reconcile once the stems take their share: the
  repair step is where the two meet.
- **A loop short of a gain is repaired by a summit detour, inside the match length band.** After the circles, the
  summit source and the lollipop, when no route meets the gain, the engine takes up to 5 candidates whose length is
  inside the band the caller gave (`DistanceBand`, the generator's match share) and whose gain is short, and detours
  up to 3 of them through the highest summits near their path: the path is sampled every 2 km, each summit within
  1.5 km of a sample, 600 m apart, 9 at most; the segment nearest a summit is replaced by the two legs through it,
  both legs avoiding the replaced corridor, and the detour is kept only if the whole path stays inside the length
  band. The lollipop repairs its local paths before composing them, with the local band, never the composed loop,
  whose stem is the shape. The repaired paths are described beside the originals and the generator ranks them; the
  original may still win on the distance, so the repair does not promise a match, only a closer gain in the set. On
  a synthetic square with a 150 m summit 200 m off, a 16 km/0 m loop becomes 16.4 km/+150 m; on a low-relief start,
  the repaired candidate gains about 60 m per summit but the ranking kept the shorter original, and the 25 Bosses
  17.8 km/+512 m is over the band and is not repaired: it stays a suggestion with the closest gain.
- **A route may repeat its loop when the user allows repeats in the settings, and the engine chooses the count.** The
  consent is a lasting permission, not a per-search criterion, so it lives with the pace and the units, and every request
  carries it as a boolean; the cap (10) is the contract's, and the engine's to spend. A request too short to cut into
  laps simply keeps its loop. The engine searches the natural loops first, unchanged; only
  when no returned loop is within the match band
  of a numeric gain, the target is a distance, and the user allows repeats does it search a shorter loop at distance/N and
  gain/N, repeat each loop N times, and rank the repeated routes beside the natural ones. The first N is the target gain
  divided by the highest gain the natural loops made, capped by the contract's maximum and by `minLapDistanceKm` (1.5 km):
  under that, the 400 m snap reach of the loop search's control points dominates and a lap can no longer be aimed at its
  length. The full loop's gain does not predict the lap's: on a low-relief start, a 15 km loop made 270 m
  while a 6 km lap made 87, so the estimate was corrected: after each lap search, the gain the lap actually made gives
  the next count, `N = ceil(target gain / lap gain)`, and the search runs again, up to four lap searches. The count never
  goes down: each lap's gain can only take it up by at least one. When the estimate passes the contract's maximum, the
  maximum is tried once, as its shorter lap can climb more than the one just measured; the walk stops after four lap
  searches, when a lap gains nothing, when the next count would not rise, or when the context ends. It is a heuristic,
  not a search for the best count: a count it steps over can be the one that matches. Each repeat search gets 40 candidates and a 25-loop stop,
  while the natural search keeps its 100 and 60, so a request is bounded at about 260 loop candidates (100 natural, four
  times 40); their wall time includes the summit and repair sources at each lap scale. A 16 km/+500 m request on a
  low-relief start, with its four lap searches, answered in 97 ms on the v9 graph in the dev server; the harness across starts and the
  hardest requests remains the precondition for calling the budget settled. When the last count still misses, the answer
  carries the closest gain; the walk promises no route. A ladder of every count
  was rejected: it costs several times the budget, and the timeout, not the terrain, would pick N. When the natural
  search returns no loop at all, the shortest lap allowed is tried once, as the whole loop may be out of the graph's
  reach where a shorter one is not. A repeat is
  made on
  one loop: the geometry, the surfaces and the technical stretches are repeated (the seam point is not duplicated), the
  totals are multiplied, and the ranking still measures retrace and diversity on the single lap, so the repeated part is
  the shape, not a retrace, and two counts of one loop cover the same ground (only one survives). A loop through
  waypoints is repeated whole, at the count that best fits its length and the maximum, and only as one direct candidate;
  the answers for a direct loop that already overshoots stay as they were. The contract names the shape: `repeats` in the
  criteria (the user's consent), `laps` on a route (absent for a loop run once); the route list, the detail and the GPX name, description and
  file name (`-x5`) carry it. A duration target and a plain length keep the natural loops; the direct loop through
  waypoints is the exception, as the waypoints fix its length.

- **A suggestion ranks the elevation gain three times the distance.** The user who sets a gain cares more about it
  than about a kilometre, and the set was showing the shortest suggestion first with a gain far from the target. The
  weight is 3, the smallest that clears the noise in both measured directions: 306 m at 18.8 km ranks 0.09 ahead of
  263 m at 15.9 km (a weight of 2 left 0.009, inside the retrace and surface noise), while 283 m at 19.9 km stays
  behind 271 m at 16.0 km, because 12 m do not buy 3.9 km; both pairs are pinned by tests. The retrace and surface
  still order genuinely close candidates, a retrace difference of about a tenth reorders, and the weight is for a
  numeric gain only: the flat and hilly shortcut checks keep their weight, a kind of terrain and not a number. The
  tolerances, the match and suggestion meanings, and the closest gain are unchanged; only the order in the set and
  which suggestions fill it move, and a suggestion up to the 25 % distance tolerance can now lead a nearer one. The
  gain counts three times the distance, not always first. The 25 Bosses match (464 m) and its 806 m suggestion
  (512 m) keep their order. The engine's own loop score weights the distance 3 and the gain 2, the opposite; it
  proposes and the generator selects.
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
