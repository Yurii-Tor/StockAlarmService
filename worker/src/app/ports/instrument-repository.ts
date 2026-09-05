import type { ProviderInstrument } from './market-data';

/**
 * Persistence port for instruments.
 *
 * app/ may not import Drizzle or any binding (FR-0A8), so use cases depend on
 * this interface and the Drizzle implementation lives in adapters/. That is
 * also what lets the search and sync use cases be tested without a database.
 */

export interface StoredInstrument {
  id: string;
  provider: string;
  providerInstrumentId: string;
  symbol: string;
  displayName: string;
  assetType: string;
  exchange: string | null;
  mic: string | null;
  currency: string | null;
  country: string | null;
  isin: string | null;
  figi: string | null;
  isMonitorable: boolean;
  metadataUpdatedAt: number;
}

export interface InstrumentSearchHit extends StoredInstrument {
  /**
   * Set when more than one hit shares this symbol. §B.1 requires the user to
   * choose in that case, so the flag travels with the result rather than
   * being recomputed in the UI.
   */
  isAmbiguousSymbol: boolean;
}

export interface InstrumentRepository {
  search(query: string, limit: number, assetType?: string): Promise<InstrumentSearchHit[]>;
  findById(id: string): Promise<StoredInstrument | null>;
  findByProviderId(provider: string, providerInstrumentId: string): Promise<StoredInstrument | null>;

  /**
   * Insert or update only what actually changed, never exceeding
   * `maxStatements` writes in one call.
   *
   * The cap is not a tuning knob -- it is the guard that stops a first seed
   * from taking the whole account offline. See SyncOutcome below.
   */
  upsertChanged(
    provider: string,
    instruments: readonly ProviderInstrument[],
    now: number,
    maxStatements: number,
  ): Promise<SyncOutcome>;
}

export interface SyncOutcome {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /**
   * Changes identified but deliberately NOT written, because writing them
   * would have exceeded the run's budget. They are picked up next run: the
   * diff is stable, so a deferred row still differs tomorrow.
   */
  deferred: number;
  /** True when `deferred > 0`; the universe is not yet fully synced. */
  budgetExhausted: boolean;
  /** Billable D1 rows this run is estimated to have cost. */
  estimatedRowsWritten: number;
}
