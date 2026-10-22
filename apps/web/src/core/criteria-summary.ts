import { criteriaText, type Language } from '../i18n/index.ts';
import type { RouteSetRequest } from './route.ts';
import { formatDistance, formatDuration, formatHeight } from './units.ts';

/** What the user asked for in a line, such as "10.0 km · Hilly · Unpaved". The start point is left out. */
export function criteriaSummary(
  { target, elevationGain, surface, waypoints }: RouteSetRequest,
  language: Language,
): string {
  const t = criteriaText[language];
  // The destination sets the distance of an out-and-back route: there is none to say.
  const parts = !target
    ? [t.outAndBack]
    : ['distance' in target ? formatDistance(target.distance, language) : formatDuration(target.duration, language)];
  if (elevationGain !== undefined) {
    parts.push(
      elevationGain === 'flat' ? t.flat : elevationGain === 'hilly' ? t.hilly : formatHeight(elevationGain, language),
    );
  }
  if (surface !== 'any') parts.push(t[surface]);
  if (waypoints?.length) parts.push(t.waypointCount(waypoints.length));
  return parts.join(' · ');
}
