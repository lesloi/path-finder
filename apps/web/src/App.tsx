import { useEffect, useSyncExternalStore, type ComponentType } from 'react';

import { CriteriaView } from './criteria-view.tsx';
import { browserLanguage, type Language } from './language.ts';
import { CreditsPage } from './legal/credits-page.tsx';
import { LegalNoticePage } from './legal/legal-notice-page.tsx';
import { PrivacyPolicyPage } from './legal/privacy-policy-page.tsx';
import { useSettings } from './settings.ts';
import { SettingsView } from './settings-view.tsx';
import { SubPage } from './ui/index.ts';

// Each page by its hash, with its title and where its back arrow goes.
const pages: Record<
  string,
  { Page: ComponentType<{ language: Language }>; title: Record<Language, string>; back: string }
> = {
  '#/settings': { Page: SettingsView, title: { en: 'Settings', fr: 'Réglages' }, back: '#/' },
  '#/credits': { Page: CreditsPage, title: { en: 'Credits', fr: 'Crédits' }, back: '#/settings' },
  '#/privacy': {
    Page: PrivacyPolicyPage,
    title: { en: 'Privacy policy', fr: 'Politique de confidentialité' },
    back: '#/settings',
  },
  '#/legal-notice': {
    Page: LegalNoticePage,
    title: { en: 'Legal notice', fr: 'Mentions légales' },
    back: '#/settings',
  },
};

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

// Hash URLs keep the browser back button working without server-side routes.
function useHash() {
  return useSyncExternalStore(subscribeToHash, () => window.location.hash);
}

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
      {/* Pages open over the map, which stays mounted so it keeps its view and start point. */}
      <div inert={Boolean(page)}>
        {/* The map says what the app is: the name is for screen readers. */}
        <h1 className="sr-only">Path finder</h1>
        <CriteriaView language={language} />
      </div>
      {page && (
        <SubPage title={page.title[language]} back={page.back} language={language}>
          <page.Page language={language} />
        </SubPage>
      )}
    </main>
  );
}
