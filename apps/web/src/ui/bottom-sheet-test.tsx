import { fireEvent, render, screen } from '@testing-library/react';

import { BottomSheet } from './bottom-sheet.tsx';

describe('BottomSheet', () => {
  it('shows its content', () => {
    render(<BottomSheet label="Criteria">Long-press the map</BottomSheet>);

    expect(screen.getByText('Long-press the map')).toBeInTheDocument();
  });

  it('expands and collapses from its handle', () => {
    render(<BottomSheet label="Criteria" />);
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
    render(<BottomSheet label="Criteria" />);
    const handle = screen.getByRole('button', { name: 'Criteria' });

    fireEvent.pointerDown(handle, { clientY: from });
    fireEvent.pointerUp(handle, { clientY: to });
    fireEvent.click(handle);

    expect(handle).toHaveAttribute('aria-expanded', expanded);
  });
});
