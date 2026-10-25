import { criteriaText, type Language } from '../i18n/index.ts';

/** A bare "2/5" would be read "2 slash 5": the screen reader gets the words, and skips the symbols. */
export function CountOfMax({
  language,
  count,
  max,
  testId,
}: {
  language: Language;
  count: number;
  max: number;
  testId: string;
}) {
  // The max matters as the list fills; the first item already shows it, and an empty form stays bare.
  if (count === 0) return null;
  return (
    <span data-testid={testId} className="text-sm text-ink-2 tabular-nums">
      <span aria-hidden>
        {count}/{max}
      </span>
      <span className="sr-only">{criteriaText[language].countOfMax(count, max)}</span>
    </span>
  );
}
