import { fireEvent, render, screen } from '@testing-library/react';

import type { PaceUnit } from '../core/index.ts';
import { PaceSlider } from './pace-slider.tsx';

function setup(props: { pace?: number; paceUnit?: PaceUnit } = {}) {
  const onChange = vi.fn();
  render(
    <PaceSlider label="Pace" pace={6} paceUnit="min/km" language="en" testId="pace" onChange={onChange} {...props} />,
  );
  return { onChange, slider: screen.getByTestId('pace'), plus: screen.getByTestId('pace-plus') };
}

describe('PaceSlider', () => {
  it('shows the pace in min/km, within 3:00 and 12:00', () => {
    const { slider } = setup({ pace: 5.5 });

    expect(slider).toHaveValue('330');
    expect(slider).toHaveAttribute('min', '180');
    expect(slider).toHaveAttribute('max', '720');
    expect(slider).toHaveAccessibleName('Pace');
    expect(screen.getByTestId('pace-value')).toHaveTextContent('5:30 min/km');
  });

  it('changes the pace, in minutes per km, as the slider moves', () => {
    const { slider, onChange } = setup();

    fireEvent.change(slider, { target: { value: '330' } });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(5.5);
  });

  it('moves the pace by one step, in minutes per km, with the plus button', () => {
    const { plus, onChange } = setup({ pace: 5.5 });

    fireEvent.click(plus);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(335 / 60);
  });

  it('shows the pace in km/h, within 5 and 20, when the user asks for it', () => {
    const { slider } = setup({ pace: 5, paceUnit: 'km/h' });

    expect(slider).toHaveValue('12');
    expect(slider).toHaveAttribute('min', '5');
    expect(slider).toHaveAttribute('max', '20');
    expect(screen.getByTestId('pace-value')).toHaveTextContent('12.0 km/h');
  });

  it('changes a speed in km/h into a pace in minutes per km', () => {
    const { slider, onChange } = setup({ paceUnit: 'km/h' });

    fireEvent.change(slider, { target: { value: '12' } });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('shows the step the thumb is on, so that the thumb and the pace agree', () => {
    // 5.5 min/km is 10.9 km/h, which the thumb holds at 11.
    const { slider } = setup({ pace: 5.5, paceUnit: 'km/h' });

    expect(slider).toHaveValue('11');
    expect(screen.getByTestId('pace-value')).toHaveTextContent('11.0 km/h');
  });

  it.each([
    ['too fast, in min/km', 2, 'min/km', '180', '3:00 min/km'],
    ['too slow, in min/km', 15, 'min/km', '720', '12:00 min/km'],
    ['too slow, in km/h', 15, 'km/h', '5', '5.0 km/h'],
    ['too fast, in km/h', 2, 'km/h', '20', '20.0 km/h'],
  ] as const)('keeps a pace %s within the range of the slider', (_, pace, paceUnit, value, shown) => {
    const { slider } = setup({ pace, paceUnit });

    expect(slider).toHaveValue(value);
    expect(screen.getByTestId('pace-value')).toHaveTextContent(shown);
  });
});
