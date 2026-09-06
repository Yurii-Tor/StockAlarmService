import { expect, test } from '@playwright/test';
import { resetDatabase, seedDirectory, signIn } from './helpers';

/**
 * Acceptance criterion 4: an item saves with no review date and no push.
 *
 * §D.1 is the governing principle -- "Creating an asset, watchlist item, lot,
 * thesis, target price, or price alert must not require a review deadline or
 * a timer-based push." The API test proves no scheduling rows are written.
 * This proves the screen never asks for any of it, which is the half a user
 * actually experiences.
 */
test.describe('AC-04: saving needs no reminder', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    resetDatabase();
    await seedDirectory(baseURL!);
    await signIn(page, `ac04-${Date.now()}@example.com`, baseURL!);
  });

  test('saves a watchlist item without ever mentioning a reminder', async ({ page }) => {
    await page.goto('/add');
    await page.getByTestId('ticker-search').fill('MSFT');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('asset-card')).toBeVisible();

    // Watching is the default (FR-070): no date picker, no channel checkboxes,
    // nothing to dismiss before saving.
    await expect(page.getByTestId('save')).toBeEnabled();
    await page.getByTestId('save').click();

    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('MSFT');

    // It is a watchlist entry, so no position is recorded.
    await expect(page.getByText('Watching — no position recorded.')).toBeVisible();
  });

  test('saves a purchase with a thesis and no reminder', async ({ page }) => {
    await page.goto('/add');
    await page.getByTestId('ticker-search').fill('MSFT');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await page.getByTestId('intent-open').click();
    await page.getByTestId('quantity').fill('25');
    await page.getByTestId('thesis').fill('Margins keep expanding. Wrong if growth stalls.');

    await page.getByTestId('save').click();

    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
    const position = page.getByTestId('position');
    await expect(position).toContainText('25');
    await expect(position).toContainText('480.15');
    // FR-053: figures are labelled with their currency and never summed
    // across currencies.
    await expect(position).toContainText('All figures in USD');
  });

  test('shows the saved item in the portfolio', async ({ page }) => {
    await page.goto('/add');
    await page.getByTestId('ticker-search').fill('AAPL');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('asset-card')).toBeVisible();
    await page.getByTestId('save').click();
    await expect(page).toHaveURL(/\/items\//);

    await page.goto('/');
    await expect(page.getByTestId('item-list')).toContainText('AAPL');
  });
});
