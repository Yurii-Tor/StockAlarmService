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
   * Insert or update only what actually changed.
   *
   * A full US universe is ~31,000 rows, and rewriting all of them nightly
   * would consume roughly a third of the 100k/day D1 write budget to change
   * almost nothing (NFR-06). Implementations must diff, not truncate.
   */
  upsertChanged(
    provider: string,
    instruments: readonly ProviderInstrument[],
    now: number,
  ): Promise<SyncOutcome>;
}

export interface SyncOutcome {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
}
