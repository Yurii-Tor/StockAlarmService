import type { Clock } from '../../domain/time/clock';
import type {
  DirectoryEntry,
  DirectoryRefreshOutcome,
  InstrumentDirectory,
} from '../ports/instrument-directory';
import { MarketDataUnavailable, type MarketDataProvider } from '../ports/market-data';

/**
 * Refreshes the instrument directory (§B.1 support).
 *
 * This replaces the nightly D1 sync that caused the 2026-09-05 outage. The
 * difference is not the size of the data — it is still the same ~31,000
 * symbols — but where it lives:
 *
 *   before: 31,000 D1 rows, 6 billable writes each = 186,000 writes
 *   now:    ~37 KV shards, 1 write each, and only when a shard changed
 *
 * On a normal day nothing changes upstream and the refresh writes **zero**.
 * D1 is untouched by this job entirely; a row appears there only when the
 * user saves an investment item.
 */

/**
 * Exchanges whose symbols are searchable.
 *
 * US only for now, deliberately. Adding a venue is a one-line change here
 * plus a refresh; the directory is sharded by symbol rather than by exchange,
 * so nothing else has to move.
 */
export const SYNCED_EXCHANGES = ['US'] as const;

export interface DirectoryRefreshReport extends DirectoryRefreshOutcome {
  exchanges: readonly string[];
  provider: string;
  durationMs: number;
  failed: boolean;
  error?: string;
}

export async function refreshInstrumentDirectory(
  provider: MarketDataProvider,
  directory: InstrumentDirectory,
  clock: Clock,
  exchanges: readonly string[] = SYNCED_EXCHANGES,
): Promise<DirectoryRefreshReport> {
  const startedAt = clock.now();
  const base = { exchanges, provider: provider.name };

  const collected: DirectoryEntry[] = [];

  for (const exchange of exchanges) {
    try {
      const instruments = await provider.listInstruments(exchange);
      for (const i of instruments) {
        collected.push({
          // Keyed by the provider's own instrument id, NOT the display
          // symbol. Two listings of one company share a display symbol
          // (`VOD` on both NASDAQ and London) but differ by provider id
          // (`VOD` vs `VOD.L`). Keying by display symbol makes them collide,
          // and one venue's currency silently overwrites the other's.
          symbol: i.providerInstrumentId,
          displayName: i.displayName,
          assetType: i.assetType,
          mic: i.mic,
          currency: i.currency,
          figi: i.figi,
          isin: i.isin,
        });
      }
    } catch (error) {
      // A partial refresh would silently delete every symbol from the
      // exchange that failed, because `refresh` replaces shard contents.
      // Abort instead and leave the existing directory in place: stale
      // metadata still supports search, an emptied directory does not.
      const message =
        error instanceof MarketDataUnavailable ? error.message : 'unexpected refresh failure';
      return {
        ...base,
        entries: 0,
        shards: 0,
        shardsWritten: 0,
        shardsUnchanged: 0,
        kvWrites: 0,
        durationMs: clock.now() - startedAt,
        failed: true,
        error: `${exchange}: ${message}`,
      };
    }
  }

  const outcome = await directory.refresh(collected);

  return { ...base, ...outcome, durationMs: clock.now() - startedAt, failed: false };
}
