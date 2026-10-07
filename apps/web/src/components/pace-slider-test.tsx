import { fireEvent, render, screen } from '@testing-library/react';

import { PaceSlider } from './pace-slider.tsx';

function setup(props: { pace?: number; units?: 'metric' | 'imperial' } = {}) {
  const onChange = vi.fn();
  render(<PaceSlider label="Pace" pace={6} units="metric" testId="pace" onChange={onChange} {...props} />);
  return { onChange, slider: screen.getByTestId('pace') };
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

  it('shows the pace per mile in imperial units', () => {
    const { slider } = setup({ units: 'imperial' });

    expect(screen.getByTestId('pace-value')).toHaveTextContent('9:39 min/mi');
    expect(slider).toHaveAttribute('max', '1140');
  });

  it('changes the pace, in minutes per km, as the slider moves', () => {
    const { slider, onChange } = setup();

    fireEvent.change(slider, { target: { value: '330' } });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(5.5);
  });

  it('changes a pace per mile into minutes per km', () => {
    const { slider, onChange } = setup({ units: 'imperial' });

    fireEvent.change(slider, { target: { value: '480' } });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(8 / 1.609344);
  });
});
