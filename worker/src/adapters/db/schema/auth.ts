import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { instant, authInstant, localTime, id, timestamps, authTimestamps, oneOf } from './_shared';

/**
 * Identity, sessions and per-user settings.
 *
 * The addendum never mentions authentication anywhere (ADR-0006), so the
 * four Better Auth core tables below are reconstructed, matching the shape
 * Better Auth expects from its Drizzle adapter. Everything after them is
 * spec §F.1.
 */

// ---------------------------------------------------------------------------
// Better Auth core
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    // Postgres citext has no D1 equivalent (ADR-0001), and Drizzle cannot
    // attach COLLATE NOCASE here, so addresses are normalised to lowercase
    // at the application boundary before any read or write. The unique index
    // below therefore only holds if that normalisation is never bypassed.
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    status: text('status').notNull().default('active'),
    deletedAt: instant('deleted_at'),
    ...authTimestamps,
  },
  (t) => [
    uniqueIndex('ux_users_email').on(t.email),
    check('ck_users_status', oneOf('status', ['active', 'pending_deletion', 'deleted'])),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: authInstant('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...authTimestamps,
  },
  (t) => [uniqueIndex('ux_sessions_token').on(t.token), index('ix_sessions_user').on(t.userId)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: authInstant('access_token_expires_at'),
    refreshTokenExpiresAt: authInstant('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    ...authTimestamps,
  },
  (t) => [
    uniqueIndex('ux_accounts_provider_account').on(t.providerId, t.accountId),
    index('ix_accounts_user').on(t.userId),
  ],
);

export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: authInstant('expires_at').notNull(),
    ...authTimestamps,
  },
  (t) => [index('ix_verifications_identifier').on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Spec §F.1 — user settings
// ---------------------------------------------------------------------------

export const userSettings = sqliteTable(
  'user_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    defaultTimezone: text('default_timezone').notNull().default('Europe/Bucharest'),
    defaultNewItemStatus: text('default_new_item_status').notNull().default('watching'),

    defaultReviewPlanMode: text('default_review_plan_mode').notNull().default('none'),
    defaultReviewPlanPreset: text('default_review_plan_preset'),

    // §E.2 requires three SEPARATE defaults, not one global list. These are
    // NOT NULL: an account always has a default, and it is the per-reminder
    // column that carries the three-state semantics (ADR-0007).
    defaultReviewChannels: text('default_review_channels').notNull().default('["in_app"]'),
    defaultPriceAlertChannels: text('default_price_alert_channels')
      .notNull()
      .default('["push","in_app"]'),
    defaultPreReviewChannels: text('default_pre_review_channels').notNull().default('["in_app"]'),

    prefillEntryPriceFromLatestQuote: integer('prefill_entry_price_from_latest_quote', {
      mode: 'boolean',
    })
      .notNull()
      .default(true),

    defaultBrokerName: text('default_broker_name'),
    // The mechanical implementation of §C.2's "last-used broker for this user".
    lastUsedBrokerName: text('last_used_broker_name'),

    lockScreenPrivacy: text('lock_screen_privacy').notNull().default('minimal'),

    quietHoursEnabled: integer('quiet_hours_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    quietHoursStart: localTime('quiet_hours_start'),
    quietHoursEnd: localTime('quiet_hours_end'),
    quietHoursApplyToEmail: integer('quiet_hours_apply_to_email', { mode: 'boolean' })
      .notNull()
      .default(false),

    overdueDigestMode: text('overdue_digest_mode').notNull().default('off'),
    inAppEnabled: integer('in_app_enabled', { mode: 'boolean' }).notNull().default(true),

    ...timestamps,
  },
  () => [
    check('ck_settings_new_item_status', oneOf('default_new_item_status', ['watching', 'open'])),
    check(
      'ck_settings_review_mode',
      oneOf('default_review_plan_mode', ['none', 'date', 'recurring']),
    ),
    check(
      'ck_settings_privacy',
      oneOf('lock_screen_privacy', ['minimal', 'standard', 'detailed']),
    ),
    check('ck_settings_digest', oneOf('overdue_digest_mode', ['off', 'daily', 'weekly'])),
  ],
);

// ---------------------------------------------------------------------------
// §E.3 — notification email address
// ---------------------------------------------------------------------------

/**
 * Separate from `users.email` on purpose: §E.3 allows a distinct verified
 * notification address. Email counts as an ACTIVE channel only when
 * `verified_at is not null and unsubscribed_at is null` — that single
 * predicate is acceptance criterion 8 (FR-086).
 *
 * Tokens are stored hashed, single-use and expiring (NFR-08).
 */
export const notificationEmailAddresses = sqliteTable(
  'notification_email_addresses',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    verifiedAt: instant('verified_at'),
    verificationTokenHash: text('verification_token_hash'),
    verificationExpiresAt: instant('verification_expires_at'),
    verificationAttempts: integer('verification_attempts').notNull().default(0),
    unsubscribedAt: instant('unsubscribed_at'),
    unsubscribeTokenHash: text('unsubscribe_token_hash'),
    ...timestamps,
  },
  (t) => [uniqueIndex('ux_notification_email_user').on(t.userId)],
);

// ---------------------------------------------------------------------------
// §E.2 "Registered devices" / §G.3 POST /devices/register
// ---------------------------------------------------------------------------

/**
 * Note the addressing model: we target OneSignal by `include_aliases.
 * external_id` (which is our own `users.id`), NOT by subscription id.
 * So this table exists for the device list, the diagnostics screen and
 * acceptance criterion 10 — not for routing (ADR-0005).
 */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('onesignal'),
    providerSubscriptionId: text('provider_subscription_id').notNull(),
    externalId: text('external_id').notNull(),
    platform: text('platform'),
    userAgent: text('user_agent'),
    label: text('label'),
    permissionState: text('permission_state').notNull().default('default'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastSeenAt: instant('last_seen_at'),
    revokedAt: instant('revoked_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ux_push_subscription_provider').on(t.provider, t.providerSubscriptionId),
    index('ix_push_subscriptions_user').on(t.userId),
    check(
      'ck_push_permission_state',
      oneOf('permission_state', ['granted', 'denied', 'default']),
    ),
    // `platform` is nullable; a CHECK only fails on FALSE, and `null in (...)`
    // is NULL, so unknown platforms are permitted while wrong ones are not.
    check('ck_push_platform', oneOf('platform', ['ios_web', 'android_web', 'desktop_web'])),
  ],
);
