import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { instant, decimal, id, oneOf } from './_shared';

/**
 * Spec §F.2 — cached provider instrument mapping, plus quotes.
 */

/**
 * A specific LISTING on a specific venue, not an abstract company.
 * `MSFT` on NASDAQ and `MSFT` elsewhere are two rows, which is what makes
 * §B.1's "never automatically assume a ticker is unique" enforceable.
 *
 * This table is also the PRIMARY search surface, not a cache of one. Finnhub's
 * /search returns no exchange, MIC or currency and so cannot satisfy
 * acceptance criterion 1; /stock/symbol?exchange=US does return them, so a
 * nightly sync populates this table and search runs locally against the FTS5
 * index (see migration, and docs/02-assumptions.md §E).
 */
export const instruments = sqliteTable(
  'instruments',
  {
    id: id(),
    provider: text('provider').notNull(),
    providerInstrumentId: text('provider_instrument_id').notNull(),

    symbol: text('symbol').notNull(),
    displayName: text('display_name').notNull(),
    assetType: text('asset_type').notNull(),
    exchange: text('exchange'),
    mic: text('mic'),
    currency: text('currency'),
    country: text('country'),
    isin: text('isin'),
    figi: text('figi'),

    /**
     * §B.3: target monitoring must be PREVENTED when an asset cannot be
     * mapped to a monitorable instrument. Reminders and journal stay
     * available regardless (FR-033, FR-066).
     */
    isMonitorable: integer('is_monitorable', { mode: 'boolean' }).notNull().default(true),

    metadataUpdatedAt: instant('metadata_updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('ux_instruments_provider_id').on(t.provider, t.providerInstrumentId),
    // The disambiguation lookup for §B.1.
    index('ix_instruments_symbol_mic').on(t.symbol, t.mic),
    index('ix_instruments_isin').on(t.isin),
  ],
);

/**
 * The current cached quote — exactly one row per instrument.
 *
 * The two timestamps are the point (FR-024). `quote_as_of` is the PROVIDER's
 * own as-of time and is what the UI displays; `retrieved_at` is when we
 * fetched, and is what TTL is computed from. Collapsing them into one column
 * is precisely how stale data ends up labelled "current", which §B.2 forbids
 * outright.
 */
export const instrumentQuotes = sqliteTable(
  'instrument_quotes',
  {
    instrumentId: text('instrument_id')
      .primaryKey()
      .references(() => instruments.id, { onDelete: 'cascade' }),

    lastPrice: decimal('last_price'),
    currency: text('currency'),

    quoteAsOf: instant('quote_as_of').notNull(),
    retrievedAt: instant('retrieved_at').notNull(),

    delayMinutes: integer('delay_minutes').notNull().default(0),
    freshness: text('freshness').notNull(),
    source: text('source').notNull(),

    previousClose: decimal('previous_close'),
    dayOpen: decimal('day_open'),
    dayHigh: decimal('day_high'),
    dayLow: decimal('day_low'),
  },
  (t) => [
    index('ix_quotes_retrieved_at').on(t.retrievedAt),
    // FR-025: exactly four states. "current" is reserved for `realtime`.
    check(
      'ck_quote_freshness',
      oneOf('freshness', ['realtime', 'delayed', 'stale', 'unavailable']),
    ),
  ],
);

/**
 * Recent price observations, kept only so `crosses_above` / `crosses_below`
 * can be distinguished from `is above` / `is below` (FR-064). A bare current
 * price comparison can only express the latter.
 *
 * Retention is 90 days (OQ-9). Rows land here only for instruments with an
 * active price target, to stay inside the D1 write budget (NFR-06).
 */
export const instrumentQuoteHistory = sqliteTable(
  'instrument_quote_history',
  {
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    observedAt: instant('observed_at').notNull(),
    price: decimal('price').notNull(),
  },
  (t) => [
    uniqueIndex('ux_quote_history').on(t.instrumentId, t.observedAt),
    index('ix_quote_history_observed').on(t.observedAt),
  ],
);
