# IGN basemap loaded directly from the device

The app shows maps with Plan IGN vector tiles, fetched straight from the IGN Géoplateforme
with its public key. This is a deliberate exception to "no third party at runtime": IGN, a
French public body, sees the user's IP address and the map area they view. The owner
accepted this on 2026-09-24 for the best French cartography at no cost and no operations.
The privacy policy must name IGN as a recipient.

Since the app became a web app (ADR 0004), the tiles are fetched from the browser. Pages
are served with `Referrer-Policy: no-referrer`, so IGN does not also receive the URL of
the page the user is on.

## Considered Options

- **Self-hosted OpenStreetMap PMTiles** (Protomaps extract on our object storage): no third
  party, but no relief by default and a monthly regeneration job. It stays the fallback;
  switching is mostly a style URL change in MapLibre.
- **Proxying IGN through our backend**: hides the IP from IGN, but all tile traffic and
  caching land on our server.
