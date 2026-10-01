import { commonText, type Language } from '../i18n/index.ts';

export type Units = 'metric' | 'imperial';

export const KM_PER_MILE = 1.609344;
export const METRES_PER_FOOT = 0.3048;

/** How an activity shows its pace: minutes per distance (run) or a speed (hike). */
export type PaceDisplay = 'pace' | 'speed';

export function paceUnit(display: PaceDisplay, units: Units): string {
  if (display === 'pace') return units === 'metric' ? 'min/km' : 'min/mi';
  return units === 'metric' ? 'km/h' : 'mph';
}

/** A pace in minutes per km, as "5:30" (min/km or min/mi) or "4.5" / "4,5" (km/h or mph). */
export function formatPace(minPerKm: number, display: PaceDisplay, units: Units, language: Language): string {
  const perUnit = units === 'metric' ? 1 : KM_PER_MILE;
  if (display === 'speed') {
    return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(60 / minPerKm / perUnit);
  }
  const seconds = Math.round(minPerKm * perUnit * 60);
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;
}

/** The pace in minutes per km that `formatPace` shows as `input`, or undefined if it is not one. */
export function parsePace(input: string, display: PaceDisplay, units: Units): number | undefined {
  const perUnit = units === 'metric' ? 1 : KM_PER_MILE;
  if (display === 'speed') {
    const speed = Number(input.trim().replace(',', '.'));
    return speed > 0 ? 60 / (speed * perUnit) : undefined;
  }
  const match = /^(\d{1,2})(?::([0-5]\d))?$/.exec(input.trim());
  if (!match) return undefined;
  const minutes = Number(match[1]) + Number(match[2] ?? 0) / 60;
  return minutes > 0 ? minutes / perUnit : undefined;
}

/** A distance in kilometres as "12.3 km", or "7.7 mi" in imperial units. */
export function formatDistance(km: number, units: Units, language: Language): string {
  const decimal = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return units === 'metric' ? `${decimal.format(km)} km` : `${decimal.format(km / KM_PER_MILE)} mi`;
}

/** A height or an elevation gain in metres as "340 m", or "1115 ft" in imperial units. */
export function formatHeight(metres: number, units: Units, language: Language): string {
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
