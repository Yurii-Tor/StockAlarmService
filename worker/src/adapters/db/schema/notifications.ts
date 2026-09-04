import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { instant, id, oneOf } from './_shared';
import { users } from './auth';

/**
 * Spec §F.4 — notification events and deliveries.
 *
 * These two tables ARE the transactional outbox. There is deliberately no
 * separate `outbox_messages` table: events are written in the same D1 batch
 * as the occurrence state change, and deliveries are the per-channel work
 * items. A generic outbox alongside would mean two sources of truth for the
 * same pending work and two dedup schemes to reconcile.
 */

export const notificationEvents = sqliteTable(
  'notification_events',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    occurrenceUtc: instant('occurrence_utc').notNull(),

    /** JSON array. Never empty — see the CHECK below. */
    channelsRequested: text('channels_requested').notNull(),

    status: text('status').notNull().default('pending'),

    /**
     * §F.4: "An occurrence has exactly one notification event, enforced by
     * unique deduplication key."
     *
     * That sentence is a STORAGE CONSTRAINT, not an application convention,
     * and the unique index below implements it literally. Formats:
     *   review-reminder:{reminderId}:{occurrenceUtc}
     *   pre-review:{reminderId}:{occurrenceUtc}:{offset}
     *   price-target:{targetId}:{windowStartUtc}
     */
    deduplicationKey: text('deduplication_key').notNull(),

    /** Rendering-independent facts; the message is built from this at send time. */
    payload: text('payload').notNull(),

    /**
     * Quiet-hours release time (§E.4). The event row and the inbox row are
     * written IMMEDIATELY at the original time; only external delivery moves.
     * Nothing is ever deleted to satisfy quiet hours (FR-098, FR-099).
     */
    availableAfter: instant('available_after').notNull(),
    quietHoursDeferredFrom: instant('quiet_hours_deferred_from'),

    /** §E.4 advanced setting. NOT the iOS Critical Alerts entitlement, which
     *  the addendum forbids in MVP (FR-097). */
    isCritical: integer('is_critical', { mode: 'boolean' }).notNull().default(false),

    completedAt: instant('completed_at'),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ux_notification_events_dedup').on(t.deduplicationKey),
    index('ix_events_dispatch').on(t.status, t.availableAfter),
    index('ix_events_user_created').on(t.userId, t.createdAt),
    check(
      'ck_event_source_type',
      oneOf('source_type', [
        'review_reminder',
        'pre_review_alert',
        'price_target',
        'digest',
        'system',
      ]),
    ),
    check(
      'ck_event_status',
      oneOf('status', [
        'pending',
        'processing',
        'partially_delivered',
        'delivered',
        'failed',
        'cancelled',
      ]),
    ),
    /**
     * Enforces §H.1 step 3 at the storage layer: it is structurally
     * impossible to persist an event with no channels. A silent plan produces
     * no row here at all (FR-075).
     */
    check(
      'ck_event_has_channels',
      sql.raw('json_valid(channels_requested) and json_array_length(channels_requested) > 0'),
    ),
  ],
);

/**
 * One row per channel per event.
 *
 * The unique index is what makes acceptance criterion 9 ("separate channel
 * delivery records") structurally true rather than aspirational, and what
 * makes per-channel retry idempotent.
 *
 * `skipped_reason` is load-bearing for criterion 10. Channel eligibility is
 * evaluated HERE, per delivery, not during resolution: an unverified email or
 * a missing push subscription produces a `skipped` row with a reason, never a
 * silently removed channel. A channel dropped before the event was written
 * leaves no evidence anywhere, which would make the diagnostics screen unable
 * to explain what happened (FR-0A5).
 */
export const notificationDeliveries = sqliteTable(
  'notification_deliveries',
  {
    id: id(),
    notificationEventId: text('notification_event_id')
      .notNull()
      .references(() => notificationEvents.id, { onDelete: 'cascade' }),

    channel: text('channel').notNull(),
    status: text('status').notNull().default('pending'),

    /** Incremented BEFORE the provider call, which is what bounds duplicate
     *  sends under at-least-once delivery (FR-0A6). */
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: instant('next_attempt_at'),

    attemptedAt: instant('attempted_at'),
    completedAt: instant('completed_at'),

    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    /** §H.1 step 8, and the data source for the diagnostics screen. */
    providerResponse: text('provider_response'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    skippedReason: text('skipped_reason'),

    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ux_delivery_event_channel').on(t.notificationEventId, t.channel),
    index('ix_delivery_retry').on(t.channel, t.status, t.nextAttemptAt),
    check('ck_delivery_channel', oneOf('channel', ['push', 'email', 'in_app'])),
    check(
      'ck_delivery_status',
      oneOf('status', ['pending', 'queued', 'sending', 'sent', 'failed', 'skipped', 'expired']),
    ),
    check(
      'ck_delivery_skipped_reason',
      oneOf('skipped_reason', [
        'email_unverified',
        'email_unsubscribed',
        'no_push_subscription',
        'push_permission_denied',
        'channel_disabled',
      ]),
    ),
  ],
);

/**
 * The durable fallback (§E.1, FR-087). Written in the same batch as the
 * event, not as a dispatch step, and never deferred by quiet hours — it is a
 * record, not an interruption.
 */
export const inboxItems = sqliteTable(
  'inbox_items',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    notificationEventId: text('notification_event_id')
      .notNull()
      .references(() => notificationEvents.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    body: text('body').notNull(),
    deepLink: text('deep_link'),
    category: text('category'),

    readAt: instant('read_at'),
    archivedAt: instant('archived_at'),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ux_inbox_event').on(t.notificationEventId),
    index('ix_inbox_user_created').on(t.userId, t.createdAt),
    index('ix_inbox_unread').on(t.userId, t.readAt),
  ],
);

// ---------------------------------------------------------------------------
// Supporting tables
// ---------------------------------------------------------------------------

/** A flaky mobile network must not create two positions (FR-045). */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [uniqueIndex('ux_idempotency_user_key').on(t.userId, t.key)],
);

/** FR-0B2. Note: D1 export does not support FTS5 virtual tables, so the
 *  export path reads base tables directly (ADR-0001). */
export const dataExportJobs = sqliteTable('data_export_jobs', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  format: text('format').notNull().default('json'),
  status: text('status').notNull().default('pending'),
  requestedAt: instant('requested_at').notNull(),
  completedAt: instant('completed_at'),
  objectKey: text('object_key'),
  downloadTokenHash: text('download_token_hash'),
  expiresAt: instant('expires_at'),
});

/** FR-0B3 — deletion with a grace period before irreversible purge. */
export const accountDeletionRequests = sqliteTable('account_deletion_requests', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  requestedAt: instant('requested_at').notNull(),
  scheduledPurgeAt: instant('scheduled_purge_at').notNull(),
  confirmedAt: instant('confirmed_at'),
  cancelledAt: instant('cancelled_at'),
  purgedAt: instant('purged_at'),
});
