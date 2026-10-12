import { useEffectEvent, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

// A drag of the handle longer than this, in px, moves the sheet instead of toggling it.
const SWIPE_PX = 30;
// While it follows the finger, the sheet stays between these shares of the screen height.
const DRAG_MIN = 0.15;
const DRAG_MAX = 0.6;

/**
 * The phone panel over the bottom of the map. It is as tall as its content, up to 40 % of the screen; once
 * `expanded` (such as for the detail of a route), it takes 60 % of it. The handle toggles that, from a tap or a
 * swipe; without `onExpandedChange`, the handle is only a mark. A drag of the handle moves the sheet with the finger,
 * and it settles on the side the finger went. `onHeightChange` hears the height of the sheet in px, so the map is
 * framed clear of it and the buttons over the map stand above it: it waits for the end of a drag, so the map is
 * not framed again at every move.
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
  // Where a drag of the handle began, and how tall the sheet was then; none when there is no drag.
  const drag = useRef<{ y: number; height: number }>(undefined);
  const swiped = useRef(false);
  // Counts the ends of a drag: the height is told again then, even if the sheet ends as tall as it was.
  const [settled, setSettled] = useState(0);
  const heightChanged = useEffectEvent((height: number) => onHeightChange?.(height));

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (!drag.current) heightChanged(entry.borderBoxSize[0].blockSize);
    });
    observer.observe(sheet.current!);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (settled > 0) heightChanged(sheet.current!.getBoundingClientRect().height);
  }, [settled]);

  const follow = (event: PointerEvent) => {
    if (!drag.current) return;
    const [min, max] = [window.innerHeight * DRAG_MIN, window.innerHeight * DRAG_MAX];
    const height = drag.current.height - (event.clientY - drag.current.y);
    const style = sheet.current!.style;
    style.maxHeight = `${max}px`;
    style.height = `${Math.min(Math.max(height, min), max)}px`;
  };

  // The sheet goes back to the height its state gives it.
  const letGo = () => {
    drag.current = undefined;
    sheet.current!.style.height = '';
    sheet.current!.style.maxHeight = '';
    setSettled((count) => count + 1);
  };

  const mark = 'before:block before:h-1 before:w-10 before:rounded-full before:bg-border';
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
          // As tall as a touch target, with the mark in the middle. The negative margin takes back most of the half-leading
          // of the first line below, so the space under the mark looks the same as the one above it.
          className={`-mb-1 grid h-touch w-full flex-none cursor-grab place-items-center touch-none ${mark}`}
          aria-label={label}
          aria-expanded={expanded}
          onPointerDown={(event) => {
            drag.current = { y: event.clientY, height: sheet.current!.getBoundingClientRect().height };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={follow}
          onPointerUp={(event) => {
            const distance = event.clientY - (drag.current?.y ?? event.clientY);
            letGo();
            swiped.current = Math.abs(distance) > SWIPE_PX;
            if (swiped.current) onExpandedChange(distance < 0);
          }}
          // A gesture the system takes over leaves the state as it was.
          onPointerCancel={letGo}
          onLostPointerCapture={() => drag.current && letGo()}
          // A swipe ends with a click too: only a tap or a key toggles the sheet.
          onClick={() => {
            if (!swiped.current) onExpandedChange(!expanded);
            swiped.current = false;
          }}
        />
      ) : (
        <div aria-hidden className={`grid h-7 w-full flex-none place-items-center ${mark}`} />
      )}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">{children}</div>
    </div>
  );
}
