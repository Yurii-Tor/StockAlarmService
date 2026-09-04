import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import {
  instant,
  localTime,
  channelSelection,
  id,
  timestamps,
  oneOf,
  validJsonOrNull,
} from './_shared';
import { users } from './auth';
import { investmentItems } from './portfolio';

/**
 * Spec §F.3 — the review PLAN. Never the delivery.
 *
 * §D.1's central claim is that a plan and a notification are different
 * things, and this table holds only the plan.
 */
export const reviewReminders = sqliteTable(
  'review_reminders',
  {
    id: id(),
    investmentItemId: text('investment_item_id')
      .notNull()
      .references(() => investmentItems.id, { onDelete: 'cascade' }),
    /** Denormalised so the dispatch scan never joins. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Anchor / first occurrence. */
    scheduledFor: instant('scheduled_for').notNull(),
    timezone: text('timezone').notNull(),

    /**
     * FR-078, and this column is NOT optional.
     *
     * Storing only `scheduled_for` and adding a month makes a 09:00
     * Europe/Bucharest reminder set in September fire at 08:00 in December.
     * Wall-clock time plus IANA zone is the only representation that survives
     * a DST transition, so recurrence advances the LOCAL date and re-resolves
     * against the zone (ADR-0003).
     */
    localTimeOfDay: localTime('local_time_of_day').notNull(),

    /** RRULE-compatible subset, e.g. 'FREQ=MONTHLY;INTERVAL=3' (ASM-024). */
    repeatRule: text('repeat_rule').notNull().default('none'),
    repeatUntil: instant('repeat_until'),
    repeatCount: integer('repeat_count'),

    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

    /**
     * THE THREE-STATE COLUMN. See ADR-0007 before changing anything here.
     *
     *   NULL   -> inherit user_settings.default_review_channels, resolved at
     *             dispatch time, so changing the account default retroactively
     *             changes this reminder (which is what "default" means)
     *   '[]'   -> EXPLICITLY SILENT. Never creates a NotificationEvent.
     *             The occurrence becomes `skipped_silent` and stays visible
     *             on the dashboard and calendar (FR-072, criteria 5 and 11)
     *   '[..]' -> explicit override of the account default (criterion 7)
     *
     * Deliberately nullable with NO default. A `.default('[]')` here, or a
     * DTO typed as non-nullable string[], silently converts every inheriting
     * reminder into a permanently silent one. Nothing throws; reminders just
     * stop arriving.
     */
    channels: channelSelection('channels'),

    /** §F.3 `preAlertOffsets`, JSON array of ISO-8601 durations, e.g. ["P1D"]. */
    preAlertOffsets: text('pre_alert_offsets').notNull().default('[]'),

    status: text('status').notNull().default('scheduled'),

    /** Materialised; the scanner's only hot column. */
    nextOccurrenceUtc: instant('next_occurrence_utc'),
    lastOccurrenceUtc: instant('last_occurrence_utc'),

    deletedAt: instant('deleted_at'),
    ...timestamps,
  },
  (t) => [
    // The scanner touches only live plans.
    index('ix_reminders_due').on(t.nextOccurrenceUtc),
    index('ix_reminders_item').on(t.investmentItemId),
    index('ix_reminders_user').on(t.userId),
    check('ck_reminder_status', oneOf('status', ['scheduled', 'active', 'completed', 'cancelled'])),
    check('ck_reminder_channels_json', validJsonOrNull('channels')),
    check('ck_reminder_pre_alerts_json', sql.raw('json_valid(pre_alert_offsets)')),
  ],
);

/**
 * A materialised instance of a plan — and the table that makes silent plans
 * real.
 *
 * Acceptance criteria 5 ("appears in the calendar/dashboard") and 11
 * ("remains due/overdue in the product UI") both describe situations where
 * NO NotificationEvent exists. Without this table they have nothing to point
 * at. `state = 'skipped_silent'` is literally criterion 11 in one column
 * value (FR-079).
 *
 * Note what is absent: there is no `overdue` column. Overdue is DERIVED in
 * queries as `state in ('pending','dispatched','skipped_silent') and
 * occurrence_utc < now - grace`. Storing it would require a sweeper job whose
 * only purpose is flipping a flag, and would introduce the failure mode where
 * the sweeper was down so nothing shows overdue (ASM-023).
 */
export const reviewOccurrences = sqliteTable(
  'review_occurrences',
  {
    id: id(),
    reviewReminderId: text('review_reminder_id')
      .notNull()
      .references(() => reviewReminders.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    investmentItemId: text('investment_item_id')
      .notNull()
      .references(() => investmentItems.id, { onDelete: 'cascade' }),

    occurrenceUtc: instant('occurrence_utc').notNull(),
    occurrenceLocalDate: text('occurrence_local_date').notNull(),
    occurrenceLocalTime: localTime('occurrence_local_time').notNull(),

    kind: text('kind').notNull().default('review'),
    /** ISO-8601 duration for pre-alerts; empty string for the review itself,
     *  so the unique index below treats it as a real discriminator. */
    preAlertOffset: text('pre_alert_offset').notNull().default(''),

    state: text('state').notNull().default('pending'),

    dispatchedAt: instant('dispatched_at'),
    completedAt: instant('completed_at'),
    notificationEventId: text('notification_event_id'),
    journalEntryId: text('journal_entry_id'),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    /**
     * Makes concurrent generation harmless. Two dispatcher ticks racing on
     * the same reminder produce one row; the loser's INSERT OR IGNORE is a
     * no-op. This is the correctness backstop that removes any need for
     * leader election (NFR-02, ADR-0001).
     */
    uniqueIndex('ux_occurrence_identity').on(
      t.reviewReminderId,
      t.occurrenceUtc,
      t.kind,
      t.preAlertOffset,
    ),
    // Calendar and dashboard.
    index('ix_occurrences_user_time').on(t.userId, t.occurrenceUtc),
    index('ix_occurrences_state').on(t.state, t.occurrenceUtc),
    check('ck_occurrence_kind', oneOf('kind', ['review', 'pre_alert'])),
    check(
      'ck_occurrence_state',
      oneOf('state', ['pending', 'dispatched', 'skipped_silent', 'completed', 'dismissed']),
    ),
  ],
);
