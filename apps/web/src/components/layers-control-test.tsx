import { fireEvent, render, screen } from '@testing-library/react';

import { criteriaText } from '../i18n/index.ts';
import { LayersControl } from './layers-control.tsx';

const t = criteriaText.en;

function setup(layers = { water: true, viewpoint: false, toilets: false, seasonal: true }) {
  const onChange = vi.fn();
  render(<LayersControl language="en" layers={layers} onChange={onChange} className="" />);
  const button = screen.getByTestId('criteria-layers');
  return { onChange, button, open: () => fireEvent.click(button) };
}

describe('LayersControl', () => {
  it('lists one checkbox per category, checked as the layers are', () => {
    const { open } = setup();

    open();

    expect(screen.getByTestId('layers-water')).toBeChecked();
    expect(screen.getByTestId('layers-viewpoint')).not.toBeChecked();
    expect(screen.getByTestId('layers-viewpoint')).toHaveAccessibleName(t.poiViewpoint);
  });

  it('turns the seasonal water points off on their own row', () => {
    const { onChange, open } = setup();
    open();

    fireEvent.click(screen.getByTestId('layers-seasonal'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      water: true,
      viewpoint: false,
      toilets: false,
      seasonal: false,
    });
  });

  it('has no seasonal row to use while the water points are hidden', () => {
    const { open } = setup({ water: false, viewpoint: false, toilets: false, seasonal: true });
    open();

    expect(screen.getByTestId('layers-seasonal')).toBeDisabled();
  });

  it('turns a category on without touching the other', () => {
    const { onChange, open } = setup();
    open();

    fireEvent.click(screen.getByTestId('layers-viewpoint'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      water: true,
      viewpoint: true,
      toilets: false,
      seasonal: true,
    });
  });

  it('closes on Escape and gives the focus back to its button', () => {
    const { button, open } = setup();
    open();

    fireEvent.keyDown(screen.getByTestId('layers-water'), { key: 'Escape' });

    expect(screen.queryByTestId('layers-water')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes on a press outside', () => {
    const { open } = setup();
    open();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByTestId('layers-water')).not.toBeInTheDocument();
  });
});
