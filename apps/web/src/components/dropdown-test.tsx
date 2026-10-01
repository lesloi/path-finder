import { fireEvent, render, screen } from '@testing-library/react';

import { Dropdown } from './dropdown.tsx';

const options = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial', icon: <svg aria-hidden /> },
  { value: 'nautical', label: 'Nautical' },
];

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Units Metric' }));
const option = (name: string) => screen.getByRole('option', { name });

describe('Dropdown', () => {
  it('names itself with its label and its value', () => {
    render(<Dropdown label="Units" value="metric" options={options} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Units Metric' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens on the current option', () => {
    render(<Dropdown label="Units" value="metric" options={options} onChange={vi.fn()} />);

    open();

    expect(option('Metric')).toHaveAttribute('aria-selected', 'true');
    expect(option('Metric')).toHaveFocus();
  });

  it('picks a value from its list and closes it', () => {
    const onChange = vi.fn();
    render(<Dropdown label="Units" value="metric" options={options} onChange={onChange} />);
    open();

    fireEvent.click(option('Imperial'));

    expect(onChange).toHaveBeenCalledWith('imperial');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('picks a value with the keyboard', () => {
    const onChange = vi.fn();
    render(<Dropdown label="Units" value="metric" options={options} onChange={onChange} />);
    open();

    fireEvent.keyDown(option('Imperial'), { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('imperial');
  });

  it.each([
    ['ArrowDown moves to the next option', ['ArrowDown'], 'Imperial'],
    ['ArrowDown stops at the last option', ['ArrowDown', 'ArrowDown', 'ArrowDown'], 'Nautical'],
    ['ArrowUp moves to the previous option', ['End', 'ArrowUp'], 'Imperial'],
    ['ArrowUp stops at the first option', ['ArrowUp'], 'Metric'],
    ['End moves to the last option', ['End'], 'Nautical'],
    ['Home moves to the first option', ['End', 'Home'], 'Metric'],
  ])('%s', (_, keys, focused) => {
    render(<Dropdown label="Units" value="metric" options={options} onChange={vi.fn()} />);
    open();

    for (const key of keys) fireEvent.keyDown(document.activeElement!, { key });

    expect(option(focused)).toHaveFocus();
  });

  it('leaves its options out of the tab order', () => {
    render(<Dropdown label="Units" value="metric" options={options} onChange={vi.fn()} />);
    open();

    expect(screen.getAllByRole('option').map((item) => item.tabIndex)).toEqual([-1, -1, -1]);
  });

  it('closes without a change on Tab, back on its button', () => {
    const onChange = vi.fn();
    render(<Dropdown label="Units" value="metric" options={options} onChange={onChange} />);
    open();

    fireEvent.keyDown(option('Metric'), { key: 'Tab' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Units Metric' })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes without a change on Escape', () => {
    const onChange = vi.fn();
    render(<Dropdown label="Units" value="metric" options={options} onChange={onChange} />);
    open();

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
