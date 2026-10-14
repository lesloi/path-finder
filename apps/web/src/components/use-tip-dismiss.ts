import { useEffect } from 'react';

const OPEN = '[data-tip]:not([data-tip-dismissed]):is(:hover, :focus-visible)';

/**
 * Lets Escape dismiss the tooltip (`data-tip`) a pointer or the focus holds open, without moving either (WCAG
 * 1.4.13); it comes back once the pointer or the focus has left the element. That Escape is only for the tooltip:
 * the other handlers do not see it, so it does not also close a dock. Pressing the element dismisses it the same way.
 */
export function useTipDismiss() {
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A touch screen has no hover: a tooltip that is not drawn has nothing to dismiss.
      const open = [...document.querySelectorAll(OPEN)].filter(
        (tip) => getComputedStyle(tip, '::after').display !== 'none',
      );
      if (!open.length) return;
      for (const tip of open) tip.setAttribute('data-tip-dismissed', '');
      event.stopPropagation();
    };
    // Only the element itself is left: a pointer going from its icon to its edge has not left it.
    const restore = (event: Event) => {
      if (event.target instanceof Element && event.target.matches('[data-tip]')) {
        event.target.removeAttribute('data-tip-dismissed');
      }
    };
    // A pressed control may move or hide under the pointer, which would then keep its tooltip open. A tap is not
    // held open: its `click` comes after `pointerleave`, which would leave the flag set with nothing to restore it.
    const press = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const tip = event.target.closest(OPEN);
      tip?.setAttribute('data-tip-dismissed', '');
    };
    // The capture phase runs before the handlers of the page; `pointerleave` does not bubble.
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('click', press, true);
    document.addEventListener('pointerleave', restore, true);
    document.addEventListener('focusout', restore);
    return () => {
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('click', press, true);
      document.removeEventListener('pointerleave', restore, true);
      document.removeEventListener('focusout', restore);
    };
  }, []);
}
