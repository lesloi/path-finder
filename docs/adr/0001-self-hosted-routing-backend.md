# Self-hosted, stateless routing backend

Generating a route needs OSM road and path data, elevation data, and a routing engine. That
is too heavy for the device, and offline use is not a goal. A third-party routing API would
receive users' precise locations. We run an open-source routing engine ourselves, on
Scaleway in France, shipped as Docker containers, with France as the only coverage area for
now. The backend keeps no state and writes no logs that contain locations. The app only
talks to it through a routing seam, so a third-party EU API can be plugged in behind that seam if we ever need to.

This changes the original "no third-party network calls at runtime" rule. The owner decided
on 2026-09-24 that runtime calls are allowed to services the project operates, and, when
unavoidable, to French or EU providers (or providers in a country with an EU adequacy decision).

## Considered Options

- **Third-party EU API called from the device** (GraphHopper, openrouteservice): fastest
  to ship, but the location leaves our control and we depend on their quotas and log
  policies.
- **Fully on-device routing**: the most private, but the data downloads and engine work are
  out of proportion to the product.
