import { criteriaSummary } from './criteria-summary.ts';
import type { RouteSetRequest } from './route.ts';

const request: RouteSetRequest = {
  start: [6.1294, 45.8992],
  activity: 'run',
  target: { distance: 10 },
  surface: 'any',
  pace: 6,
};
const metric = { units: 'metric', language: 'en' } as const;

describe('criteriaSummary', () => {
  it('names the activity and the target distance', () => {
    expect(criteriaSummary(request, metric)).toBe('Run · 10.0 km');
  });

  it('gives the target duration instead of a distance', () => {
    expect(criteriaSummary({ ...request, target: { duration: 75 } }, metric)).toBe('Run · 1 h 15');
  });

  it.each([
    ['a flat target', 'flat', 'Run · 10.0 km · Flat'],
    ['a hilly target', 'hilly', 'Run · 10.0 km · Hilly'],
    ['a target elevation gain', 300, 'Run · 10.0 km · 300 m'],
  ] as const)('adds %s', (_, elevationGain, expected) => {
    expect(criteriaSummary({ ...request, elevationGain }, metric)).toBe(expected);
  });

  it('adds a surface preference', () => {
    expect(criteriaSummary({ ...request, surface: 'unpaved' }, metric)).toBe('Run · 10.0 km · Unpaved');
  });

  it('follows the units and the language', () => {
    expect(
      criteriaSummary(
        { ...request, activity: 'hike', elevationGain: 300, surface: 'paved' },
        { units: 'imperial', language: 'fr' },
      ),
    ).toBe('Randonnée · 6,2 mi · 984 ft · Goudronné');
  });
});
