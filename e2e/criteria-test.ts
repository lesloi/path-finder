import type { Page } from '@playwright/test';

import { expect, openCriteria, setStart, test } from './test.ts';

// The radio buttons are visually hidden: the user clicks their labels.
const choose = (page: Page, group: string, value: string) =>
  page.locator('label', { has: page.getByTestId(`criteria-${group}-${value}`) }).click();

const START = '45.8326, 6.8652';

test.describe('the criteria form', () => {
  test('offers Find routes once a start point is set', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);
    await expect(page.getByTestId('criteria-submit')).toBeHidden();

    await setStart(page, START);

    await expect(page.getByTestId('criteria-submit')).toBeVisible();
  });

  test('sets the criteria in the full form', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);
    await setStart(page, START);

    await choose(page, 'target', 'duration');

    await expect(page.getByTestId('criteria-duration')).toBeVisible();
    // The e2e server has a stand-in graph with elevation (`apps/server/internal/standin`): the elevation gain is offered.
    await expect(page.getByTestId('criteria-elevation-hilly')).toBeAttached();
    // The pace is set where it is used, under the duration.
    await expect(page.getByTestId('criteria-pace')).toHaveValue('360');
  });

  test('keeps the pace across a reload', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);
    await setStart(page, START);
    await choose(page, 'target', 'duration');

    await page.getByTestId('criteria-pace').fill('330');
    await page.reload();
    await openCriteria(page);
    await setStart(page, START);

    // The criteria are kept only once a search is made: the length is set by distance again.
    await choose(page, 'target', 'duration');
    await expect(page.getByTestId('criteria-pace')).toHaveValue('330');
  });
});
