import { useEffectEvent, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

// A drag of the handle longer than this, in px, moves the sheet instead of toggling it.
const SWIPE_PX = 30;
// While it follows the finger, the sheet stays between these heights: in screen units, as the classes are.
const DRAG_MIN = '15dvh';
const DRAG_MAX = '60dvh';

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
  // The finger dragging the handle: where it began, how tall the sheet was then and how far it went; none without a drag.
  const drag = useRef<{ pointerId: number; y: number; height: number; reach: number }>(undefined);
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
    if (drag.current?.pointerId !== event.pointerId) return;
    const moved = event.clientY - drag.current.y;
    drag.current.reach = Math.max(drag.current.reach, Math.abs(moved));
    const style = sheet.current!.style;
    // The screen units bound it: the pixels of the finger may go beyond.
    style.minHeight = DRAG_MIN;
    style.maxHeight = DRAG_MAX;
    // A sheet already collapsed does not shrink further, nor does an expanded one grow: the finger may go on, not the sheet.
    const allowed = expanded ? Math.max(moved, 0) : Math.min(moved, 0);
    style.height = `${drag.current.height - allowed}px`;
  };

  // The sheet goes back to the height its state gives it.
  const letGo = () => {
    drag.current = undefined;
    Object.assign(sheet.current!.style, { height: '', minHeight: '', maxHeight: '' });
    setSettled((count) => count + 1);
  };

  // Without a handle, nothing ends a drag that was on it.
  const canExpand = onExpandedChange !== undefined;
  useLayoutEffect(() => {
    if (!canExpand && drag.current) letGo();
  }, [canExpand]);

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
            if (drag.current) return;
            const { pointerId, clientY: y } = event;
            drag.current = { pointerId, y, height: sheet.current!.getBoundingClientRect().height, reach: 0 };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={follow}
          onPointerUp={(event) => {
            if (drag.current && drag.current.pointerId !== event.pointerId) return;
            const distance = event.clientY - (drag.current?.y ?? event.clientY);
            const reach = Math.max(drag.current?.reach ?? 0, Math.abs(distance));
            letGo();
            // A drag that went far is no tap, even back where it began; only where it ended says which way to settle.
            swiped.current = reach > SWIPE_PX;
            if (Math.abs(distance) > SWIPE_PX) onExpandedChange(distance < 0);
          }}
          // A gesture the system takes over leaves the state as it was.
          onPointerCancel={(event) => drag.current?.pointerId === event.pointerId && letGo()}
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
