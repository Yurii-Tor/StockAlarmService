import type {
  CreateItemCommand,
  CreatedItem,
  ItemDetail,
  ItemSummary,
  NewLot,
  PortfolioRepository,
  ThesisVersionRecord,
} from '../../app/ports/portfolio-repository';
import type { ResolvedInstrument } from '../../app/instruments/search';

/**
 * D1-backed portfolio repository.
 *
 * Every write here is deliberate and small. After the 2026-09-05 incident the
 * rule for this project is that D1 holds only what the user actually created:
 * saving one item writes roughly a dozen billable rows, not thirty thousand.
 */

interface ItemRow {
  id: string;
  instrument_id: string | null;
  symbol: string;
  display_name: string;
  asset_type: string;
  exchange: string | null;
  currency: string;
  status: string;
  timezone: string;
  created_at: number;
  provider: string | null;
  provider_instrument_id: string | null;
}

interface LotRow {
  id: string;
  bought_at: number;
  quantity: string;
  entry_price: string;
  currency: string;
  fees: string;
  broker_name: string | null;
  entry_price_source: string;
  entry_price_quote_as_of: number | null;
}

/**
 * Exact decimal arithmetic on strings.
 *
 * Money never round-trips through a JS number here (FR-051): 0.1 + 0.2 is not
 * 0.3, and a cost basis is not the place to discover that. Values are scaled
 * to integers by the larger of the two scales, added with BigInt, and scaled
 * back.
 */
export function addDecimal(a: string, b: string): string {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return fromScaled(toScaled(a, scale) + toScaled(b, scale), scale);
}

export function multiplyDecimal(a: string, b: string): string {
  const scaleA = scaleOf(a);
  const scaleB = scaleOf(b);
  return fromScaled(toScaled(a, scaleA) * toScaled(b, scaleB), scaleA + scaleB);
}

export function divideDecimal(a: string, b: string, decimals = 8): string {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const numerator = toScaled(a, scale) * 10n ** BigInt(decimals);
  const denominator = toScaled(b, scale);
  if (denominator === 0n) return '0';
  return fromScaled(numerator / denominator, decimals);
}

function scaleOf(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const raw = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = raw.split('.');
  const padded = (fraction + '0'.repeat(scale)).slice(0, scale);
  const result = BigInt(whole + (padded || ''));
  return negative ? -result : result;
}

