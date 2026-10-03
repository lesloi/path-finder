import { Footprints, Info, Layers, Mountain, Ruler, Timer, TrendingUp, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  CriteriaError,
  MAX_TARGET_DISTANCE,
  MAX_TARGET_ELEVATION_GAIN,
  MIN_TARGET_DISTANCE,
  parseCriteria,
  TARGET_DURATION,
  type Criteria,
  type CriteriaField,
} from '../contract/index.ts';
import { CHIP, CHIP_ROW, Dialog, PRIMARY_BUTTON, SegmentedControl, Slider, useDesktop } from '../components/index.ts';
import {
  ACTIVITY_PACES,
  DEFAULT_ACTIVITY,
  formatDuration,
  KM_PER_MILE,
  METRES_PER_FOOT,
  type Activity,
  type Position,
  type RouteSetRequest,
  type Units,
} from '../core/index.ts';
import { commonText, criteriaText, type Language } from '../i18n/index.ts';
import { paceFor, useSettings } from '../state/index.ts';

const ACTIVITIES = Object.keys(ACTIVITY_PACES) as Activity[];
const ACTIVITY_ICONS = { run: Footprints, hike: Mountain } satisfies Record<Activity, LucideIcon>;

const CRITERIA = ['activity', 'target', 'elevation', 'surface'] as const;

const DURATION_STEP = 5; // minutes
const DURATION_DEFAULT = 60; // minutes

type Target = 'distance' | 'duration';
type Level = 'any' | 'flat' | 'hilly' | 'target';
type Surface = Criteria['surface'];
type Criterion = (typeof CRITERIA)[number];

// Distance in km or mi, elevation gain in m or ft: the user's units, which the bounds are shown in.
export type Draft = {
  target: Target;
  distance: number;
  duration: number;
  level: Level;
  gain: number;
  surface: Surface;
};

/** The bounds of the sliders in the user's units, inside the API's bounds once converted back. */
function boundsFor(activity: Activity, units: Units) {
  const { kmPerDistanceUnit, metresPerGainUnit, gainStep } = unitsFor(units);
  return {
    distance: {
      min: Math.ceil(MIN_TARGET_DISTANCE / kmPerDistanceUnit),
      max: Math.floor(MAX_TARGET_DISTANCE[activity] / kmPerDistanceUnit),
    },
    gain: { max: Math.floor(MAX_TARGET_ELEVATION_GAIN / metresPerGainUnit / gainStep) * gainStep },
  };
}

function unitsFor(units: Units) {
  return units === 'metric'
    ? { kmPerDistanceUnit: 1, metresPerGainUnit: 1, gainStep: 50, distance: 'km', gain: 'm', defaults: [10, 300] }
    : {
        kmPerDistanceUnit: KM_PER_MILE,
        metresPerGainUnit: METRES_PER_FOOT,
        gainStep: 100,
        distance: 'mi',
        gain: 'ft',
        defaults: [6, 1_000],
      };
}

