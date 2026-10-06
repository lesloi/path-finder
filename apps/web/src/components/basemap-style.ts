import type { StyleSpecification } from 'maplibre-gl';

import type { Basemap } from '../core/index.ts';

const GEOPF = 'https://data.geopf.fr';

// The Géoplateforme's raster tiles, at the zoom the vector Plan IGN stops at: MapLibre scales them beyond.
function wmts(layer: string, format: 'image/png' | 'image/jpeg'): StyleSpecification {
  const query =
    `SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&FORMAT=${format}` +
    '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
  return {
    version: 8,
    sources: { basemap: { type: 'raster', tileSize: 256, maxzoom: 18, tiles: [`${GEOPF}/wmts?${query}`] } },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}

/** The MapLibre style of a basemap: a style URL for the vector Plan IGN, a raster style for the others. */
export function basemapStyle(basemap: Basemap): string | StyleSpecification {
  switch (basemap) {
    case 'plan':
      return wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png');
    case 'minimal':
      return `${GEOPF}/annexes/ressources/vectorTiles/styles/PLAN.IGN/epure.json`;
    case 'aerial':
      return wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg');
  }
}
