import { useEffectEvent, useLayoutEffect, useRef, type ReactNode } from 'react';

// A drag of the handle longer than this, in px, moves the sheet instead of toggling it.
const SWIPE_PX = 30;

/**
 * The phone panel over the bottom of the map. It is as tall as its content, up to 40 % of the screen; once
 * `expanded` (such as for the detail of a route), it takes 60 % of it. The handle toggles that, from a tap or a
 * swipe; without `onExpandedChange`, the handle is only a mark. `onHeightChange` hears the height of the sheet in
 * px, so the map is framed clear of it.
 */
export function BottomSheet({
  label,
  expanded = false,
  onExpandedChange,
  onHeightChange,
  testId,
  children,
}: {
  label: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onHeightChange?: (height: number) => void;
  /** Prefix of the test ids: the sheet, then `-handle` for its handle. */
  testId?: string;
  children?: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number>(undefined);
  const swiped = useRef(false);
  const heightChanged = useEffectEvent((height: number) => onHeightChange?.(height));

  // The floating buttons and the map attribution sit above the sheet, whatever its height.
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize[0].blockSize;
      root.setProperty('--sheet-height', `${height}px`);
      heightChanged(height);
    });
    observer.observe(sheet.current!);
    return () => {
      observer.disconnect();
      root.removeProperty('--sheet-height');
      heightChanged(0);
    };
  }, []);

  const mark = 'before:mx-auto before:block before:h-1 before:w-10 before:rounded-full before:bg-border';
  return (
    <div
      ref={sheet}
      data-testid={testId}
      className={
        'fixed inset-x-0 bottom-0 z-4 flex flex-col rounded-t-lg bg-surface shadow-float ' +
        'pr-safe-4 pb-safe-4 pl-safe-4 desktop:hidden ' +
        (expanded ? 'h-[60dvh]' : 'max-h-[40dvh]')
      }
    >
      {onExpandedChange ? (
        <button
          type="button"
          data-testid={testId && `${testId}-handle`}
          className={`h-7 w-full flex-none cursor-grab touch-none ${mark}`}
          aria-label={label}
          aria-expanded={expanded}
          onPointerDown={(event) => {
            dragFrom.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            const distance = event.clientY - (dragFrom.current ?? event.clientY);
            dragFrom.current = undefined;
            swiped.current = Math.abs(distance) > SWIPE_PX;
            if (swiped.current) onExpandedChange(distance < 0);
          }}
          // A swipe ends with a click too: only a tap or a key toggles the sheet.
          onClick={() => {
            if (!swiped.current) onExpandedChange(!expanded);
            swiped.current = false;
          }}
        />
      ) : (
        <div aria-hidden className={`h-7 w-full flex-none ${mark}`} />
      )}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">{children}</div>
    </div>
  );
}
