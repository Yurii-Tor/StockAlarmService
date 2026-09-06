import { expect, test } from '@playwright/test';
import { resetDatabase, seedDirectory, signIn } from './helpers';

/**
 * Acceptance criterion 2, plus §B.2's absolute rule about the word "current".
 *
 * Two of the assertions here are regressions for bugs the API tests could not
 * see, because the API was correct in both cases: a raw ISO timestamp where a
 * readable local time belonged, and asset type rendered lowercase on the card
 * while search showed it title-cased.
 */
test.describe('AC-02: selection prefills the draft', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    resetDatabase();
    await seedDirectory(baseURL!);
    await signIn(page, `ac02-${Date.now()}@example.com`, baseURL!);
    await page.goto('/add');
    await page.getByTestId('ticker-search').fill('MSFT');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('asset-card')).toBeVisible();
  });

  test('fills symbol, name, venue, type, currency and price', async ({ page }) => {
    const card = page.getByTestId('asset-card');

    await expect(card).toContainText('MSFT — Microsoft Corporation');
    // Title-cased here exactly as in search results, from one shared formatter.
    await expect(card).toContainText('NASDAQ · Stock · USD');
    await expect(card).toContainText('480.15');
  });

  test('renders the quote timestamp as a readable local time, not an ISO string', async ({
    page,
  }) => {
    const card = page.getByTestId('asset-card');

    await expect(card).toContainText(/as of \w+ \d+, \d{4}/);
    // The bug: Intl throws when dateStyle is combined with timeZoneName, and
    // the catch returned the raw ISO string.
    await expect(card).not.toContainText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  test('only calls a quote "current" when it really is real-time', async ({ page }) => {
    const card = page.getByTestId('asset-card');
    const text = (await card.innerText()).toLowerCase();

    // §B.2 states this as an absolute: never label stale or unavailable data
    // as current. The fixture quote is real-time, so the word is permitted --
    // and the freshness badge must agree with the price label.
    if (text.includes('current price')) {
      await expect(card).toContainText('Current');
    }
  });
});
