import { fireEvent, render, renderHook, screen } from '@testing-library/react';

import { expectNamedControls } from '../accessible-names.ts';
import { commonText, settingsText } from '../i18n/index.ts';
import { paceFor, useSettings } from '../state/index.ts';
import { SettingsView } from './settings-view.tsx';

const en = { ...commonText.en, ...settingsText.en };
const fr = { ...commonText.fr, ...settingsText.fr };
const renderView = (language: 'en' | 'fr' = 'en') => render(<SettingsView language={language} />);
const saved = () => renderHook(() => useSettings()).result.current[0];
const pick = (dropdown: 'theme' | 'language' | 'units', option: string) => {
  fireEvent.click(screen.getByTestId(`settings-${dropdown}`));
  fireEvent.click(screen.getByTestId(`settings-${dropdown}-${option}`));
};

describe('SettingsView', () => {
  it('shows the default paces in metric units', () => {
    renderView();

    expect(screen.getByTestId('settings-pace-run')).toHaveValue('6:00');
    expect(screen.getByTestId('settings-pace-hike')).toHaveValue('4.5');
    expect(screen.getByTestId('settings-units')).toHaveAccessibleName(`${en.units} ${en.metric}`);
  });

  it('saves the picked theme', () => {
    renderView();

    pick('theme', 'dark');

    expect(screen.getByTestId('settings-theme')).toHaveAccessibleName(`${en.theme} ${en.dark}`);
    expect(saved().theme).toBe('dark');
  });

  it('shows the theme first in the display group', () => {
    renderView();

    expect(screen.getByTestId('settings-theme')).toHaveAccessibleName(`${en.theme} ${en.system}`);
    expect(screen.getAllByRole('button')[0]).toBe(screen.getByTestId('settings-theme'));
  });

  it('shows the display, pace, and about groups in this order', () => {
    renderView();

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      en.display,
      en.pace,
      en.about,
    ]);
  });

  it.each([
    ['credits', '#/credits'],
    ['privacy', '#/privacy'],
    ['legal-notice', '#/legal-notice'],
  ])('links to the %s page', (page, href) => {
    renderView();

    expect(screen.getByTestId(`settings-${page}`)).toHaveAttribute('href', href);
  });

  it('saves a run pace in minutes per km', () => {
    renderView();

    fireEvent.change(screen.getByTestId('settings-pace-run'), { target: { value: '5:30' } });

    expect(saved().pace.run).toBe(5.5);
  });

  it('saves a hike speed as a pace in minutes per km', () => {
    renderView();

    fireEvent.change(screen.getByTestId('settings-pace-hike'), { target: { value: '5' } });

    expect(saved().pace.hike).toBe(12);
  });

  it('does not save what is not a pace, and shows the saved pace again on leaving the field', () => {
    renderView();
    const input = screen.getByTestId('settings-pace-run');

    fireEvent.change(input, { target: { value: '5:7' } });
    expect(saved().pace.run).toBeUndefined();

    fireEvent.blur(input);
    expect(input).toHaveValue('6:00');
  });

  it('shows and takes paces in min/mi and mph with imperial units', () => {
    renderView();

    pick('units', 'imperial');

    expect(saved().units).toBe('imperial');
    expect(screen.getByTestId('settings-pace-run')).toHaveAccessibleName(`${en.activities.run} (min/mi)`);
    expect(screen.getByTestId('settings-pace-run')).toHaveValue('9:39');
    expect(screen.getByTestId('settings-pace-hike')).toHaveAccessibleName(`${en.activities.hike} (mph)`);
    expect(screen.getByTestId('settings-pace-hike')).toHaveValue('2.8');

    fireEvent.change(screen.getByTestId('settings-pace-run'), { target: { value: '8:00' } });

    expect(paceFor(saved(), 'run')).toBeCloseTo(8 / 1.609344);
  });

  it('takes a hike speed with a decimal comma', () => {
    renderView('fr');

    fireEvent.change(screen.getByTestId('settings-pace-hike'), { target: { value: '4,8' } });

    expect(60 / paceFor(saved(), 'hike')).toBeCloseTo(4.8);
  });

  it('saves the language the user picks', () => {
    renderView();

    pick('language', 'fr');

    expect(saved().language).toBe('fr');
  });

  it.each(['en', 'fr'] as const)('names every control in %s', (language) => {
    const { container } = renderView(language);

    expectNamedControls(container);
  });

  it('speaks French', () => {
    renderView('fr');

    expect(screen.getAllByRole('heading', { level: 2 })[1]).toHaveTextContent(fr.pace);
    expect(screen.getByTestId('settings-pace-run')).toHaveAccessibleName(`${fr.activities.run} (min/km)`);
    expect(screen.getByTestId('settings-pace-run')).toHaveValue('6:00');
    expect(screen.getByTestId('settings-pace-hike')).toHaveAccessibleName(`${fr.activities.hike} (km/h)`);
    expect(screen.getByTestId('settings-pace-hike')).toHaveValue('4,5');
    expect(screen.getByTestId('settings-language')).toHaveAccessibleName(`${fr.language} Français`);
    expect(screen.getByTestId('settings-units')).toHaveAccessibleName(`${fr.units} ${fr.metric}`);
  });
});
