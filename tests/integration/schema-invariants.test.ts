import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * These tests assert the storage-level guarantees the whole design rests on.
 *
 * They are deliberately written as raw SQL against the real migrated schema
 * rather than through Drizzle: the contract being verified belongs to the
 * database, not to the ORM, and it must hold no matter what writes to it.
 */

const now = 1_780_000_000_000;

/**
 * This pool version has no isolatedStorage option, so D1 state persists
 * across tests in a file. Reset explicitly, child tables first, rather than
 * relying on FK cascade -- a test suite should not depend on PRAGMA state.
 */
const TABLES_CHILD_FIRST = [
  'notification_deliveries',
  'inbox_items',
  'notification_events',
  'review_occurrences',
  'review_reminders',
  'price_targets',
  'journal_entries',
  'thesis_versions',
  'theses',
  'thesis_templates',
  'lots',
  'investment_items',
  'instrument_quote_history',
  'instrument_quotes',
  'instruments',
  'push_subscriptions',
  'notification_email_addresses',
  'user_settings',
  'idempotency_keys',
  'data_export_jobs',
  'account_deletion_requests',
  'verifications',
  'accounts',
  'sessions',
  'users',
] as const;

async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES_CHILD_FIRST.map((t) => env.DB.prepare(`delete from ${t}`)));
}

async function seedUser(id = 'user-1'): Promise<string> {
  await env.DB.prepare(
    `insert into users (id, email, email_verified, status, created_at, updated_at)
     values (?, ?, 0, 'active', ?, ?)`,
  )
    .bind(id, `${id}@example.com`, now, now)
    .run();
  return id;
}

async function seedItemAndReminder(userId: string) {
  await env.DB.prepare(
    `insert into investment_items
       (id, user_id, symbol, display_name, asset_type, currency, status, timezone, created_at, updated_at)
     values ('item-1', ?, 'MSFT', 'Microsoft Corporation', 'stock', 'USD', 'watching', 'Europe/Bucharest', ?, ?)`,
  )
    .bind(userId, now, now)
    .run();
}

beforeEach(async () => {
  await resetDb();
  await seedUser();
  await seedItemAndReminder('user-1');
});

describe('ADR-0007: channels is three-state', () => {
  async function insertReminder(id: string, channels: string | null) {
    await env.DB.prepare(
      `insert into review_reminders
         (id, investment_item_id, user_id, scheduled_for, timezone, local_time_of_day,
          repeat_rule, enabled, channels, pre_alert_offsets, status, created_at, updated_at)
       values (?, 'item-1', 'user-1', ?, 'Europe/Bucharest', '09:00',
               'none', 1, ?, '[]', 'scheduled', ?, ?)`,
    )
      .bind(id, now, channels, now, now)
      .run();
  }

  it('keeps NULL (inherit) distinct from [] (explicitly silent)', async () => {
    await insertReminder('inherit', null);
    await insertReminder('silent', '[]');
    await insertReminder('override', '["push","email"]');

    const rows = await env.DB.prepare(
      `select id, channels from review_reminders order by id`,
    ).all<{ id: string; channels: string | null }>();

    const byId = Object.fromEntries(rows.results.map((r) => [r.id, r.channels]));

    // The distinction the whole feature rests on. If a migration, ORM default
    // or DTO ever normalises NULL to '[]', every inheriting reminder becomes
    // permanently silent and nothing throws.
    expect(byId['inherit']).toBeNull();
    expect(byId['silent']).toBe('[]');
    expect(byId['override']).toBe('["push","email"]');
    expect(byId['inherit']).not.toBe(byId['silent']);
  });

  it('does not impose a NOT NULL or default on channels', async () => {
    const ddl = await env.DB.prepare(
      `select sql from sqlite_master where type='table' and name='review_reminders'`,
    ).first<{ sql: string }>();

    const channelsLine = ddl!.sql
      .split('\n')
      .find((l) => l.includes('`channels`') || l.includes('"channels"'));

    expect(channelsLine).toBeDefined();
    expect(channelsLine!.toLowerCase()).not.toContain('not null');
    expect(channelsLine!.toLowerCase()).not.toContain('default');
  });
});

