import { expect, test } from './test.ts';

test.describe('the settings', () => {
  test('survive a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await page.getByTestId('settings-pace-run').fill('5:30');
    await page.getByTestId('settings-units').click();
    await page.getByTestId('settings-units-imperial').click();
    await page.getByTestId('settings-language').click();
    await page.getByTestId('settings-language-fr').click();
    await page.reload();

    await expect(page.getByTestId('settings-language')).toHaveAccessibleName('Langue Français');
    await expect(page.getByTestId('settings-units')).toHaveAccessibleName('Unités Impériales (mi, ft)');
    // 5:30 min/km is 8:51 min/mi.
    await expect(page.getByTestId('settings-pace-run')).toHaveAccessibleName('Course (min/mi)');
    await expect(page.getByTestId('settings-pace-run')).toHaveValue('8:51');
  });
});
