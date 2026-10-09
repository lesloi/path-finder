import type { Page } from '@playwright/test';

import { expect, openCriteria, test } from './test.ts';

// The radio buttons are visually hidden: the user clicks their labels.
const choose = (page: Page, group: string, value: string) =>
  page.locator('label', { has: page.getByTestId(`criteria-${group}-${value}`) }).click();

test.describe('the criteria form', () => {
  test('offers Find routes once a start point is set', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);
    await expect(page.getByTestId('criteria-submit')).toBeHidden();

    await page.getByTestId('criteria-start').fill('45.8326, 6.8652');
    await page.getByTestId('criteria-start').press('Enter');

    await expect(page.getByTestId('criteria-submit')).toBeVisible();
  });

  test('sets the criteria in the full form', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);

    await choose(page, 'target', 'duration');

    await expect(page.getByTestId('criteria-duration')).toBeVisible();
    // The e2e server has a stand-in graph with elevation (`apps/server/internal/standin`): the elevation gain is offered.
    await expect(page.getByTestId('criteria-elevation-hilly')).toBeAttached();
    // The pace is set where it is used, under the duration.
    await expect(page.getByTestId('criteria-pace')).toHaveValue('360');
  });

  test('offers the technical stretches unless the surface is paved, off by default', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);

    await expect(page.getByTestId('criteria-technical')).not.toBeChecked();
    await choose(page, 'surface', 'paved');
    await expect(page.getByTestId('criteria-technical')).toHaveCount(0);
    await choose(page, 'surface', 'unpaved');
    await expect(page.getByTestId('criteria-technical')).toBeAttached();
  });

  test('keeps the pace across a reload', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);
    await choose(page, 'target', 'duration');

    await page.getByTestId('criteria-pace').fill('330');
    await page.reload();
    await openCriteria(page);

    // The criteria are kept only once a search is made: the length is set by distance again.
    await choose(page, 'target', 'duration');
    await expect(page.getByTestId('criteria-pace')).toHaveValue('330');
  });
});
