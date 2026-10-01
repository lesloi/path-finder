import { useEffect, type ComponentType } from 'react';

import { SubPage } from './components/index.ts';
import { browserLanguage, commonText, type Language } from './i18n/index.ts';
import { goTo, useHash, useSettings } from './state/index.ts';
import { CreditsPage, CriteriaView, LegalNoticePage, PrivacyPolicyPage, SettingsView } from './views/index.ts';
// Each page by its hash, with its title and where its back arrow goes.
const pages: Record<
  string,
  {
    Page: ComponentType<{ language: Language }>;
    title: 'settings' | 'credits' | 'privacy' | 'legalNotice';
    back: string;
    wide?: boolean;
  }
> = {
  '#/settings': { Page: SettingsView, title: 'settings', back: '#/' },
  '#/credits': { Page: CreditsPage, title: 'credits', back: '#/settings', wide: true },
  '#/privacy': {
    Page: PrivacyPolicyPage,
    title: 'privacy',
    back: '#/settings',
    wide: true,
  },
  '#/legal-notice': {
    Page: LegalNoticePage,
    title: 'legalNotice',
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
      <h1 data-testid="app-title" className="sr-only">
        Path finder
      </h1>
      {/* Pages open over the map, which stays mounted so it keeps its view and start point. */}
      <CriteriaView language={language} pageOpen={Boolean(page)} />
      {page && (
        <SubPage
          title={commonText[language][page.title]}
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
