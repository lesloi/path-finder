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

## Routing

- **Loops through waypoints use BRouter's normal routing**, with one detour point per heading, and
  criteria whose waypoints alone exceed the target are refused. It controls the catching range and
  tells which point failed, which round-trip mode does not. A waypoint is moved to the nearest way
  within 250 m, beyond which the criteria are refused.

## Elevation

- **Elevation comes from IGN BD ALTI 25 m, not from BRouter.** BRouter's SRTM (about 90 m) gives an
  elevation gain 5–76 % too low, BD ALTI stays within 8 % of IGN RGE ALTI. BRouter still uses SRTM to
  weight climbs. Revisit if coverage extends beyond France (Copernicus DEM overstated gain in cities
  and forests).

## Naming

- **A route is named after its activity and day**, with the distance and elevation gain
  (`Course · 28 sept. · 12,3 km · +340 m`), not after a place. The name only has to tell routes apart in
  a watch vendor's app, and a commune would need a runtime call or a heavy file.
