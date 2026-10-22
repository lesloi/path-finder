import { useId, useState, type ReactNode } from 'react';

import {
  byDuration,
  CriteriaError,
  MAX_TARGET_DISTANCE,
  MAX_TARGET_ELEVATION_GAIN,
  MIN_TARGET_DISTANCE,
  parseCriteria,
  TARGET_DURATION,
  areaContains,
  type AvoidedArea,
  type CriteriaField,
} from '../contract/index.ts';
import { PaceSlider, PRIMARY_BUTTON, SegmentedControl, Slider } from '../components/index.ts';
import { formatDuration, kmBetween, samePositions, type Position, type RouteSetRequest } from '../core/index.ts';
import { commonText, criteriaText, type Language } from '../i18n/index.ts';
import { useSettings, type LastCriteria } from '../state/index.ts';

const CRITERIA = ['shape', 'target', 'surface', 'elevation'] as const;
// An out-and-back route has neither: its destination sets the distance, and the elevation gain follows.
const LOOP_ONLY: Criterion[] = ['target', 'elevation'];

const DURATION_STEP = 5; // minutes

type Target = LastCriteria['target'];
type Criterion = (typeof CRITERIA)[number];

// Distance in km, elevation gain in m, which the bounds are shown in.
export type Draft = LastCriteria;

const GAIN_STEP = 50;

