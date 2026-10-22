import { MAX_GPX_POINTS, simplify } from './gpx.ts';
import { estimatedDuration } from './pace.ts';
import { climbAndDescent, elevationProfile, kmBetween, type Route } from './route.ts';

/** Larger files are not tracks: reading one would freeze the tab. */
export const MAX_IMPORT_FILE_BYTES = 20_000_000;

// By local name, so that GPX 1.0 and 1.1 are both read whatever the namespace.
function elementsNamed(parent: ParentNode, name: string): Element[] {
  return [...parent.querySelectorAll('*')].filter((element) => element.localName === name);
}

function pointsOf(document: Document): [number, number, number?][] | undefined {
  // A planned route is read only when there is no recorded track.
  const tracks = elementsNamed(document, 'trkpt');
  const elements = tracks.length > 0 ? tracks : elementsNamed(document, 'rtept');
  const points: [number, number, number?][] = [];
  for (const element of elements) {
    const [lat, lon] = [Number(element.getAttribute('lat')), Number(element.getAttribute('lon'))];
    if (!element.hasAttribute('lat') || !element.hasAttribute('lon')) return undefined;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
    const ele = elementsNamed(element, 'ele')[0]?.textContent?.trim();
    const height = ele ? Number(ele) : NaN;
    points.push(Number.isFinite(height) ? [lon, lat, height] : [lon, lat]);
  }
  return points.length >= 2 ? points : undefined;
}

const MAX_NAME = 100;

const clean = (text: string | null | undefined, max: number) =>
  text?.replace(/\s+/g, ' ').trim().slice(0, max) || undefined;

// What the file calls itself: its track, its planned route, then its own metadata, else the name of the file.
function describe(document: Document, fileName?: string): NonNullable<Route['imported']> {
  const owners = ['trk', 'rte', 'metadata'].flatMap((tag) => elementsNamed(document, tag).slice(0, 1));
  const named = owners
    .map((owner) => elementsNamed(owner, 'name').find((e) => e.parentElement === owner))
    .find(Boolean);
  const name = clean(named?.textContent, MAX_NAME) ?? clean(fileName?.replace(/\.gpx$/i, ''), MAX_NAME);
  return name ? { name } : {};
}

/**
 * The route in a GPX file the user loaded, read on the device, or undefined when the file is not a GPX with at least
 * two points. The heights are kept only when every point has one: a track with some missing would draw a profile
 * that is made up. Surfaces and technical stretches are not known, and the elevation is never asked of the server.
 */
export function importGpx(text: string, pace: number, fileName?: string): Route | undefined {
  if (text.length > MAX_IMPORT_FILE_BYTES) return undefined;
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'gpx') return undefined;
  const points = pointsOf(document);
  if (!points) return undefined;

  const withHeights = points.every((point) => point.length === 3);
  const flat = withHeights ? points : points.map(([lon, lat]): [number, number] => [lon, lat]);
  // Measured on every point, then simplified for what is drawn: a recording holds tens of thousands.
  let distance = 0;
  for (let k = 1; k < flat.length; k++) distance += kmBetween(flat[k - 1]! as number[], flat[k]! as number[]);
  const geometry = simplify(flat, MAX_GPX_POINTS) as Route['geometry'];

  const profile = withHeights ? elevationProfile(geometry) : undefined;
  const { climb, descent } = profile ? climbAndDescent(profile) : {};
  const route: Route = {
    geometry,
    distance,
    ...(climb !== undefined && { elevationGain: climb, elevationLoss: descent! }),
    estimatedDuration: 0,
    kind: 'match',
    unpavedShare: 0,
    surfaces: [],
    technical: false,
    technicalStretches: [],
    imported: describe(document, fileName),
  };
  route.estimatedDuration = estimatedDuration(route, pace);
  return route;
}
