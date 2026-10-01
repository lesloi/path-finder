import { commonText, criteriaText, type Language } from '../i18n/index.ts';
import type { RouteSetRequest } from './route.ts';
import { formatDistance, formatDuration, formatHeight, type Units } from './units.ts';

/** What the user asked for in a line, such as "Run · 10.0 km · Hilly · Unpaved". The start point is left out. */
export function criteriaSummary(
  { activity, target, elevationGain, surface }: RouteSetRequest,
  { units, language }: { units: Units; language: Language },
): string {
  const t = criteriaText[language];
  const parts = [
    commonText[language].activities[activity],
    'distance' in target ? formatDistance(target.distance, units, language) : formatDuration(target.duration, language),
  ];
  if (elevationGain !== undefined) {
    parts.push(
      elevationGain === 'flat'
        ? t.flat
        : elevationGain === 'hilly'
          ? t.hilly
          : formatHeight(elevationGain, units, language),
    );
  }
  if (surface !== 'any') parts.push(t[surface]);
  return parts.join(' · ');
}
