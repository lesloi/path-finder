import { useEffectEvent, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

// A drag of the handle longer than this, in px, moves the sheet instead of toggling it.
const SWIPE_PX = 30;
// While it follows the finger, the sheet stays between these heights: in screen units, as the classes are.
const DRAG_MIN = '15dvh';
const DRAG_MAX = '60dvh';
// A swipe longer than this share of the screen goes from the handle alone to the expanded sheet, or back.
const LONG_SWIPE = 0.3;
// A folded sheet dragged up by this much, in px, shows its content in full.
const FADE_IN_PX = 120;

/**
 * The phone panel over the bottom of the map. It is as tall as its content, up to 40 % of the screen; once
 * `expanded` (such as for the detail of a route), it takes 60 % of it. The handle toggles that, from a tap or a
 * swipe; without `onExpandedChange` there is no handle, as a mark that does nothing would mislead. A drag of the
 * handle moves the sheet with the finger, but never past its state (a collapsed sheet does not shrink, an expanded one
 * does not grow), and it settles on the side the finger went. A sheet that can be folded goes one step per swipe (two for a swipe across much of the screen),
 * between folded, collapsed and expanded, and a tap on a folded one brings it back to collapsed. `onHeightChange` hears the height of the sheet in px, so the map is framed clear of it and the
 * buttons over the map stand above it: it waits for the end of a drag, so the map is not framed again at every move.
 */
export function BottomSheet({
  label,
  expanded = false,
  onExpandedChange,
  folded = false,
  onFoldedChange,
  foldedLabel,
  onHeightChange,
  testId,
  children,
}: {
  label: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Folded down to the handle alone, to leave the map free. Only a sheet with `onFoldedChange` folds. */
  folded?: boolean;
  onFoldedChange?: (folded: boolean) => void;
  /** The name of the handle while folded, since the sheet then shows nothing else of its state. */
  foldedLabel?: string;
  onHeightChange?: (height: number) => void;
  /** Prefix of the test ids: the sheet, then `-handle` for its handle. */
  testId?: string;
  children?: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // The finger dragging the handle: where it began, how tall the sheet was then, whether it was expanded and how far
  // it went; none without a drag.
  const drag = useRef<{ pointerId: number; y: number; height: number; expanded: boolean; reach: number }>(undefined);
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

  const canExpand = onExpandedChange !== undefined;
  // Without a handle, a sheet left folded could not be brought back.
  const canFold = canExpand && onFoldedChange !== undefined;
  const shut = folded && canFold;

  const follow = (event: PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const moved = event.clientY - drag.current.y;
    drag.current.reach = Math.max(drag.current.reach, Math.abs(moved));
    // A sheet already collapsed does not shrink further (unless it folds), nor does an expanded one grow, nor a folded one
    // shrink: the finger may go on, not the sheet.
    const { expanded: wasExpanded } = drag.current;
    const mayShrink = wasExpanded || (canFold && !shut);
    const allowed = (moved > 0 ? mayShrink : !wasExpanded) ? moved : 0;
    sheet.current!.style.height = `${drag.current.height - allowed}px`;
    // A folded sheet shows what it opens onto as it grows, fading in rather than showing an empty panel.
    if (shut) {
      content.current!.style.opacity = String(Math.min(-allowed / FADE_IN_PX, 1));
    }
  };

  // The sheet goes back to the height its state gives it.
  const letGo = () => {
    drag.current = undefined;
    Object.assign(sheet.current!.style, { height: '', minHeight: '', maxHeight: '' });
    Object.assign(content.current!.style, { maxHeight: '', opacity: '' });
    setSettled((count) => count + 1);
  };

  // Without a handle, nothing ends a drag that was on it.
  useLayoutEffect(() => {
    if (!canExpand && drag.current) letGo();
  }, [canExpand]);

  // Without a handle, a sheet left at 60 % could not be brought back down.
  const tall = expanded && canExpand;
  return (
    <div
      ref={sheet}
      data-testid={testId}
      className={
        'fixed inset-x-0 bottom-0 z-4 flex overflow-hidden flex-col rounded-t-lg bg-surface shadow-float ' +
        'pr-safe-4 pb-safe-4 pl-safe-4 desktop:hidden ' +
        (tall && !shut ? 'h-[60dvh]' : 'max-h-[40dvh]') +
        // Without a handle, the space it took is kept as plain padding.
        (canExpand ? '' : ' pt-4')
      }
    >
      {canExpand && (
        <button
          type="button"
          data-testid={testId && `${testId}-handle`}
          // As tall as a touch target, with the mark in the middle. The negative margin takes back most of the half-leading
          // of the first line below, so the space under the mark looks the same as the one above it.
          className="-mb-1 grid h-touch w-full flex-none cursor-grab place-items-center touch-none before:block before:h-1 before:w-10 before:rounded-full before:bg-border"
          aria-label={shut && foldedLabel ? foldedLabel : label}
          aria-expanded={expanded && !shut}
          onPointerDown={(event) => {
            if (drag.current) return;
            const { pointerId, clientY: y } = event;
            const height = sheet.current!.getBoundingClientRect().height;
            drag.current = { pointerId, y, height, expanded, reach: 0 };
            // Set once, not at every move. The screen units bound the sheet: the pixels of the finger may go beyond. The
            // height is pinned too, so that lifting these bounds does not resize a sheet that is only touched.
            Object.assign(sheet.current!.style, {
              height: `${height}px`,
              minHeight: canFold ? '0px' : DRAG_MIN,
              maxHeight: DRAG_MAX,
            });
            if (shut) content.current!.style.maxHeight = 'none';
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
            if (Math.abs(distance) <= SWIPE_PX) return;
            // Folded, collapsed, expanded; a swipe across much of the screen skips the step between.
            const level = shut ? 0 : expanded ? 2 : 1;
            const steps = Math.abs(distance) > window.innerHeight * LONG_SWIPE ? 2 : 1;
            const next = Math.min(Math.max(level + (distance < 0 ? steps : -steps), canFold ? 0 : 1), 2);
            if (next === level) return;
            if (shut || next === 0) onFoldedChange!(next === 0);
            if (level === 2 || next === 2) onExpandedChange(next === 2);
          }}
          // A gesture the system takes over leaves the state as it was.
          onPointerCancel={(event) => drag.current?.pointerId === event.pointerId && letGo()}
          onLostPointerCapture={() => drag.current && letGo()}
          // A swipe ends with a click too: only a tap or a key toggles the sheet.
          onClick={() => {
            if (!swiped.current) {
              if (shut) onFoldedChange!(false);
              else onExpandedChange(!expanded);
            }
            swiped.current = false;
          }}
        />
      )}
      {/* Squeezed to nothing rather than unmounted, so that it keeps its scroll and a drag up can reveal it; inert, so it is out of reach meanwhile. */}
      <div
        ref={content}
        inert={shut}
        className={'flex flex-col gap-3 overflow-y-auto ' + (shut ? 'max-h-0 flex-none' : 'min-h-0')}
      >
        {children}
      </div>
    </div>
  );
}
