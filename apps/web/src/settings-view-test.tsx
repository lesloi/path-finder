import { fireEvent, render, renderHook, screen } from '@testing-library/react';

import { paceFor, useSettings } from './settings.ts';
import { SettingsView } from './settings-view.tsx';

const renderView = (language: 'en' | 'fr' = 'en') => render(<SettingsView language={language} />);
const saved = () => renderHook(() => useSettings()).result.current[0];

describe('SettingsView', () => {
  it('shows the default paces in metric units', () => {
    renderView();

    expect(screen.getByLabelText('Run (min/km)')).toHaveValue('6:00');
    expect(screen.getByLabelText('Hike (km/h)')).toHaveValue('4.5');
    expect(screen.getByLabelText('Units')).toHaveValue('metric');
  });

  it('saves a run pace in minutes per km', () => {
    renderView();

    fireEvent.change(screen.getByLabelText('Run (min/km)'), { target: { value: '5:30' } });

    expect(saved().pace.run).toBe(5.5);
  });

  it('saves a hike speed as a pace in minutes per km', () => {
    renderView();

    fireEvent.change(screen.getByLabelText('Hike (km/h)'), { target: { value: '5' } });

    expect(saved().pace.hike).toBe(12);
  });

  it('does not save what is not a pace, and shows the saved pace again on leaving the field', () => {
    renderView();
    const input = screen.getByLabelText('Run (min/km)');

    fireEvent.change(input, { target: { value: '5:7' } });
    expect(saved().pace.run).toBeUndefined();

    fireEvent.blur(input);
    expect(input).toHaveValue('6:00');
  });

  it('shows and takes paces in min/mi and mph with imperial units', () => {
    renderView();

    fireEvent.change(screen.getByLabelText('Units'), { target: { value: 'imperial' } });

    expect(saved().units).toBe('imperial');
    expect(screen.getByLabelText('Run (min/mi)')).toHaveValue('9:39');
    expect(screen.getByLabelText('Hike (mph)')).toHaveValue('2.8');

    fireEvent.change(screen.getByLabelText('Run (min/mi)'), { target: { value: '8:00' } });

    expect(paceFor(saved(), 'run')).toBeCloseTo(8 / 1.609344);
  });

  it('takes a hike speed with a decimal comma', () => {
    renderView('fr');

    fireEvent.change(screen.getByLabelText('Randonnée (km/h)'), { target: { value: '4,8' } });

    expect(60 / paceFor(saved(), 'hike')).toBeCloseTo(4.8);
  });

  it('saves the language the user picks', () => {
    renderView();

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr' } });

    expect(saved().language).toBe('fr');
  });

  it('speaks French', () => {
    renderView('fr');

    expect(screen.getByRole('heading', { name: 'Allure' })).toBeInTheDocument();
    expect(screen.getByLabelText('Course (min/km)')).toHaveValue('6:00');
    expect(screen.getByLabelText('Randonnée (km/h)')).toHaveValue('4,5');
    expect(screen.getByLabelText('Langue')).toHaveValue('fr');
    expect(screen.getByLabelText('Unités')).toHaveValue('metric');
  });
});
