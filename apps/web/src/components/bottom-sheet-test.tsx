import { act, fireEvent, render, screen } from '@testing-library/react';

import { useState, type ReactNode } from 'react';

import { BottomSheet } from './bottom-sheet.tsx';

// The sheet as a view holds it, keeping whether it is expanded.
function Sheet({ children, onHeightChange }: { children?: ReactNode; onHeightChange?: (height: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <BottomSheet
      testId="sheet"
      label="Route"
      expanded={expanded}
      onExpandedChange={setExpanded}
      {...(onHeightChange && { onHeightChange })}
    >
      {children}
    </BottomSheet>
  );
}

describe('BottomSheet', () => {
  it('shows its content', () => {
    render(
      <Sheet>
        <p data-testid="content" />
      </Sheet>,
    );

    expect(screen.getByTestId('sheet')).toContainElement(screen.getByTestId('content'));
  });

  it('expands and collapses from its handle', () => {
    render(<Sheet />);
    const handle = screen.getByTestId('sheet-handle');
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(handle).toHaveAccessibleName('Route');

    fireEvent.click(handle);
    expect(handle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(handle);
    expect(handle).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([
    ['expands on a swipe up', 300, 200, 'true'],
    ['stays collapsed on a swipe down', 200, 300, 'false'],
  ])('%s of its handle', (_, from, to, expanded) => {
    render(<Sheet />);
    const handle = screen.getByTestId('sheet-handle');

    fireEvent.pointerDown(handle, { clientY: from });
    fireEvent.pointerUp(handle, { clientY: to });
    fireEvent.click(handle);

    expect(handle).toHaveAttribute('aria-expanded', expanded);
  });

  it('has a handle that is only a mark when it cannot expand', () => {
    render(<BottomSheet testId="sheet" label="Route" />);

    expect(screen.queryByTestId('sheet-handle')).not.toBeInTheDocument();
  });

  describe('a drag of its handle', () => {
    const SHEET_PX = 300;
    const heightOf = (sheet: HTMLElement) => sheet.style.height;
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: SHEET_PX } as DOMRect);
    });
    afterEach(() => vi.restoreAllMocks());

    it('makes the sheet follow the finger', () => {
      render(<Sheet />);
      const handle = screen.getByTestId('sheet-handle');

      fireEvent.pointerDown(handle, { clientY: 400 });
      fireEvent.pointerMove(handle, { clientY: 350 });

      expect(heightOf(screen.getByTestId('sheet'))).toBe('350px');
    });

    it('stops the sheet at 60 % of the screen', () => {
      render(<Sheet />);
      const handle = screen.getByTestId('sheet-handle');

      fireEvent.pointerDown(handle, { clientY: 700 });
      fireEvent.pointerMove(handle, { clientY: 0 });

      expect(heightOf(screen.getByTestId('sheet'))).toBe(`${window.innerHeight * 0.6}px`);
    });

    it('settles on expanded when released after a swipe up', () => {
      render(<Sheet />);
      const handle = screen.getByTestId('sheet-handle');

      fireEvent.pointerDown(handle, { clientY: 400 });
      fireEvent.pointerMove(handle, { clientY: 300 });
      fireEvent.pointerUp(handle, { clientY: 300 });

      expect(heightOf(screen.getByTestId('sheet'))).toBe('');
      expect(handle).toHaveAttribute('aria-expanded', 'true');
    });

    it('lets go of the sheet when the gesture is cancelled', () => {
      render(<Sheet />);
      const handle = screen.getByTestId('sheet-handle');

      fireEvent.pointerDown(handle, { clientY: 400 });
      fireEvent.pointerMove(handle, { clientY: 300 });
      fireEvent.pointerCancel(handle);

      expect(heightOf(screen.getByTestId('sheet'))).toBe('');
      expect(handle).toHaveAttribute('aria-expanded', 'false');
    });

    it('tells its height once released, not while it moves', () => {
      const onHeightChange = vi.fn();
      render(<Sheet onHeightChange={onHeightChange} />);
      const handle = screen.getByTestId('sheet-handle');
      onHeightChange.mockClear();

      fireEvent.pointerDown(handle, { clientY: 400 });
      fireEvent.pointerMove(handle, { clientY: 300 });
      expect(onHeightChange).not.toHaveBeenCalled();

      fireEvent.pointerUp(handle, { clientY: 300 });
      expect(onHeightChange).toHaveBeenLastCalledWith(SHEET_PX);
    });
  });

  describe('its height', () => {
    const observed: { callback: ResizeObserverCallback }[] = [];
    const observer = window.ResizeObserver;
    beforeEach(() => {
      window.ResizeObserver = class {
        constructor(callback: ResizeObserverCallback) {
          observed.push({ callback });
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    });
    afterEach(() => {
      window.ResizeObserver = observer;
      observed.length = 0;
    });
    const resize = (blockSize: number) =>
      act(() =>
        observed[0]!.callback([{ borderBoxSize: [{ blockSize }] }] as unknown as ResizeObserverEntry[], {} as never),
      );

    it('is told as it changes', () => {
      const onHeightChange = vi.fn();
      render(<Sheet onHeightChange={onHeightChange} />);

      resize(240);

      expect(onHeightChange).toHaveBeenLastCalledWith(240);
    });
  });
});
