import { roadbookText } from '../i18n/index.ts';
import type { Position } from './coordinates.ts';
import { distancesAlong, elevationProfile, locate, type ProfilePoint, type Route } from './route.ts';
import { formatDistance, formatHeight, type Display } from './units.ts';

/** The smallest change of direction, in degrees, that is a turn. */
export const TURN_MIN_ANGLE = 60;
/** Kilometres a turn must come after the previous one. */
export const TURN_MIN_SPACING = 0.1;
/** Kilometres between the samples the route is smoothed to before its turns are measured. */
export const TURN_SAMPLE_STEP = 0.01;
/** Kilometres before and after a sample that its direction is measured over: a bend wider than this is no turn. */
export const TURN_SPAN = 0.03;
/** The shortest stretch of surface, in kilometres, that is told. */
export const SURFACE_MIN_LENGTH = 0.2;
/** The smallest average grade, in percent, of a sustained climb or descent. */
export const SLOPE_MIN_GRADE = 5;
/** The shortest sustained climb or descent, in kilometres. */
export const SLOPE_MIN_LENGTH = 0.3;
/** The smallest gain or loss, in metres, of a sustained climb or descent. */
export const SLOPE_MIN_HEIGHT = 20;
/** Metres the height may go back against a climb or descent before it counts as ended. */
export const SLOPE_REVERSAL = 3;
/** Kilometres a point of interest may lie from the route and still be told. */
export const POI_MAX_DISTANCE = 0.05;

export type PoiCategory = 'water' | 'viewpoint';

/** A point of interest near a route. Seasonal water points are flagged. */
export type Poi = { position: Position; category: PoiCategory; seasonal?: boolean };

export type CueKind = 'start' | 'technical' | 'turn' | 'surface' | 'climb' | 'descent' | 'poi' | 'finish';

/** One line of a roadbook: what it tells, and the kilometres covered when it comes. */
export type Cue = { kind: CueKind; distance: number; text: string };

// Metres under which two heights are the same: interpolating between samples leaves rounding errors.
const HEIGHT_TOLERANCE = 1e-6;
const METRES_PER_DEGREE = 111_195;

type Metres = [number, number];

// The route in metres east and north of its first point, on a local equirectangular projection.
function projectInMetres(geometry: number[][]): Metres[] {
  const [lon0, lat0] = geometry[0];
  const cos = Math.cos((lat0 * Math.PI) / 180);
  return geometry.map(([lon, lat]) => [(lon - lon0) * cos * METRES_PER_DEGREE, (lat - lat0) * METRES_PER_DEGREE]);
}

// The route sampled every `TURN_SAMPLE_STEP` kilometres from its start.
function resample(points: Metres[], distances: number[]): Metres[] {
  const total = distances[distances.length - 1];
  const samples: Metres[] = [];
  for (let step = 0; step * TURN_SAMPLE_STEP <= total; step++) {
    const [k, t] = locate(distances, step * TURN_SAMPLE_STEP);
    const [a, b] = [points[k], points[k + 1] ?? points[k]];
    samples.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
  }
  return samples;
}

type Turn = { distance: number; side: 'left' | 'right' };

// The clear turns of a route, once smoothed, none within `TURN_MIN_SPACING` of the one before.
function findTurns(geometry: number[][], distances: number[]): Turn[] {
  const points = resample(projectInMetres(geometry), distances);
  const span = Math.round(TURN_SPAN / TURN_SAMPLE_STEP);
  const peaks: { distance: number; angle: number }[] = [];
  let peak: { distance: number; angle: number } | undefined;
  for (let k = span; k < points.length - span; k++) {
    const [a, b, c] = [points[k - span], points[k], points[k + span]];
    const [before, after] = [
      [b[0] - a[0], b[1] - a[1]],
      [c[0] - b[0], c[1] - b[1]],
    ];
    // Counter-clockwise is left.
    const angle =
      (Math.atan2(before[0] * after[1] - before[1] * after[0], before[0] * after[0] + before[1] * after[1]) * 180) /
      Math.PI;
    if (Math.abs(angle) >= TURN_MIN_ANGLE) {
      if (!peak || Math.abs(angle) > Math.abs(peak.angle)) peak = { distance: k * TURN_SAMPLE_STEP, angle };
    } else if (peak) {
      peaks.push(peak);
      peak = undefined;
    }
  }
  if (peak) peaks.push(peak);
  const turns: Turn[] = [];
  for (const { distance, angle } of peaks) {
    if (turns.length === 0 || distance - turns[turns.length - 1].distance >= TURN_MIN_SPACING) {
      turns.push({ distance, side: angle > 0 ? 'left' : 'right' });
    }
  }
  return turns;
}

