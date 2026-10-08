import { fireEvent, render, screen } from '@testing-library/react';

import { SegmentedControl } from './segmented-control.tsx';

const options = [
  { value: 'a', label: 'Alpha', icon: <svg data-testid="icon-a" aria-hidden /> },
  { value: 'b', label: 'Beta' },
];

describe('SegmentedControl', () => {
  it('names its group and checks the current value', () => {
    render(<SegmentedControl testId="pick" label="Letter" value="a" options={options} onChange={vi.fn()} />);

    expect(screen.getByTestId('pick')).toHaveAccessibleName('Letter');
    expect(screen.getByTestId('pick-a')).toBeChecked();
    expect(screen.getByTestId('pick-b')).not.toBeChecked();
  });

  it('shows the icon of an option before its label', () => {
    render(<SegmentedControl testId="pick" label="Letter" value="a" options={options} onChange={vi.fn()} />);

    expect(screen.getByTestId('icon-a').nextSibling).toHaveTextContent('Alpha');
  });

  it('reports the picked value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl testId="pick" label="Letter" value="a" options={options} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('pick-b'));

    expect(onChange).toHaveBeenCalledWith('b');
  });
});
