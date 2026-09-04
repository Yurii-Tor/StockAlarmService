import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { instant, decimal, channelSelection, id, timestamps, oneOf, validJsonOrNull } from './_shared';
import { users } from './auth';
import { instruments } from './instruments';

/**
 * Portfolio, thesis and journal. Entirely reconstructed (§5 of the spec):
 * §J.3 says "implement portfolio journal, thesis versioning, notes, and core
 * item screens" but the addendum never defines any of it.
 */

export const investmentItems = sqliteTable(
  'investment_items',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * NULL *is* the manual/custom asset of §B.3 — no separate flag, no
     * separate table. The CHECK below guarantees a manual item still carries
     * the fields a resolved instrument would have supplied (FR-030).
     */
    instrumentId: text('instrument_id').references(() => instruments.id, {
      onDelete: 'set null',
    }),

    symbol: text('symbol').notNull(),
    displayName: text('display_name').notNull(),
    assetType: text('asset_type').notNull(),
    exchange: text('exchange'),
    currency: text('currency').notNull(),

    status: text('status').notNull().default('watching'),
    timezone: text('timezone').notNull(),

    closedAt: instant('closed_at'),
    deletedAt: instant('deleted_at'),
    ...timestamps,
  },
  (t) => [
    index('ix_items_user_status').on(t.userId, t.status),
    // The price-target evaluator fans out from here.
    index('ix_items_instrument').on(t.instrumentId),
    check('ck_item_status', oneOf('status', ['watching', 'open', 'closed', 'archived'])),
    check(
      'ck_item_manual_has_metadata',
      sql.raw(
        "instrument_id is not null or (symbol <> '' and display_name <> '' and currency is not null)",
      ),
    ),
    // Deliberately NOT unique on (user_id, instrument_id): OQ-4 allows the
    // same instrument in two items for two different strategies.
  ],
);

export const lots = sqliteTable(
  'lots',
  {
    id: id(),
    investmentItemId: text('investment_item_id')
      .notNull()
      .references(() => investmentItems.id, { onDelete: 'cascade' }),

    boughtAt: instant('bought_at').notNull(),
    quantity: decimal('quantity').notNull(),
    entryPrice: decimal('entry_price').notNull(),
    currency: text('currency').notNull(),
    fees: decimal('fees').notNull().default('0'),
    brokerName: text('broker_name'),
    status: text('status').notNull().default('open'),

    /**
     * FR-043: preserves §C.1's distinction between a prefilled market quote
     * and a corrected broker execution. Without this, a later reader cannot
     * tell whether `entry_price` was what the user actually paid.
     */
    entryPriceSource: text('entry_price_source').notNull(),
    entryPriceQuoteAsOf: instant('entry_price_quote_as_of'),

    soldAt: instant('sold_at'),
    exitPrice: decimal('exit_price'),
    exitFees: decimal('exit_fees'),
    ...timestamps,
  },
  (t) => [
    index('ix_lots_item').on(t.investmentItemId),
    check('ck_lot_status', oneOf('status', ['open', 'closed'])),
    check('ck_lot_price_source', oneOf('entry_price_source', ['manual', 'latest_quote'])),
    // Exact decimals are stored as text, so these compare numerically via CAST.
    check('ck_lot_quantity_positive', sql.raw('cast(quantity as real) > 0')),
    check('ck_lot_entry_price_non_negative', sql.raw('cast(entry_price as real) >= 0')),
    check('ck_lot_fees_non_negative', sql.raw('cast(fees as real) >= 0')),
  ],
);

// ---------------------------------------------------------------------------
// Thesis — append-only (FR-054)
// ---------------------------------------------------------------------------

export const theses = sqliteTable(
  'theses',
  {
    id: id(),
    investmentItemId: text('investment_item_id')
      .notNull()
      .references(() => investmentItems.id, { onDelete: 'cascade' }),
    currentVersionId: text('current_version_id'),
    ...timestamps,
  },
  (t) => [uniqueIndex('ux_thesis_item').on(t.investmentItemId)],
);

/**
 * Never UPDATEd. A save inserts `version_no + 1` and repoints
 * `theses.current_version_id`. This is what makes §E.3's "read your original
 * thesis" meaningful months later (FR-055).
 */
export const thesisVersions = sqliteTable(
  'thesis_versions',
  {
    id: id(),
    thesisId: text('thesis_id')
      .notNull()
      .references(() => theses.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    body: text('body').notNull(),
    templateId: text('template_id'),
    changeSummary: text('change_summary'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ux_thesis_version_no').on(t.thesisId, t.versionNo),
    index('ix_thesis_versions').on(t.thesisId, t.versionNo),
  ],
);

/** §C.3. `user_id` NULL means a system-seeded template. */
export const thesisTemplates = sqliteTable(
  'thesis_templates',
  {
    id: id(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    body: text('body').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('ux_template_user_name').on(t.userId, t.name)],
);

export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: id(),
    investmentItemId: text('investment_item_id')
      .notNull()
      .references(() => investmentItems.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('note'),
    body: text('body').notNull(),
    occurredAt: instant('occurred_at').notNull(),
    /** Closes the loop: completing a review can attach the note it produced. */
    reviewOccurrenceId: text('review_occurrence_id'),
    deletedAt: instant('deleted_at'),
    ...timestamps,
  },
  (t) => [
    index('ix_journal_item_time').on(t.investmentItemId, t.occurredAt),
    check('ck_journal_kind', oneOf('kind', ['note', 'review', 'decision', 'event'])),
  ],
);

// ---------------------------------------------------------------------------
// Price targets (§D.3)
// ---------------------------------------------------------------------------

export const priceTargets = sqliteTable(
  'price_targets',
  {
    id: id(),
    investmentItemId: text('investment_item_id')
      .notNull()
      .references(() => investmentItems.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    kind: text('kind').notNull().default('custom'),
    direction: text('direction').notNull(),
    thresholdPrice: decimal('threshold_price').notNull(),
    currency: text('currency').notNull(),

    /**
     * Three-state, exactly as on review_reminders — see ADR-0007.
     * NULL inherits `user_settings.default_price_alert_channels`;
     * '[]' is an explicitly passive target (FR-063).
     */
    channels: channelSelection('channels'),
    isPassive: integer('is_passive', { mode: 'boolean' }).notNull().default(false),

    status: text('status').notNull().default('active'),

    /** FR-065: hysteresis, so a price oscillating around the threshold
     *  cannot emit one alert per poll. */
    armed: integer('armed', { mode: 'boolean' }).notNull().default(true),
    cooldownUntil: instant('cooldown_until'),

    triggeredAt: instant('triggered_at'),
    triggeredPrice: decimal('triggered_price'),
    ...timestamps,
  },
  (t) => [
    index('ix_targets_item').on(t.investmentItemId),
    check('ck_target_kind', oneOf('kind', ['base_target', 'take_profit', 'stop_loss', 'custom'])),
    check(
      'ck_target_direction',
      oneOf('direction', ['above', 'below', 'crosses_above', 'crosses_below']),
    ),
    check(
      'ck_target_status',
      oneOf('status', ['active', 'triggered', 'paused', 'disabled', 'not_monitorable']),
    ),
    check('ck_target_channels_json', validJsonOrNull('channels')),
  ],
);
