import { fireEvent, render, screen } from '@testing-library/react';

import { Slider } from './slider.tsx';

function setup(props: { value?: number; min?: number; max?: number; step?: number } = {}) {
  const onChange = vi.fn();
  render(
    <Slider
      testId="s"
      label="Distance"
      language="en"
      value={10}
      shown="10 km"
      min={0}
      max={20}
      step={1}
      onChange={onChange}
      {...props}
    />,
  );
  return {
    onChange,
    minus: screen.getByTestId('s-minus'),
    plus: screen.getByTestId('s-plus'),
  };
}

describe('Slider', () => {
  it('moves up by one step with the plus button', () => {
    const { plus, onChange } = setup({ step: 5 });

    fireEvent.click(plus);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(15);
  });

  it('moves down by one step with the minus button', () => {
    const { minus, onChange } = setup({ step: 5 });

    fireEvent.click(minus);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('lands on the step grid when the value is off it', () => {
    const { plus, minus, onChange } = setup({ value: 130, step: 50, max: 500 });

    fireEvent.click(plus);
    fireEvent.click(minus);

    expect(onChange.mock.calls).toEqual([[200], [100]]);
  });

  it('stops at the maximum when a step would pass it', () => {
    const { plus, onChange } = setup({ value: 19.5, max: 20 });

    fireEvent.click(plus);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(20);
  });

  it('keeps decimal steps exact', () => {
    const { plus, onChange } = setup({ value: 0.2, min: 0, max: 1, step: 0.1 });

    fireEvent.click(plus);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(0.3);
  });

  it('disables the minus button at the minimum', () => {
    const { minus, plus } = setup({ value: 0 });

    expect(minus).toBeDisabled();
    expect(plus).toBeEnabled();
  });

  it('disables the plus button at the maximum', () => {
    const { plus, minus } = setup({ value: 20 });

    expect(plus).toBeDisabled();
    expect(minus).toBeEnabled();
  });

  it('names the buttons after the slider', () => {
    const { minus, plus } = setup();

    expect(minus).toHaveAccessibleName('Decrease (Distance)');
    expect(plus).toHaveAccessibleName('Increase (Distance)');
  });

  it('never submits a surrounding form', () => {
    const { plus } = setup();

    expect(plus).toHaveAttribute('type', 'button');
  });
});
