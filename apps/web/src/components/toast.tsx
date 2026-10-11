import type { KeyboardEvent, ReactNode } from 'react';

import { TOAST } from './styles.ts';

const DISMISSING_KEYS = ['Enter', ' ', 'Escape'];

/** A short message at the top of the screen, as an alert: a click, or Enter, Space or Escape on it, drops it. */
export function Toast({ testId, onDismiss, children }: { testId: string; onDismiss: () => void; children: ReactNode }) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!DISMISSING_KEYS.includes(event.key)) return;
    event.preventDefault();
    onDismiss();
  };
  return (
    <p className={TOAST} role="alert" tabIndex={0} data-testid={testId} onClick={onDismiss} onKeyDown={onKeyDown}>
      {children}
    </p>
  );
}
