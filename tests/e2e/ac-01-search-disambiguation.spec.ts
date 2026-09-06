import { expect, test } from '@playwright/test';
import { resetDatabase, seedDirectory, signIn } from './helpers';

/**
 * Acceptance criterion 1, and §B.1's hard rule about duplicate tickers.
 *
 * The API test proves the data is right. This proves the screen shows it, and
 * that the UI refuses to choose between two listings on the user's behalf.
 */
test.describe('AC-01: search and disambiguation', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    resetDatabase();
    await seedDirectory(baseURL!);
    await signIn(page, `ac01-${Date.now()}@example.com`, baseURL!);
    await page.goto('/add');
  });

  test('shows the company name, NASDAQ, type and currency for MSFT', async ({ page }) => {
    await page.getByTestId('ticker-search').fill('MSFT');

    const results = page.getByTestId('search-results');
    await expect(results).toBeVisible();

    // §B.1's exact two-line result format.
    await expect(results).toContainText('MSFT — Microsoft Corporation');
    await expect(results).toContainText('NASDAQ · Stock · USD');
  });

  test('offers both venues for a duplicate ticker and never auto-selects', async ({ page }) => {
    await page.getByTestId('ticker-search').fill('VOD');

    const results = page.getByTestId('search-results');
    await expect(results).toBeVisible();

    // "Never automatically assume a ticker is unique across all exchanges."
    await expect(page.getByTestId('disambiguation-notice')).toBeVisible();
    await expect(results).toContainText('GBP');
    await expect(results).toContainText('USD');
    await expect(results.getByText('duplicate ticker').first()).toBeVisible();

    // Crucially: still on the search step. Nothing was chosen for the user.
    await expect(page).toHaveURL(/\/add$/);
    await expect(page.getByTestId('asset-card')).toHaveCount(0);
  });

  test('does not warn about ambiguity for a unique ticker', async ({ page }) => {
    await page.getByTestId('ticker-search').fill('AAPL');

    await expect(page.getByTestId('search-results')).toBeVisible();
    await expect(page.getByTestId('disambiguation-notice')).toHaveCount(0);
  });
});
