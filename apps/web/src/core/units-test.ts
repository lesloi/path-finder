import {
  formatDistance,
  formatDuration,
  formatHeight,
  formatPace,
  paceFromSeconds,
  paceSeconds,
  paceUnit,
} from './units.ts';

describe('formatDistance', () => {
  it.each([
    ['in kilometres', 12.34, 'metric', 'en', '12.3 km'],
    ['with a decimal comma in French', 12.34, 'metric', 'fr', '12,3 km'],
    ['in miles', 16.09344, 'imperial', 'en', '10.0 mi'],
    ['in miles with a decimal comma in French', 12.34, 'imperial', 'fr', '7,7 mi'],
  ] as const)('writes a distance %s', (_, km, units, language, expected) => {
    expect(formatDistance(km, { units, language })).toBe(expected);
  });
});

describe('formatHeight', () => {
  it.each([
    ['in metres', 339.6, 'metric', '340 m'],
    ['in feet', 339.6, 'imperial', '1114 ft'],
    ['without a thousands separator', 1_234, 'metric', '1234 m'],
  ] as const)('writes a height %s, in both languages', (_, metres, units, expected) => {
    expect(formatHeight(metres, { units, language: 'fr' })).toBe(expected);
    expect(formatHeight(metres, { units, language: 'en' })).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    ['under an hour in minutes', 45, '45 min'],
    ['from an hour in hours and minutes', 65, '1 h 05'],
    ['to the nearest minute', 84.6, '1 h 25'],
  ])('writes a duration %s, in both languages', (_, minutes, expected) => {
    expect(formatDuration(minutes, 'en')).toBe(expected);
    expect(formatDuration(minutes, 'fr')).toBe(expected);
  });
});

describe('pace', () => {
  it('is minutes per distance, never a speed', () => {
    expect(paceUnit('metric')).toBe('min/km');
    expect(paceUnit('imperial')).toBe('min/mi');
  });

  it.each([
    ['per kilometre', 5.5, 'metric', '5:30 min/km'],
    ['per mile', 5.5, 'imperial', '8:51 min/mi'],
  ] as const)('writes a pace %s', (_, minPerKm, units, expected) => {
    expect(formatPace(minPerKm, units)).toBe(expected);
  });

  it.each([
    ['per kilometre', 330, 'metric', 5.5],
    ['per mile', 480, 'imperial', 8 / 1.609344],
  ] as const)('goes from seconds %s to a pace in minutes per km, and back', (_, seconds, units, minPerKm) => {
    expect(paceFromSeconds(seconds, units)).toBeCloseTo(minPerKm, 10);
    expect(paceSeconds(minPerKm, units)).toBe(seconds);
  });
});
