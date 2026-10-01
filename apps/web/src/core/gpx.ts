import { commonText, type Language } from '../i18n/index.ts';
import type { Activity } from './activity.ts';
import { routeName } from './route-name.ts';
import { KM_PER_MILE, METRES_PER_FOOT, type Units } from './units.ts';

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

/** Older watches truncate longer tracks. */
export const MAX_GPX_POINTS = 2_000;

/**
 * The GPX export of a route, built on the device: a GPX 1.1 file with one track named after
 * the route, in a file such as "Course-2809-12km_340m.gpx".
 */
export function gpxExport(
  route: GpxRoute,
  activity: Activity,
  day: Date,
  settings: { units: Units; language: Language },
): { fileName: string; content: string } {
  const name = routeName(activity, day, route, settings);
  const minutes = Math.round(route.estimatedDuration);
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  const points = simplify(route.geometry, MAX_GPX_POINTS)
    .map(([lon, lat, ele]) => {
      const height = ele === undefined ? '' : `<ele>${ele.toFixed(1)}</ele>`;
      return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${height}</trkpt>`;
    })
    .join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Path finder" xmlns="http://www.topografix.com/GPX/1/1">
<trk>
<name>${name}</name>
<desc>${name} · ${duration}. ${commonText[settings.language].gpxAttribution}</desc>
<trkseg>
${points}
</trkseg>
</trk>
</gpx>
`;
  return { fileName: `${fileName(route, activity, day, settings)}.gpx`, content };
}

/** Short and without accents, such as "Randonnee-2809-12km_340m", or "Run-2809-8mi_1114ft" in imperial units. */
function fileName(
  { distance, elevationGain }: GpxRoute,
  activity: Activity,
  day: Date,
  { units, language }: { units: Units; language: Language },
): string {
  const metric = units === 'metric';
  const activityName = commonText[language].activities[activity].normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const date = `${day.getDate()}`.padStart(2, '0') + `${day.getMonth() + 1}`.padStart(2, '0');
  const length = metric ? `${Math.round(distance)}km` : `${Math.round(distance / KM_PER_MILE)}mi`;
  const climb =
    elevationGain === undefined
      ? ''
      : `_${metric ? `${Math.round(elevationGain)}m` : `${Math.round(elevationGain / METRES_PER_FOOT)}ft`}`;
  return `${activityName}-${date}-${length}${climb}`;
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
