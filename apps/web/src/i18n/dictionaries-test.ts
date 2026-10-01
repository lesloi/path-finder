import { commonText } from './common.ts';
import { criteriaText } from './criteria.ts';
import { errorText } from './errors.ts';
import { settingsText } from './settings.ts';

// The shape of a dictionary: its keys, and whether each leaf is a string or a function.
function shape(value: unknown): unknown {
  if (typeof value === 'function') return 'function';
  if (typeof value === 'string') return 'string';
  return Object.fromEntries(Object.entries(value as object).map(([key, leaf]) => [key, shape(leaf)]));
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [];
  return Object.values(value as object).flatMap(strings);
}

describe.each([
  ['common', commonText],
  ['criteria', criteriaText],
  ['errors', errorText],
  ['settings', settingsText],
])('the %s dictionary', (_, dictionary) => {
  it('has the same keys in English and French', () => {
    expect(shape(dictionary.fr)).toEqual(shape(dictionary.en));
  });

  it('has no empty label', () => {
    expect([...strings(dictionary.en), ...strings(dictionary.fr)]).not.toContain('');
  });
});

describe('the criteria dictionary', () => {
  it.each(['en', 'fr'] as const)('words its parameterized messages in %s', (language) => {
    const { distanceError, elevationGainError } = criteriaText[language];

    expect(distanceError(1, 50, 'km')).toContain('1');
    expect(distanceError(1, 50, 'km')).toContain('50 km');
    expect(elevationGainError(5_000, 'm')).toContain('5000 m');
  });
});
