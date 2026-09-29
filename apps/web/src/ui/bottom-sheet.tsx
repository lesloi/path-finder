import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// A drag of the handle longer than this, in px, moves the sheet instead of toggling it.
const SWIPE_PX = 30;

/** The phone panel over the bottom of the map, collapsed or expanded from its handle. */
export function BottomSheet({ label, children }: { label: string; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number>(undefined);
  const swiped = useRef(false);

  // The floating buttons and the map attribution sit above the sheet, whatever its height.
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const observer = new ResizeObserver(([entry]) =>
      root.setProperty('--sheet-height', `${entry.borderBoxSize[0].blockSize}px`),
    );
    observer.observe(sheet.current!);
    return () => {
      observer.disconnect();
      root.removeProperty('--sheet-height');
    };
  }, []);

  return (
    <div ref={sheet} className={expanded ? 'bottom-sheet expanded' : 'bottom-sheet'}>
      <button
        type="button"
        className="bottom-sheet-handle"
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
          if (swiped.current) setExpanded(distance < 0);
        }}
        // A swipe ends with a click too: only a tap or a key toggles the sheet.
        onClick={() => {
          if (!swiped.current) setExpanded(!expanded);
          swiped.current = false;
        }}
      />
      <div className="bottom-sheet-body">{children}</div>
    </div>
  );
}
