import { expect, test } from './test.ts';

test.describe('the settings', () => {
  test('survive a reload', async ({ page }) => {
    await page.goto('/#/settings');

    await page.getByLabel('Run (min/km)').fill('5:30');
    await page.getByRole('button', { name: /^Units/ }).click();
    await page.getByRole('option', { name: 'Imperial (mi, ft)' }).click();
    await page.getByRole('button', { name: /^Language/ }).click();
    await page.getByRole('option', { name: 'Français' }).click();
    await page.reload();

    await expect(page.getByRole('button', { name: 'Langue Français' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unités Impériales (mi, ft)' })).toBeVisible();
    // 5:30 min/km is 8:51 min/mi.
    await expect(page.getByLabel('Course (min/mi)')).toHaveValue('8:51');
  });
});
