import { expect, test } from './test.ts';

test.describe('the settings', () => {
  test('survive a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await expect(page.getByTestId('settings-pace-unit-min/km')).toBeChecked();
    await page.locator('label', { has: page.getByTestId('settings-pace-unit-km/h') }).click();
    await page.locator('label', { has: page.getByTestId('settings-language-fr') }).click();
    await page.reload();

    await expect(page.getByTestId('settings-language-fr')).toBeChecked();
    await expect(page.getByTestId('settings-pace-unit-km/h')).toBeChecked();
  });

  test('keep a forced theme across a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await page.locator('label', { has: page.getByTestId('settings-theme-dark') }).click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
