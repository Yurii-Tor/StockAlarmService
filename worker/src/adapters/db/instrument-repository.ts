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
  ): Promise<SyncOutcome> {
    // Read current state once. ~31k row reads against a 5M/day budget is
    // cheap; WRITES are the scarce resource (100k/day), so the entire point
    // of this method is to write as few rows as possible (NFR-06).
    const { results: existingRows } = await this.db
      .prepare(`select * from instruments where provider = ?1`)
      .bind(provider)
      .all<InstrumentRow>();

    const existing = new Map(existingRows.map((r) => [r.provider_instrument_id, r]));

    const outcome: SyncOutcome = {
      seen: instruments.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
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

    const statements: D1PreparedStatement[] = [];

    for (const incoming of instruments) {
      const current = existing.get(incoming.providerInstrumentId);

      if (!current) {
        statements.push(
          insertStmt.bind(
            crypto.randomUUID(),
            provider,
            incoming.providerInstrumentId,
            incoming.symbol,
            incoming.displayName,
            incoming.assetType,
            null,
            incoming.mic,
            incoming.currency,
            incoming.country,
            incoming.isin,
            incoming.figi,
            incoming.isMonitorable ? 1 : 0,
            now,
          ),
        );
        outcome.inserted += 1;
        continue;
      }

      // metadata_updated_at is excluded from the comparison deliberately:
      // including it would make every row differ on every run and defeat the
      // entire purpose of an incremental sync.
      const unchanged =
        current.symbol === incoming.symbol &&
        current.display_name === incoming.displayName &&
        current.asset_type === incoming.assetType &&
        current.mic === incoming.mic &&
        current.currency === incoming.currency &&
        current.isin === incoming.isin &&
        current.figi === incoming.figi &&
        (current.is_monitorable === 1) === incoming.isMonitorable;

      if (unchanged) {
        outcome.unchanged += 1;
        continue;
      }

      statements.push(
        updateStmt.bind(
          incoming.symbol,
          incoming.displayName,
          incoming.assetType,
          incoming.mic,
          incoming.currency,
          incoming.isin,
          incoming.figi,
          incoming.isMonitorable ? 1 : 0,
          now,
          current.id,
        ),
      );
      outcome.updated += 1;
    }

    // Chunked so a large first sync stays inside D1's per-batch limits.
    const CHUNK = 50;
    for (let i = 0; i < statements.length; i += CHUNK) {
      const slice = statements.slice(i, i + CHUNK);
      if (slice.length > 0) await this.db.batch(slice);
    }

    return outcome;
  }
}
