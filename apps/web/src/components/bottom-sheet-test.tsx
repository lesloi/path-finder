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

// The sheet of a route set, which can also be folded down to its handle.
function FoldableSheet({ initial = 'normal' }: { initial?: 'normal' | 'expanded' | 'folded' }) {
  const [expanded, setExpanded] = useState(initial === 'expanded');
  const [folded, setFolded] = useState(initial === 'folded');
  return (
    <BottomSheet
      testId="sheet"
      label="Route"
      expanded={expanded}
      onExpandedChange={setExpanded}
      folded={folded}
      onFoldedChange={setFolded}
    >
      <p data-testid="content" />
    </BottomSheet>
  );
}

const swipe = (handle: HTMLElement, from: number, to: number) => {
  fireEvent.pointerDown(handle, { clientY: from });
  fireEvent.pointerUp(handle, { clientY: to });
  fireEvent.click(handle);
};

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

  it('has no handle when it cannot expand', () => {
    render(<BottomSheet testId="sheet" label="Route" />);

    expect(screen.queryByTestId('sheet-handle')).not.toBeInTheDocument();
  });

  it('stays collapsed when it cannot expand, since nothing could collapse it', () => {
    render(<BottomSheet testId="sheet" label="Route" expanded />);

    expect(screen.getByTestId('sheet')).not.toHaveClass('h-[60dvh]');
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

    it.each([
      ['collapsed', false, 400, 450],
      ['expanded', true, 400, 350],
    ])('does not move a %s sheet further than it is', (_, expanded, from, to) => {
      render(<BottomSheet testId="sheet" label="Route" expanded={expanded} onExpandedChange={vi.fn()} />);
      const handle = screen.getByTestId('sheet-handle');

      fireEvent.pointerDown(handle, { clientY: from });
      fireEvent.pointerMove(handle, { clientY: to });

      expect(heightOf(screen.getByTestId('sheet'))).toBe(`${SHEET_PX}px`);
    });

    it('leaves the bounds of the sheet to the screen units of its classes', () => {
      render(<Sheet />);
      const handle = screen.getByTestId('sheet-handle');

      fireEvent.pointerDown(handle, { clientY: 700 });
      fireEvent.pointerMove(handle, { clientY: 0 });

      expect(screen.getByTestId('sheet').style).toMatchObject({ minHeight: '15dvh', maxHeight: '60dvh' });
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

    it('does not toggle when the drag comes back near where it began', () => {
      render(<Sheet />);
      const handle = screen.getByTestId('sheet-handle');

      fireEvent.pointerDown(handle, { clientY: 400 });
      fireEvent.pointerMove(handle, { clientY: 280 });
      fireEvent.pointerMove(handle, { clientY: 395 });
      fireEvent.pointerUp(handle, { clientY: 395 });
      fireEvent.click(handle);

      expect(handle).toHaveAttribute('aria-expanded', 'false');
      expect(heightOf(screen.getByTestId('sheet'))).toBe('');
    });

    it('follows the first finger only', () => {
      render(<Sheet />);
      const handle = screen.getByTestId('sheet-handle');

      fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 });
      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 2 });
      fireEvent.pointerMove(handle, { clientY: 350, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientY: 100, pointerId: 2 });

      expect(heightOf(screen.getByTestId('sheet'))).toBe('350px');

      fireEvent.pointerUp(handle, { clientY: 350, pointerId: 1 });

      expect(heightOf(screen.getByTestId('sheet'))).toBe('');
    });

    it('lets go of the sheet when its handle goes away during a drag', () => {
      const onHeightChange = vi.fn();
      const props = { testId: 'sheet', label: 'Route', onHeightChange };
      const { rerender } = render(<BottomSheet {...props} onExpandedChange={vi.fn()} />);
      const handle = screen.getByTestId('sheet-handle');
      fireEvent.pointerDown(handle, { clientY: 400 });
      fireEvent.pointerMove(handle, { clientY: 300 });
      onHeightChange.mockClear();

      rerender(<BottomSheet {...props} />);

      expect(heightOf(screen.getByTestId('sheet'))).toBe('');
      expect(onHeightChange).toHaveBeenLastCalledWith(SHEET_PX);
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

  describe('when it can be folded', () => {
    it('folds on a swipe down, keeping its content out of reach', () => {
      render(<FoldableSheet />);

      swipe(screen.getByTestId('sheet-handle'), 200, 300);

      expect(screen.getByTestId('content').parentElement).toHaveAttribute('inert');
      expect(screen.getByTestId('sheet')).toHaveClass('max-h-[40dvh]');
    });

    it('goes from expanded to its usual height on a swipe down, not to folded', () => {
      render(<FoldableSheet initial="expanded" />);

      swipe(screen.getByTestId('sheet-handle'), 200, 300);

      expect(screen.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByTestId('content')).toBeVisible();
    });

    it('reveals its content, fading in, as a folded sheet is dragged up', () => {
      render(<FoldableSheet initial="folded" />);
      const handle = screen.getByTestId('sheet-handle');
      const content = screen.getByTestId('content').parentElement!;

      fireEvent.pointerDown(handle, { clientY: 300 });
      fireEvent.pointerMove(handle, { clientY: 240 });

      expect(content.style).toMatchObject({ maxHeight: 'none', opacity: '0.5' });
    });

    it('unfolds on a swipe up, to its usual height', () => {
      render(<FoldableSheet initial="folded" />);

      swipe(screen.getByTestId('sheet-handle'), 300, 200);

      expect(screen.getByTestId('content')).toBeVisible();
      expect(screen.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'false');
    });

    it('goes from folded to expanded on a swipe across the screen', () => {
      render(<FoldableSheet initial="folded" />);

      swipe(screen.getByTestId('sheet-handle'), 700, 100);

      expect(screen.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('content').parentElement).not.toHaveAttribute('inert');
    });

    it('goes from expanded to folded on a swipe across the screen', () => {
      render(<FoldableSheet initial="expanded" />);

      swipe(screen.getByTestId('sheet-handle'), 100, 700);

      expect(screen.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByTestId('content').parentElement).toHaveAttribute('inert');
    });

    it('names its handle after the folded state while folded', () => {
      const { rerender } = render(
        <BottomSheet
          testId="sheet"
          label="Route"
          foldedLabel="Route, folded"
          onExpandedChange={vi.fn()}
          onFoldedChange={vi.fn()}
          folded
        />,
      );
      expect(screen.getByTestId('sheet-handle')).toHaveAccessibleName('Route, folded');

      rerender(
        <BottomSheet
          testId="sheet"
          label="Route"
          foldedLabel="Route, folded"
          onExpandedChange={vi.fn()}
          onFoldedChange={vi.fn()}
        />,
      );

      expect(screen.getByTestId('sheet-handle')).toHaveAccessibleName('Route');
    });

    it('unfolds on a tap of its handle', () => {
      render(<FoldableSheet initial="folded" />);

      fireEvent.click(screen.getByTestId('sheet-handle'));

      expect(screen.getByTestId('content')).toBeVisible();
    });

    it('can be dragged below its usual lowest height', () => {
      render(<FoldableSheet />);
      const handle = screen.getByTestId('sheet-handle');

      fireEvent.pointerDown(handle, { clientY: 200 });
      fireEvent.pointerMove(handle, { clientY: 300 });

      expect(screen.getByTestId('sheet').style.minHeight).toBe('0px');
    });

    it('ignores being folded once it cannot be anymore', () => {
      const props = { testId: 'sheet', label: 'Route', onExpandedChange: vi.fn(), folded: true };
      const { rerender } = render(
        <BottomSheet {...props} onFoldedChange={vi.fn()}>
          <p data-testid="content" />
        </BottomSheet>,
      );

      rerender(
        <BottomSheet {...props}>
          <p data-testid="content" />
        </BottomSheet>,
      );

      expect(screen.getByTestId('content').parentElement).not.toHaveAttribute('inert');
    });
  });
});
