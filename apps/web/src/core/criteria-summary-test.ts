import { commonText, criteriaText } from '../i18n/index.ts';
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
const run = commonText.en.activities.run;

describe('criteriaSummary', () => {
  it('names the activity and the target distance', () => {
    expect(criteriaSummary(request, metric)).toBe(`${run} · 10.0 km`);
  });

  it('gives the target duration instead of a distance', () => {
    expect(criteriaSummary({ ...request, target: { duration: 75 } }, metric)).toBe(`${run} · 1 h 15`);
  });

  it.each([
    ['a flat target', 'flat', `${run} · 10.0 km · ${criteriaText.en.flat}`],
    ['a hilly target', 'hilly', `${run} · 10.0 km · ${criteriaText.en.hilly}`],
    ['a target elevation gain', 300, `${run} · 10.0 km · 300 m`],
  ] as const)('adds %s', (_, elevationGain, expected) => {
    expect(criteriaSummary({ ...request, elevationGain }, metric)).toBe(expected);
  });

  it('adds a surface preference', () => {
    expect(criteriaSummary({ ...request, surface: 'unpaved' }, metric)).toBe(
      `${run} · 10.0 km · ${criteriaText.en.unpaved}`,
    );
  });

  it('follows the units and the language', () => {
    expect(
      criteriaSummary(
        { ...request, activity: 'hike', elevationGain: 300, surface: 'paved' },
        { units: 'imperial', language: 'fr' },
      ),
    ).toBe(`${commonText.fr.activities.hike} · 6,2 mi · 984 ft · ${criteriaText.fr.paved}`);
  });
});
