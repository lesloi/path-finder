import type { SurfaceStretch } from '../../../api/src/contract.ts';

/** A strip as wide as the route is long, painted paved or unpaved along it. */
export function SurfaceStrip({ surfaces, testId }: { surfaces: SurfaceStretch[]; testId?: string }) {
  let start = 0;
  return (
    <div data-testid={testId} className="relative h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      {surfaces.map(({ surface, share }, k) => {
        const left = start;
        start += share;
        return (
          <i
            key={k}
            data-surface={surface}
            className={`absolute inset-y-0 ${surface === 'paved' ? 'bg-paved' : 'bg-unpaved'}`}
            style={{ left: `${left * 100}%`, width: `${share * 100}%` }}
          />
        );
      })}
    </div>
  );
}
