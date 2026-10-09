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
import { PaceSlider, PRIMARY_BUTTON, SegmentedControl, Slider, Switch } from '../components/index.ts';
import {
  formatDuration,
  KM_PER_MILE,
  METRES_PER_FOOT,
  type Position,
  type RouteSetRequest,
  type Units,
} from '../core/index.ts';
import { commonText, criteriaText, type Language } from '../i18n/index.ts';
import { unitsOf, useSettings, useUnits, type LastCriteria } from '../state/index.ts';

const CRITERIA = ['target', 'surface', 'elevation'] as const;

const DURATION_STEP = 5; // minutes

type Target = LastCriteria['target'];
type Criterion = (typeof CRITERIA)[number];

// Distance in km or mi, elevation gain in m or ft: the user's units, which the bounds are shown in.
export type Draft = LastCriteria;

/** The bounds of the sliders in the user's units, inside the API's bounds once converted back. */
function boundsFor(units: Units) {
  const { kmPerDistanceUnit, metresPerGainUnit, gainStep } = unitsFor(units);
  return {
    distance: {
      min: Math.ceil(MIN_TARGET_DISTANCE / kmPerDistanceUnit),
      max: Math.floor(MAX_TARGET_DISTANCE / kmPerDistanceUnit),
    },
    gain: { max: Math.floor(MAX_TARGET_ELEVATION_GAIN / metresPerGainUnit / gainStep) * gainStep },
  };
}

