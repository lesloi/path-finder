import { Suspense, useDeferredValue, useEffect, type ComponentType } from 'react';

import { LoadErrorBoundary, SubPage, lazyChunk, useTipDismiss } from './components/index.ts';
import { applyDescription } from './core/index.ts';
import { commonText, type Language } from './i18n/index.ts';
import { goTo, languageOf, useHash, useSettings } from './state/index.ts';
import { CriteriaView } from './views/index.ts';

// The pages load when opened: the map is what the first visit is for.
const pageLoaders = {
  settings: () => import('./views/settings-view.tsx').then((m) => ({ default: m.SettingsView })),
  credits: () => import('./views/legal/credits-page.tsx').then((m) => ({ default: m.CreditsPage })),
  privacy: () => import('./views/legal/privacy-policy-page.tsx').then((m) => ({ default: m.PrivacyPolicyPage })),
  legalNotice: () => import('./views/legal/legal-notice-page.tsx').then((m) => ({ default: m.LegalNoticePage })),
};
const SettingsView = lazyChunk(pageLoaders.settings);
const CreditsPage = lazyChunk(pageLoaders.credits);
const PrivacyPolicyPage = lazyChunk(pageLoaders.privacy);
const LegalNoticePage = lazyChunk(pageLoaders.legalNotice);

/** Fetches the code of every page, so the service worker keeps it for a visit offline. */
export async function preloadPages() {
  await Promise.all(Object.values(pageLoaders).map((load) => load()));
}

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
  const language = languageOf(settings);
  // A page shows once its code is there, with its content: until then the one on screen stays, or the map alone.
  const shownHash = useDeferredValue(hash);
  const page = pages[shownHash];
  useTipDismiss();

  useEffect(() => {
    document.documentElement.lang = language;
    applyDescription(commonText[language].description);
  }, [language]);

  return (
    <main>
      {/* The map says what the app is: the name is for screen readers. */}
      <h1 data-testid="app-title" className="sr-only">
        Path finder
      </h1>
      {/* Pages open over the map, which stays mounted so it keeps its view and start point. */}
      <CriteriaView language={language} pageOpen={Boolean(page)} />
      <Suspense fallback={null}>
        {page && (
          <SubPage
            title={commonText[language][page.title]}
            back={page.back}
            {...(page.wide && { wide: true })}
            language={language}
            navigate={goTo}
          >
            <LoadErrorBoundary key={shownHash} language={language}>
              <page.Page language={language} />
            </LoadErrorBoundary>
          </SubPage>
        )}
      </Suspense>
    </main>
  );
}
