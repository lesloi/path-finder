import { expect, test } from './test.ts';

test.describe('the settings', () => {
  test('survive a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await page.getByTestId('settings-units-imperial').check({ force: true });
    await page.getByTestId('settings-language-fr').check({ force: true });
    await page.reload();

    await expect(page.getByTestId('settings-language-fr')).toBeChecked();
    await expect(page.getByTestId('settings-units-imperial')).toBeChecked();
  });

  test('keep a forced theme across a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await page.getByTestId('settings-theme-dark').check({ force: true });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
