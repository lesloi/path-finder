import { useEffect, useEffectEvent } from 'react';

// Milliseconds a toast stays before it drops by itself.
export const TOAST_MS = 6_000;

/** Calls `dismiss` once a toast has been up for `TOAST_MS`: `shown` is what the toast says, undefined when there is none. */
export function useToastTimeout(shown: unknown, dismiss: () => void) {
  const drop = useEffectEvent(dismiss);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(drop, TOAST_MS);
    return () => clearTimeout(timer);
  }, [shown]);
}
