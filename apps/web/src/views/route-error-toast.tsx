import { Toast } from '../components/index.ts';
import { errorText, routesText, type Language } from '../i18n/index.ts';
import type { Refusal } from '../state/index.ts';

// The lines of the toast: what happened, and what to try.
function linesFor(language: Language, refusal: Refusal): string[] {
  const t = routesText[language];
  switch (refusal.error) {
    case 'no-routes':
      return [t.noRoutes, t.noRoutesHint];
    case 'unreachable':
      return [t.unreachable, t.unreachableHint];
    case 'failed':
      return [t.failed, t.failedHint];
    case 'invalid-criteria':
      // The form lets nothing else through, so a field a refusal names is a point that is too far from a way.
      if (refusal.field === 'start') return [t.startTooFar, t.startTooFarHint];
      if (refusal.field !== 'waypoints') return [errorText[language]['invalid-criteria']];
      return refusal.waypoint === undefined
        ? [t.waypointsUnreachable]
        : [t.waypointTooFar(refusal.waypoint), t.waypointTooFarHint];
    default:
      return [errorText[language][refusal.error]];
  }
}

/** Why a request gave no routes, in the user's language; a click drops it. */
export function RouteErrorToast({
  language,
  refusal,
  onDismiss,
}: {
  language: Language;
  refusal: Refusal;
  onDismiss: () => void;
}) {
  const lines = linesFor(language, refusal);
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
