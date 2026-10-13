import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

import { expectNamedControls } from '../accessible-names.ts';
import { commonText, settingsText } from '../i18n/index.ts';
import { useSettings } from '../state/index.ts';
import { SettingsView } from './settings-view.tsx';

const en = { ...commonText.en, ...settingsText.en };
const fr = { ...commonText.fr, ...settingsText.fr };
const renderView = (language: 'en' | 'fr' = 'en') => render(<SettingsView language={language} />);
const saved = () => renderHook(() => useSettings()).result.current[0];
const pick = (control: 'theme' | 'language' | 'pace-unit' | 'basemap', option: string) =>
  fireEvent.change(screen.getByTestId(`settings-${control}`), { target: { value: option } });

describe('SettingsView', () => {
  it.each([
    ['en', en],
    ['fr', fr],
  ] as const)('shows the pace in min/km by default, in %s', (language, text) => {
    renderView(language);

    expect(screen.getByTestId('settings-pace-unit')).toHaveAccessibleName(text.paceUnit);
    expect(screen.getByTestId('settings-pace-unit')).toHaveValue('min/km');
  });

  it('saves the picked theme', () => {
    renderView();

    pick('theme', 'dark');

    expect(screen.getByTestId('settings-theme')).toHaveValue('dark');
    expect(saved().theme).toBe('dark');
  });

  it('shows the theme first in the display group', () => {
    renderView();

    expect(screen.getByTestId('settings-theme')).toHaveValue('system');
    expect(screen.getAllByRole('combobox')[0]).toBe(screen.getByTestId('settings-theme'));
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

  it('saves the pace unit the user picks', () => {
    renderView('fr');

    pick('pace-unit', 'km/h');

    expect(screen.getByTestId('settings-pace-unit')).toHaveValue('km/h');
    expect(saved().paceUnit).toBe('km/h');
  });

  it('shows the saved map background, and saves the one the user picks', () => {
    renderView();
    expect(screen.getByTestId('settings-basemap')).toHaveAccessibleName(en.basemap);
    expect(screen.getByTestId('settings-basemap')).toHaveValue('plan');

    pick('basemap', 'aerial');

    expect(screen.getByTestId('settings-basemap')).toHaveValue('aerial');
    expect(saved().basemap).toBe('aerial');
  });

  it('says so when the map background picked could not be loaded, until the next pick', () => {
    renderView();
    const settings = renderHook(() => useSettings());
    pick('basemap', 'minimal');
    expect(screen.queryByTestId('settings-basemap-error')).toBeNull();

    // The map gives the previous background back when the style of the new one fails.
    act(() => settings.result.current[1]({ basemap: 'plan' }));

    expect(screen.getByTestId('settings-basemap-error')).toHaveTextContent(en.basemapFailed);
    expect(screen.getByTestId('settings-basemap')).toHaveAccessibleDescription(en.basemapFailed);
    pick('basemap', 'aerial');
    expect(screen.queryByTestId('settings-basemap-error')).toBeNull();
  });

  it('names the map backgrounds in French', () => {
    renderView('fr');

    expect(screen.getByTestId('settings-basemap-aerial')).toHaveTextContent(fr.aerial);
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
    expect(screen.getByTestId('settings-language')).toHaveValue('fr');
    expect(screen.getByTestId('settings-pace-unit')).toHaveAccessibleName(fr.paceUnit);
  });
});
