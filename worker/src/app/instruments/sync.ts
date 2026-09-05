import type { Clock } from '../../domain/time/clock';
import type { InstrumentRepository, SyncOutcome } from '../ports/instrument-repository';
import { MarketDataUnavailable, type MarketDataProvider } from '../ports/market-data';

/**
 * Nightly instrument-universe sync (§B.1 support).
 *
 * This is what makes local search possible, and therefore what makes
 * acceptance criterion 1 achievable at all: provider search endpoints do not
 * return exchange, MIC or currency, but the per-exchange symbol listing does.
 *
 * The sync is incremental by contract (see InstrumentRepository.upsertChanged).
 * A full US universe is ~31,000 rows; rewriting it nightly would consume
 * roughly a third of the free-tier D1 write budget to change almost nothing.
 */

export interface SyncReport extends SyncOutcome {
  exchange: string;
  provider: string;
  durationMs: number;
  failed: boolean;
  error?: string;
}

export async function syncInstrumentUniverse(
  provider: MarketDataProvider,
  repo: InstrumentRepository,
  clock: Clock,
  exchange: string,
): Promise<SyncReport> {
  const startedAt = clock.now();
  const base = { exchange, provider: provider.name };

  let instruments;
  try {
    instruments = await provider.listInstruments(exchange);
  } catch (error) {
    // A failed sync must leave the existing universe intact: stale instrument
    // metadata still supports search, whereas an emptied table would break it
    // entirely. Never clear before a successful fetch.
    const message =
      error instanceof MarketDataUnavailable ? error.message : 'unexpected sync failure';
    return {
      ...base,
      seen: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      durationMs: clock.now() - startedAt,
      failed: true,
      error: message,
    };
  }

  const outcome = await repo.upsertChanged(provider.name, instruments, clock.now());

  return { ...base, ...outcome, durationMs: clock.now() - startedAt, failed: false };
}
