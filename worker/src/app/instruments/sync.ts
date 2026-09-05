import type { Clock } from '../../domain/time/clock';
import type { InstrumentRepository, SyncOutcome } from '../ports/instrument-repository';
import { MarketDataUnavailable, type MarketDataProvider } from '../ports/market-data';

/**
 * Instrument-universe sync (§B.1 support).
 *
 * This is what makes local search possible, and therefore what makes
 * acceptance criterion 1 achievable at all: provider search endpoints do not
 * return exchange, MIC or currency, but the per-exchange symbol listing does.
 *
 * ## Why this job is budget-capped
 *
 * On 2026-09-05 a single unthrottled seed of 30,991 instruments wrote
 * **177,888 billable D1 rows -- 178% of the daily free-tier budget**. D1's
 * write limit is enforced PER ACCOUNT, not per database, so once it tripped,
 * every write on the account began failing, including those of an unrelated
 * project that then logged ~108 errors over four hours.
 *
 * The incremental diff was correct and remains correct. What it could not
 * help with was the FIRST seed, where every row is new and there is no diff
 * to exploit. So the cap below is not an optimisation; it is the thing that
 * makes this job safe to run at all, whoever triggers it.
 *
 * A capped seed simply takes several runs. The diff is stable, so a row
 * deferred tonight still differs tomorrow and is picked up then.
 */

/**
 * Billable rows this job may spend in one run.
 *
 * Deliberately a fraction of the 100k/day account limit, because the budget
 * is shared with every other Worker and database on the account -- including
 * projects this one knows nothing about.
 */
export const SYNC_ROW_WRITE_BUDGET = 20_000;

/** Must match the measured amplification in the repository adapter. */
const ROW_WRITE_AMPLIFICATION = 6;

/** Statements affordable within the budget. */
export function maxStatementsForBudget(
  budgetRows: number = SYNC_ROW_WRITE_BUDGET,
  amplification: number = ROW_WRITE_AMPLIFICATION,
): number {
  return Math.max(0, Math.floor(budgetRows / amplification));
}

export interface SyncReport extends SyncOutcome {
  exchange: string;
  provider: string;
  durationMs: number;
  failed: boolean;
  error?: string;
  /** Statement ceiling applied to this run. */
  budgetStatements: number;
}

export async function syncInstrumentUniverse(
  provider: MarketDataProvider,
  repo: InstrumentRepository,
  clock: Clock,
  exchange: string,
  budgetRows: number = SYNC_ROW_WRITE_BUDGET,
): Promise<SyncReport> {
  const startedAt = clock.now();
  const budgetStatements = maxStatementsForBudget(budgetRows);
  const base = { exchange, provider: provider.name, budgetStatements };

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
      deferred: 0,
      budgetExhausted: false,
      estimatedRowsWritten: 0,
      durationMs: clock.now() - startedAt,
      failed: true,
      error: message,
    };
  }

  const outcome = await repo.upsertChanged(
    provider.name,
    instruments,
    clock.now(),
    budgetStatements,
  );

  return { ...base, ...outcome, durationMs: clock.now() - startedAt, failed: false };
}
