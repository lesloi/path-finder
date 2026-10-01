import type { Route } from './route.ts';

/** The size of the box a relief is drawn in and the margin it keeps from the edges, in its own units. */
export type ReliefBox = { width: number; height: number; margin: number };

/** A route seen from above and to one side: its path at its heights, and the ground below it. */
export type Relief = { ground: [number, number][]; path: [number, number][] };

// Metres per degree of latitude.
const METRES_PER_DEGREE = 111_000;
// The view turns the route this far from north, and leans this far from the vertical, in radians.
const AZIMUTH = Math.PI / 6;
const LEAN = (50 * Math.PI) / 180;
// Heights are stretched until the relief is this share of the route's extent, but never more than this many times.
const RELIEF_SHARE = 0.35;
const MAX_EXAGGERATION = 12;
// Points a drawing keeps at most: more would not show.
const MAX_POINTS = 150;

/**
 * A route in perspective, scaled to fit the box and centred: the path at its heights and the same
 * path flat on the ground at its lowest point. Nothing without heights can be drawn, so it returns
 * nothing for a route without BD ALTI.
 */
export function projectRelief(geometry: Route['geometry'], { width, height, margin }: ReliefBox): Relief | undefined {
  if (!geometry.every((point) => point.length === 3)) return undefined;
  const step = Math.ceil(geometry.length / MAX_POINTS);
  const points = (geometry as [number, number, number][]).filter((_, k) => k % step === 0 || k === geometry.length - 1);
  const [lon0, lat0] = points[0];
  const scaleX = Math.cos((lat0 * Math.PI) / 180) * METRES_PER_DEGREE;
  const floor = Math.min(...points.map(([, , ele]) => ele));
  const eastings = points.map(([lon]) => (lon - lon0) * scaleX);
  const northings = points.map(([, lat]) => (lat - lat0) * METRES_PER_DEGREE);
  const extent = Math.max(
    Math.max(...eastings) - Math.min(...eastings),
    Math.max(...northings) - Math.min(...northings),
  );
  const relief = Math.max(...points.map(([, , ele]) => ele)) - floor;
  const exaggeration = relief ? Math.min((RELIEF_SHARE * extent) / relief, MAX_EXAGGERATION) : 1;
  const place = ([lon, lat]: [number, number, number], ele: number): [number, number] => {
    const [east, north] = [(lon - lon0) * scaleX, (lat - lat0) * METRES_PER_DEGREE];
    const across = east * Math.cos(AZIMUTH) - north * Math.sin(AZIMUTH);
    const depth = east * Math.sin(AZIMUTH) + north * Math.cos(AZIMUTH);
    return [across, -(depth * Math.sin(LEAN) + (ele - floor) * exaggeration * Math.cos(LEAN))];
  };
  const ground = points.map((point) => place(point, floor));
  const path = points.map((point) => place(point, point[2]));
  const all = [...ground, ...path];
  const [left, right] = [Math.min(...all.map(([x]) => x)), Math.max(...all.map(([x]) => x))];
  const [top, bottom] = [Math.min(...all.map(([, y]) => y)), Math.max(...all.map(([, y]) => y))];
  const [spanX, spanY] = [right - left, bottom - top];
  const scale = Math.min(
    spanX ? (width - 2 * margin) / spanX : Infinity,
    spanY ? (height - 2 * margin) / spanY : Infinity,
  );
  const fit = Number.isFinite(scale) ? scale : 1;
  const [offsetX, offsetY] = [(width - spanX * fit) / 2, (height - spanY * fit) / 2];
  const toBox = ([x, y]: [number, number]): [number, number] => [offsetX + (x - left) * fit, offsetY + (y - top) * fit];
  return { ground: ground.map(toBox), path: path.map(toBox) };
}
