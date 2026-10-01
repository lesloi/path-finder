import { Toast } from '../components/index.ts';
import { errorText, routesText, type Language } from '../i18n/index.ts';
import type { RouteSetError } from '../state/index.ts';

/** Why a request gave no routes, in the user's language; a click drops it. */
export function RouteErrorToast({
  language,
  error,
  onDismiss,
}: {
  language: Language;
  error: RouteSetError | 'no-routes';
  onDismiss: () => void;
}) {
  const t = routesText[language];
  const lines =
    error === 'no-routes'
      ? [t.noRoutes, t.noRoutesHint]
      : error === 'unreachable'
        ? [t.unreachable, t.unreachableHint]
        : error === 'failed'
          ? [t.failed, t.failedHint]
          : [errorText[language][error]];
  return (
    <Toast testId="routes-toast" onDismiss={onDismiss}>
      {lines[0]}
      {lines[1] && (
        <>
          <br />
          {lines[1]}
        </>
      )}
    </Toast>
  );
}