// Where each stretch of surface of at least `SURFACE_MIN_LENGTH` begins, after the shorter ones were
// absorbed by the stretch before them (or after them at the start) and equal neighbours were merged.
function surfaceChanges(
  surfaces: Route['surfaces'],
): { distance: number; surface: Route['surfaces'][number]['surface'] }[] {
  const first = surfaces.findIndex(({ from, to }) => to - from >= SURFACE_MIN_LENGTH);
  if (first === -1) return [];
  const merged = [{ ...surfaces[first], from: 0 }];
  for (const stretch of surfaces.slice(first + 1)) {
    const last = merged[merged.length - 1];
    if (stretch.to - stretch.from < SURFACE_MIN_LENGTH || stretch.surface === last.surface) last.to = stretch.to;
    else merged.push({ ...stretch });
  }
  return merged.slice(1).map(({ from, surface }) => ({ distance: from, surface }));
}

type Slope = { from: ProfilePoint; to: ProfilePoint };

// The climbs and descents of a profile: runs of one direction, however the height wavers by less than
// `SLOPE_REVERSAL`, trimmed to where the height really starts to change.
function slopes(profile: ProfilePoint[]): Slope[] {
  const legs: [number, number][] = [];
  let [start, extreme, direction] = [0, 0, 0];
  const close = () => {
    if (direction === 0) return;
    // Trim the flat run-in: a climb starts at its last lowest point, a descent at its last highest.
    let from = start;
    for (let k = start; k <= extreme; k++) {
      if ((profile[k].height - profile[from].height) * direction <= HEIGHT_TOLERANCE) from = k;
    }
    legs.push([from, extreme]);
  };
  for (let k = 1; k < profile.length; k++) {
    const delta = profile[k].height - profile[extreme].height;
    if (direction === 0) {
      if (Math.abs(delta) >= SLOPE_REVERSAL) [direction, extreme] = [Math.sign(delta), k];
    } else if (delta * direction > HEIGHT_TOLERANCE) {
      extreme = k;
    } else if (-delta * direction >= SLOPE_REVERSAL) {
      close();
      [start, direction, extreme] = [extreme, -direction, k];
    }
  }
  close();
  return legs.map(([from, to]) => ({ from: profile[from], to: profile[to] }));
}

type SustainedSlope = Slope & { length: number; height: number; grade: number };

// The sustained climbs and descents of a route: steep enough, long enough, and with enough height.
// The grade is a fraction, the height is signed.
function sustainedSlopes(geometry: Route['geometry']): SustainedSlope[] {
  const profile = elevationProfile(geometry);
  if (!profile) return [];
  return slopes(profile)
    .map(({ from, to }) => {
      const [length, height] = [to.distance - from.distance, to.height - from.height];
      return { from, to, length, height, grade: Math.abs(height) / (length * 1000) };
    })
    .filter(
      ({ length, height, grade }) =>
        length >= SLOPE_MIN_LENGTH && Math.abs(height) >= SLOPE_MIN_HEIGHT && grade * 100 >= SLOPE_MIN_GRADE,
    );
}

