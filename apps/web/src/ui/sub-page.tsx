import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Language } from '../language.ts';
import { ICON_BUTTON } from './styles.ts';

const text = {
  en: { back: 'Back' },
  fr: { back: 'Retour' },
} satisfies Record<Language, unknown>;

/** A full-screen page over the map, with a header whose back arrow goes to `back`. */
export function SubPage({
  title,
  back,
  language,
  children,
}: {
  title: string;
  back: string;
  language: Language;
  children: ReactNode;
}) {
  const t = text[language];
  return (
    <div className="fixed inset-0 z-10 overflow-y-auto bg-surface pb-safe-0">
      <header
        className={
          'sticky top-0 z-1 flex min-h-[calc(56px+env(safe-area-inset-top))] items-center gap-1 border-b ' +
          'border-border bg-surface pt-safe-0 pr-safe-2 pl-safe-2'
        }
      >
        <a className={ICON_BUTTON} href={back} aria-label={t.back}>
          <ArrowLeft aria-hidden />
        </a>
        <h1 className="text-lg font-bold">{title}</h1>
      </header>
      <div
        className="mx-auto max-w-140 pt-4 pr-safe-4 pb-6 pl-safe-4"
      >
        {children}
      </div>
    </div>
  );
}
