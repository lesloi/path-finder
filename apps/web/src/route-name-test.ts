import { routeName } from './route-name.ts';

const route = { distance: 12.34, elevationGain: 339.6 };
const date = new Date(2026, 8, 28, 12);

describe('routeName', () => {
  it('names a route after its activity and day, with its distance and elevation gain', () => {
    expect(routeName('run', date, route, { units: 'metric', language: 'fr' })).toBe(
      'Course · 28 sept. · 12,3 km · +340 m',
    );
    expect(routeName('hike', date, route, { units: 'metric', language: 'en' })).toBe(
      'Hike · Sep 28 · 12.3 km · +340 m',
    );
  });

  it('follows imperial units', () => {
    expect(routeName('run', date, route, { units: 'imperial', language: 'en' })).toBe(
      'Run · Sep 28 · 7.7 mi · +1114 ft',
    );
  });

  it('leaves out an unknown elevation gain', () => {
    expect(routeName('hike', date, { distance: 12.34 }, { units: 'metric', language: 'fr' })).toBe(
      'Randonnée · 28 sept. · 12,3 km',
    );
    expect(routeName('hike', date, { distance: 12.34 }, { units: 'imperial', language: 'en' })).toBe(
      'Hike · Sep 28 · 7.7 mi',
    );
  });
});
