import type { Page } from '@playwright/test';

import { expect, test } from './test.ts';

// The radio buttons are visually hidden: the user clicks their labels.
const choose = (page: Page, group: string, value: string) =>
  page.locator('label', { has: page.getByTestId(`criteria-${group}-${value}`) }).click();

test.describe('the criteria form', () => {
  test('offers Find routes once a start point is set', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('criteria-submit')).toBeHidden();

    await page.getByTestId('criteria-start').fill('45.8326, 6.8652');
    await page.getByTestId('criteria-start').press('Enter');

    await expect(page.getByTestId('criteria-submit')).toBeVisible();
  });

  test('sets the criteria in the full form', async ({ page, isMobile }) => {
    await page.goto('/');
    // On phones, the sheet shows chips until its handle expands it to the full form.
    if (isMobile) await page.getByTestId('criteria-sheet-handle').click();

    await choose(page, 'target', 'duration');

    await expect(page.getByTestId('criteria-duration')).toBeVisible();
    // The e2e server has a stand-in graph with elevation (`apps/server/internal/standin`): the elevation gain is offered.
    await expect(page.getByTestId('criteria-elevation-hilly')).toBeAttached();
    // The pace is set where it is used, under the duration.
    await expect(page.getByTestId('criteria-pace')).toHaveValue('6:00');
  });

  test('keeps the pace across a reload', async ({ page, isMobile }) => {
    await page.goto('/');
    if (isMobile) await page.getByTestId('criteria-sheet-handle').click();
    await choose(page, 'target', 'duration');

    await page.getByTestId('criteria-pace').fill('5:30');
    await page.getByTestId('criteria-pace').blur();
    await page.reload();
    if (isMobile) await page.getByTestId('criteria-sheet-handle').click();

    // The last criteria are kept too: the length is still set by duration.
    await expect(page.getByTestId('criteria-pace')).toHaveValue('5:30');
  });
});
