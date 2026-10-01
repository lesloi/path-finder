import { commonText } from './common.ts';
import { criteriaText } from './criteria.ts';
import { errorText } from './errors.ts';
import { legalText, type Paragraph, type Section } from './legal.ts';
import { routesText } from './routes.ts';
import { LINKS } from './links.ts';
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
  ['legal', legalText],
  ['routes', routesText],
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

describe('the legal dictionary', () => {
  const pages = (language: 'en' | 'fr'): Section[][] => [
    legalText[language].credits,
    legalText[language].privacy,
    legalText[language].legalNotice,
  ];
  const paragraphs = (language: 'en' | 'fr'): Paragraph[] =>
    pages(language)
      .flat()
      .flatMap(({ blocks }) => blocks.flatMap((block) => ('paragraph' in block ? [block.paragraph] : block.list)));

  it.each(['en', 'fr'] as const)('gives every link of a paragraph its address and its words in %s', (language) => {
    for (const { text, links = {} } of paragraphs(language)) {
      const ids = [...text.matchAll(/\{(\w+)\}/g)].map(([, id]) => id);

      expect(Object.keys(links).sort()).toEqual([...ids].sort());
      expect(ids.every((id) => id in LINKS)).toBe(true);
    }
  });

  it('has unique section ids on each page', () => {
    for (const sections of pages('en')) {
      const ids = sections.map(({ id }) => id);

      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
