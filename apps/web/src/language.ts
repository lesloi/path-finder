export type Language = 'fr' | 'en';

/** The first French or English entry of the browser's preferred languages, else English. */
export function browserLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.split('-')[0].toLowerCase();
    if (base === 'fr' || base === 'en') return base;
  }
  return 'en';
}
