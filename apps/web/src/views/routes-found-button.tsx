import { ChevronRight, Route } from 'lucide-react';

import { LIST_ROW_CHEVRON } from '../components/index.ts';
import { routesText, type Language } from '../i18n/index.ts';

/** A way back to the routes found, above the criteria that were left for them. */
export function RoutesFoundButton({
  language,
  count,
  onClick,
}: {
  language: Language;
  count: number;
  onClick: () => void;
}) {
  const t = routesText[language];
  return (
    <button
      type="button"
      data-testid="criteria-routes"
      className="flex min-h-touch w-full flex-none items-center gap-3 rounded-md bg-accent-soft px-3 text-left font-semibold text-accent"
      aria-label={t.showRoutes(count)}
      onClick={onClick}
    >
      <Route size={18} aria-hidden className="flex-none" />
      <span className="flex-1">{t.routeCount(count)}</span>
      <ChevronRight size={18} aria-hidden className={LIST_ROW_CHEVRON} />
    </button>
  );
}
