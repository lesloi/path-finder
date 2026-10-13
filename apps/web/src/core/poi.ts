import { POI_TILE_ZOOM } from '../contract/index.ts';
import type { Position } from './coordinates.ts';

/** The kinds of points of interest the map can show. */
export type PoiCategory = 'water' | 'viewpoint';

/** The categories in the order the layers popover lists them. */
export const POI_CATEGORIES: PoiCategory[] = ['water', 'viewpoint'];

/** What the map shows of the points of interest: each category, and whether seasonal water points are among them. */
export type PoiLayers = Record<PoiCategory | 'seasonal', boolean>;

/** The keys of the layers, in the order the popover lists them. */
export const POI_LAYER_KEYS: (keyof PoiLayers)[] = [...POI_CATEGORIES, 'seasonal'];

/** Water points are shown, seasonal ones too, until the user hides them; viewpoints once the user shows them. */
export const DEFAULT_POI_LAYERS: PoiLayers = { water: true, viewpoint: false, seasonal: true };

/** From this zoom, the map shows points of interest and asks for their tiles; a lower view would span too many. */
export const POI_MIN_ZOOM = 13;

/** A point of interest as the map draws it. */
export type Poi = { category: PoiCategory; position: Position; seasonal: boolean };

/** The categories that are on. */
export const shownPoiCategories = (layers: PoiLayers): PoiCategory[] =>
  POI_CATEGORIES.filter((category) => layers[category]);

const GRID = 2 ** POI_TILE_ZOOM;
const clamp = (index: number) => Math.max(0, Math.min(GRID - 1, Math.floor(index)));

const column = (lon: number) => clamp(((lon + 180) / 360) * GRID);
const row = (lat: number) => {
  const radians = (lat * Math.PI) / 180;
  return clamp(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * GRID);
};

/** The tile of the server's grid that holds a position: the same cut as its `POITileOf`. */
export const poiTileOf = ([lon, lat]: Position): [number, number] => [column(lon), row(lat)];

/** The tiles that cover a view, given as west, south, east and north, row by row from the north. */
export function poiTilesCovering([west, south, east, north]: [number, number, number, number]): [number, number][] {
  const [x0, y0] = poiTileOf([west, north]);
  const [x1, y1] = poiTileOf([east, south]);
  const tiles: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push([x, y]);
  return tiles;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isCategory = (value: unknown): value is PoiCategory => POI_CATEGORIES.includes(value as PoiCategory);

/** The points of an answer of `GET /api/v1/poi-tiles/{x}/{y}`; what is not a point is left out, and a bad answer holds none. */
export function parsePoiTile(body: unknown): Poi[] {
  if (typeof body !== 'object' || body === null || !('pois' in body) || !Array.isArray(body.pois)) return [];
  const pois: Poi[] = [];
  for (const item of body.pois as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { category, position, seasonal } = item as Record<string, unknown>;
    if (!isCategory(category) || !Array.isArray(position) || position.length !== 2) continue;
    const [lon, lat] = position as unknown[];
    if (!isNumber(lon) || !isNumber(lat)) continue;
    pois.push({ category, position: [lon, lat], seasonal: seasonal === true });
  }
  return pois;
}
