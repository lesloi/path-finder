import { browserLanguage } from './language.ts';

describe('browserLanguage', () => {
  it('picks French when the browser prefers French', () => {
    expect(browserLanguage(['fr-FR', 'en-US'])).toBe('fr');
  });

  it('picks the first supported language', () => {
    expect(browserLanguage(['de-DE', 'fr', 'en'])).toBe('fr');
  });

  it('falls back to English', () => {
    expect(browserLanguage(['de-DE'])).toBe('en');
    expect(browserLanguage([])).toBe('en');
  });
});
