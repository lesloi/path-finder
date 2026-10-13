import { Toast } from '../components/index.ts';
import { errorText, routesText, type Language } from '../i18n/index.ts';
import type { InvalidCriteria, RouteSetError } from '../state/index.ts';

// The form lets nothing else through, so the field a refusal names is a point that is too far from a way.
function invalidLines(language: Language, invalid?: InvalidCriteria): string[] {
  const t = routesText[language];
  if (invalid?.field === 'start') return [t.startTooFar, t.startTooFarHint];
  if (invalid?.field !== 'waypoints') return [errorText[language]['invalid-criteria']];
  return invalid.waypoint === undefined
    ? [t.waypointsUnreachable, t.waypointsUnreachableHint]
    : [t.waypointTooFar(invalid.waypoint), t.waypointTooFarHint];
}

/** Why a request gave no routes, in the user's language; a click drops it. */
export function RouteErrorToast({
  language,
  error,
  invalid,
  onDismiss,
}: {
  language: Language;
  error: RouteSetError | 'no-routes';
  /** What an `invalid-criteria` refusal named, to tell the user which point to fix. */
  invalid?: InvalidCriteria;
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
          : error === 'invalid-criteria'
            ? invalidLines(language, invalid)
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
