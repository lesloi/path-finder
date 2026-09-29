import { act, fireEvent, render, screen } from '@testing-library/react';

import { useState, type ReactNode } from 'react';

import { BottomSheet } from './bottom-sheet.tsx';

// A visual viewport that the on-screen keyboard shrinks.
function keyboardViewport(height: number) {
  const viewport = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 });
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  return () => {
    viewport.height = window.innerHeight - height;
    viewport.dispatchEvent(new Event('resize'));
  };
}

// The sheet as a view holds it, keeping whether it is expanded.
function Sheet({ children }: { children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <BottomSheet label="Criteria" expanded={expanded} onExpandedChange={setExpanded}>
      {children}
    </BottomSheet>
  );
}

describe('BottomSheet', () => {
  it('shows its content', () => {
    render(<Sheet>Long-press the map</Sheet>);

    expect(screen.getByText('Long-press the map')).toBeInTheDocument();
  });

  it('expands and collapses from its handle', () => {
    render(<Sheet />);
    const handle = screen.getByRole('button', { name: 'Criteria' });
    expect(handle).toHaveAttribute('aria-expanded', 'false');

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
    const handle = screen.getByRole('button', { name: 'Criteria' });

    fireEvent.pointerDown(handle, { clientY: from });
    fireEvent.pointerUp(handle, { clientY: to });
    fireEvent.click(handle);

    expect(handle).toHaveAttribute('aria-expanded', expanded);
  });

  describe('with an on-screen keyboard', () => {
    afterEach(() => {
      Reflect.deleteProperty(window, 'visualViewport');
    });

    it('rises above the keyboard while one of its fields has the focus', () => {
      const openKeyboard = keyboardViewport(300);
      render(
        <Sheet>
          <input aria-label="Start point" />
        </Sheet>,
      );
      const field = screen.getByRole('textbox', { name: 'Start point' });

      field.focus();
      act(openKeyboard);

      expect(field.closest('.fixed')).toHaveStyle({ bottom: '300px' });
    });

    it('stays at the bottom when the keyboard is for something else', () => {
      const openKeyboard = keyboardViewport(300);
      render(
        <Sheet>
          <input aria-label="Start point" />
        </Sheet>,
      );

      const field = screen.getByRole('textbox', { name: 'Start point' });

      act(openKeyboard);

      expect(field.closest('.fixed')).not.toHaveStyle({ bottom: '300px' });
    });
  });
});
