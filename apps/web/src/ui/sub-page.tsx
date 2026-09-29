import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Language } from '../language.ts';

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
    <div className="sub-page">
      <header className="sub-page-header">
        <a className="icon-button" href={back} aria-label={t.back}>
          <ArrowLeft aria-hidden />
        </a>
        <h1>{title}</h1>
      </header>
      <div className="sub-page-body">{children}</div>
    </div>
  );
}