/** The bounds of the sliders, inside the API's bounds. */
const BOUNDS = {
  distance: { min: Math.ceil(MIN_TARGET_DISTANCE), max: Math.floor(MAX_TARGET_DISTANCE) },
  gain: { max: Math.floor(MAX_TARGET_ELEVATION_GAIN / GAIN_STEP) * GAIN_STEP },
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * What the user has set in the form. It starts from the criteria of the last search, kept on the
 * device, and is kept there only once a search is made with it (`keep`), so that setting a criterion writes nothing.
 * The sliders show the distance to the kilometre and the gain to the step, which the criteria kept are not rounded to.
 */
export function useCriteriaDraft(): [Draft, (draft: Draft) => void, () => void] {
  const [settings, update] = useSettings();
  const [criteria, setCriteria] = useState(settings.lastCriteria);
  const draft: Draft = {
    ...criteria,
    distance: Math.round(criteria.distance),
    gain: Math.round(criteria.gain / GAIN_STEP) * GAIN_STEP,
  };
  function setDraft(next: Draft) {
    // A length is rewritten only when its shown value changed, which would otherwise round the one asked.
    setCriteria({
      ...next,
      distance: next.distance === draft.distance ? criteria.distance : next.distance,
      gain: next.gain === draft.gain ? criteria.gain : next.gain,
    });
  }
  const keep = () => {
    if (criteria !== settings.lastCriteria) update({ lastCriteria: criteria });
  };
  return [draft, setDraft, keep];
}

/**
 * The request the draft asks for, or none without a start point. Both the
 * form and the view that compares it with the routes found build it here.
 */
export function criteriaRequest(
  draft: Draft,
  {
    pace,
    start,
    destination,
    waypoints,
    avoidedAreas,
  }: {
    pace: number;
    start?: Position | undefined;
    destination?: Position | undefined;
    waypoints?: Position[] | undefined;
    avoidedAreas?: AvoidedArea[] | undefined;
  },
): RouteSetRequest | undefined {
  const distance = clamp(draft.distance, BOUNDS.distance.min, BOUNDS.distance.max);
  const gain = clamp(draft.gain, 0, BOUNDS.gain.max);
  const level = draft.level;
  const outAndBack = draft.shape === 'outAndBack';
  // A route is no longer than its target, and no point of it is farther from the start than that: an area beyond
  // stays on the device, as a route cannot need it. An out-and-back route has no target to bound its reach, and its
  // way can wind: its reach is the longest route there is.
  const reachKm = outAndBack ? MAX_TARGET_DISTANCE : draft.target === 'distance' ? distance : draft.duration / pace;
  const reachable =
    start && avoidedAreas?.filter((area) => kmBetween(start, area.center) - area.radius / 1000 <= reachKm);
  if (!start) return undefined;
  const common = {
    start,
    surface: draft.surface,
    pace,
    ...(waypoints?.length && { waypoints }),
    ...(reachable?.length && { avoidedAreas: reachable }),
  };
  if (outAndBack) {
    // Without a destination there is nothing to ask for yet.
    return destination && { ...common, shape: 'outAndBack', destination };
  }
  return {
    ...common,
    target: draft.target === 'distance' ? { distance } : { duration: draft.duration },
    ...(level === 'target' && { elevationGain: gain }),
    ...((level === 'flat' || level === 'hilly') && { elevationGain: level }),
  };
}

const sameAreas = (a: AvoidedArea[], b: AvoidedArea[]) =>
  a.length === b.length &&
  a.every(
    ({ center, radius }, i) =>
      radius === b[i]!.radius && center[0] === b[i]!.center[0] && center[1] === b[i]!.center[1],
  );

/**
 * Whether `request` asks for something other than `found`, the request of the routes shown. A distance or an
 * elevation gain within half a step of the slider is the same one (a distance of 9.66 km, which the slider
 * rounds to 10, comes from the last search), and the pace of a distance only changes the durations, on the spot.
 */
export function criteriaChanged(request: RouteSetRequest, found: RouteSetRequest): boolean {
  const within = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
  const [a, b] = [request.target, found.target];
  const sameTarget =
    !a || !b
      ? a === b
      : 'distance' in a && 'distance' in b
        ? within(a.distance, b.distance, 0.5)
        : 'duration' in a && 'duration' in b && a.duration === b.duration;
  const [gainA, gainB] = [request.elevationGain, found.elevationGain];
  const sameGain =
    typeof gainA === 'number' && typeof gainB === 'number' ? within(gainA, gainB, GAIN_STEP / 2) : gainA === gainB;
  return !(
    sameTarget &&
    sameGain &&
    samePositions([request.start], [found.start]) &&
    request.surface === found.surface &&
    request.shape === found.shape &&
    samePositions(request.destination ? [request.destination] : [], found.destination ? [found.destination] : []) &&
    samePositions(request.waypoints ?? [], found.waypoints ?? []) &&
    sameAreas(request.avoidedAreas ?? [], found.avoidedAreas ?? []) &&
    (!byDuration(found) || request.pace === found.pace)
  );
}

/**
 * The criteria of a route set: target distance or duration, surface, and elevation gain,
 * over the user's settings. `onSubmit` receives a request body that `parseCriteria`
 * accepts.
 */
export function CriteriaForm({
  language,
  start,
  destination,
  waypoints,
  avoidedAreas,
  startUncovered = false,
  draft: kept,
  searched = false,
  destinationField,
  waypointList,
  avoidedList,
  onSubmit,
}: {
  language: Language;
  start?: Position;
  /** Where an out-and-back route turns back: set in its own field, above the criteria. */
  destination?: Position | undefined;
  /** The points the routes go through, in order: they are placed on the map, not in the form. */
  waypoints?: Position[] | undefined;
  /** The areas routes keep out of: placed on the map, not in the form. */
  avoidedAreas?: AvoidedArea[] | undefined;
  /** The start point is where the server has no routes: asking would only fail. */
  startUncovered?: boolean;
  /** From `useCriteriaDraft`, for a view that mounts the form in more than one place and keeps what was set. */
  draft?: ReturnType<typeof useCriteriaDraft>;
  /** Routes were already found: the button then runs the search again. */
  searched?: boolean;
  /** The field of the destination, under the shape. */
  destinationField?: ReactNode;
  /** The waypoints as a list, between the criteria and the button. */
  waypointList?: ReactNode;
  /** The list of the areas to avoid, under the waypoints. */
  avoidedList?: ReactNode;
  onSubmit: (request: RouteSetRequest) => void;
}) {
  const t = { ...commonText[language], ...criteriaText[language] };
  const [settings, update] = useSettings();
  const own = useCriteriaDraft();
  const [draft, setDraft] = kept ?? own;

  const distance = clamp(draft.distance, BOUNDS.distance.min, BOUNDS.distance.max);
  const gain = clamp(draft.gain, 0, BOUNDS.gain.max);
  const level = draft.level;
  const change = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes });

  const request = criteriaRequest(draft, { pace: settings.pace, start, destination, waypoints, avoidedAreas });
  const field = request && invalidField(request);
  const needsDestination = Boolean(start) && draft.shape === 'outAndBack' && !destination;

  const sections: Record<Criterion, { title: string; content: ReactNode }> = {
    shape: {
      title: t.shape,
      content: (
        <>
          <SegmentedControl
            testId="criteria-shape"
            label={t.shape}
            value={draft.shape}
            options={[
              { value: 'loop', label: t.loop },
              { value: 'outAndBack', label: t.outAndBack },
            ]}
            onChange={(shape) => change({ shape })}
          />
          {draft.shape === 'outAndBack' && destinationField}
          {needsDestination && (
            <p role="status" data-testid="criteria-destination-hint" className="text-sm text-ink">
              {t.destinationHint}
            </p>
          )}
        </>
      ),
    },
    target: {
      title: t.target,
      content: (
        <div className="flex flex-col gap-2">
          <SegmentedControl
            testId="criteria-target"
            label={t.target}
            value={draft.target}
            options={[
              { value: 'distance', label: t.distance },
              { value: 'duration', label: t.duration },
            ]}
            onChange={(target) => change({ target })}
          />
          {draft.target === 'distance' ? (
            <Slider
              testId="criteria-distance"
              label={t.distance}
              value={distance}
              shown={`${distance} km`}
              min={BOUNDS.distance.min}
              max={BOUNDS.distance.max}
              step={1}
              onChange={(value) => change({ distance: value })}
            />
          ) : (
            <Slider
              testId="criteria-duration"
              label={t.duration}
              value={draft.duration}
              shown={formatDuration(draft.duration, language)}
              min={TARGET_DURATION.min}
              max={TARGET_DURATION.max}
              step={DURATION_STEP}
              onChange={(value) => change({ duration: value })}
            />
          )}
          {draft.target === 'duration' && (
            <PaceSlider
              label={t.pace}
              pace={settings.pace}
              paceUnit={settings.paceUnit}
              language={language}
              testId="criteria-pace"
              onChange={(pace) => update({ pace })}
            />
          )}
        </div>
      ),
    },
    elevation: {
      title: t.elevationGain,
      content: (
        <div className="flex flex-col gap-2">
          <SegmentedControl
            testId="criteria-elevation"
            label={t.elevationGain}
            value={level}
            options={[
              { value: 'any', label: t.any },
              { value: 'flat', label: t.flat },
              { value: 'hilly', label: t.hilly },
              { value: 'target', label: t.targetLevel },
            ]}
            onChange={(level) => change({ level })}
          />
          {level === 'target' && (
            <Slider
              testId="criteria-gain"
              label={t.elevationGain}
              value={gain}
              shown={`${gain} m`}
              min={0}
              max={BOUNDS.gain.max}
              step={GAIN_STEP}
              onChange={(value) => change({ gain: value })}
            />
          )}
        </div>
      ),
    },
    surface: {
      title: t.surface,
      content: (
        <SegmentedControl
          testId="criteria-surface"
          label={t.surface}
          value={draft.surface}
          options={[
            { value: 'paved', label: t.paved },
            { value: 'any', label: t.anySurface },
            { value: 'unpaved', label: t.unpaved },
          ]}
          onChange={(surface) => change({ surface })}
        />
      ),
    },
  };

  const uncoveredId = useId();
  const findRoutes = request && !field && (
    <>
      {/* Not hidden, so that the user sees why the search cannot run; the message holds no coordinates. */}
      {startUncovered && (
        <p id={uncoveredId} role="status" data-testid="criteria-uncovered" className="text-sm text-ink">
          {t.uncoveredStart}
        </p>
      )}
      <button
        type="button"
        className={PRIMARY_BUTTON}
        data-testid="criteria-submit"
        disabled={startUncovered}
        {...(startUncovered && { 'aria-describedby': uncoveredId })}
        onClick={() => onSubmit(request)}
      >
        {searched ? t.searchAgain : t.findRoutes}
      </button>
    </>
  );
  const error = field && (
    <p role="alert" data-testid="criteria-error" className="text-sm text-ink">
      {field === 'avoidedAreas' && start && avoidedAreas?.some((area) => areaContains(area, start))
        ? t.startInAvoidedArea
        : message(field, draft.target, { language, distance: BOUNDS.distance, gain: BOUNDS.gain })}
    </p>
  );

  return (
    <>
      {CRITERIA.filter((criterion) => draft.shape === 'loop' || !LOOP_ONLY.includes(criterion)).map((criterion) => (
        <section key={criterion} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink-2">{sections[criterion].title}</h2>
          {sections[criterion].content}
        </section>
      ))}
      {waypointList}
      {avoidedList}
      {error}
      {findRoutes}
    </>
  );
}

// The first field `parseCriteria` rejects, as the API would.
export function invalidField(request: RouteSetRequest): CriteriaField | undefined {
  try {
    parseCriteria(request);
  } catch (error) {
    if (error instanceof CriteriaError) return error.field;
    throw error;
  }
}

function message(
  field: CriteriaField,
  target: Target,
  {
    language,
    distance,
    gain,
  }: {
    language: Language;
    distance: { min: number; max: number };
    gain: { max: number };
  },
): string {
  const t = criteriaText[language];
  const messages: Record<CriteriaField, string> = {
    start: t.startError,
    shape: t.shapeError,
    destination: t.destinationError,
    target: target === 'distance' ? t.distanceError(distance.min, distance.max, 'km') : t.durationError,
    elevationGain: t.elevationGainError(gain.max, 'm'),
    surface: t.surfaceError,
    pace: t.paceError,
    waypoints: t.waypointsError,
    avoidedAreas: t.avoidedAreasError,
  };
  return messages[field];
}
