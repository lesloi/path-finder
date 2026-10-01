import type { ReactNode } from 'react';

import { TOAST } from './styles.ts';

/** A short message at the top of the screen, as an alert: a click drops it. */
export function Toast({ testId, onDismiss, children }: { testId: string; onDismiss: () => void; children: ReactNode }) {
  return (
    <p className={TOAST} role="alert" data-testid={testId} onClick={onDismiss}>
      {children}
    </p>
  );
}
