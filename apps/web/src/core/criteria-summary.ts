import { criteriaText } from '../i18n/index.ts';
import type { RouteSetRequest } from './route.ts';
import { formatDistance, formatDuration, formatHeight, type Display } from './units.ts';

/** What the user asked for in a line, such as "10.0 km · Hilly · Unpaved". The start point is left out. */
export function criteriaSummary({ target, elevationGain, surface }: RouteSetRequest, display: Display): string {
  const { language } = display;
  const t = criteriaText[language];
  const parts = [
    'distance' in target ? formatDistance(target.distance, display) : formatDuration(target.duration, display.language),
  ];
  if (elevationGain !== undefined) {
    parts.push(
      elevationGain === 'flat' ? t.flat : elevationGain === 'hilly' ? t.hilly : formatHeight(elevationGain, display),
    );
  }
  if (surface !== 'any') parts.push(t[surface]);
  return parts.join(' · ');
}
