import { commonText } from '../i18n/index.ts';
import { routeName } from './route-name.ts';
import { KM_PER_MILE, METRES_PER_FOOT, type Display } from './units.ts';

/**
 * A route as the API sends it: longitude, latitude, and height in metres on every point, or
 * no heights and no elevation gain when the API has no BD ALTI.
 */
export type GpxRoute = {
  geometry: [number, number, number][] | [number, number][];
  /** Kilometres. */
  distance: number;
  /** Metres. */
  elevationGain?: number;
  /** Minutes. */
  estimatedDuration: number;
};

const APP_URL = 'https://mypathfinder.fr/';

// The licence text itself, unlike LINKS.odbl, which is OSM's copyright page for the legal pages.
const OSM_LICENSE = 'https://opendatacommons.org/licenses/odbl/';

/** Older watches truncate longer tracks. */
export const MAX_GPX_POINTS = 2_000;

/**
 * The GPX export of a route, built on the device: a GPX 1.1 file with one track named after
 * the route, in a file such as "Running-12km_340m-20260928120000.gpx".
 */
export function gpxExport(route: GpxRoute, day: Date, settings: Display): { fileName: string; content: string } {
  const name = routeName(day, route, settings);
  const minutes = Math.round(route.estimatedDuration);
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  const kept = simplify(route.geometry, MAX_GPX_POINTS);
  const points = kept.map(trackPoint).join('\n');
  // A route with no point has no area to bound.
  const area = kept.length ? `<bounds ${bounds(kept)}/>\n` : '';
  const description = `${name} · ${duration}. ${commonText[settings.language].gpxAttribution}`;
  // The schema fixes the order of the elements, in the metadata as in the track.
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Path finder" xmlns="http://www.topografix.com/GPX/1/1">
<metadata>
<desc>${description}</desc>
<copyright author="OpenStreetMap contributors"><license>${OSM_LICENSE}</license></copyright>
<link href="${APP_URL}"><text>Path finder</text></link>
<time>${day.toISOString()}</time>
${area}</metadata>
<trk>
<name>${name}</name>
<desc>${description}</desc>
<type>running</type>
<trkseg>
${points}
</trkseg>
</trk>
</gpx>
`;
  return { fileName: `${fileName(route, day, settings)}.gpx`, content };
}

function trackPoint([lon, lat, ele]: [number, number, number?]): string {
  const height = ele === undefined ? '' : `<ele>${ele.toFixed(1)}</ele>`;
  return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${height}</trkpt>`;
}

/** One pass, since spreading every coordinate into `Math.min` would not hold for a longer track. */
function bounds(points: [number, number, number?][]): string {
  let [minLat, maxLat, minLon, maxLon] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [lon, lat] of points) {
    [minLat, maxLat] = [Math.min(minLat, lat), Math.max(maxLat, lat)];
    [minLon, maxLon] = [Math.min(minLon, lon), Math.max(maxLon, lon)];
  }
  const [a, b, c, d] = [minLat, minLon, maxLat, maxLon].map((degrees) => degrees.toFixed(6));
  return `minlat="${a}" minlon="${b}" maxlat="${c}" maxlon="${d}"`;
}

/** Such as "Running-12km_340m-20260928120000", or "Running-8mi_1114ft-20260928120000" in imperial units. */
function fileName({ distance, elevationGain }: GpxRoute, day: Date, { units }: Display): string {
  const metric = units === 'metric';
  // The device's local time, as the user reads it on their watch.
  const date = [
    day.getFullYear(),
    day.getMonth() + 1,
    day.getDate(),
    day.getHours(),
    day.getMinutes(),
    day.getSeconds(),
  ]
    .map((part, k) => `${part}`.padStart(k === 0 ? 4 : 2, '0'))
    .join('');
  const length = metric ? `${Math.round(distance)}km` : `${Math.round(distance / KM_PER_MILE)}mi`;
  const climb =
    elevationGain === undefined
      ? ''
      : `_${metric ? `${Math.round(elevationGain)}m` : `${Math.round(elevationGain / METRES_PER_FOOT)}ft`}`;
  return `Running-${length}${climb}-${date}`;
}

/** Douglas–Peucker, with a tolerance doubled from 1 m until at most `max` points are left. */
function simplify(geometry: [number, number, number?][], max: number): [number, number, number?][] {
  if (geometry.length <= max) return geometry;
  // Metres on a local equirectangular projection, close enough over a loop.
  const scale = 111_195;
  const cos = Math.cos((geometry[0][1] * Math.PI) / 180);
  const xy = geometry.map(([lon, lat]) => [lon * scale * cos, lat * scale]);
  const offset = (k: number, a: number, b: number) => {
    const [px, py] = xy[k];
    const [ax, ay] = xy[a];
    const [dx, dy] = [xy[b][0] - ax, xy[b][1] - ay];
    const length = Math.hypot(dx, dy);
    // A loop's first and last points are the same: measure from that point.
    return length ? Math.abs(dx * (py - ay) - dy * (px - ax)) / length : Math.hypot(px - ax, py - ay);
  };
  for (let tolerance = 1; ; tolerance *= 2) {
    const kept = new Set([0, geometry.length - 1]);
    const stack: [number, number][] = [[0, geometry.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let [farthest, distance] = [-1, tolerance];
      for (let k = a + 1; k < b; k++) {
        const d = offset(k, a, b);
        if (d > distance) [farthest, distance] = [k, d];
      }
      if (farthest < 0) continue;
      kept.add(farthest);
      stack.push([a, farthest], [farthest, b]);
    }
    if (kept.size <= max) return [...kept].sort((a, b) => a - b).map((k) => geometry[k]);
  }
}