// Each pass of the route by a point: a run of segments within `POI_MAX_DISTANCE`, at its closest point.
function passesBy(points: Metres[], distances: number[], [x, y]: Metres): number[] {
  const passes: number[] = [];
  let best: { offset: number; distance: number } | undefined;
  for (let k = 0; k + 1 < points.length; k++) {
    const [a, b] = [points[k], points[k + 1]];
    // A segment whose box is further than the limit is skipped without projecting the point on it.
    const reach = POI_MAX_DISTANCE * 1000;
    const far =
      x < Math.min(a[0], b[0]) - reach ||
      x > Math.max(a[0], b[0]) + reach ||
      y < Math.min(a[1], b[1]) - reach ||
      y > Math.max(a[1], b[1]) + reach;
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const squared = dx * dx + dy * dy;
    const t = squared ? Math.min(Math.max(((x - a[0]) * dx + (y - a[1]) * dy) / squared, 0), 1) : 0;
    const offset = far ? Infinity : Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)) / 1000;
    if (offset <= POI_MAX_DISTANCE) {
      if (!best || offset < best.offset)
        best = { offset, distance: distances[k] + t * (distances[k + 1] - distances[k]) };
    } else if (best) {
      passes.push(best.distance);
      best = undefined;
    }
  }
  if (best) passes.push(best.distance);
  return passes;
}

/**
 * The cues of a route's roadbook, in order from the start to the finish: clear turns, changes of
 * surface, sustained climbs and descents, the technical stretches, and the points of interest of the
 * `shown` categories the route passes. The route holds no position for a technical stretch, so it is
 * told once, right after the start. Nothing here is fetched or saved.
 */
export function roadbookCues(route: Route, pois: Poi[], shown: PoiCategory[], display: Display): Cue[] {
  const text = roadbookText[display.language];
  const { geometry } = route;
  const start: Cue = { kind: 'start', distance: 0, text: text.cueStart };
  const technical: Cue[] = route.technical ? [{ kind: 'technical', distance: 0, text: text.cueTechnical }] : [];
  const finish = (distance: number): Cue => ({ kind: 'finish', distance, text: text.cueFinish });
  if (geometry.length === 0) return [start, ...technical, finish(route.distance)];

  const distances = distancesAlong(geometry);
  // Distances along the geometry are scaled to the route's own length, as the surface stretches are.
  const total = distances[distances.length - 1];
  const scale = total > 0 ? route.distance / total : 1;
  const along: Cue[] = [];
  const add = (kind: CueKind, distance: number, words: string) => along.push({ kind, distance, text: words });

  for (const { distance, side } of findTurns(geometry, distances)) add('turn', distance * scale, text.cueTurn[side]);
  for (const { distance, surface } of surfaceChanges(route.surfaces))
    add('surface', distance, text.cueSurface[surface]);
  for (const { from, length, height, grade } of sustainedSlopes(geometry)) {
    const percent = new Intl.NumberFormat(display.language, { style: 'percent', maximumFractionDigits: 0 });
    const words = [
      formatHeight(Math.abs(height), display),
      formatDistance(length * scale, display),
      percent.format(grade),
    ] as const;
    add(
      height > 0 ? 'climb' : 'descent',
      from.distance * scale,
      height > 0 ? text.cueClimb(...words) : text.cueDescent(...words),
    );
  }
  const shownPois = pois.filter(({ category }) => shown.includes(category));
  // The route and the points share one projection, so they are measured against each other.
  const projected = projectInMetres([...geometry, ...shownPois.map(({ position }) => position)]);
  const points = projected.slice(0, geometry.length);
  shownPois.forEach(({ category, seasonal }, k) => {
    const label = text.cuePoi[category];
    for (const distance of passesBy(points, distances, projected[geometry.length + k])) {
      add('poi', distance * scale, seasonal ? text.cueSeasonal(label) : label);
    }
  });
  along.sort((a, b) => a.distance - b.distance);

  return [start, ...technical, ...along, finish(Math.max(route.distance, along.at(-1)?.distance ?? 0))];
}
