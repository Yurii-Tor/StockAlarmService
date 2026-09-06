import { expect, test } from '@playwright/test';
import { resetDatabase, seedDirectory, signIn, uniqueEmail } from './helpers';

/**
 * FR-054: a thesis revision never overwrites the previous one.
 *
 * This is the product's whole reason to exist -- being able to read what you
 * actually thought at the time -- so it is worth asserting through the UI and
 * not only against the database.
 */
test.describe('thesis versioning', () => {
  test('keeps the original version readable after a revision', async ({ page, baseURL }) => {
    resetDatabase();
    await seedDirectory(baseURL!);
    await signIn(page, uniqueEmail('thesis'), baseURL!);

    await page.goto('/add');
    await page.getByTestId('ticker-search').fill('MSFT');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('asset-card')).toBeVisible();
    await page.getByTestId('thesis').fill('Original reasoning.');
    await page.getByTestId('save').click();
    await expect(page).toHaveURL(/\/items\//);

    await page.getByTestId('thesis-editor').fill('Revised reasoning.');
    await page.getByTestId('save-thesis').click();

    await expect(page.getByText('version 2 of 2')).toBeVisible();

    await page.getByTestId('show-history').click();
    const history = page.getByTestId('thesis-history');

    await expect(history).toContainText('Version 2');
    await expect(history).toContainText('Revised reasoning.');
    // The point of the whole feature: version 1 survives verbatim.
    await expect(history).toContainText('Version 1');
    await expect(history).toContainText('Original reasoning.');
  });
});
