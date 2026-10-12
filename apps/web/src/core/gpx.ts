import { commonText, LINKS, type Language } from '../i18n/index.ts';
import { formatDistance, formatHeight, formatPace, type PaceUnit } from './units.ts';

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

// Cycling (#131) will be a travel mode that chooses this; only running is generated for now.
const TRAVEL_MODE = { type: 'running', label: 'Running' };

/** Older watches truncate longer tracks. */
export const MAX_GPX_POINTS = 2_000;

/**
 * The GPX export of a route, built on the device: a GPX 1.1 file with one track named after
 * the route and its pace, in a file such as "Running-12km_340m-20260928120000.gpx".
 */
export function gpxExport(
  route: GpxRoute,
  exportedAt: Date,
  /** The language the export is written in, and how its pace is. */
  { language, paceUnit }: { language: Language; paceUnit: PaceUnit },
  /** Minutes per km, the one the estimated duration was computed at. */
  pace: number,
): { fileName: string; content: string } {
  const name = `${commonText[language].gpxTrackName} · ${formatDistance(route.distance, language)}`;
  const minutes = Math.round(route.estimatedDuration);
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  const points = simplify(route.geometry, MAX_GPX_POINTS).map(trackPoint).join('\n');
  const climb = route.elevationGain === undefined ? [] : [`+${formatHeight(route.elevationGain, language)}`];
  const description = `${[...climb, duration].join(' · ')} (${formatPace(pace, paceUnit, language)})`;
  // The schema fixes the order of the elements, in the metadata as in the track.
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Path finder" xmlns="http://www.topografix.com/GPX/1/1">
<metadata>
<copyright author="OpenStreetMap contributors"><license>${LINKS.odblText}</license></copyright>
<link href="${LINKS.app}"><text>Path finder</text></link>
<time>${exportedAt.toISOString()}</time>
</metadata>
<trk>
<name>${name}</name>
<desc>${description}</desc>
<type>${TRAVEL_MODE.type}</type>
<trkseg>
${points}
</trkseg>
</trk>
</gpx>
`;
  return { fileName: `${fileName(route, exportedAt)}.gpx`, content };
}

function trackPoint([lon, lat, ele]: [number, number, number?]): string {
  const height = ele === undefined ? '' : `<ele>${ele.toFixed(1)}</ele>`;
  return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${height}</trkpt>`;
}

/** Such as "Running-12km_340m-20260928120000". */
function fileName({ distance, elevationGain }: GpxRoute, exportedAt: Date): string {
  // The device's local time, as the user reads it on their watch.
  const pad = (n: number) => `${n}`.padStart(2, '0');
  const [date, time] = [
    `${exportedAt.getFullYear()}${pad(exportedAt.getMonth() + 1)}${pad(exportedAt.getDate())}`,
    `${pad(exportedAt.getHours())}${pad(exportedAt.getMinutes())}${pad(exportedAt.getSeconds())}`,
  ];
  const length = `${Math.round(distance)}km`;
  const climb = elevationGain === undefined ? '' : `_${Math.round(elevationGain)}m`;
  return `${TRAVEL_MODE.label}-${length}${climb}-${date}${time}`;
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
