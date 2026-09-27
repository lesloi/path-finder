import { ACTIVITY_NAMES, type Activity } from './activity.ts';
import type { Language } from './language.ts';

export type Units = 'metric' | 'imperial';

const KM_PER_MILE = 1.609344;
const METRES_PER_FOOT = 0.3048;

/**
 * The route name: the activity, the day of the export, the distance, and the elevation gain
 * when known, such as "Course · 28 sept. · 12,3 km · +340 m". Nothing names where it starts.
 */
export function routeName(
  activity: Activity,
  date: Date,
  { distance, elevationGain }: { distance: number; elevationGain?: number },
  { units, language }: { units: Units; language: Language },
): string {
  const metric = units === 'metric';
  const day = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(date);
  const decimal = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const length = metric ? `${decimal.format(distance)} km` : `${decimal.format(distance / KM_PER_MILE)} mi`;
  const climb =
    elevationGain === undefined
      ? []
      : [metric ? `+${Math.round(elevationGain)} m` : `+${Math.round(elevationGain / METRES_PER_FOOT)} ft`];
  return [ACTIVITY_NAMES[activity][language], day, length, ...climb].join(' · ');
}
