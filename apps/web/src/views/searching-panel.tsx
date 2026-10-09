import { LoaderCircle } from 'lucide-react';

import { routesText, type Language } from '../i18n/index.ts';

/** What replaces the criteria while the API works. */
export function SearchingPanel({ language }: { language: Language }) {
  return (
    <p
      role="status"
      data-testid="routes-loading"
      className="m-0 flex min-h-touch items-center justify-center gap-2 text-ink-2"
    >
      <LoaderCircle size={20} aria-hidden className="animate-spin motion-reduce:animate-none" />
      {routesText[language].finding}
    </p>
  );
}
