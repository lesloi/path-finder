import type { SurfaceStretch } from '../../../api/src/contract.ts';

/** A strip as wide as the route is long, painted paved or unpaved along it. */
export function SurfaceStrip({ surfaces, testId }: { surfaces: SurfaceStretch[]; testId?: string }) {
  // Each stretch starts where the ones before it end.
  const starts = surfaces.map((_, k) => surfaces.slice(0, k).reduce((sum, { share }) => sum + share, 0));
  return (
    <div data-testid={testId} className="relative h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      {surfaces.map(({ surface, share }, k) => {
        return (
          <i
            key={k}
            data-surface={surface}
            className={`absolute inset-y-0 ${surface === 'paved' ? 'bg-paved' : 'bg-unpaved'}`}
            style={{ left: `${starts[k] * 100}%`, width: `${share * 100}%` }}
          />
        );
      })}
    </div>
  );
}
