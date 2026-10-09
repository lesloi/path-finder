import { criteriaText } from '../apps/web/src/i18n/index.ts';
import { expect, openCriteria, test } from './test.ts';

// The stand-in graph covers the cells round Annecy and nothing else.
const ANNECY = '45.8992, 6.1294';
const PARIS = '48.8566, 2.3522';

test.describe('the places with no routes', () => {
  test('cannot be searched from: the button is off and says why', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);

    await page.getByTestId('criteria-start').fill(PARIS);
    await page.getByTestId('criteria-start').press('Enter');

    await expect(page.getByTestId('criteria-submit')).toBeDisabled();
    await expect(page.getByTestId('criteria-uncovered')).toHaveText(criteriaText.en.uncoveredStart);
  });

  test('are left once the start point moves to a covered place', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);
    await page.getByTestId('criteria-start').fill(PARIS);
    await page.getByTestId('criteria-start').press('Enter');
    await expect(page.getByTestId('criteria-submit')).toBeDisabled();

    await page.getByTestId('criteria-start').fill(ANNECY);
    await page.getByTestId('criteria-start').press('Enter');

    await expect(page.getByTestId('criteria-submit')).toBeEnabled();
    await expect(page.getByTestId('criteria-uncovered')).toHaveCount(0);
  });
});
