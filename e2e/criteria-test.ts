import { expect, test } from './test.ts';

test.describe('the criteria form', () => {
  test('offers Find routes once a start point is set', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Find routes' })).toBeHidden();

    await page.getByLabel('Start point').fill('45.8326, 6.8652');
    await page.getByLabel('Start point').press('Enter');

    await expect(page.getByRole('button', { name: 'Find routes' })).toBeVisible();
  });

  test('sets the criteria in the full form', async ({ page, isMobile }) => {
    await page.goto('/');
    // On phones, the sheet shows chips until its handle expands it to the full form.
    if (isMobile) await page.getByRole('button', { name: 'Criteria' }).click();

    // The radio buttons are visually hidden: the user clicks their labels.
    await page.locator('label', { hasText: 'Duration' }).click();

    await expect(page.getByRole('slider', { name: 'Duration' })).toBeVisible();
    // The e2e server has no BD ALTI: the elevation gain is not offered.
    await expect(page.getByRole('radio', { name: 'Hilly' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Adjust your pace' })).toHaveAttribute('href', '#/settings');
  });
});
