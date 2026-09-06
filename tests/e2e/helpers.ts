import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

/**
 * Test helpers that talk to the same local database the app uses.
 *
 * Sign-in deliberately goes through the real magic-link flow rather than a
 * test-only backdoor. A backdoor would be faster, but it would also mean the
 * one code path every user takes is the one path never exercised in a
 * browser — and the last cookie bug lived exactly there.
 */

const ADMIN_TOKEN = 'local-dev-admin-token';

function d1(sql: string): unknown[] {
  // Invoked through Node rather than `npx` with `shell: true`. On Windows the
  // shell splits the SQL on spaces and wrangler rejects it as unknown
  // arguments, which is silent until a helper fails mid-test.
  const raw = execFileSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'stockalarm',
      '--local',
      '--command',
      sql,
      '--json',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );

  // wrangler prints a banner before the JSON payload.
  const start = raw.indexOf('[');
  if (start === -1) return [];
  const parsed = JSON.parse(raw.slice(start)) as Array<{ results?: unknown[] }>;
  return parsed[0]?.results ?? [];
}

/** Removes every row the suite creates, so runs do not accumulate state. */
export function resetDatabase(): void {
  const tables = [
    'thesis_versions',
    'theses',
    'lots',
    'investment_items',
    'instruments',
    'sessions',
    'accounts',
    'verifications',
    'user_settings',
    'users',
  ];
  // One statement per call: wrangler's --command takes a single statement.
  for (const table of tables) d1(`delete from ${table}`);
}

/** Populates the KV instrument directory. Idempotent: later runs write nothing. */
export async function seedDirectory(baseURL: string): Promise<void> {
  for (const exchange of ['US', 'L']) {
    const response = await fetch(
      `${baseURL}/api/v1/admin/refresh-directory?exchange=${exchange}`,
      { method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    if (!response.ok) {
      throw new Error(`Directory refresh failed for ${exchange}: ${response.status}`);
    }
  }
}

/**
 * Signs in by seeding a magic-link token and following the verification URL.
 *
 * The token is written straight into `verifications` rather than requested
 * over the API, because `wrangler dev` simulates the custom domain declared in
 * wrangler.jsonc: the Worker sees `Origin: http://stockalarm.torproduction.com`
 * while the browser is on 127.0.0.1, and Better Auth's CSRF check rejects the
 * sign-in POST with 403. That is a local-development artefact — in production
 * the origin matches naturally — but it makes the POST unusable from here.
 *
 * What still runs for real is the part that has actually broken before: the
 * GET verification, which is where the session cookie is issued and where the
 * `Secure`-over-http bug lived. Origin checks do not apply to GET, so this
 * exercises the meaningful half without fighting the dev server.
 */
export async function signIn(page: Page, email: string, _baseURL: string): Promise<void> {
  const token = `e2e${Math.random().toString(36).slice(2)}${Date.now()}`;
  const now = Date.now();
  const expires = now + 15 * 60 * 1000;
  const value = JSON.stringify({ email }).replace(/'/g, "''");

  d1(
    `insert into verifications (id, identifier, value, expires_at, created_at, updated_at) ` +
      `values ('${crypto.randomUUID()}', '${token}', '${value}', ${expires}, ${now}, ${now})`,
  );

  await page.goto(`/api/v1/auth/magic-link/verify?token=${token}&callbackURL=/`, {
    waitUntil: 'networkidle',
  });

  // NOT `waitForURL('**/')`: that glob matches the verification URL itself,
  // because it ends in `callbackURL=/`. The wait then resolved instantly, the
  // helper returned before the redirect completed, and every test saw the
  // signed-out app. Wait for something only the signed-in app renders.
  await page.getByTestId('add-investment').waitFor({ state: 'visible', timeout: 15_000 });
}
