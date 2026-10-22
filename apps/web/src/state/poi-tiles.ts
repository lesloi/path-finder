import { parsePoiTile, type Poi } from '../core/index.ts';
import { apiVersionHeader } from './api.ts';

/** How long a tile that could not be had is left alone: a server with no tiles, or no network, is not asked at every move. */
export const POI_RETRY_MS = 30_000;

const loaded = new Map<string, Promise<Poi[]>>();
const failedAt = new Map<string, number>();

async function fetchTile(x: number, y: number): Promise<Poi[] | undefined> {
  try {
    const response = await fetch(`/api/v1/poi-tiles/${x}/${y}`, { headers: apiVersionHeader() });
    return response.ok ? parsePoiTile(await response.json()) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Asks our own server for a tile of points of interest. Nothing about the user is sent, but the tile says which
 * ~30 km of the map is in view, so the server never logs it. A tile is kept for the session; a failure (offline,
 * a server with no tiles, a stale build) holds none, and is asked again once `POI_RETRY_MS` has passed.
 */
export function requestPoiTile(x: number, y: number): Promise<Poi[]> {
  const key = `${x}/${y}`;
  const kept = loaded.get(key);
  if (kept) return kept;
  if (Date.now() - (failedAt.get(key) ?? -POI_RETRY_MS) < POI_RETRY_MS) return Promise.resolve([]);
  const request = fetchTile(x, y).then((pois) => {
    loaded.delete(key);
    if (!pois) {
      failedAt.set(key, Date.now());
      return [];
    }
    failedAt.delete(key);
    loaded.set(key, Promise.resolve(pois));
    return pois;
  });
  // While it is on its way, a second ask shares it.
  loaded.set(key, request);
  return request;
}
