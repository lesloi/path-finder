# Elevation from the IGN terrain model, not from the routing engine

The official BRouter segments embed CGIAR SRTM elevation at about 90 m, which is too noisy
for trustworthy elevation gain. We keep the official segments for routing, so BRouter still
uses SRTM to weight climbs, but route generation resamples every candidate on IGN BD ALTI
25 m (Licence Ouverte), a terrain model of metropolitan France, converted at build time into
tiles the API reads locally. That resampled profile is the only source for the elevation
profile, the displayed elevation gain, and match scoring. A reader may be surprised that the
engine's own elevation is ignored; this is why.

Measured against IGN RGE ALTI in Paris, the Vallée de Chevreuse, and Chamonix (spikes #3
and #14), BD ALTI stays within 8 % of the reference elevation gain; BRouter's SRTM figure is
5–76 % too low.

## Considered Options

- **Copernicus DEM GLO-30** (the first choice): worldwide, but it is a surface model that
  includes buildings, bridges, and forest canopy. It overstated elevation gain by +251 % to
  +442 % in Paris and +48 % to +96 % in the Vallée de Chevreuse, while being accurate in
  Chamonix. No smoothing setting fixes both. Worth revisiting only if coverage extends beyond
  France.
- **IGN RGE ALTI 5 m**: finer, but ~33 GB compressed for metropolitan France against ~3 GB
  for BD ALTI 25 m, for no measurable gain at a 30 m sampling step.
- **Building our own BRouter segments with a better DEM**: consistent everywhere, but a heavy
  data pipeline (OSM extract, DEM, conversion) to run and maintain.
- **Accepting SRTM 90 m**: no work, but elevation gain is the core promise for trail users.
