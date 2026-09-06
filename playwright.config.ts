import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level acceptance tests.
 *
 * These exist because the API tests cannot see the screen. Three bugs so far
 * were invisible to them because the API was correct in each case:
 *
 *   - a `Secure` session cookie issued over http, silently dropped by every
 *     browser, so sign-in appeared to work and left no session;
 *   - Intl throwing when `dateStyle` is combined with `timeZoneName`, so the
 *     asset card showed a raw ISO string where §B.2 wants a readable time;
 *   - asset type rendered lowercase on one screen and title-cased on another.
 *
 * curl does not enforce cookie rules and JSON assertions do not read labels.
 * Only a browser catches these.
 */

const PORT = 4321;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // The suite drives one shared dev server and one local database, so
  // parallel workers would fight over the same rows.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Mobile-first: the product is meant to be opened from a phone home
    // screen (ADR-0005), so that is the viewport under test.
    ...devices['iPhone 13'],
  },

  webServer: {
    // Builds the SPA first: wrangler serves web/dist, so a stale bundle would
    // silently test the previous UI.
    command: `npm run build && npx wrangler dev --port ${PORT} --local --ip 127.0.0.1`,
    url: `${BASE_URL}/api/v1/health/live`,
    reuseExistingServer: !process.env['CI'],
    // workerd cold start plus the Vite build.
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
