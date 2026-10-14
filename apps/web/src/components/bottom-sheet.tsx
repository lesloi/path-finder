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

/** The stops of a sheet, from the lowest to the highest. */
export type SheetState = 'folded' | 'collapsed' | 'expanded';

const DEFAULT_STOPS: readonly SheetState[] = ['collapsed', 'expanded'];

/**
 * The phone panel over the bottom of the map. It is as tall as its content, up to 40 % of the screen; once
 * `expanded` (such as for the detail of a route), it takes 60 % of it. The handle moves it between its `stops`
 * (ordered from the lowest), from a tap or a swipe; without `onStateChange` there is no handle, as a mark that does
 * nothing would mislead, and the sheet stays collapsed. A tap goes to the next stop, or down from the highest. A swipe
 * goes one stop (two across much of the screen). A drag of the handle moves the sheet with the finger, but never past
 * its stops, and it settles on the side the finger went. A `folded` stop leaves the handle alone, to free the map.
 * `onHeightChange` hears the height of the sheet in px, so the map is framed clear of it and the buttons over the map
 * stand above it: it waits for the end of a drag, so the map is not framed again at every move.
 */
export function BottomSheet({
  label,
  state = 'collapsed',
  onStateChange,
  stops = DEFAULT_STOPS,
  foldedLabel,
  onHeightChange,
  testId,
  children,
}: {
  label: string;
  state?: SheetState;
  onStateChange?: (state: SheetState) => void;
  stops?: readonly SheetState[];
  /** The name of the handle while folded, since the sheet then shows nothing else of its state. */
  foldedLabel?: string;
  onHeightChange?: (height: number) => void;
  /** Prefix of the test ids: the sheet, then `-handle` for its handle. */
  testId?: string;
  children?: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // The finger dragging the handle: where it began, how tall the sheet was then, its stop and how far it went; none
  // without a drag.
  const drag = useRef<{ pointerId: number; y: number; height: number; index: number; reach: number }>(undefined);
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

  const canMove = onStateChange !== undefined;
  // Without a handle, a sheet left folded or expanded could not be brought back.
  const shown = canMove && stops.includes(state) ? state : 'collapsed';
  const index = Math.max(stops.indexOf(shown), 0);
  const top = stops.length - 1;
  const folded = shown === 'folded';

  const follow = (event: PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const moved = event.clientY - drag.current.y;
    drag.current.reach = Math.max(drag.current.reach, Math.abs(moved));
    // A sheet at its lowest stop does not shrink, nor one at its highest grow: the finger may go on, not the sheet.
    const { index: from } = drag.current;
    const allowed = (moved > 0 ? from > 0 : from < top) ? moved : 0;
    sheet.current!.style.height = `${drag.current.height - allowed}px`;
    // A folded sheet shows what it opens onto as it grows, fading in rather than showing an empty panel.
    if (folded) {
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
    if (!canMove && drag.current) letGo();
  }, [canMove]);

  return (
    <div
      ref={sheet}
      data-testid={testId}
      className={
        'fixed inset-x-0 bottom-0 z-4 flex overflow-hidden flex-col rounded-t-lg bg-surface shadow-float ' +
        'pr-safe-4 pb-safe-4 pl-safe-4 desktop:hidden ' +
        (shown === 'expanded' ? 'h-[60dvh]' : 'max-h-[40dvh]') +
        // Without a handle, the space it took is kept as plain padding.
        (canMove ? '' : ' pt-4')
      }
    >
      {canMove && (
        <button
          type="button"
          data-testid={testId && `${testId}-handle`}
          // As tall as a touch target, with the mark in the middle. The negative margin takes back most of the half-leading
          // of the first line below, so the space under the mark looks the same as the one above it.
          className="-mb-1 grid h-touch w-full flex-none cursor-grab place-items-center touch-none before:block before:h-1 before:w-10 before:rounded-full before:bg-border"
          aria-label={folded && foldedLabel ? foldedLabel : label}
          aria-expanded={shown === 'expanded'}
          onPointerDown={(event) => {
            if (drag.current) return;
            const { pointerId, clientY: y } = event;
            const height = sheet.current!.getBoundingClientRect().height;
            drag.current = { pointerId, y, height, index, reach: 0 };
            // Set once, not at every move. The screen units bound the sheet: the pixels of the finger may go beyond. The
            // height is pinned too, so that lifting these bounds does not resize a sheet that is only touched.
            Object.assign(sheet.current!.style, {
              height: `${height}px`,
              minHeight: stops[0] === 'folded' ? '0px' : DRAG_MIN,
              maxHeight: DRAG_MAX,
            });
            if (folded) content.current!.style.maxHeight = 'none';
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
            // A swipe across much of the screen skips the stop between.
            const steps = Math.abs(distance) > window.innerHeight * LONG_SWIPE ? 2 : 1;
            const next = Math.min(Math.max(index + (distance < 0 ? steps : -steps), 0), top);
            if (next !== index) onStateChange(stops[next]!);
          }}
          // A gesture the system takes over leaves the state as it was.
          onPointerCancel={(event) => drag.current?.pointerId === event.pointerId && letGo()}
          onLostPointerCapture={() => drag.current && letGo()}
          // A swipe ends with a click too: only a tap or a key toggles the sheet.
          onClick={() => {
            if (!swiped.current) onStateChange(stops[index === top ? index - 1 : index + 1]!);
            swiped.current = false;
          }}
        />
      )}
      {/* Squeezed to nothing rather than unmounted, so that it keeps its scroll and a drag up can reveal it; inert, so it is out of reach meanwhile. */}
      <div
        ref={content}
        inert={folded}
        className={'flex flex-col gap-3 overflow-y-auto ' + (folded ? 'max-h-0 flex-none' : 'min-h-0')}
      >
        {children}
      </div>
    </div>
  );
}
