import { commonText, type Language } from '../i18n/index.ts';

/** How a pace is written: minutes per km, or a speed in km/h. */
export type PaceUnit = 'min/km' | 'km/h';

export const PACE_UNITS: PaceUnit[] = ['min/km', 'km/h'];

/** A pace in minutes per km as seconds per km. */
export function paceSeconds(minPerKm: number): number {
  return Math.round(minPerKm * 60);
}

/** Seconds per km as a pace in minutes per km. */
export function paceFromSeconds(seconds: number): number {
  return seconds / 60;
}

/** A pace in minutes per km as a speed in km/h, and a speed in km/h as a pace: the one is the inverse of the other. */
export function invertPace(value: number): number {
  return 60 / value;
}

/** A pace in minutes per km as "5:30 min/km", or "10.9 km/h" as a speed. */
export function formatPace(minPerKm: number, paceUnit: PaceUnit, language: Language): string {
  if (paceUnit === 'km/h') return `${oneDecimal(language).format(invertPace(minPerKm))} km/h`;
  const seconds = paceSeconds(minPerKm);
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')} min/km`;
}

/** A number with one decimal, such as "12.3", or "12,3" in French. */
export const oneDecimal = (language: Language) =>
  new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A distance in kilometres as "12.3 km". */
export function formatDistance(km: number, language: Language): string {
  return `${oneDecimal(language).format(km)} km`;
}

/** A height or an elevation gain in metres as "340 m". */
export function formatHeight(metres: number, language: Language): string {
  const whole = new Intl.NumberFormat(language, { maximumFractionDigits: 0, useGrouping: false });
  return `${whole.format(metres)} m`;
}

/** A duration in minutes as "45 min", or "1 h 05" from an hour on. */
export function formatDuration(minutes: number, language: Language): string {
  const { hour, minute } = commonText[language];
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  if (hours === 0) return `${rounded} ${minute}`;
  return `${hours} ${hour} ${`${rounded % 60}`.padStart(2, '0')}`;
}
