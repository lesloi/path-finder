import { fireEvent, render, screen } from '@testing-library/react';

import { PaceSlider } from './pace-slider.tsx';

function setup(props: { pace?: number; units?: 'metric' | 'imperial' } = {}) {
  const onChange = vi.fn();
  const onDone = vi.fn();
  const view = render(
    <PaceSlider label="Pace" pace={6} units="metric" testId="pace" onChange={onChange} onDone={onDone} {...props} />,
  );
  return { onChange, onDone, slider: screen.getByTestId('pace'), view };
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
    setup({ units: 'imperial' });

    expect(screen.getByTestId('pace-value')).toHaveTextContent('9:39 min/mi');
  });

  it('moves what it shows while sliding, and changes the pace once, when the user lets go', () => {
    const { slider, onChange } = setup();

    fireEvent.change(slider, { target: { value: '330' } });
    expect(screen.getByTestId('pace-value')).toHaveTextContent('5:30 min/km');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(5.5);
  });

  it('changes the pace at the end of a key press, or when the user leaves it', () => {
    const { slider, onChange, onDone } = setup();

    fireEvent.change(slider, { target: { value: '300' } });
    fireEvent.keyUp(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(5);

    fireEvent.change(slider, { target: { value: '420' } });
    fireEvent.blur(slider);
    expect(onChange).toHaveBeenLastCalledWith(7);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('does not change the pace when it did not move', () => {
    const { slider, onChange, onDone } = setup();

    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);

    expect(onChange).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('shows a pace set elsewhere', () => {
    const { view } = setup();

    view.rerender(<PaceSlider label="Pace" pace={5} units="metric" testId="pace" onChange={() => {}} />);

    expect(screen.getByTestId('pace')).toHaveValue('300');
  });
});
