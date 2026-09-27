import type { Activity, Criteria, Position, RoutingEngine } from '../route-generation/index.ts';

/** Milliseconds before a BRouter call is dropped. Successful calls took under 2.2 s in the BRouter spike (#1). */
const TIMEOUT = 5_000;
/** BRouter calls at once, as in #1. More would queue up on the server behind the timeout. */
const CONCURRENCY = 4;
/** Hardest SAC hiking scale per activity. 0 or 1 makes BRouter time out in the mountains (#1). */
const SAC_SCALE_LIMIT: Record<Activity, number> = { run: 2, hike: 3 };
/** `path_preference` per surface preference: above 0 favours unpaved paths. */
const PATH_PREFERENCE: Record<Criteria['surface'], number> = { paved: 0, unpaved: 20, any: 0 };

// The part of BRouter's GeoJSON answer we read. `messages` is a table whose first row names the columns.
type Answer = {
  features: [
    {
      geometry: { coordinates: number[][] };
      properties: { 'track-length': string; messages: string[][] };
    },
  ];
};

/**
 * Asks the BRouter server at `baseUrl` (such as `http://localhost:17777`) for loops in
 * round-trip mode, with the `hiking-mountain` profile, `CONCURRENCY` calls at a time. Each
 * call rejects after `TIMEOUT`, or once `signal` aborts.
 */
export function createBRouter(baseUrl: string): RoutingEngine {
  let running = 0;
  const waiting: (() => void)[] = [];

  return async ({ start, radius, heading, activity, surface }, signal) => {
    if (running < CONCURRENCY) running++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      const params = new URLSearchParams({
        lonlats: start.join(','),
        profile: 'hiking-mountain',
        engineMode: '4',
        roundTripDistance: String(Math.round(radius)),
        direction: String(heading),
        format: 'geojson',
        'profile:SAC_scale_limit': String(SAC_SCALE_LIMIT[activity]),
        'profile:path_preference': String(PATH_PREFERENCE[surface]),
      });
      const response = await fetch(`${baseUrl}/brouter?${params}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]),
      });
      if (!response.ok) throw new Error(`BRouter answered ${response.status}`);
      const [{ geometry, properties }] = ((await response.json()) as Answer).features;
      const [columns, ...rows] = properties.messages;
      const distance = columns.indexOf('Distance');
      const wayTags = columns.indexOf('WayTags');
      return {
        // Coordinates also carry BRouter's elevation, which is not used (#30).
        geometry: geometry.coordinates.map(([lon, lat]): Position => [lon, lat]),
        distance: Number(properties['track-length']) / 1000,
        ways: rows.map((row) => {
          const tags = Object.fromEntries(row[wayTags].split(' ').map((tag) => tag.split('=')));
          return { length: Number(row[distance]), surface: tags.surface, highway: tags.highway };
        }),
      };
    } finally {
      // Hand the slot over to the next waiting call, if any.
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
