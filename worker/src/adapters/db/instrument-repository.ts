import type {
  InstrumentRepository,
  InstrumentSearchHit,
  StoredInstrument,
  SyncOutcome,
} from '../../app/ports/instrument-repository';
import type { ProviderInstrument } from '../../app/ports/market-data';

/**
 * D1-backed instrument repository.
 *
 * Uses the D1 binding directly rather than Drizzle. Search has to be raw SQL
 * anyway (FTS5 `MATCH` has no query-builder expression), and the sync needs
 * real `D1PreparedStatement`s to batch -- Drizzle's `run()` executes
 * immediately and returns a promise, which cannot be batched.
 *
 * Search goes through FTS5 rather than LIKE: `LIKE '%vod%'` cannot use an
 * index, so it degrades linearly across ~31,000 rows on every keystroke.
 */

/**
 * Billable D1 rows per logical instrument row written.
 *
 * D1 bills index and FTS shadow-table maintenance as rows written, so one
 * INSERT into `instruments` is NOT one billable row. Measured, not estimated:
 * `wrangler d1 insights` reports avgRowsWritten 6 for this exact statement.
 *
 *   1  the table row
 *   3  index entries (ux_instruments_provider_id, ix_instruments_symbol_mic,
 *      ix_instruments_isin)
 *  ~2  FTS5 shadow writes via instruments_fts_after_insert
 *
 * This constant exists because getting it wrong took the whole Cloudflare
 * account offline on 2026-09-05: a 30,991-row seed cost 177,888 billable
 * writes -- 178% of the daily free-tier budget -- and because that limit is
 * enforced PER ACCOUNT, it blocked writes for an unrelated project too.
 *
 * If an index is added to `instruments`, raise this number.
 */
export const D1_ROW_WRITE_AMPLIFICATION = 6;

interface InstrumentRow {
  id: string;
  provider: string;
  provider_instrument_id: string;
  symbol: string;
  display_name: string;
  asset_type: string;
  exchange: string | null;
  mic: string | null;
  currency: string | null;
  country: string | null;
  isin: string | null;
  figi: string | null;
  is_monitorable: number;
  metadata_updated_at: number;
}

function toStored(row: InstrumentRow): StoredInstrument {
  return {
    id: row.id,
    provider: row.provider,
    providerInstrumentId: row.provider_instrument_id,
    symbol: row.symbol,
    displayName: row.display_name,
    assetType: row.asset_type,
    exchange: row.exchange,
    mic: row.mic,
    currency: row.currency,
    country: row.country,
    isin: row.isin,
    figi: row.figi,
    isMonitorable: row.is_monitorable === 1,
    metadataUpdatedAt: row.metadata_updated_at,
  };
}

