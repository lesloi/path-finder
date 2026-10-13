import { parsePoiTile, type Poi } from '../core/index.ts';
import { buildIdHeader } from './api.ts';

const loaded = new Map<string, Promise<Poi[]>>();

async function fetchTile(x: number, y: number): Promise<Poi[] | undefined> {
  try {
    const response = await fetch(`/api/v1/poi-tiles/${x}/${y}`, { headers: buildIdHeader() });
    return response.ok ? parsePoiTile(await response.json()) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Asks our own server for a tile of points of interest. Nothing about the user is sent, but the tile says which
 * ~30 km of the map is in view, so the server never logs it. A tile is kept for the session; a failure (offline,
 * a server with no tiles, a stale build) holds none and is asked again next time, since it is not the tile.
 */
export function requestPoiTile(x: number, y: number): Promise<Poi[]> {
  const key = `${x}/${y}`;
  const kept = loaded.get(key);
  if (kept) return kept;
  const request = fetchTile(x, y).then((pois) => {
    if (!pois) loaded.delete(key);
    return pois ?? [];
  });
  loaded.set(key, request);
  return request;
}
