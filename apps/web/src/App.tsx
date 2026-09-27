import { useSyncExternalStore, type ReactNode } from 'react';

import { browserLanguage, type Language } from './language.ts';
import { CreditsPage } from './legal/credits-page.tsx';
import { LegalNoticePage } from './legal/legal-notice-page.tsx';
import { PrivacyPolicyPage } from './legal/privacy-policy-page.tsx';
import { SettingsView } from './settings-view.tsx';

const backLabel: Record<Language, string> = { en: 'Back', fr: 'Retour' };
const settingsLabel: Record<Language, string> = { en: 'Settings', fr: 'Réglages' };

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
  const language = browserLanguage(navigator.languages);

  switch (hash) {
    case '#/settings':
      return (
        <Page language={language} back="#/">
          <SettingsView language={language} />
        </Page>
      );
    case '#/credits':
      return (
        <Page language={language} back="#/settings">
          <CreditsPage language={language} />
        </Page>
      );
    case '#/privacy':
      return (
        <Page language={language} back="#/settings">
          <PrivacyPolicyPage language={language} />
        </Page>
      );
    case '#/legal-notice':
      return (
        <Page language={language} back="#/settings">
          <LegalNoticePage language={language} />
        </Page>
      );
    default:
      return (
        <main>
          <h1>Path finder</h1>
          <a href="#/settings">{settingsLabel[language]}</a>
        </main>
      );
  }
}

function Page({
  language,
  back,
  children,
}: {
  language: Language;
  back: string;
  children: ReactNode;
}) {
  return (
    <main>
      <a href={back}>{backLabel[language]}</a>
      {children}
    </main>
  );
}
