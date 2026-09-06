import { expect, test } from '@playwright/test';
import { resetDatabase, seedDirectory, signIn } from './helpers';

/**
 * Acceptance criterion 3: "I bought it" fills date, price and fees, and leaves
 * the user with exactly one thing to type.
 *
 * This is the clearest expression of §A -- the user supplies only what the
 * system cannot know -- so it is asserted at the level a user experiences it:
 * the Save button stays disabled until quantity is entered, and then unlocks.
 */
test.describe('AC-03: purchase defaults', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    resetDatabase();
    await seedDirectory(baseURL!);
    await signIn(page, `ac03-${Date.now()}@example.com`, baseURL!);
    await page.goto('/add');
    await page.getByTestId('ticker-search').fill('MSFT');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('asset-card')).toBeVisible();
    await page.getByTestId('intent-open').click();
    await expect(page.getByTestId('purchase-section')).toBeVisible();
  });

  test('prefills price, fees and purchase time; leaves quantity empty', async ({ page }) => {
    await expect(page.getByTestId('entry-price')).toHaveValue('480.15');
    await expect(page.getByTestId('fees')).toHaveValue('0');
    await expect(page.getByTestId('bought-at')).not.toHaveValue('');

    // §C.1: "Quantity defaults to empty and is required."
    await expect(page.getByTestId('quantity')).toHaveValue('');
  });

  test('keeps Save disabled until quantity is entered, then unlocks it', async ({ page }) => {
    const save = page.getByTestId('save');

    await expect(save).toBeDisabled();
    await expect(page.getByTestId('required-hint')).toContainText('Quantity is required');

    await page.getByTestId('quantity').fill('25');

    await expect(save).toBeEnabled();
    await expect(page.getByTestId('required-hint')).toHaveCount(0);
  });

  test('leaves every execution-specific value editable', async ({ page }) => {
    // §C.1 item 3: broker execution legitimately differs from a market quote.
    await page.getByTestId('entry-price').fill('481.20');
    await page.getByTestId('fees').fill('1.50');

    await expect(page.getByTestId('entry-price')).toHaveValue('481.20');
    await expect(page.getByTestId('fees')).toHaveValue('1.50');
  });

  test('switching back to Watching removes the purchase section', async ({ page }) => {
    await page.getByTestId('intent-watching').click();

    // FR-042: watching creates no lot, so it must ask for no purchase data.
    await expect(page.getByTestId('purchase-section')).toHaveCount(0);
    await expect(page.getByTestId('save')).toBeEnabled();
  });
});
