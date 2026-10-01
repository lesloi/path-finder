import { fireEvent, render, screen } from '@testing-library/react';

import { Dropdown } from './dropdown.tsx';

const options = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial', icon: <svg aria-hidden /> },
  { value: 'nautical', label: 'Nautical' },
];

const open = () => fireEvent.click(screen.getByTestId('units'));
const option = (value: string) => screen.getByTestId(`units-${value}`);

describe('Dropdown', () => {
  it('names itself with its label and its value', () => {
    render(<Dropdown testId="units" label="Units" value="metric" options={options} onChange={vi.fn()} />);

    expect(screen.getByTestId('units')).toHaveAccessibleName('Units Metric');
    expect(screen.getByTestId('units')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('units-list')).not.toBeInTheDocument();
  });

  it('opens on the current option', () => {
    render(<Dropdown testId="units" label="Units" value="metric" options={options} onChange={vi.fn()} />);

    open();

    expect(option('metric')).toHaveAttribute('aria-selected', 'true');
    expect(option('metric')).toHaveFocus();
  });

  it('picks a value from its list and closes it', () => {
    const onChange = vi.fn();
    render(<Dropdown testId="units" label="Units" value="metric" options={options} onChange={onChange} />);
    open();

    fireEvent.click(option('imperial'));

    expect(onChange).toHaveBeenCalledWith('imperial');
    expect(screen.queryByTestId('units-list')).not.toBeInTheDocument();
  });

  it('picks a value with the keyboard', () => {
    const onChange = vi.fn();
    render(<Dropdown testId="units" label="Units" value="metric" options={options} onChange={onChange} />);
    open();

    fireEvent.keyDown(option('imperial'), { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('imperial');
  });

  it.each([
    ['ArrowDown moves to the next option', ['ArrowDown'], 'imperial'],
    ['ArrowDown stops at the last option', ['ArrowDown', 'ArrowDown', 'ArrowDown'], 'nautical'],
    ['ArrowUp moves to the previous option', ['End', 'ArrowUp'], 'imperial'],
    ['ArrowUp stops at the first option', ['ArrowUp'], 'metric'],
    ['End moves to the last option', ['End'], 'nautical'],
    ['Home moves to the first option', ['End', 'Home'], 'metric'],
  ])('%s', (_, keys, focused) => {
    render(<Dropdown testId="units" label="Units" value="metric" options={options} onChange={vi.fn()} />);
    open();

    for (const key of keys) fireEvent.keyDown(document.activeElement!, { key });

    expect(option(focused)).toHaveFocus();
  });

  it('leaves its options out of the tab order', () => {
    render(<Dropdown testId="units" label="Units" value="metric" options={options} onChange={vi.fn()} />);
    open();

    expect(screen.getAllByRole('option').map((item) => item.tabIndex)).toEqual([-1, -1, -1]);
  });

  it('closes without a change on Tab, back on its button', () => {
    const onChange = vi.fn();
    render(<Dropdown testId="units" label="Units" value="metric" options={options} onChange={onChange} />);
    open();

    fireEvent.keyDown(option('metric'), { key: 'Tab' });

    expect(screen.queryByTestId('units-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('units')).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes without a change on Escape', () => {
    const onChange = vi.fn();
    render(<Dropdown testId="units" label="Units" value="metric" options={options} onChange={onChange} />);
    open();

    fireEvent.keyDown(screen.getByTestId('units-list'), { key: 'Escape' });

    expect(screen.queryByTestId('units-list')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
