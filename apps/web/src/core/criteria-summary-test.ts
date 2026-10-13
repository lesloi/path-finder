import { criteriaText } from '../i18n/index.ts';
import { criteriaSummary } from './criteria-summary.ts';
import type { RouteSetRequest } from './route.ts';

const request: RouteSetRequest = {
  start: [6.1294, 45.8992],
  target: { distance: 10 },
  surface: 'any',
  pace: 6,
};
const metric = 'en';

describe('criteriaSummary', () => {
  it('names the target distance', () => {
    expect(criteriaSummary(request, metric)).toBe('10.0 km');
  });

  it('gives the target duration instead of a distance', () => {
    expect(criteriaSummary({ ...request, target: { duration: 75 } }, metric)).toBe('1 h 15');
  });

  it.each([
    ['a flat target', 'flat', `10.0 km · ${criteriaText.en.flat}`],
    ['a hilly target', 'hilly', `10.0 km · ${criteriaText.en.hilly}`],
    ['a target elevation gain', 300, `10.0 km · 300 m`],
  ] as const)('adds %s', (_, elevationGain, expected) => {
    expect(criteriaSummary({ ...request, elevationGain }, metric)).toBe(expected);
  });

  it('adds a surface preference', () => {
    expect(criteriaSummary({ ...request, surface: 'unpaved' }, metric)).toBe(`10.0 km · ${criteriaText.en.unpaved}`);
  });

  it('counts the waypoints', () => {
    const waypoints: [number, number][] = [
      [6.1, 45.9],
      [6.2, 45.9],
    ];

    expect(criteriaSummary({ ...request, waypoints: [waypoints[0]!] }, metric)).toBe('10.0 km · 1 waypoint');
    expect(criteriaSummary({ ...request, waypoints }, metric)).toBe('10.0 km · 2 waypoints');
    expect(criteriaSummary({ ...request, waypoints }, 'fr')).toBe('10,0 km · 2 points de passage');
  });

  it('follows the language', () => {
    expect(criteriaSummary({ ...request, elevationGain: 300, surface: 'paved' }, 'fr')).toBe(
      `10,0 km · 300 m · ${criteriaText.fr.paved}`,
    );
  });
});
