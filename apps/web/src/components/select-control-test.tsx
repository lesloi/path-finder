import { fireEvent, render, screen } from '@testing-library/react';

import { SelectControl } from './select-control.tsx';

const options = [
  { value: 'a', label: 'Alpha', icon: <svg data-testid="icon-a" aria-hidden /> },
  { value: 'b', label: 'Beta' },
];

describe('SelectControl', () => {
  it('names itself and shows the current value', () => {
    render(<SelectControl testId="pick" label="Letter" value="b" options={options} onChange={vi.fn()} />);

    expect(screen.getByTestId('pick')).toHaveAccessibleName('Letter');
    expect(screen.getByTestId('pick')).toHaveValue('b');
    expect(screen.getByTestId('pick-a')).toHaveTextContent('Alpha');
  });

  it('shows the icon of an option before its label', () => {
    render(<SelectControl testId="pick" label="Letter" value="b" options={options} onChange={vi.fn()} />);

    expect(screen.getByTestId('pick-a').firstChild).toBe(screen.getByTestId('icon-a'));
  });

  it('reports the picked value', () => {
    const onChange = vi.fn();
    render(<SelectControl testId="pick" label="Letter" value="a" options={options} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('pick'), { target: { value: 'b' } });

    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('is described by the element it points to', () => {
    render(
      <>
        <p id="why">Because</p>
        <SelectControl testId="pick" label="Letter" value="a" options={options} describedBy="why" onChange={vi.fn()} />
      </>,
    );

    expect(screen.getByTestId('pick')).toHaveAccessibleDescription('Because');
  });
});
