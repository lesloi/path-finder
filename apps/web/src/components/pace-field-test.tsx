import { fireEvent, render, screen } from '@testing-library/react';

import { PaceField } from './pace-field.tsx';

function setup(props: { pace?: number; units?: 'metric' | 'imperial' } = {}) {
  const onChange = vi.fn();
  const onDone = vi.fn();
  const view = render(
    <PaceField label="Pace" pace={6} units="metric" testId="pace" onChange={onChange} onDone={onDone} {...props} />,
  );
  return { onChange, onDone, input: screen.getByTestId('pace'), view };
}

describe('PaceField', () => {
  it('shows the pace with its unit in the name', () => {
    const { input } = setup({ pace: 5.5 });

    expect(input).toHaveValue('5:30');
    expect(input).toHaveAccessibleName('Pace (min/km)');
  });

  it('shows the pace per mile in imperial units', () => {
    const { input } = setup({ units: 'imperial' });

    expect(input).toHaveValue('9:39');
    expect(input).toHaveAccessibleName('Pace (min/mi)');
  });

  it('changes the pace once, when the user leaves the field, not while typing', () => {
    const { input, onChange, onDone } = setup();

    fireEvent.change(input, { target: { value: '5:30' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(5.5);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('commits on Enter', () => {
    const { input, onChange } = setup();

    fireEvent.change(input, { target: { value: '7' } });
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('does not change the pace for the same pace, or for text that is not one', () => {
    const { input, onChange } = setup();

    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: 'fast' } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('6:00');
  });

  it('puts the pace back on Escape', () => {
    const { input, onChange, onDone } = setup();

    fireEvent.change(input, { target: { value: '5:30' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveValue('6:00');
    expect(onDone).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a pace set elsewhere', () => {
    const { input, view } = setup();

    view.rerender(<PaceField label="Pace" pace={5} units="metric" testId="pace" onChange={() => {}} />);

    expect(input).toHaveValue('5:00');
  });
});
