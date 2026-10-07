import { commonText, settingsText } from '../apps/web/src/i18n/index.ts';
import { expect, test } from './test.ts';

const fr = { ...commonText.fr, ...settingsText.fr };

test.describe('the settings', () => {
  test('survive a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await page.getByTestId('settings-units').click();
    await page.getByTestId('settings-units-imperial').click();
    await page.getByTestId('settings-language').click();
    await page.getByTestId('settings-language-fr').click();
    await page.reload();

    await expect(page.getByTestId('settings-language')).toHaveAccessibleName(`${fr.language} Français`);
    await expect(page.getByTestId('settings-units')).toHaveAccessibleName(`${fr.units} ${fr.imperial}`);
  });

  test('keep a forced theme across a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await page.getByTestId('settings-theme').click();
    await page.getByTestId('settings-theme-dark').click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
