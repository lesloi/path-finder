import {
  formatDistance,
  formatDuration,
  formatHeight,
  formatPace,
  paceFromSeconds,
  paceSeconds,
  invertPace,
} from './units.ts';

describe('formatDistance', () => {
  it.each([
    ['in kilometres', 12.34, 'en', '12.3 km'],
    ['with a decimal comma in French', 12.34, 'fr', '12,3 km'],
  ] as const)('writes a distance %s', (_, km, language, expected) => {
    expect(formatDistance(km, language)).toBe(expected);
  });
});

describe('formatHeight', () => {
  it.each([
    ['in metres', 339.6, '340 m'],
    ['without a thousands separator', 1_234, '1234 m'],
  ] as const)('writes a height %s, in both languages', (_, metres, expected) => {
    expect(formatHeight(metres, 'fr')).toBe(expected);
    expect(formatHeight(metres, 'en')).toBe(expected);
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
  it.each([
    ['in minutes per km', 5.5, 'min/km', 'en', '5:30 min/km'],
    ['in km/h', 5.5, 'km/h', 'en', '10.9 km/h'],
    ['in km/h with a decimal comma in French', 5.5, 'km/h', 'fr', '10,9 km/h'],
  ] as const)('writes a pace %s', (_, minPerKm, paceUnit, language, expected) => {
    expect(formatPace(minPerKm, paceUnit, language)).toBe(expected);
  });

  it('goes from seconds per km to a pace in minutes per km, and back', () => {
    expect(paceFromSeconds(330)).toBe(5.5);
    expect(paceSeconds(5.5)).toBe(330);
  });

  it('goes from a speed in km/h to a pace in minutes per km, and back', () => {
    expect(invertPace(12)).toBe(5);
    expect(invertPace(5)).toBe(12);
  });
});
