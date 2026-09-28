import { useEffect, useSyncExternalStore, type ComponentType } from 'react';

import { CriteriaView } from './criteria-view.tsx';
import { browserLanguage, type Language } from './language.ts';
import { CreditsPage } from './legal/credits-page.tsx';
import { LegalNoticePage } from './legal/legal-notice-page.tsx';
import { PrivacyPolicyPage } from './legal/privacy-policy-page.tsx';
import { useSettings } from './settings.ts';
import { SettingsView } from './settings-view.tsx';

const text = {
  en: { back: 'Back', settings: 'Settings' },
  fr: { back: 'Retour', settings: 'Réglages' },
} satisfies Record<Language, unknown>;

// Each page by its hash, with where its back link goes.
const pages: Record<string, { Page: ComponentType<{ language: Language }>; back: string }> = {
  '#/settings': { Page: SettingsView, back: '#/' },
  '#/credits': { Page: CreditsPage, back: '#/settings' },
  '#/privacy': { Page: PrivacyPolicyPage, back: '#/settings' },
  '#/legal-notice': { Page: LegalNoticePage, back: '#/settings' },
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
  const t = text[language];
  const page = pages[hash];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  if (!page) {
    return (
      <main>
        <h1>Path finder</h1>
        <a href="#/settings">{t.settings}</a>
        <CriteriaView language={language} />
      </main>
    );
  }
  return (
    <main>
      <a href={page.back}>{t.back}</a>
      <page.Page language={language} />
    </main>
  );
}
