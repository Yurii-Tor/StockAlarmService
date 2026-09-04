import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveBaseUrl } from '../../worker/src/adapters/auth';

/**
 * Authentication is the largest reconstructed area in the spec — the addendum
 * never mentions it (ADR-0006). These tests pin the flow that everything
 * user-scoped depends on.
 */

const ORIGIN = 'http://localhost:8787';

async function reset() {
  for (const table of ['sessions', 'accounts', 'verifications', 'user_settings', 'users']) {
    await env.DB.prepare(`delete from ${table}`).run();
  }
}

beforeEach(reset);

/** Better Auth stores the magic-link token as the verification identifier. */
async function latestMagicLinkToken(): Promise<string> {
  const row = await env.DB.prepare(
    `select identifier from verifications order by created_at desc limit 1`,
  ).first<{ identifier: string }>();
  if (!row) throw new Error('no magic-link token was issued');
  return row.identifier;
}

async function signIn(email: string): Promise<string> {
  const requested = await SELF.fetch(`${ORIGIN}/api/v1/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, callbackURL: '/' }),
  });
  expect(requested.status).toBe(200);

  const token = await latestMagicLinkToken();
  const verified = await SELF.fetch(
    `${ORIGIN}/api/v1/auth/magic-link/verify?token=${token}&callbackURL=/`,
    { redirect: 'manual' },
  );
  expect(verified.status).toBe(302);

  const cookies = verified.headers.getSetCookie();
  const session = cookies.find((c) => c.includes('session_token'));
  if (!session) throw new Error(`no session cookie in: ${cookies.join(' | ')}`);
  return session.split(';')[0]!;
}

describe('GET /me', () => {
  it('refuses an unauthenticated request with problem+json', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/me`);

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    await expect(response.json()).resolves.toMatchObject({ status: 401, title: 'Unauthorized' });
  });

  it('returns the user and lazily creates their settings', async () => {
    const cookie = await signIn('investor@example.com');

    const response = await SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { cookie } });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      user: { id: string; email: string };
      settings: Record<string, unknown> & {
        defaultReviewChannels: string[];
        defaultPriceAlertChannels: string[];
        defaultPreReviewChannels: string[];
      };
    };

    expect(body.user.email).toBe('investor@example.com');

    // §E.2 requires three SEPARATE defaults, not one shared list. If these
    // ever collapse into one value, criterion 7 becomes untestable.
    expect(body.settings.defaultReviewChannels).toEqual(['in_app']);
    expect(body.settings.defaultPriceAlertChannels).toEqual(['push', 'in_app']);
    expect(body.settings.defaultPreReviewChannels).toEqual(['in_app']);

    // FR-070: a new account plans no reviews until the user asks for one.
    expect(body.settings.defaultNewItemStatus).toBe('watching');

    const settingsRows = await env.DB.prepare(
      `select count(*) as c from user_settings`,
    ).first<{ c: number }>();
    expect(settingsRows!.c).toBe(1);
  });

  it('does not create a second settings row on repeat calls', async () => {
    const cookie = await signIn('investor@example.com');
    await SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { cookie } });
    await SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { cookie } });

    const rows = await env.DB.prepare(`select count(*) as c from user_settings`).first<{
      c: number;
    }>();
    expect(rows!.c).toBe(1);
  });
});

describe('magic-link sign-in', () => {
  it('issues an HttpOnly session cookie', async () => {
    const cookie = await signIn('investor@example.com');
    expect(cookie).toContain('better-auth');

    // The credential must stay out of JavaScript: a service worker runs on
    // this same origin (NFR-08, ADR-0004).
    const raw = await env.DB.prepare(`select count(*) as c from sessions`).first<{ c: number }>();
    expect(raw!.c).toBe(1);
  });

  it('does not issue a session for an unknown token', async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/api/v1/auth/magic-link/verify?token=not-a-real-token&callbackURL=/`,
      { redirect: 'manual' },
    );

    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.includes('session_token='))).toBe(false);
  });
});

describe('resolveBaseUrl', () => {
  const configured = 'https://stockalarm.torproduction.com';

  it('uses the loopback origin in local development', () => {
    // A `Secure` cookie issued over http is silently dropped by browsers, so
    // sign-in would appear to succeed and leave no session behind.
    expect(resolveBaseUrl(configured, 'http://localhost:8787/api/v1/me')).toBe(
      'http://localhost:8787',
    );
    expect(resolveBaseUrl(configured, 'http://127.0.0.1:8788/x')).toBe('http://127.0.0.1:8788');
  });

  it('ignores any non-loopback origin, so a spoofed Host cannot steer a magic link', () => {
    expect(resolveBaseUrl(configured, 'https://evil.example.com/api/v1/me')).toBe(configured);
    expect(resolveBaseUrl(configured, 'https://stockalarm.torproduction.com/x')).toBe(configured);
    expect(resolveBaseUrl(configured, 'not a url')).toBe(configured);
  });
});
