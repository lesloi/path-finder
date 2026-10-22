import { MAX_GPX_POINTS, simplify } from './gpx.ts';
import { estimatedDuration } from './pace.ts';
import { climbAndDescent, elevationProfile, kmBetween, type Route } from './route.ts';

/** Larger files are not tracks: reading one would freeze the tab. */
export const MAX_IMPORT_FILE_BYTES = 20_000_000;

// By local name, so that GPX 1.0 and 1.1 are both read whatever the namespace.
const childNamed = (parent: Element, name: string) => [...parent.children].find((child) => child.localName === name);

function pointsOf(document: Document): Route['geometry'] | undefined {
  // A planned route is read only when there is no recorded track.
  let elements = document.getElementsByTagNameNS('*', 'trkpt');
  if (elements.length === 0) elements = document.getElementsByTagNameNS('*', 'rtept');
  const points: number[][] = [];
  let withHeights = true;
  for (const element of elements) {
    if (!element.hasAttribute('lat') || !element.hasAttribute('lon')) return undefined;
    const [lat, lon] = [Number(element.getAttribute('lat')), Number(element.getAttribute('lon'))];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
    const ele = childNamed(element, 'ele')?.textContent?.trim();
    const height = ele ? Number(ele) : NaN;
    if (!Number.isFinite(height)) withHeights = false;
    points.push([lon, lat, height]);
  }
  if (points.length < 2) return undefined;
  // The heights are kept only when every point has one: a track with some missing would draw a profile that is made up.
  return (withHeights ? points : points.map(([lon, lat]) => [lon, lat])) as Route['geometry'];
}

const MAX_NAME = 100;

const clean = (text: string | null | undefined, max: number) =>
  text?.replace(/\s+/g, ' ').trim().slice(0, max) || undefined;

// What the file calls itself: its track, its planned route, then its own metadata, else the name of the file.
function trackName(document: Document, fileName?: string): string | undefined {
  const top = [...document.documentElement.children];
  const named = ['trk', 'rte', 'metadata']
    .map((tag) => top.find(({ localName }) => localName === tag))
    .map((owner) => owner && childNamed(owner, 'name'))
    .find(Boolean);
  return clean(named?.textContent, MAX_NAME) ?? clean(fileName?.replace(/\.gpx$/i, ''), MAX_NAME);
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
  const geometry = pointsOf(document);
  if (!geometry) return undefined;

  // Measured on every point, then simplified for what is drawn: a recording holds tens of thousands.
  let distance = 0;
  for (let k = 1; k < geometry.length; k++) distance += kmBetween(geometry[k - 1]!, geometry[k]!);
  const drawn = simplify(geometry, MAX_GPX_POINTS, true) as Route['geometry'];

  // On every point: the simplified ones can be too few to tell a climb from a ramp.
  const profile = elevationProfile(geometry);
  const stats = profile && climbAndDescent(profile);
  const name = trackName(document, fileName);
  const route: Route = {
    geometry: drawn,
    distance,
    ...(stats && { elevationGain: stats.climb, elevationLoss: stats.descent }),
    estimatedDuration: 0,
    kind: 'match',
    unpavedShare: 0,
    surfaces: [],
    technical: false,
    technicalStretches: [],
    imported: name ? { name } : {},
  };
  route.estimatedDuration = estimatedDuration(route, pace);
  return route;
}
