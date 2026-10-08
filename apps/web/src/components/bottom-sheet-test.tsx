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

    it('is told, and left to the page for the floating buttons', () => {
      const onHeightChange = vi.fn();
      const { unmount } = render(<Sheet onHeightChange={onHeightChange} />);

      resize(240);

      expect(onHeightChange).toHaveBeenLastCalledWith(240);
      expect(document.documentElement.style.getPropertyValue('--sheet-height')).toBe('240px');

      unmount();
      expect(onHeightChange).toHaveBeenLastCalledWith(0);
      expect(document.documentElement.style.getPropertyValue('--sheet-height')).toBe('');
    });
  });
});
