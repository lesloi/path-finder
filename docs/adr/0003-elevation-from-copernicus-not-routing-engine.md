# Elevation from Copernicus, not from the routing engine

The official BRouter segments embed CGIAR SRTM elevation at about 90 m, which is too noisy
for trustworthy elevation gain. We keep the official segments for routing, so BRouter still
uses SRTM to weight climbs, but route generation resamples every candidate on Copernicus
DEM GLO-30. That resampled profile is the only source for the elevation profile, the
displayed elevation gain, and match scoring. A reader may be surprised that the engine's
own elevation is ignored; this is why.

## Considered Options

- **Building our own BRouter segments with Copernicus elevation**: consistent everywhere,
  but a heavy data pipeline (OSM extract, DEM, conversion) to run and maintain.
- **Accepting SRTM 90 m**: no work, but elevation gain is the core promise for trail users.
