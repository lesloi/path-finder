import { fireEvent, render, screen } from '@testing-library/react';

import { BasemapPicker } from './basemap-picker.tsx';

const options = [
  { value: 'plan', label: 'Plan IGN' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'aerial', label: 'Aerial photo' },
] as const;

function renderPicker(onChange = vi.fn()) {
  render(
    <BasemapPicker label="Map background" value="minimal" options={[...options]} className="" onChange={onChange} />,
  );
  return onChange;
}

const open = () => fireEvent.click(screen.getByTestId('criteria-basemap'));

describe('BasemapPicker', () => {
  it('is a named button, closed until clicked', () => {
    renderPicker();

    expect(screen.getByTestId('criteria-basemap')).toHaveAccessibleName('Map background');
    expect(screen.getByTestId('criteria-basemap')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists the backgrounds, the current one checked and focused', () => {
    renderPicker();

    open();

    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Plan IGN',
      'Minimal',
      'Aerial photo',
    ]);
    expect(screen.getByTestId('criteria-basemap-minimal')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('criteria-basemap-minimal')).toHaveFocus();
  });

  it('reports the background picked, closes, and gives the focus back to the button', () => {
    const onChange = renderPicker();
    open();

    fireEvent.click(screen.getByTestId('criteria-basemap-aerial'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('aerial');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('criteria-basemap')).toHaveFocus();
  });

  it('closes on Escape', () => {
    renderPicker();
    open();

    fireEvent.keyDown(screen.getByTestId('criteria-basemap-minimal'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on a press elsewhere, but not on one inside the menu', () => {
    renderPicker();
    open();

    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('moves between the backgrounds with the arrow keys, Home, and End', () => {
    renderPicker();
    open();
    const key = (name: string) => fireEvent.keyDown(document.activeElement!, { key: name });

    key('ArrowDown');
    expect(screen.getByTestId('criteria-basemap-aerial')).toHaveFocus();
    key('ArrowDown');
    expect(screen.getByTestId('criteria-basemap-aerial')).toHaveFocus();
    key('Home');
    expect(screen.getByTestId('criteria-basemap-plan')).toHaveFocus();
    key('ArrowUp');
    expect(screen.getByTestId('criteria-basemap-plan')).toHaveFocus();
    key('End');
    expect(screen.getByTestId('criteria-basemap-aerial')).toHaveFocus();
    key('a');
    expect(screen.getByTestId('criteria-basemap-aerial')).toHaveFocus();
  });

  it('closes on Tab, leaving the focus on the button for Tab to move on from', () => {
    renderPicker();
    open();

    fireEvent.keyDown(screen.getByTestId('criteria-basemap-minimal'), { key: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('criteria-basemap')).toHaveFocus();
  });
});