function fromScaled(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export class D1PortfolioRepository implements PortfolioRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Finds or creates the instrument row for a resolved instrument.
   *
   * Done before the main batch because we need the id, and D1 batches cannot
   * read a value back. The unique index on (provider, provider_instrument_id)
   * makes the insert safe against a concurrent save of the same ticker: the
   * loser's INSERT OR IGNORE is a no-op and the follow-up read finds the
   * winner's row.
   */
  private async ensureInstrument(
    instrument: ResolvedInstrument,
    now: number,
  ): Promise<string> {
    const existing = await this.db
      .prepare(
        `select id from instruments where provider = ?1 and provider_instrument_id = ?2 limit 1`,
      )
      .bind(instrument.provider, instrument.symbol)
      .first<{ id: string }>();

    if (existing) return existing.id;

    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `insert or ignore into instruments (
           id, provider, provider_instrument_id, symbol, display_name, asset_type,
           exchange, mic, currency, country, isin, figi, is_monitorable, metadata_updated_at
         ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
      .bind(
        id,
        instrument.provider,
        instrument.symbol,
        instrument.symbol,
        instrument.displayName,
        instrument.assetType,
        instrument.exchange,
        instrument.mic,
        instrument.currency,
        instrument.country,
        instrument.isin,
        instrument.figi,
        instrument.isMonitorable ? 1 : 0,
        now,
      )
      .run();

    const row = await this.db
      .prepare(
        `select id from instruments where provider = ?1 and provider_instrument_id = ?2 limit 1`,
      )
      .bind(instrument.provider, instrument.symbol)
      .first<{ id: string }>();

    return row?.id ?? id;
  }

  async createItem(command: CreateItemCommand): Promise<CreatedItem> {
    const { item, lot, thesisBody, thesisTemplateId } = command;

    const instrumentId = item.instrument
      ? await this.ensureInstrument(item.instrument, item.createdAt)
      : null;

    const itemId = crypto.randomUUID();
    const lotId = lot ? crypto.randomUUID() : null;
    const thesisId = thesisBody ? crypto.randomUUID() : null;
    const versionId = thesisBody ? crypto.randomUUID() : null;

    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `insert into investment_items (
             id, user_id, instrument_id, symbol, display_name, asset_type,
             exchange, currency, status, timezone, created_at, updated_at
           ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
        )
        .bind(
          itemId,
          item.userId,
          instrumentId,
          item.symbol,
          item.displayName,
          item.assetType,
          item.exchange,
          item.currency,
          item.status,
          item.timezone,
          item.createdAt,
        ),
    ];

    if (lot && lotId) {
      statements.push(
        this.db
          .prepare(
            `insert into lots (
               id, investment_item_id, bought_at, quantity, entry_price, currency,
               fees, broker_name, status, entry_price_source, entry_price_quote_as_of,
               created_at, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'open', ?9, ?10, ?11, ?11)`,
          )
          .bind(
            lotId,
            itemId,
            lot.boughtAt,
            lot.quantity,
            lot.entryPrice,
            lot.currency,
            lot.fees,
            lot.brokerName,
            lot.entryPriceSource,
            lot.entryPriceQuoteAsOf,
            item.createdAt,
          ),
      );

      if (lot.brokerName) {
        // §C.2's "last-used broker", so the next purchase needs no retyping.
        statements.push(
          this.db
            .prepare(
              `update user_settings set last_used_broker_name = ?1, updated_at = ?2
               where user_id = ?3`,
            )
            .bind(lot.brokerName, item.createdAt, item.userId),
        );
      }
    }

    if (thesisBody && thesisId && versionId) {
      statements.push(
        this.db
          .prepare(
            `insert into theses (id, investment_item_id, current_version_id, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?4)`,
          )
          .bind(thesisId, itemId, versionId, item.createdAt),
        this.db
          .prepare(
            `insert into thesis_versions
               (id, thesis_id, version_no, body, template_id, change_summary, created_by_user_id, created_at)
             values (?1, ?2, 1, ?3, ?4, NULL, ?5, ?6)`,
          )
          .bind(versionId, thesisId, thesisBody, thesisTemplateId, item.userId, item.createdAt),
      );
    }

    // One batch: D1 applies it atomically, so a half-written item cannot exist.
    await this.db.batch(statements);

    return { id: itemId, instrumentId, lotId, thesisId };
  }

  /**
   * Adds per-item aggregates.
   *
   * Two queries for the whole page rather than two per item: a portfolio view
   * of 50 items would otherwise cost 100 round trips.
   */
  private async summarise(userId: string, rows: ItemRow[]): Promise<ItemSummary[]> {
    if (rows.length === 0) return [];

    const { results: lots } = await this.db
      .prepare(
        `select l.investment_item_id, l.quantity, l.entry_price, l.fees
         from lots l
         join investment_items i on i.id = l.investment_item_id
         where i.user_id = ?1 and i.deleted_at is null and l.status = 'open'`,
      )
      .bind(userId)
      .all<{ investment_item_id: string; quantity: string; entry_price: string; fees: string }>();

    const { results: theses } = await this.db
      .prepare(
        `select t.investment_item_id from theses t
         join investment_items i on i.id = t.investment_item_id
         where i.user_id = ?1 and i.deleted_at is null`,
      )
      .bind(userId)
      .all<{ investment_item_id: string }>();
    const withThesis = new Set(theses.map((t) => t.investment_item_id));

    const byItem = new Map<string, typeof lots>();
    for (const lot of lots) {
      const list = byItem.get(lot.investment_item_id) ?? [];
      list.push(lot);
      byItem.set(lot.investment_item_id, list);
    }

    return rows.map((row) => {
      const itemLots = byItem.get(row.id) ?? [];

      let totalQuantity = '0';
      let totalFees = '0';
      let totalCost = '0';
      for (const lot of itemLots) {
        totalQuantity = addDecimal(totalQuantity, lot.quantity);
        totalFees = addDecimal(totalFees, lot.fees);
        totalCost = addDecimal(totalCost, multiplyDecimal(lot.quantity, lot.entry_price));
      }

      return {
        id: row.id,
        symbol: row.symbol,
        displayName: row.display_name,
        assetType: row.asset_type,
        exchange: row.exchange,
        currency: row.currency,
        status: row.status,
        timezone: row.timezone,
        createdAt: row.created_at,
        instrumentRef:
          row.provider && row.provider_instrument_id
            ? `${row.provider}:${row.provider_instrument_id}`
            : null,
        // Aggregates are per-currency by construction: an item has exactly
        // one currency, and totals are never summed across items (FR-053).
        totalQuantity: itemLots.length > 0 ? totalQuantity : null,
        totalFees: itemLots.length > 0 ? totalFees : null,
        averageEntryPrice:
          itemLots.length > 0 && totalQuantity !== '0'
            ? divideDecimal(totalCost, totalQuantity, 8)
            : null,
        lotCount: itemLots.length,
        hasThesis: withThesis.has(row.id),
      };
    });
  }

  async listItems(userId: string): Promise<ItemSummary[]> {
    const { results } = await this.db
      .prepare(
        `select i.*, n.provider, n.provider_instrument_id
         from investment_items i
         left join instruments n on n.id = i.instrument_id
         where i.user_id = ?1 and i.deleted_at is null
         order by i.created_at desc`,
      )
      .bind(userId)
      .all<ItemRow>();

    return this.summarise(userId, results);
  }

  async getItem(userId: string, itemId: string): Promise<ItemDetail | null> {
    const row = await this.db
      .prepare(
        `select i.*, n.provider, n.provider_instrument_id
         from investment_items i
         left join instruments n on n.id = i.instrument_id
         where i.user_id = ?1 and i.id = ?2 and i.deleted_at is null`,
      )
      .bind(userId, itemId)
      .first<ItemRow>();

    if (!row) return null;

    const [summary] = await this.summarise(userId, [row]);
    if (!summary) return null;

    const { results: lotRows } = await this.db
      .prepare(
        `select * from lots where investment_item_id = ?1 order by bought_at desc`,
      )
      .bind(itemId)
      .all<LotRow>();

    const thesis = await this.db
      .prepare(
        `select v.version_no, v.body, (
           select count(*) from thesis_versions where thesis_id = t.id
         ) as version_count
         from theses t
         join thesis_versions v on v.id = t.current_version_id
         where t.investment_item_id = ?1`,
      )
      .bind(itemId)
      .first<{ version_no: number; body: string; version_count: number }>();

    return {
      ...summary,
      lots: lotRows.map(
        (l): NewLot & { id: string } => ({
          id: l.id,
          boughtAt: l.bought_at,
          quantity: l.quantity,
          entryPrice: l.entry_price,
          currency: l.currency,
          fees: l.fees,
          brokerName: l.broker_name,
          entryPriceSource: l.entry_price_source as 'manual' | 'latest_quote',
          entryPriceQuoteAsOf: l.entry_price_quote_as_of,
        }),
      ),
      thesis: thesis
        ? {
            currentVersionNo: thesis.version_no,
            body: thesis.body,
            versionCount: thesis.version_count,
          }
        : null,
    };
  }

  async addThesisVersion(
    userId: string,
    itemId: string,
    body: string,
    changeSummary: string | null,
    now: number,
  ): Promise<{ versionNo: number } | null> {
    const owned = await this.db
      .prepare(
        `select id from investment_items where id = ?1 and user_id = ?2 and deleted_at is null`,
      )
      .bind(itemId, userId)
      .first<{ id: string }>();
    if (!owned) return null;

    let thesis = await this.db
      .prepare(`select id from theses where investment_item_id = ?1`)
      .bind(itemId)
      .first<{ id: string }>();

    if (!thesis) {
      const thesisId = crypto.randomUUID();
      await this.db
        .prepare(
          `insert into theses (id, investment_item_id, current_version_id, created_at, updated_at)
           values (?1, ?2, NULL, ?3, ?3)`,
        )
        .bind(thesisId, itemId, now)
        .run();
      thesis = { id: thesisId };
    }

    const last = await this.db
      .prepare(`select max(version_no) as n from thesis_versions where thesis_id = ?1`)
      .bind(thesis.id)
      .first<{ n: number | null }>();

    const versionNo = (last?.n ?? 0) + 1;
    const versionId = crypto.randomUUID();

    // Append, then repoint. The previous version is never updated or deleted
    // (FR-054) -- that is what makes "read your original thesis" possible
    // months later.
    await this.db.batch([
      this.db
        .prepare(
          `insert into thesis_versions
             (id, thesis_id, version_no, body, template_id, change_summary, created_by_user_id, created_at)
           values (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)`,
        )
        .bind(versionId, thesis.id, versionNo, body, changeSummary, userId, now),
      this.db
        .prepare(`update theses set current_version_id = ?1, updated_at = ?2 where id = ?3`)
        .bind(versionId, now, thesis.id),
    ]);

    return { versionNo };
  }

  async listThesisVersions(userId: string, itemId: string): Promise<ThesisVersionRecord[]> {
    const { results } = await this.db
      .prepare(
        `select v.version_no, v.body, v.change_summary, v.created_at
         from thesis_versions v
         join theses t on t.id = v.thesis_id
         join investment_items i on i.id = t.investment_item_id
         where i.id = ?1 and i.user_id = ?2 and i.deleted_at is null
         order by v.version_no desc`,
      )
      .bind(itemId, userId)
      .all<{ version_no: number; body: string; change_summary: string | null; created_at: number }>();

    return results.map((r) => ({
      versionNo: r.version_no,
      body: r.body,
      changeSummary: r.change_summary,
      createdAt: r.created_at,
    }));
  }

  async softDeleteItem(userId: string, itemId: string, now: number): Promise<boolean> {
    // Soft (FR-058): thesis and journal survive until account purge, because
    // the record of a decision outlives the position it was about.
    const result = await this.db
      .prepare(
        `update investment_items set deleted_at = ?1, updated_at = ?1
         where id = ?2 and user_id = ?3 and deleted_at is null`,
      )
      .bind(now, itemId, userId)
      .run();

    return (result.meta.changes ?? 0) > 0;
  }
}
