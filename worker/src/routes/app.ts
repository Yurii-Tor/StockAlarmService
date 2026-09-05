import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Database } from '../adapters/db/client';
import { createMailer } from '../adapters/email/mailer';
import { createAuth, describeAuthMethods } from '../adapters/auth';
import { SystemClock } from '../adapters/time/system-clock';
import { instruments } from './instruments';
import type { AppContext } from './context';

export const api = new Hono<AppContext>();

/** Per-request wiring. D1 and KV bindings are per-invocation, not global. */
api.use('*', async (c, next) => {
  const db = createDb(c.env.DB);
  const mailer = createMailer(c.env);
  c.set('db', db);
  c.set('mailer', mailer);
  c.set('clock', new SystemClock());
  c.set('auth', createAuth(db, c.env, mailer, c.req.url));
  await next();
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

api.get('/health/live', (c) => c.json({ status: 'live' }));

api.get('/health/ready', async (c) => {
  /**
   * Reminder correctness depends on the runtime's time-zone data. A stale
   * tzdata makes reminders fire an hour off with NO error raised, so it is
   * checked here and reviewed quarterly (ADR-0003, docs/04-operations.md §6).
   *
   * Australia/Lord_Howe is the probe on purpose: its 30-minute DST offset is
   * the case that breaks naive implementations.
   */
  const timeZoneDataOk = (() => {
    try {
      const fmt = new Intl.DateTimeFormat('en', {
        timeZone: 'Australia/Lord_Howe',
        timeZoneName: 'longOffset',
      });
      return fmt.format(0).length > 0;
    } catch {
      return false;
    }
  })();

  const database = await (async (): Promise<'ok' | 'unavailable'> => {
    try {
      await c.env.DB.prepare('select 1').first();
      return 'ok';
    } catch {
      return 'unavailable';
    }
  })();

  const schemaVersion = await (async (): Promise<number | null> => {
    try {
      const row = await c.env.DB.prepare(
        `select count(*) as c from sqlite_master where type = 'table'`,
      ).first<{ c: number }>();
      return row?.c ?? null;
    } catch {
      return null;
    }
  })();

  const ready = timeZoneDataOk && database === 'ok';

  return c.json(
    {
      status: ready ? 'ready' : 'degraded',
      checks: { database, timeZoneDataOk, tableCount: schemaVersion },
      marketDataProvider: c.env.MARKET_DATA_PROVIDER,
      auth: describeAuthMethods(c.env, c.get('mailer')),
    },
    ready ? 200 : 503,
  );
});

// ---------------------------------------------------------------------------
// Auth (Better Auth owns everything under /auth)
// ---------------------------------------------------------------------------

api.on(['GET', 'POST'], '/auth/*', (c) => c.get('auth').handler(c.req.raw));

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

/**
 * Ensures a settings row exists for a user (spec §F.1).
 *
 * Created lazily on first authenticated read rather than in the sign-up path,
 * so accounts created through any provider -- or restored from an export --
 * converge on the same defaults.
 */
async function ensureUserSettings(db: Database, userId: string, now: number) {
  const existing = await db
    .select({ userId: schema.userSettings.userId })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(schema.userSettings).values({
    userId,
    // Defaults for every other column live in the schema, so there is one
    // definition of "default" rather than two that can drift.
    createdAt: now,
    updatedAt: now,
  });
}

api.get('/me', async (c) => {
  const session = await c.get('auth').api.getSession({ headers: c.req.raw.headers });

  if (!session?.user) {
    return c.json(
      {
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Sign in to access this resource.',
      },
      401,
      { 'content-type': 'application/problem+json' },
    );
  }

  const db = c.get('db');
  await ensureUserSettings(db, session.user.id, Date.now());

  const [settings] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, session.user.id))
    .limit(1);

  return c.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
    },
    settings: settings
      ? {
          defaultTimezone: settings.defaultTimezone,
          defaultNewItemStatus: settings.defaultNewItemStatus,
          // Parsed for the client, but note these are the ACCOUNT defaults.
          // A reminder's own `channels` is three-state and overrides them
          // (ADR-0007); it is never merged with these here.
          defaultReviewChannels: JSON.parse(settings.defaultReviewChannels) as string[],
          defaultPriceAlertChannels: JSON.parse(settings.defaultPriceAlertChannels) as string[],
          defaultPreReviewChannels: JSON.parse(settings.defaultPreReviewChannels) as string[],
          prefillEntryPriceFromLatestQuote: settings.prefillEntryPriceFromLatestQuote,
          lockScreenPrivacy: settings.lockScreenPrivacy,
          quietHours: {
            enabled: settings.quietHoursEnabled,
            startLocalTime: settings.quietHoursStart,
            endLocalTime: settings.quietHoursEnd,
            applyToEmail: settings.quietHoursApplyToEmail,
          },
          overdueDigestMode: settings.overdueDigestMode,
        }
      : null,
  });
});

// ---------------------------------------------------------------------------
// Instruments (§G.1) and the prefilled draft (§G.2)
// ---------------------------------------------------------------------------

api.route('/', instruments);

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

api.all('*', (c) =>
  c.json(
    { type: 'about:blank', title: 'Not Found', status: 404 },
    404,
    { 'content-type': 'application/problem+json' },
  ),
);
