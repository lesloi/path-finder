import { LoaderCircle } from 'lucide-react';

import { useDesktop } from '../components/index.ts';
import { routesText, type Language } from '../i18n/index.ts';
import { ROUTE_ROW_BOX } from './route-set-view.tsx';

// Rows drawn: enough to fill the panel without promising a number of routes. A phone shows the second one peeking.
const DESKTOP_ROWS = 3;
const PHONE_ROWS = 2;

const BAR = 'rounded-full bg-surface-2';

/** The outline of a `RouteRow`. */
function PlaceholderRow({ className }: { className: string }) {
  return (
    <div className={`${ROUTE_ROW_BOX} ${className}`}>
      <div className="flex items-center gap-3">
        <div className="size-13 flex-none rounded-sm bg-surface-2" />
        <div className="flex flex-none flex-col gap-2">
          <div className={`${BAR} h-5 w-16`} />
          <div className={`${BAR} h-3.5 w-24`} />
        </div>
        <div className={`${BAR} h-8 min-w-0 flex-1`} />
      </div>
      <div className={`${BAR} h-1.5 w-full`} />
    </div>
  );
}

/** What replaces the criteria while the API works. */
export function SearchingPanel({ language }: { language: Language }) {
  const desktop = useDesktop();
  return (
    <>
      <p
        role="status"
        data-testid="routes-loading"
        className="m-0 flex min-h-touch items-center justify-center gap-2 text-ink-2"
      >
        <LoaderCircle size={20} aria-hidden className="animate-spin motion-reduce:animate-none" />
        {routesText[language].finding}
      </p>
      {/* Outside the status: only its text is announced. */}
      {/* The lines of the route set above its rows: the count, then the pace, each as tall as its buttons. */}
      <div
        data-testid="routes-placeholder"
        aria-hidden
        className="flex animate-pulse flex-col gap-2 motion-reduce:animate-none"
      >
        <div className="flex min-h-touch items-center">
          <div className={`${BAR} h-4 w-24`} />
        </div>
        <div className="flex min-h-touch items-center">
          <div className={`${BAR} h-3.5 w-40`} />
        </div>
        <div className={desktop ? 'flex flex-col gap-2' : 'flex gap-2 overflow-hidden pb-1'}>
          {Array.from({ length: desktop ? DESKTOP_ROWS : PHONE_ROWS }, (_, index) => (
            <PlaceholderRow key={index} className={desktop ? '' : 'w-[88%] flex-none'} />
          ))}
        </div>
      </div>
    </>
  );
}
