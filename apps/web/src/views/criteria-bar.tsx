import { Pencil } from 'lucide-react';

import { criteriaText, type Language } from '../i18n/index.ts';

/**
 * The bar over the top of a phone's map: what the user asks for, and the start point once it is set. A tap
 * opens the criteria.
 */
export function CriteriaBar({
  language,
  summary,
  start,
  onClick,
}: {
  language: Language;
  /** The criteria in a line, such as "10.0 km · Hilly". */
  summary: string;
  /** The start point as coordinates; none until it is set. */
  start?: string | undefined;
  onClick: () => void;
}) {
  const t = criteriaText[language];
  return (
    <button
      type="button"
      data-testid="criteria-bar"
      // Next to the settings button, which is as wide as a touch target.
      className={
        'fixed top-safe-3 left-safe-3 z-5 flex h-touch items-center gap-3 rounded-full bg-surface px-4 text-left ' +
        'shadow-float right-[calc(env(safe-area-inset-right)+--spacing(3)+var(--spacing-touch)+--spacing(2))]'
      }
      aria-label={`${t.editCriteria}: ${[summary, start].filter(Boolean).join(', ')}`}
      onClick={onClick}
    >
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <strong className="truncate text-sm">{summary}</strong>
        {start && <span className="truncate text-sm text-ink-2">{start}</span>}
      </span>
      <Pencil size={18} aria-hidden className="flex-none text-ink-2" />
    </button>
  );
}
