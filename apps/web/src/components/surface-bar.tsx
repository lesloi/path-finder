import { SURFACE_CLASSES } from './surface-colors.ts';

/**
 * A route's surface at a glance: one bar in two segments, paved then unpaved, each as wide as its share.
 * `unpavedShare` is within 0 and 1. A segment with no share is left out. `label` is the bar's accessible name, which spells the shares.
 */
export function SurfaceBar({ unpavedShare, label, testId }: { unpavedShare: number; label: string; testId?: string }) {
  const segments = [
    { surface: 'paved', share: 1 - unpavedShare },
    { surface: 'unpaved', share: unpavedShare },
  ] as const;
  return (
    <span data-testid={testId} role="img" aria-label={label} className="flex h-1.5 w-full overflow-hidden rounded-full">
      {segments.map(
        ({ surface, share }) =>
          share > 0 && (
            <i
              key={surface}
              data-testid={testId && `${testId}-${surface}`}
              className={SURFACE_CLASSES[surface].dot}
              style={{ width: `${share * 100}%` }}
            />
          ),
      )}
    </span>
  );
}
