import type { Language } from '../language.ts';

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
