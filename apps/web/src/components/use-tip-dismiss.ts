import { useEffect } from 'react';

/**
 * Lets Escape dismiss the tooltip (`data-tip`) a pointer or the focus holds open, without moving either (WCAG
 * 1.4.13); it comes back once the pointer or the focus has left the element.
 */
export function useTipDismiss() {
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      for (const element of document.querySelectorAll('[data-tip]:hover, [data-tip]:focus-visible')) {
        element.setAttribute('data-tip-dismissed', '');
      }
    };
    const restore = (event: Event) => {
      if (event.target instanceof Element) event.target.closest('[data-tip]')?.removeAttribute('data-tip-dismissed');
    };
    document.addEventListener('keydown', dismiss);
    // `pointerleave` does not bubble: the capture phase catches it on the way down.
    document.addEventListener('pointerleave', restore, true);
    document.addEventListener('focusout', restore);
    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerleave', restore, true);
      document.removeEventListener('focusout', restore);
    };
  }, []);
}
