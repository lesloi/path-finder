import { ArrowLeft, X } from 'lucide-react';
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';

import type { Language } from '../language.ts';
import { ICON_BUTTON } from './styles.ts';
import { useDesktop } from './use-desktop.ts';

// Where closing a page leads: the map.
const HOME = '#/';

const text = {
  en: { back: 'Back', close: 'Close' },
  fr: { back: 'Retour', close: 'Fermer' },
} satisfies Record<Language, unknown>;

/**
 * A modal page over the map: full screen on phones, with a back arrow to `back`; centred on
 * desktops, with a cross that closes every page, and the back arrow only for a page within a
 * page. Escape goes to `back`, and a click on the scrim closes every page.
 */
export function SubPage({
  title,
  back,
  wide = false,
  language,
  navigate,
  children,
}: {
  title: string;
  back: string;
  /** Long text, such as the legal pages. */
  wide?: boolean;
  language: Language;
  /** Shows the page at a hash, for the arrow, the cross, Escape, and the scrim. */
  navigate: (hash: string) => void;
  children: ReactNode;
}) {
  const t = text[language];
  const desktop = useDesktop();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  // Modal: the map and its controls are out of reach until the page closes.
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  // Screen reader and keyboard users start from the page they just opened.
  useEffect(() => heading.current?.focus(), [title]);

  // The links keep their href for a middle click; a plain click leaves the way `navigate` does.
  const follow = (hash: string) => (event: MouseEvent) => {
    event.preventDefault();
    navigate(hash);
  };

  return (
    <dialog
      ref={dialog}
      data-testid="sub-page"
      aria-labelledby={headingId}
      className={
        'fixed inset-0 m-0 flex h-dvh max-h-none w-full max-w-none flex-col bg-surface text-ink ' +
        'backdrop:bg-scrim desktop:m-auto desktop:max-h-[calc(100dvh-(--spacing(12)))] desktop:rounded-md ' +
        'desktop:h-fit desktop:shadow-float ' +
        (wide ? 'desktop:w-160' : 'desktop:w-120')
      }
      // Escape goes back, as the arrow does.
      onCancel={(event) => {
        event.preventDefault();
        navigate(back);
      }}
      // A click outside the page lands on the dialog itself, over its scrim.
      onClick={(event) => event.target === event.currentTarget && navigate(HOME)}
    >
      <header
        className={
          'flex min-h-[calc(--spacing(14)+env(safe-area-inset-top))] flex-none items-center gap-1 border-b ' +
          'border-border pt-safe-0 pr-safe-2 pl-safe-2'
        }
      >
        {(!desktop || back !== HOME) && (
          <a className={ICON_BUTTON} data-testid="sub-page-back" href={back} aria-label={t.back} onClick={follow(back)}>
            <ArrowLeft aria-hidden />
          </a>
        )}
        <h1
          ref={heading}
          id={headingId}
          data-testid="sub-page-title"
          className={`text-lg font-bold outline-none ${desktop && back === HOME ? 'pl-2' : ''}`}
          tabIndex={-1}
        >
          {title}
        </h1>
        {desktop && (
          <a
            className={`${ICON_BUTTON} ml-auto`}
            data-testid="sub-page-close"
            href={HOME}
            aria-label={t.close}
            onClick={follow(HOME)}
          >
            <X aria-hidden />
          </a>
        )}
      </header>
      {/* Only the content scrolls, below the header. */}
      <div className="min-h-0 flex-1 overflow-y-auto pt-4 pr-safe-4 pb-safe-6 pl-safe-4">{children}</div>
    </dialog>
  );
}
