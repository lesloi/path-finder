import { fireEvent, render, screen } from '@testing-library/react';

import { useState } from 'react';

import { BottomSheet } from './bottom-sheet.tsx';

// The sheet as a view holds it, keeping whether it is expanded.
function Sheet({ children }: { children?: string }) {
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
});
