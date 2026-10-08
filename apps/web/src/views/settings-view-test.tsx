import { fireEvent, render, renderHook, screen } from '@testing-library/react';

import { expectNamedControls } from '../accessible-names.ts';
import { commonText, settingsText } from '../i18n/index.ts';
import { useSettings } from '../state/index.ts';
import { SettingsView } from './settings-view.tsx';

const en = { ...commonText.en, ...settingsText.en };
const fr = { ...commonText.fr, ...settingsText.fr };
const renderView = (language: 'en' | 'fr' = 'en') => render(<SettingsView language={language} />);
const saved = () => renderHook(() => useSettings()).result.current[0];
const pick = (control: 'theme' | 'language' | 'units', option: string) =>
  fireEvent.click(screen.getByTestId(`settings-${control}-${option}`));

describe('SettingsView', () => {
  it('shows the metric units by default', () => {
    renderView();

    expect(screen.getByTestId('settings-units')).toHaveAccessibleName(en.units);
    expect(screen.getByTestId('settings-units-metric')).toBeChecked();
  });

  it('saves the picked theme', () => {
    renderView();

    pick('theme', 'dark');

    expect(screen.getByTestId('settings-theme-dark')).toBeChecked();
    expect(saved().theme).toBe('dark');
  });

  it('shows the theme first in the display group', () => {
    renderView();

    expect(screen.getByTestId('settings-theme-system')).toBeChecked();
    expect(screen.getAllByRole('radio')[0]).toBe(screen.getByTestId('settings-theme-system'));
  });

  it('shows the display and about groups in this order, and no pace', () => {
    renderView();

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      en.display,
      en.about,
    ]);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it.each([
    ['credits', '#/credits'],
    ['privacy', '#/privacy'],
    ['legal-notice', '#/legal-notice'],
  ])('links to the %s page', (page, href) => {
    renderView();

    expect(screen.getByTestId(`settings-${page}`)).toHaveAttribute('href', href);
  });

  it('saves the units the user picks', () => {
    renderView();

    pick('units', 'imperial');

    expect(saved().units).toBe('imperial');
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

    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(fr.display);
    expect(screen.getByTestId('settings-language')).toHaveAccessibleName(fr.language);
    expect(screen.getByTestId('settings-language-fr')).toBeChecked();
    expect(screen.getByTestId('settings-units')).toHaveAccessibleName(fr.units);
  });
});
