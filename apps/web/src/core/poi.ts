import { POI_TILE_ZOOM } from '../contract/index.ts';
import { commonText, type Language } from '../i18n/index.ts';
import type { Position } from './coordinates.ts';
import { boundsAround } from './route.ts';

/** The kinds of points of interest the map can show. */
export type PoiCategory = 'water' | 'viewpoint' | 'toilets';

/** The categories in the order the layers popover lists them. */
export const POI_CATEGORIES: PoiCategory[] = ['water', 'viewpoint', 'toilets'];

/** What the map shows of the points of interest: each category, and whether seasonal water points are among them. */
export type PoiLayers = Record<PoiCategory | 'seasonal', boolean>;

/** The keys of the layers, in the order the popover lists them. */
export const POI_LAYER_KEYS: (keyof PoiLayers)[] = ['water', 'seasonal', 'viewpoint', 'toilets'];

/** Water points are shown, seasonal ones too, until the user hides them; the other categories once the user shows them. */
export const DEFAULT_POI_LAYERS: PoiLayers = {
  water: true,
  viewpoint: false,
  toilets: false,
  seasonal: true,
};

/** From this zoom, the map shows points of interest and asks for their tiles; a lower view would span too many. */
export const POI_MIN_ZOOM = 11;

/** A point of interest as the map draws it; `name` is the OSM name, when it has one. */
export type Poi = { category: PoiCategory; position: Position; seasonal: boolean; name?: string };

/** What a waypoint keeps of the point of interest it was made from. */
export type WaypointPoi = Pick<Poi, 'category' | 'seasonal' | 'name'>;

/** The points of interest behind waypoints, by the waypoint's position: the server is only ever sent positions. */
export type WaypointPois = Record<string, WaypointPoi>;

export const waypointPoiKey = ([lon, lat]: Position) => `${lon},${lat}`;

/** The point of interest a waypoint was made from; it sits at the very position of the point, so an exact match is right. */
export const waypointPoiAt = (pois: WaypointPois, position: Position): WaypointPoi | undefined =>
  pois[waypointPoiKey(position)];

/** What a point of interest is called: its OSM name, else what it is. */
export function poiLabel({ category, seasonal, name }: WaypointPoi, language: Language): string {
  const words = commonText[language];
  if (name) return name;
  if (category === 'water') return seasonal ? words.seasonalWaterPoint : words.waterPoint;
  return words[category];
}

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

/** The tiles that hold every point of a route and the margin around it, in metres. */
export const poiTilesAround = (geometry: number[][], margin: number): [number, number][] =>
  poiTilesCovering(boundsAround(geometry, margin));

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** Whether a value names a category of points of interest. */
export const isPoiCategory = (value: unknown): value is PoiCategory => POI_CATEGORIES.includes(value as PoiCategory);

/** The points of an answer of `GET /api/v1/poi-tiles/{x}/{y}`; what is not a point is left out, and a bad answer holds none. */
export function parsePoiTile(body: unknown): Poi[] {
  if (typeof body !== 'object' || body === null || !('pois' in body) || !Array.isArray(body.pois)) return [];
  const pois: Poi[] = [];
  for (const item of body.pois as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { category, position, seasonal, name } = item as Record<string, unknown>;
    if (!isPoiCategory(category) || !Array.isArray(position) || position.length !== 2) continue;
    const [lon, lat] = position as unknown[];
    if (!isNumber(lon) || !isNumber(lat)) continue;
    pois.push({
      category,
      position: [lon, lat],
      seasonal: seasonal === true,
      ...(typeof name === 'string' && name && { name }),
    });
  }
  return pois;
}
