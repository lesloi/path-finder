import { expect, test } from './test.ts';

test.describe('the settings', () => {
  test('survive a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await expect(page.getByTestId('settings-pace-unit')).toHaveValue('min/km');
    await page.getByTestId('settings-pace-unit').selectOption('km/h');
    await page.getByTestId('settings-language').selectOption('fr');
    await page.reload();

    await expect(page.getByTestId('settings-language')).toHaveValue('fr');
    await expect(page.getByTestId('settings-pace-unit')).toHaveValue('km/h');
  });

  test('keep a forced theme across a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await page.getByTestId('settings-theme').selectOption('dark');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