describe('spec §F.4: one event per occurrence', () => {
  async function insertEvent(id: string, dedupKey: string, channels = '["in_app"]') {
    await env.DB.prepare(
      `insert into notification_events
         (id, user_id, source_type, source_id, occurrence_utc, channels_requested,
          status, deduplication_key, payload, available_after, is_critical, created_at)
       values (?, 'user-1', 'review_reminder', 'rem-1', ?, ?,
               'pending', ?, '{}', ?, 0, ?)`,
    )
      .bind(id, now, channels, dedupKey, now, now)
      .run();
  }

  it('rejects a second event for the same occurrence', async () => {
    const key = 'review-reminder:rem-1:2026-09-05T09:00:00Z';
    await insertEvent('evt-1', key);

    // "An occurrence has exactly one notification event, enforced by unique
    // deduplication key" -- a storage constraint, not a convention.
    await expect(insertEvent('evt-2', key)).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it('makes concurrent dispatch idempotent via INSERT OR IGNORE', async () => {
    const key = 'review-reminder:rem-1:2026-09-05T09:00:00Z';
    const stmt = (id: string) =>
      env.DB.prepare(
        `insert or ignore into notification_events
           (id, user_id, source_type, source_id, occurrence_utc, channels_requested,
            status, deduplication_key, payload, available_after, is_critical, created_at)
         values (?, 'user-1', 'review_reminder', 'rem-1', ?, '["in_app"]',
                 'pending', ?, '{}', ?, 0, ?)`,
      ).bind(id, now, key, now, now);

    await env.DB.batch([stmt('evt-a'), stmt('evt-b'), stmt('evt-c')]);

    const count = await env.DB.prepare(
      `select count(*) as c from notification_events where deduplication_key = ?`,
    )
      .bind(key)
      .first<{ c: number }>();

    // Two dispatcher ticks racing produce one event; the losers are no-ops.
    // This is what removes any need for leader election.
    expect(count!.c).toBe(1);
  });

  it('makes it structurally impossible to store an event with no channels', async () => {
    // §H.1 step 3: an empty effective channel set must produce NO event at
    // all. Enforced in the schema so no code path can violate it.
    await expect(insertEvent('evt-empty', 'k-empty', '[]')).rejects.toThrow(/CHECK|constraint/i);
  });
});

describe('spec §F.4: per-channel deliveries are independent', () => {
  beforeEach(async () => {
    await env.DB.prepare(
      `insert into notification_events
         (id, user_id, source_type, source_id, occurrence_utc, channels_requested,
          status, deduplication_key, payload, available_after, is_critical, created_at)
       values ('evt-1', 'user-1', 'review_reminder', 'rem-1', ?, '["push","email","in_app"]',
               'pending', 'k1', '{}', ?, 0, ?)`,
    )
      .bind(now, now, now)
      .run();
  });

  async function insertDelivery(id: string, channel: string, status = 'pending') {
    await env.DB.prepare(
      `insert into notification_deliveries
         (id, notification_event_id, channel, status, attempt_count, max_attempts, created_at)
       values (?, 'evt-1', ?, ?, 0, 5, ?)`,
    )
      .bind(id, channel, status, now)
      .run();
  }

  it('allows one row per channel and rejects a duplicate channel', async () => {
    await insertDelivery('d-push', 'push');
    await insertDelivery('d-email', 'email');
    await insertDelivery('d-inapp', 'in_app');

    // Criterion 9 ("separate channel delivery records") made structurally
    // true rather than aspirational.
    await expect(insertDelivery('d-push-2', 'push')).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it('records an ineligible channel as skipped with a reason, not by omission', async () => {
    await insertDelivery('d-push', 'push');
    await env.DB.prepare(
      `update notification_deliveries
         set status = 'skipped', skipped_reason = 'no_push_subscription'
       where id = 'd-push'`,
    ).run();

    const row = await env.DB.prepare(
      `select status, skipped_reason from notification_deliveries where id = 'd-push'`,
    ).first<{ status: string; skipped_reason: string }>();

    // Criterion 10 needs this row to exist. A channel filtered out during
    // resolution would leave the diagnostics screen nothing to explain.
    expect(row).toEqual({ status: 'skipped', skipped_reason: 'no_push_subscription' });
  });

  it('rejects an unrecognised skip reason', async () => {
    await insertDelivery('d-email', 'email');
    await expect(
      env.DB.prepare(
        `update notification_deliveries set skipped_reason = 'because' where id = 'd-email'`,
      ).run(),
    ).rejects.toThrow(/CHECK|constraint/i);
  });
});

describe('review occurrences', () => {
  async function insertOccurrence(id: string, kind = 'review', offset = '') {
    await env.DB.prepare(
      `insert or ignore into review_occurrences
         (id, review_reminder_id, user_id, investment_item_id, occurrence_utc,
          occurrence_local_date, occurrence_local_time, kind, pre_alert_offset,
          state, created_at)
       values (?, 'rem-1', 'user-1', 'item-1', ?, '2026-09-05', '09:00', ?, ?, 'pending', ?)`,
    )
      .bind(id, now, kind, offset, now)
      .run();
  }

  beforeEach(async () => {
    await env.DB.prepare(
      `insert into review_reminders
         (id, investment_item_id, user_id, scheduled_for, timezone, local_time_of_day,
          repeat_rule, enabled, channels, pre_alert_offsets, status, created_at, updated_at)
       values ('rem-1', 'item-1', 'user-1', ?, 'Europe/Bucharest', '09:00',
               'none', 1, NULL, '["P1D"]', 'scheduled', ?, ?)`,
    )
      .bind(now, now, now)
      .run();
  });

  it('deduplicates identical occurrences but keeps pre-alerts separate', async () => {
    await insertOccurrence('occ-1');
    await insertOccurrence('occ-1-dup'); // same identity: ignored
    await insertOccurrence('occ-pre', 'pre_alert', 'P1D'); // distinct

    const { results } = await env.DB.prepare(
      `select id from review_occurrences order by id`,
    ).all<{ id: string }>();

    expect(results.map((r) => r.id)).toEqual(['occ-1', 'occ-pre']);
  });

  it('represents a silent plan as a real, queryable row', async () => {
    await insertOccurrence('occ-silent');
    await env.DB.prepare(
      `update review_occurrences set state = 'skipped_silent' where id = 'occ-silent'`,
    ).run();

    // Criteria 5 and 11: no NotificationEvent exists, yet the occurrence is
    // still on the calendar and still computes as overdue.
    const overdue = await env.DB.prepare(
      `select count(*) as c from review_occurrences
        where state in ('pending','dispatched','skipped_silent')
          and occurrence_utc < ?`,
    )
      .bind(now + 1)
      .first<{ c: number }>();

    expect(overdue!.c).toBe(1);

    const events = await env.DB.prepare(
      `select count(*) as c from notification_events`,
    ).first<{ c: number }>();
    expect(events!.c).toBe(0);
  });
});

describe('instruments', () => {
  async function insertInstrument(id: string, symbol: string, name: string, mic: string) {
    await env.DB.prepare(
      `insert into instruments
         (id, provider, provider_instrument_id, symbol, display_name, asset_type,
          exchange, mic, currency, is_monitorable, metadata_updated_at)
       values (?, 'finnhub', ?, ?, ?, 'stock', ?, ?, 'USD', 1, ?)`,
    )
      .bind(id, `${id}-pid`, symbol, name, mic, mic, now)
      .run();
  }

  it('keeps duplicate symbols on different venues as separate listings', async () => {
    await insertInstrument('i-us', 'MSFT', 'Microsoft Corporation', 'XNAS');
    await insertInstrument('i-de', 'MSFT', 'Microsoft Corp (Frankfurt)', 'XFRA');

    const { results } = await env.DB.prepare(
      `select mic from instruments where symbol = 'MSFT' order by mic`,
    ).all<{ mic: string }>();

    // §B.1: "Never automatically assume a ticker is unique across all
    // exchanges." Two listings, and the UI must make the user choose.
    expect(results.map((r) => r.mic)).toEqual(['XFRA', 'XNAS']);
  });

  it('needs no full-text index, because search no longer runs here', async () => {
    await insertInstrument('i-us', 'MSFT', 'Microsoft Corporation', 'XNAS');

    // Migration 0002 dropped instruments_fts and its triggers. Each index on
    // this table multiplies the billable write cost of saving an instrument,
    // and the FTS shadow writes were 2 of the 6 that made the original seed
    // cost 178% of the daily budget.
    const fts = await env.DB.prepare(
      `select count(*) as c from sqlite_master where name = 'instruments_fts'`,
    ).first<{ c: number }>();
    expect(fts!.c).toBe(0);

    const indexes = await env.DB.prepare(
      `select count(*) as c from sqlite_master
       where type = 'index' and tbl_name = 'instruments' and name like 'ix_%'`,
    ).first<{ c: number }>();
    expect(indexes!.c).toBe(0);
  });
});

describe('spec §B.3: manual assets', () => {
  it('accepts an item with no instrument, provided it carries its own metadata', async () => {
    await env.DB.prepare(
      `insert into investment_items
         (id, user_id, instrument_id, symbol, display_name, asset_type, currency,
          status, timezone, created_at, updated_at)
       values ('manual-1', 'user-1', NULL, 'PRIVATE', 'Unlisted Holding', 'other', 'EUR',
               'watching', 'Europe/Bucharest', ?, ?)`,
    )
      .bind(now, now)
      .run();

    const row = await env.DB.prepare(
      `select instrument_id, currency from investment_items where id = 'manual-1'`,
    ).first<{ instrument_id: string | null; currency: string }>();

    // NULL instrument_id *is* the manual asset. No separate flag or table.
    expect(row!.instrument_id).toBeNull();
    expect(row!.currency).toBe('EUR');
  });

  it('rejects an item that has neither an instrument nor its own metadata', async () => {
    await expect(
      env.DB.prepare(
        `insert into investment_items
           (id, user_id, instrument_id, symbol, display_name, asset_type, currency,
            status, timezone, created_at, updated_at)
         values ('bad-1', 'user-1', NULL, '', '', 'other', 'EUR',
                 'watching', 'Europe/Bucharest', ?, ?)`,
      )
        .bind(now, now)
        .run(),
    ).rejects.toThrow(/CHECK|constraint/i);
  });
});
