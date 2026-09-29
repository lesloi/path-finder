import { useEffect, type ComponentType } from 'react';

import { CriteriaView } from './criteria-view.tsx';
import { browserLanguage, type Language } from './language.ts';
import { CreditsPage } from './legal/credits-page.tsx';
import { LegalNoticePage } from './legal/legal-notice-page.tsx';
import { PrivacyPolicyPage } from './legal/privacy-policy-page.tsx';
import { goTo, useHash } from './navigation.ts';
import { useSettings } from './settings.ts';
import { SettingsView } from './settings-view.tsx';
import { SubPage } from './ui/index.ts';

// Each page by its hash, with its title and where its back arrow goes.
const pages: Record<
  string,
  { Page: ComponentType<{ language: Language }>; title: Record<Language, string>; back: string; wide?: boolean }
> = {
  '#/settings': { Page: SettingsView, title: { en: 'Settings', fr: 'Réglages' }, back: '#/' },
  '#/credits': { Page: CreditsPage, title: { en: 'Credits', fr: 'Crédits' }, back: '#/settings', wide: true },
  '#/privacy': {
    Page: PrivacyPolicyPage,
    title: { en: 'Privacy policy', fr: 'Politique de confidentialité' },
    back: '#/settings',
    wide: true,
  },
  '#/legal-notice': {
    Page: LegalNoticePage,
    title: { en: 'Legal notice', fr: 'Mentions légales' },
    back: '#/settings',
    wide: true,
  },
};

export function App() {
  const hash = useHash();
  const [settings] = useSettings();
  const language = settings.language ?? browserLanguage(navigator.languages);
  const page = pages[hash];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <main>
      {/* The map says what the app is: the name is for screen readers. */}
      <h1 className="sr-only">Path finder</h1>
      {/* Pages open over the map, which stays mounted so it keeps its view and start point. */}
      <CriteriaView language={language} pageOpen={Boolean(page)} />
      {page && (
        <SubPage
          title={page.title[language]}
          back={page.back}
          {...(page.wide && { wide: true })}
          language={language}
          navigate={goTo}
        >
          <page.Page language={language} />
        </SubPage>
      )}
    </main>
  );
}
