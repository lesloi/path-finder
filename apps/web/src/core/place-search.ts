import { parsePosition, type Position } from './coordinates.ts';

/** The Géoplateforme geocoding service: BAN addresses and BD TOPO places, keyless, from the browser. */
const GEOCODER = 'https://data.geopf.fr/geocodage/search';

/** How many places a search keeps: a start point is one of a handful, and a long list would hide the map. */
export const PLACE_LIMIT = 5;

/** Shorter than this, a prefix matches too much to be a search. */
export const MIN_PLACE_QUERY = 3;

/** A place the geocoder knows, as the start point field offers it: where it is, and what to call it. */
export type Place = { position: Position; label: string; context?: string };

/** The address the geocoding service is asked: the text typed, the indexes, and where the map is looking. */
export function placeQueryUrl(text: string, near?: Position): string {
  const query = new URLSearchParams({
    q: text,
    index: 'address,poi',
    limit: String(PLACE_LIMIT),
    autocomplete: '1',
  });
  if (near) {
    // The service names the latitude first, where a Position holds the longitude first.
    query.set('lat', String(near[1]));
    query.set('lon', String(near[0]));
  }
  return `${GEOCODER}?${query}`;
}

/**
 * Whether `text` is worth sending to the geocoder: long enough, holding a letter, and not a position. A position is
 * read on the device, and a body of digits only is a half-typed one: neither may leave it.
 */
export function isPlaceQuery(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= MIN_PLACE_QUERY && /\p{L}/u.test(trimmed) && parsePosition(trimmed) === undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;
const first = (value: unknown): string | undefined => (Array.isArray(value) ? text(value[0]) : undefined);

// A point, within the bounds of the globe. Anything else is a feature to leave out, not an answer to refuse.
function placePosition(geometry: unknown): Position | undefined {
  if (!isObject(geometry) || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return undefined;
  const [lon, lat] = geometry.coordinates;
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat))
    return undefined;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return undefined;
  return [lon, lat];
}

// An address says where it is in "context"; a place gives arrays of postcode and town instead.
function placeContext(properties: Record<string, unknown>): string | undefined {
  const context = text(properties.context);
  if (context) return context;
  const postcode = first(properties.postcode);
  const city = text(properties.city) ?? first(properties.city);
  const built = [postcode, city].filter(Boolean).join(' ');
  return built === '' ? undefined : built;
}

/**
 * The places of a Géoplateforme answer, or undefined when the body is not one. A feature with no position or no
 * name is left out: the list has no room for a row that would say nothing.
 */
export function parsePlaces(body: unknown): Place[] | undefined {
  if (!isObject(body) || body.type !== 'FeatureCollection' || !Array.isArray(body.features)) return undefined;
  const places: Place[] = [];
  for (const feature of body.features) {
    if (!isObject(feature) || !isObject(feature.properties)) continue;
    const position = placePosition(feature.geometry);
    const { name, toponym, label } = feature.properties;
    const named = text(name) ?? text(toponym) ?? text(label);
    if (!position || !named) continue;
    const context = placeContext(feature.properties);
    places.push({ position, label: named, ...(context !== undefined && { context }) });
  }
  return places;
}

/**
 * The places matching `text`, or undefined when they cannot be asked for: no network, a refusal, an answer that is
 * not one, or a request that was aborted. The caller tells the last apart by the request it replaced, not here.
 */
export async function searchPlaces(
  text: string,
  { signal, near }: { signal?: AbortSignal; near?: Position } = {},
): Promise<Place[] | undefined> {
  try {
    const answer = await fetch(placeQueryUrl(text, near), signal ? { signal } : {});
    if (!answer.ok) return undefined;
    return parsePlaces(await answer.json());
  } catch {
    return undefined;
  }
}
