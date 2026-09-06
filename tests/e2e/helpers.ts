import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Test helpers that talk to the same local database the app uses.
 *
 * Sign-in deliberately goes through the real magic-link flow rather than a
 * test-only backdoor. A backdoor would be faster, but it would also mean the
 * one path every user takes is the one never exercised in a browser — and
 * that is exactly where the two worst bugs in this project have lived.
 */

const ADMIN_TOKEN = 'local-dev-admin-token';

/**
 * Fetch with a few retries on connection errors.
 *
 * `wrangler dev` intermittently resets connections while it is warming up or
 * reloading, which surfaces as ECONNRESET and fails a test for reasons that
 * have nothing to do with the application. Retries cover only transport
 * failures — an HTTP error response is returned as-is, so a genuine 4xx or
 * 5xx still fails the test immediately.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 4,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`Request to ${url} failed after ${attempts} attempts: ${String(lastError)}`);
}

function wrangler(args: string[]): string {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function d1(sql: string): unknown[] {
  // Invoked through Node rather than `npx` with `shell: true`. On Windows the
  // shell splits the SQL on spaces and wrangler rejects it as unknown
  // arguments, which is silent until a helper fails mid-test.
  const raw = wrangler(['d1', 'execute', 'stockalarm', '--local', '--command', sql, '--json']);

  // wrangler prints a banner before the JSON payload.
  const start = raw.indexOf('[');
  if (start === -1) return [];
  const parsed = JSON.parse(raw.slice(start)) as Array<{ results?: unknown[] }>;
  return parsed[0]?.results ?? [];
}

/**
 * Removes every row the suite creates.
 *
 * One wrangler invocation, not one per table. Each spawn costs a couple of
 * seconds and a fresh connection to the dev server; ten of them before every
 * test was slow enough to knock the server over with ECONNRESET.
 */
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

  const file = join(mkdtempSync(join(tmpdir(), 'stockalarm-e2e-')), 'reset.sql');
  writeFileSync(file, tables.map((t) => `delete from ${t};`).join(' '));

  wrangler(['d1', 'execute', 'stockalarm', '--local', '--file', file, '--json']);
}

/** A fresh address per test, so accounts never collide without a full reset. */
let counter = 0;
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

/** Populates the KV instrument directory. Idempotent: later runs write nothing. */
export async function seedDirectory(baseURL: string): Promise<void> {
  // ONE call listing every exchange. A refresh replaces the whole directory,
  // and shards are keyed by symbol, so refreshing 'US' then 'L' separately
  // deletes VOD (NASDAQ) when VOD.L (London) is written -- they share shard V.
  const response = await fetchWithRetry(`${baseURL}/api/v1/admin/refresh-directory?exchanges=US,L`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`Directory refresh failed: ${response.status}`);
  }
}

/**
 * Signs in through the real magic-link flow.
 *
 * Two things make this work that did not before, both worth knowing:
 *
 *   - the dev server runs with `routes` removed (scripts/dev-config.mjs), so
 *     wrangler stops substituting the production host and Better Auth's CSRF
 *     check no longer rejects the sign-in POST with 403;
 *   - `assets.run_worker_first` covers `/api/*`, so a browser NAVIGATION to
 *     the verification URL reaches the Worker instead of being answered with
 *     the SPA shell. Without it this flow silently signed nobody in — in
 *     production as well as here.
 */
export async function signIn(page: Page, email: string, baseURL: string): Promise<void> {
  const requested = await fetchWithRetry(`${baseURL}/api/v1/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseURL },
    body: JSON.stringify({ email, callbackURL: '/' }),
  });
  if (!requested.ok) {
    throw new Error(`Magic link request failed: ${requested.status}`);
  }

  const rows = d1(
    `select identifier from verifications order by created_at desc limit 1`,
  ) as Array<{ identifier: string }>;
  const token = rows[0]?.identifier;
  if (!token) throw new Error('No magic-link token was issued');

  await page.goto(`/api/v1/auth/magic-link/verify?token=${token}&callbackURL=/`, {
    waitUntil: 'networkidle',
  });

  // NOT `waitForURL('**/')`: that glob matches the verification URL itself,
  // because it ends in `callbackURL=/`. The wait then resolves instantly and
  // the helper returns before the session exists. Wait for something only the
  // signed-in app renders.
  await page.getByTestId('add-investment').waitFor({ state: 'visible', timeout: 15_000 });
}
