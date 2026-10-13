import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { SelectControl } from './select-control.tsx';

const options = [
  { value: 'a', label: 'Alpha', icon: <svg data-testid="icon-a" /> },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

/** The select with its own state, as a view holds it. */
function Harness({ initial = 'a', onChange }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <p id="why">Because</p>
      <SelectControl
        testId="pick"
        label="Letter"
        value={value}
        options={options}
        describedBy="why"
        onChange={(picked) => {
          setValue(picked);
          onChange?.(picked);
        }}
      />
    </>
  );
}

const button = () => screen.getByTestId('pick');
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(button(), { key, ...init });
const activeOption = () => document.getElementById(button().getAttribute('aria-activedescendant')!)!;

describe('SelectControl', () => {
  it('names itself, is described, and shows the current option with its icon while closed', () => {
    render(<Harness initial="a" />);

    expect(button()).toHaveAccessibleName('Letter');
    expect(button()).toHaveAccessibleDescription('Because');
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    expect(button()).toHaveTextContent('Alpha');
    expect(screen.getByTestId('icon-a')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens on a click and lists the options, the current one selected', () => {
    render(<Harness initial="b" />);

    fireEvent.click(button());

    expect(button()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toHaveAccessibleName('Letter');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByTestId('pick-b')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('pick-a')).toHaveAttribute('aria-selected', 'false');
  });

  it('reports the clicked option, closes, and shows it', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(button());
    fireEvent.click(screen.getByTestId('pick-c'));

    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(button()).toHaveTextContent('Gamma');
  });

  it('closes on a second click on the button, without a change', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(button());
    fireEvent.click(button());

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([['Enter'], [' '], ['ArrowDown'], ['ArrowUp']])('opens on %j', (key) => {
    render(<Harness />);

    press(key);

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('moves through the options with the arrows, Home and End, and stops at the ends', () => {
    render(<Harness initial="b" />);
    press('ArrowDown');

    press('ArrowDown');
    press('ArrowDown');
    expect(activeOption()).toHaveTextContent('Gamma');
    press('Home');
    expect(activeOption()).toHaveTextContent('Alpha');
    press('ArrowUp');
    expect(activeOption()).toHaveTextContent('Alpha');
    press('End');
    expect(activeOption()).toHaveTextContent('Gamma');
  });

  it('points at the active option for assistive technology', () => {
    render(<Harness initial="b" />);

    press('ArrowDown');

    expect(button()).toHaveAttribute('aria-activedescendant', screen.getByTestId('pick-b').id);
  });

  it.each([['Enter'], [' ']])('picks the active option on %j', (key) => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    press('ArrowDown');
    press('ArrowDown');

    press(key);

    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape without a change, and keeps Escape from going further', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    press('ArrowDown');
    press('ArrowDown');

    const notPrevented = fireEvent.keyDown(button(), { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  it('lets Escape through while closed, so the page behind can use it', () => {
    render(<Harness />);

    const notPrevented = fireEvent.keyDown(button(), { key: 'Escape' });

    expect(notPrevented).toBe(true);
  });

  it('closes when it loses the focus', () => {
    render(<Harness />);
    fireEvent.click(button());

    fireEvent.blur(button());

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('jumps to the option that starts with the typed letters', () => {
    render(<Harness />);
    press('ArrowDown');

    press('g');

    expect(activeOption()).toHaveTextContent('Gamma');
  });

  it('keeps the active option when no option starts with the typed letter', () => {
    render(<Harness />);
    press('ArrowDown');

    press('z');

    expect(activeOption()).toHaveTextContent('Alpha');
  });

  it('opens on a letter too, on the matching option', () => {
    render(<Harness />);

    press('b');

    expect(activeOption()).toHaveTextContent('Beta');
  });

  it('ignores other keys and shortcuts', () => {
    render(<Harness />);

    press('c', { ctrlKey: true });
    press('Shift');

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('makes the hovered option the active one', () => {
    render(<Harness />);
    fireEvent.click(button());

    fireEvent.mouseMove(screen.getByTestId('pick-c'));

    expect(activeOption()).toHaveTextContent('Gamma');
  });

  // Safari and Firefox on a Mac do not focus a button on a click: the select takes the focus itself, or the keys
  // and the close on blur would never reach it.
  it('takes the focus when clicked', () => {
    render(<Harness />);

    fireEvent.click(button());

    expect(button()).toHaveFocus();
  });

  it('opens on a letter that matches no option, on the current one', () => {
    render(<Harness initial="b" />);

    press('z');

    expect(activeOption()).toHaveTextContent('Beta');
  });

  it('shows nothing and does not open when there are no options', () => {
    render(<SelectControl testId="pick" label="Letter" value="a" options={[]} onChange={vi.fn()} />);

    fireEvent.click(button());
    press('ArrowDown');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(button()).toHaveAccessibleName('Letter');
  });

  describe('with a label of several words', () => {
    const words = [
      { value: 'plan', label: 'Plan IGN' },
      { value: 'photo', label: 'Photo aérienne' },
    ];
    const renderWords = (onChange = vi.fn()) =>
      render(<SelectControl testId="pick" label="Map" value="plan" options={words} onChange={onChange} />);

    it('takes a space typed within a word as part of the prefix', () => {
      const onChange = vi.fn();
      renderWords(onChange);
      press('ArrowDown');

      for (const key of ['p', 'h', 'o', 't', 'o', ' ', 'a']) press(key);

      expect(activeOption()).toHaveTextContent('Photo aérienne');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('still picks the active option on a space typed alone', () => {
      const onChange = vi.fn();
      renderWords(onChange);
      press('ArrowDown');

      press(' ');

      expect(onChange).toHaveBeenCalledWith('plan');
    });
  });

  it('picks the active option on Tab, and lets the focus move on', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    press('ArrowDown');
    press('ArrowDown');

    const notPrevented = fireEvent.keyDown(button(), { key: 'Tab' });

    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(notPrevented).toBe(true);
  });

  it('lets Tab through while closed', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const notPrevented = fireEvent.keyDown(button(), { key: 'Tab' });

    expect(notPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  // Firefox clicks a button when Space is released, whatever its keydown did: the list would reopen after a pick.
  it('keeps the release of Space from clicking the button', () => {
    render(<Harness />);

    const notPrevented = fireEvent.keyUp(button(), { key: ' ' });

    expect(notPrevented).toBe(false);
  });
});