function defaultDraft(units: Units): Draft {
  const [distance, gain] = unitsFor(units).defaults;
  return { target: 'distance', distance, duration: DURATION_DEFAULT, level: 'any', gain, surface: 'any' };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// The same distance and elevation gain in other units, as close as the sliders' steps allow.
function convert(draft: Draft, from: Units, to: Units): Draft {
  const a = unitsFor(from);
  const b = unitsFor(to);
  const gain = Math.round((draft.gain * a.metresPerGainUnit) / b.metresPerGainUnit / b.gainStep) * b.gainStep;
  return {
    ...draft,
    distance: Math.round((draft.distance * a.kmPerDistanceUnit) / b.kmPerDistanceUnit),
    gain,
  };
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * What the user has set in the form, in their units. It follows a change of units made in the
 * settings while the view stays mounted.
 */
export function useCriteriaDraft(): [Draft, (draft: Draft) => void] {
  const [{ units, lastActivity }] = useSettings();
  const [draft, setDraft] = useState(() => defaultDraft(units));
  const [unitsBefore, setUnitsBefore] = useState(units);
  if (units !== unitsBefore) {
    setUnitsBefore(units);
    // Converts what the slider shows, not a distance it had to clamp.
    const { distance } = boundsFor(lastActivity, unitsBefore);
    setDraft(convert({ ...draft, distance: clamp(draft.distance, distance.min, distance.max) }, unitsBefore, units));
  }
  return [draft, setDraft];
}

/**
 * The criteria of a route set: activity, target distance or duration, elevation gain, and
 * surface, over the user's settings. `onSubmit` receives a request body that `parseCriteria`
 * accepts. On a phone, `compact` shows chips that each open one criterion.
 */
export function CriteriaForm({
  language,
  start,
  draft: kept,
  compact = false,
  onSubmit,
}: {
  language: Language;
  start?: Position;
  /** From `useCriteriaDraft`, for a view that mounts the form in more than one place and keeps what was set. */
  draft?: ReturnType<typeof useCriteriaDraft>;
  compact?: boolean;
  onSubmit: (request: RouteSetRequest) => void;
}) {
  const t = { ...commonText[language], ...criteriaText[language] };
  const desktop = useDesktop();
  const [settings, update] = useSettings();
  const { units } = settings;
  const activity = settings.lastActivity;
  const own = useCriteriaDraft();
  const [draft, setDraft] = kept ?? own;
  const [open, setOpen] = useState<Criterion>();
  const [paceInfo, setPaceInfo] = useState(false);
  // The sheet expanded behind the dialog.
  if (open && !(compact && !desktop)) setOpen(undefined);

  const bounds = boundsFor(activity, units);
  const unit = unitsFor(units);
  // A new activity may have a shorter maximum distance.
  const distance = clamp(draft.distance, bounds.distance.min, bounds.distance.max);
  const gain = clamp(draft.gain, 0, bounds.gain.max);
  // The pace only turns a duration into a distance.
  const showPaceHint = draft.target === 'duration' && settings.pace[activity] === undefined;
  const level = draft.level;
  const change = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes });

  const request: RouteSetRequest | undefined = start && {
    start,
    activity,
    target:
      draft.target === 'distance'
        ? { distance: round(distance * unit.kmPerDistanceUnit, 2) }
        : { duration: draft.duration },
    ...(level === 'target' && { elevationGain: Math.round(gain * unit.metresPerGainUnit) }),
    ...((level === 'flat' || level === 'hilly') && { elevationGain: level }),
    surface: draft.surface,
    pace: paceFor(settings, activity),
  };
  const field = request && invalidField(request);

  const sections: Record<Criterion, { title: string; content: ReactNode }> = {
    activity: {
      title: t.activity,
      content: (
        <div role="group" data-testid="criteria-activity" aria-label={t.activity} className="flex gap-2">
          {ACTIVITIES.map((value) => {
            return (
              <button
                key={value}
                type="button"
                className={CHIP}
                data-testid={`criteria-activity-${value}`}
                data-set={value === activity ? '' : undefined}
                aria-pressed={value === activity}
                onClick={() => update({ lastActivity: value })}
              >
                <ActivityIcon activity={value} />
                {t.activities[value]}
              </button>
            );
          })}
        </div>
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
              aside={
                showPaceHint && (
                  <button
                    type="button"
                    className="flex min-h-touch items-center gap-1 text-sm text-accent"
                    data-testid="criteria-pace-info"
                    aria-expanded={paceInfo}
                    onClick={() => setPaceInfo(!paceInfo)}
                  >
                    <Info size={16} aria-hidden />
                    {t.aboutPace}
                  </button>
                )
              }
              min={TARGET_DURATION.min}
              max={TARGET_DURATION.max}
              step={DURATION_STEP}
              onChange={(value) => change({ duration: value })}
            />
          )}
          {showPaceHint && paceInfo && (
            <p className="text-sm text-ink-2">
              <a className="text-accent underline" data-testid="criteria-pace-link" href="#/settings">
                {t.adjustPace}
              </a>{' '}
              {t.adjustPaceHint}
            </p>
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

  const criteria = CRITERIA;
  const defaults = defaultDraft(units);
  const TargetIcon = draft.target === 'distance' ? Ruler : Timer;
  // `name` stands for the value on a chip that is the default, so two "Any" chips are told apart.
  const chips: Record<Criterion, { label: string; name?: string; icon?: ReactNode; set: boolean }> = {
    activity: {
      label: t.activities[activity],
      icon: <ActivityIcon activity={activity} />,
      set: activity !== DEFAULT_ACTIVITY,
    },
    target: {
      label: draft.target === 'distance' ? `${distance} ${unit.distance}` : formatDuration(draft.duration, language),
      icon: <TargetIcon size={18} aria-hidden />,
      set:
        draft.target === 'duration' || distance !== clamp(defaults.distance, bounds.distance.min, bounds.distance.max),
    },
    elevation: {
      label: level === 'target' ? `${gain} ${unit.gain}` : { any: t.any, flat: t.flat, hilly: t.hilly }[level],
      name: t.elevationChip,
      icon: <TrendingUp size={18} aria-hidden />,
      set: level !== 'any',
    },
    surface: {
      label: { paved: t.paved, any: t.anySurface, unpaved: t.unpaved }[draft.surface],
      name: t.surface,
      icon: <Layers size={18} aria-hidden />,
      set: draft.surface !== 'any',
    },
  };

  const findRoutes = request && !field && (
    <button type="button" className={PRIMARY_BUTTON} data-testid="criteria-submit" onClick={() => onSubmit(request)}>
      {t.findRoutes}
    </button>
  );
  const error = field && (
    <p role="alert" data-testid="criteria-error" className="text-sm text-ink">
      {message(field, draft.target, { language, distance: bounds.distance, gain: bounds.gain, unit })}
    </p>
  );

  if (compact && !desktop) {
    return (
      <>
        <div className={CHIP_ROW}>
          {criteria.map((criterion) => (
            <button
              key={criterion}
              type="button"
              className={CHIP}
              data-testid={`criteria-chip-${criterion}`}
              data-set={chips[criterion].set ? '' : undefined}
              aria-label={`${sections[criterion].title}: ${chips[criterion].label}`}
              onClick={() => setOpen(criterion)}
            >
              {chips[criterion].icon}
              {chips[criterion].set ? chips[criterion].label : (chips[criterion].name ?? chips[criterion].label)}
            </button>
          ))}
        </div>
        {error}
        {findRoutes}
        {open && (
          <Dialog
            testId="criteria-dialog"
            title={sections[open].title}
            closeLabel={t.close}
            onClose={() => setOpen(undefined)}
          >
            {sections[open].content}
            {/* The sheet is behind the dialog, and changes apply as they are made. */}
            {error && <div className="mt-2">{error}</div>}
          </Dialog>
        )}
      </>
    );
  }

  return (
    <>
      {criteria.map((criterion) => (
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

function ActivityIcon({ activity }: { activity: Activity }) {
  const Icon = ACTIVITY_ICONS[activity];
  return <Icon size={18} aria-hidden />;
}

// The first field `parseCriteria` rejects, as the API would.
function invalidField(request: RouteSetRequest): CriteriaField | undefined {
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
    activity: t.activityError,
    target: target === 'distance' ? t.distanceError(distance.min, distance.max, unit.distance) : t.durationError,
    elevationGain: t.elevationGainError(gain.max, unit.gain),
    surface: t.surfaceError,
    pace: t.paceError,
  };
  return messages[field];
}
