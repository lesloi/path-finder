import { commonText, type Language } from '../i18n/index.ts';

export type Units = 'metric' | 'imperial';

/** How figures are written: in the user's units and language. */
export type Display = { units: Units; language: Language };

export const KM_PER_MILE = 1.609344;
export const METRES_PER_FOOT = 0.3048;

const kmPerDistanceUnit = (units: Units) => (units === 'metric' ? 1 : KM_PER_MILE);

/** The unit of a pace: minutes per distance, never a speed. */
export function paceUnit(units: Units): string {
  return units === 'metric' ? 'min/km' : 'min/mi';
}

/** A pace in minutes per km as seconds per km, or per mile in imperial units. */
export function paceSeconds(minPerKm: number, units: Units): number {
  return Math.round(minPerKm * kmPerDistanceUnit(units) * 60);
}

/** Seconds per km, or per mile in imperial units, as a pace in minutes per km. */
export function paceFromSeconds(seconds: number, units: Units): number {
  return seconds / 60 / kmPerDistanceUnit(units);
}

/** A pace in minutes per km as "5:30 min/km", or "8:51 min/mi" in imperial units. */
export function formatPace(minPerKm: number, units: Units): string {
  const seconds = paceSeconds(minPerKm, units);
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')} ${paceUnit(units)}`;
}

/** A distance in kilometres as "12.3 km", or "7.7 mi" in imperial units. */
export function formatDistance(km: number, { units, language }: Display): string {
  const decimal = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return units === 'metric' ? `${decimal.format(km)} km` : `${decimal.format(km / KM_PER_MILE)} mi`;
}

/** A height or an elevation gain in metres as "340 m", or "1115 ft" in imperial units. */
export function formatHeight(metres: number, { units, language }: Display): string {
  const whole = new Intl.NumberFormat(language, { maximumFractionDigits: 0, useGrouping: false });
  return units === 'metric' ? `${whole.format(metres)} m` : `${whole.format(metres / METRES_PER_FOOT)} ft`;
}

/** A duration in minutes as "45 min", or "1 h 05" from an hour on. */
export function formatDuration(minutes: number, language: Language): string {
  const { hour, minute } = commonText[language];
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  if (hours === 0) return `${rounded} ${minute}`;
  return `${hours} ${hour} ${`${rounded % 60}`.padStart(2, '0')}`;
}
