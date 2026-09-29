import { useLayoutEffect, useRef, type ReactNode } from 'react';

// A drag of the handle longer than this, in px, moves the sheet instead of toggling it.
const SWIPE_PX = 30;

/** The phone panel over the bottom of the map, collapsed or expanded from its handle. */
export function BottomSheet({
  label,
  expanded,
  onExpandedChange,
  children,
}: {
  label: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children?: ReactNode;
}) {
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

  // The on-screen keyboard covers the bottom of the layout viewport, where the sheet is pinned:
  // while a field of the sheet has the focus, the sheet rises above the keyboard.
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const rise = () => {
      const element = sheet.current!;
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      element.style.bottom = element.contains(document.activeElement) && covered > 0 ? `${covered}px` : '';
    };
    viewport.addEventListener('resize', rise);
    viewport.addEventListener('scroll', rise);
    return () => {
      viewport.removeEventListener('resize', rise);
      viewport.removeEventListener('scroll', rise);
    };
  }, []);

  return (
    <div
      ref={sheet}
      className={
        'fixed inset-x-0 bottom-0 z-4 flex flex-col rounded-t-lg bg-surface shadow-float ' +
        'pr-safe-4 pb-safe-4 pl-safe-4 transition-[max-height] duration-250 ease-[ease] desktop:hidden ' +
        (expanded ? 'h-[88dvh] max-h-[88dvh]' : 'max-h-[40dvh]')
      }
    >
      <button
        type="button"
        className={
          'h-7 w-full flex-none cursor-grab touch-none before:mx-auto before:block before:h-1 before:w-10 ' +
          'before:rounded-full before:bg-border'
        }
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
      <div className="flex flex-col gap-3 overflow-y-auto">{children}</div>
    </div>
  );
}