function unitsFor(units: Units) {
  return units === 'metric'
    ? { kmPerDistanceUnit: 1, metresPerGainUnit: 1, gainStep: 50, distance: 'km', gain: 'm' }
    : {
        kmPerDistanceUnit: KM_PER_MILE,
        metresPerGainUnit: METRES_PER_FOOT,
        gainStep: 100,
        distance: 'mi',
        gain: 'ft',
      };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * What the user has set in the form, in their units. It starts from the criteria of the last search, kept on the
 * device, and is kept there only once a search is made with it (`keep`), so that setting a criterion writes nothing.
 * The distance is held in kilometres and the gain in metres, so a change of units made in the settings, even while
 * the view stays mounted, changes how they are shown and not what was asked.
 */
export function useCriteriaDraft(language: Language): [Draft, (draft: Draft) => void, () => void] {
  const [settings, update] = useSettings();
  const units = unitsOf(settings, language);
  const { kmPerDistanceUnit, metresPerGainUnit, gainStep } = unitsFor(units);
  const [criteria, setCriteria] = useState(settings.lastCriteria);
  const draft: Draft = {
    ...criteria,
    distance: Math.round(criteria.distance / kmPerDistanceUnit),
    gain: Math.round(criteria.gain / metresPerGainUnit / gainStep) * gainStep,
  };
  function setDraft(next: Draft) {
    // A length is rewritten only when its shown value changed, which would otherwise round the one asked.
    setCriteria({
      ...next,
      distance: next.distance === draft.distance ? criteria.distance : next.distance * kmPerDistanceUnit,
      gain: next.gain === draft.gain ? criteria.gain : Math.round(next.gain * metresPerGainUnit),
    });
  }
  const keep = () => {
    if (criteria !== settings.lastCriteria) update({ lastCriteria: criteria });
  };
  return [draft, setDraft, keep];
}

/**
 * The request the draft asks for, with the values in the API's units, or none without a start point. Both the
 * form and the view that compares it with the routes found build it here.
 */
export function criteriaRequest(
  draft: Draft,
  { units, pace, start }: { units: Units; pace: number; start?: Position },
): RouteSetRequest | undefined {
  const bounds = boundsFor(units);
  const unit = unitsFor(units);
  const distance = clamp(draft.distance, bounds.distance.min, bounds.distance.max);
  const gain = clamp(draft.gain, 0, bounds.gain.max);
  const level = draft.level;
  // A paved request always excludes technical stretches, whatever was kept: the stored value is not touched.
  const allowed = draft.surface !== 'paved' && draft.includeTechnical;
  return (
    start && {
      start,
      target:
        draft.target === 'distance'
          ? { distance: round(distance * unit.kmPerDistanceUnit, 2) }
          : { duration: draft.duration },
      ...(level === 'target' && { elevationGain: Math.round(gain * unit.metresPerGainUnit) }),
      ...((level === 'flat' || level === 'hilly') && { elevationGain: level }),
      surface: draft.surface,
      pace,
      includeTechnical: allowed,
    }
  );
}

/**
 * Whether `request` asks for something other than `found`, the request of the routes shown. A distance or an
 * elevation gain within half a step of the slider is the same one worded in other units (6 mi is 9.66 km, which
 * a slider in km rounds to 10), and the pace of a distance only changes the durations, on the spot.
 */
export function criteriaChanged(request: RouteSetRequest, found: RouteSetRequest, units: Units): boolean {
  const unit = unitsFor(units);
  const within = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
  const [a, b] = [request.target, found.target];
  const sameTarget =
    'distance' in a && 'distance' in b
      ? within(a.distance, b.distance, unit.kmPerDistanceUnit / 2)
      : 'duration' in a && 'duration' in b && a.duration === b.duration;
  const [gainA, gainB] = [request.elevationGain, found.elevationGain];
  const sameGain =
    typeof gainA === 'number' && typeof gainB === 'number'
      ? within(gainA, gainB, (unit.metresPerGainUnit * unit.gainStep) / 2)
      : gainA === gainB;
  return !(
    sameTarget &&
    sameGain &&
    request.start[0] === found.start[0] &&
    request.start[1] === found.start[1] &&
    request.surface === found.surface &&
    request.includeTechnical === found.includeTechnical &&
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
  const units = useUnits(language);
  const own = useCriteriaDraft(language);
  const [draft, setDraft] = kept ?? own;

  const bounds = boundsFor(units);
  const unit = unitsFor(units);
  const distance = clamp(draft.distance, bounds.distance.min, bounds.distance.max);
  const gain = clamp(draft.gain, 0, bounds.gain.max);
  const level = draft.level;
  // Only the surface preferences that can route onto technical ways get the switch. A paved request always excludes
  // them, whatever was kept: the stored value is not touched.
  const technicalApplies = draft.surface !== 'paved';
  const change = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes });

  const request = criteriaRequest(draft, { units, pace: settings.pace, start });
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
              shown={`${distance} ${unit.distance}`}
              min={bounds.distance.min}
              max={bounds.distance.max}
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
              units={units}
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
              shown={`${gain} ${unit.gain}`}
              min={0}
              max={bounds.gain.max}
              step={unit.gainStep}
              onChange={(value) => change({ gain: value })}
            />
          )}
        </div>
      ),
    },
    surface: {
      title: t.surface,
      content: (
        <div className="flex flex-col gap-2">
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
          {technicalApplies && (
            <Switch
              testId="criteria-technical"
              label={t.includeTechnical}
              checked={draft.includeTechnical}
              onChange={(includeTechnical) => change({ includeTechnical })}
            />
          )}
        </div>
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
        className={`${PRIMARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent`}
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
      {message(field, draft.target, { language, distance: bounds.distance, gain: bounds.gain, unit })}
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
    unit,
  }: {
    language: Language;
    distance: { min: number; max: number };
    gain: { max: number };
    unit: { distance: string; gain: string };
  },
): string {
  const t = criteriaText[language];
  const messages: Record<CriteriaField, string> = {
    start: t.startError,
    target: target === 'distance' ? t.distanceError(distance.min, distance.max, unit.distance) : t.durationError,
    elevationGain: t.elevationGainError(gain.max, unit.gain),
    surface: t.surfaceError,
    pace: t.paceError,
    includeTechnical: t.includeTechnicalError,
  };
  return messages[field];
}
