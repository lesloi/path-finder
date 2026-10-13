import { useId, useState, type ReactNode } from 'react';

import {
  CriteriaError,
  MAX_TARGET_DISTANCE,
  MAX_TARGET_ELEVATION_GAIN,
  MIN_TARGET_DISTANCE,
  parseCriteria,
  TARGET_DURATION,
  type CriteriaField,
} from '../contract/index.ts';
import { PaceSlider, PRIMARY_BUTTON, SegmentedControl, Slider } from '../components/index.ts';
import { formatDuration, type Position, type RouteSetRequest } from '../core/index.ts';
import { commonText, criteriaText, type Language } from '../i18n/index.ts';
import { useSettings, type LastCriteria } from '../state/index.ts';

const CRITERIA = ['target', 'surface', 'elevation'] as const;

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
  { pace, start }: { pace: number; start?: Position },
): RouteSetRequest | undefined {
  const distance = clamp(draft.distance, BOUNDS.distance.min, BOUNDS.distance.max);
  const gain = clamp(draft.gain, 0, BOUNDS.gain.max);
  const level = draft.level;
  return (
    start && {
      start,
      target: draft.target === 'distance' ? { distance } : { duration: draft.duration },
      ...(level === 'target' && { elevationGain: gain }),
      ...((level === 'flat' || level === 'hilly') && { elevationGain: level }),
      surface: draft.surface,
      pace,
    }
  );
}

/**
 * Whether `request` asks for something other than `found`, the request of the routes shown. A distance or an
 * elevation gain within half a step of the slider is the same one (a distance of 9.66 km, which the slider
 * rounds to 10, comes from the last search), and the pace of a distance only changes the durations, on the spot.
 */
export function criteriaChanged(request: RouteSetRequest, found: RouteSetRequest): boolean {
  const within = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
  const [a, b] = [request.target, found.target];
  const sameTarget =
    'distance' in a && 'distance' in b
      ? within(a.distance, b.distance, 0.5)
      : 'duration' in a && 'duration' in b && a.duration === b.duration;
  const [gainA, gainB] = [request.elevationGain, found.elevationGain];
  const sameGain =
    typeof gainA === 'number' && typeof gainB === 'number' ? within(gainA, gainB, GAIN_STEP / 2) : gainA === gainB;
  return !(
    sameTarget &&
    sameGain &&
    request.start[0] === found.start[0] &&
    request.start[1] === found.start[1] &&
    request.surface === found.surface &&
    ('distance' in b || request.pace === found.pace)
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
  startUncovered = false,
  draft: kept,
  onSubmit,
}: {
  language: Language;
  start?: Position;
  /** The start point is where the server has no routes: asking would only fail. */
  startUncovered?: boolean;
  /** From `useCriteriaDraft`, for a view that mounts the form in more than one place and keeps what was set. */
  draft?: ReturnType<typeof useCriteriaDraft>;
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

  const request = criteriaRequest(draft, { pace: settings.pace, start });
  const field = request && invalidField(request);

  const sections: Record<Criterion, { title: string; content: ReactNode }> = {
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
        {t.findRoutes}
      </button>
    </>
  );
  const error = field && (
    <p role="alert" data-testid="criteria-error" className="text-sm text-ink">
      {message(field, draft.target, { language, distance: BOUNDS.distance, gain: BOUNDS.gain })}
    </p>
  );

  return (
    <>
      {CRITERIA.map((criterion) => (
        <section key={criterion} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink-2">{sections[criterion].title}</h2>
          {sections[criterion].content}
        </section>
      ))}
      {error}
      {findRoutes}
    </>
  );
}

// The fields the form sets: it places no waypoints yet.
type FormField = Exclude<CriteriaField, 'waypoints'>;

// The first field `parseCriteria` rejects, as the API would.
export function invalidField(request: RouteSetRequest): FormField | undefined {
  try {
    parseCriteria(request);
  } catch (error) {
    // The form cannot make an invalid waypoint, so one would be a bug, not something to word.
    if (error instanceof CriteriaError && error.field !== 'waypoints') return error.field;
    throw error;
  }
}

function message(
  field: FormField,
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
  const messages: Record<FormField, string> = {
    start: t.startError,
    target: target === 'distance' ? t.distanceError(distance.min, distance.max, 'km') : t.durationError,
    elevationGain: t.elevationGainError(gain.max, 'm'),
    surface: t.surfaceError,
    pace: t.paceError,
  };
  return messages[field];
}