/**
 * Builds a safe FTS5 prefix query.
 *
 * Raw user input cannot go into a MATCH expression: `"`, `*`, `:`, `-`, `(`
 * and bare `NOT`/`OR` are FTS5 operators, so an unescaped apostrophe turns a
 * search into a syntax error the user cannot see or explain. Each token is
 * reduced to word characters, quoted, and given a prefix star.
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens = raw
    .split(/[^\p{L}\p{N}.]+/u)
    .map((t) => t.replace(/"/g, '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 6);

  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' AND ');
}

export class D1InstrumentRepository implements InstrumentRepository {
  constructor(private readonly db: D1Database) {}

  async search(query: string, limit: number, assetType?: string): Promise<InstrumentSearchHit[]> {
    const match = buildFtsQuery(query);
    if (!match) return [];

    const upper = query.trim().toUpperCase();

    // Over-fetch so ambiguity detection sees sibling listings that would
    // otherwise fall outside the limit: if two VOD listings straddle the
    // cut-off, the user must still be asked to choose (§B.1).
    const fetchLimit = Math.min(limit * 4, 200);

    const sql = `
      select i.* from instruments_fts f
      join instruments i on i.id = f.instrument_id
      where instruments_fts match ?1
        ${assetType ? 'and i.asset_type = ?4' : ''}
      order by
        case when upper(i.symbol) = ?2 then 0 else 1 end,
        length(i.symbol),
        rank
      limit ?3
    `;

    const stmt = assetType
      ? this.db.prepare(sql).bind(match, upper, fetchLimit, assetType)
      : this.db.prepare(sql).bind(match, upper, fetchLimit);

    const { results } = await stmt.all<InstrumentRow>();

    const bySymbol = new Map<string, number>();
    for (const row of results) {
      const key = row.symbol.toUpperCase();
      bySymbol.set(key, (bySymbol.get(key) ?? 0) + 1);
    }

    return results.slice(0, limit).map((row) => ({
      ...toStored(row),
      isAmbiguousSymbol: (bySymbol.get(row.symbol.toUpperCase()) ?? 0) > 1,
    }));
  }

  async findById(id: string): Promise<StoredInstrument | null> {
    const row = await this.db
      .prepare(`select * from instruments where id = ?1 limit 1`)
      .bind(id)
      .first<InstrumentRow>();
    return row ? toStored(row) : null;
  }

  async findByProviderId(
    provider: string,
    providerInstrumentId: string,
  ): Promise<StoredInstrument | null> {
    const row = await this.db
      .prepare(
        `select * from instruments where provider = ?1 and provider_instrument_id = ?2 limit 1`,
      )
      .bind(provider, providerInstrumentId)
      .first<InstrumentRow>();
    return row ? toStored(row) : null;
  }

  async upsertChanged(
    provider: string,
    instruments: readonly ProviderInstrument[],
    now: number,
    maxStatements: number,
  ): Promise<SyncOutcome> {
    const outcome: SyncOutcome = {
      seen: instruments.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      deferred: 0,
      budgetExhausted: false,
      estimatedRowsWritten: 0,
    };

    const insertStmt = this.db.prepare(`
      insert into instruments (
        id, provider, provider_instrument_id, symbol, display_name, asset_type,
        exchange, mic, currency, country, isin, figi, is_monitorable, metadata_updated_at
      ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
    `);

    const updateStmt = this.db.prepare(`
      update instruments set
        symbol = ?1, display_name = ?2, asset_type = ?3, mic = ?4, currency = ?5,
        isin = ?6, figi = ?7, is_monitorable = ?8, metadata_updated_at = ?9
      where id = ?10
    `);

    const incoming = new Map(instruments.map((i) => [i.providerInstrumentId, i]));
    const seen = new Set<string>();
    const pending: D1PreparedStatement[] = [];
    let written = 0;

    const flush = async () => {
      const WRITE_CHUNK = 50;
      for (let j = 0; j < pending.length; j += WRITE_CHUNK) {
        const batch = pending.slice(j, j + WRITE_CHUNK);
        if (batch.length > 0) await this.db.batch(batch);
      }
      written += pending.length;
      pending.length = 0;
    };

    const canWrite = () => written + pending.length < maxStatements;

    /**
     * Existing rows are read by keyset paging, not all at once.
     *
     * Two earlier shapes both failed against real data:
     *   - reading the whole provider universe in one query worked only while
     *     the table was empty; once ~31,000 rows existed the read itself
     *     returned a 500 and the nightly sync stopped working;
     *   - an `IN (...)` list of incoming ids hit D1's hard limit of 100 bound
     *     parameters per statement.
     *
     * Keyset paging over `ux_instruments_provider_id` bounds memory and
     * response size, uses one bound cursor regardless of universe size, and
     * costs ~60 reads for a 31,000-row exchange against a 5M/day read budget.
     */
    const PAGE = 500;
    let cursor = '';

    for (;;) {
      const { results: page } = await this.db
        .prepare(
          `select * from instruments
           where provider = ?1 and provider_instrument_id > ?2
           order by provider_instrument_id
           limit ?3`,
        )
        .bind(provider, cursor, PAGE)
        .all<InstrumentRow>();

      if (page.length === 0) break;

      for (const current of page) {
        const match = incoming.get(current.provider_instrument_id);
        if (!match) continue; // Delisted upstream; left in place. See below.

        seen.add(current.provider_instrument_id);

        // metadata_updated_at is excluded from the comparison deliberately:
        // including it would make every row differ on every run and defeat
        // the entire purpose of an incremental sync.
        const unchanged =
          current.symbol === match.symbol &&
          current.display_name === match.displayName &&
          current.asset_type === match.assetType &&
          current.mic === match.mic &&
          current.currency === match.currency &&
          current.isin === match.isin &&
          current.figi === match.figi &&
          (current.is_monitorable === 1) === match.isMonitorable;

        if (unchanged) {
          outcome.unchanged += 1;
          continue;
        }

        if (!canWrite()) {
          outcome.deferred += 1;
          continue;
        }

        pending.push(
          updateStmt.bind(
            match.symbol,
            match.displayName,
            match.assetType,
            match.mic,
            match.currency,
            match.isin,
            match.figi,
            match.isMonitorable ? 1 : 0,
            now,
            current.id,
          ),
        );
        outcome.updated += 1;
      }

      await flush();
      cursor = page[page.length - 1]!.provider_instrument_id;
      if (page.length < PAGE) break;
    }

    // Anything the provider listed that we have never stored.
    for (const [providerInstrumentId, match] of incoming) {
      if (seen.has(providerInstrumentId)) continue;

      if (!canWrite()) {
        outcome.deferred += 1;
        continue;
      }

      pending.push(
        insertStmt.bind(
          crypto.randomUUID(),
          provider,
          providerInstrumentId,
          match.symbol,
          match.displayName,
          match.assetType,
          null,
          match.mic,
          match.currency,
          match.country,
          match.isin,
          match.figi,
          match.isMonitorable ? 1 : 0,
          now,
        ),
      );
      outcome.inserted += 1;

      if (pending.length >= 500) await flush();
    }

    await flush();

    // Rows we hold that the provider no longer lists are deliberately left
    // alone: a delisting and a provider hiccup look identical here, and
    // deleting an instrument would orphan any investment item referencing it.
    outcome.budgetExhausted = outcome.deferred > 0;
    outcome.estimatedRowsWritten = written * D1_ROW_WRITE_AMPLIFICATION;

    return outcome;
  }
}
