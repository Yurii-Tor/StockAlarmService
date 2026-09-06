import type { ResolvedInstrument } from '../instruments/search';

/**
 * Persistence port for the portfolio.
 *
 * app/ may not import Drizzle or a binding (FR-0A8), so use cases depend on
 * this and the D1 implementation lives in adapters/.
 */

export interface NewLot {
  boughtAt: number;
  quantity: string;
  entryPrice: string;
  currency: string;
  fees: string;
  brokerName: string | null;
  entryPriceSource: 'manual' | 'latest_quote';
  entryPriceQuoteAsOf: number | null;
}

export interface NewItem {
  userId: string;
  /** Null for a manual/custom asset (§B.3). */
  instrument: ResolvedInstrument | null;
  symbol: string;
  displayName: string;
  assetType: string;
  exchange: string | null;
  currency: string;
  status: 'watching' | 'open';
  timezone: string;
  createdAt: number;
}

export interface CreateItemCommand {
  item: NewItem;
  /** Present only for `I bought it` (FR-042). */
  lot: NewLot | null;
  /** Optional; §C.1 makes the thesis strongly prompted, never required. */
  thesisBody: string | null;
  thesisTemplateId: string | null;
}

export interface CreatedItem {
  id: string;
  instrumentId: string | null;
  lotId: string | null;
  thesisId: string | null;
}

export interface ItemSummary {
  id: string;
  symbol: string;
  displayName: string;
  assetType: string;
  exchange: string | null;
  currency: string;
  status: string;
  timezone: string;
  createdAt: number;
  instrumentRef: string | null;
  /** Aggregates across open lots. Per-currency only — no FX (FR-053). */
  totalQuantity: string | null;
  totalFees: string | null;
  averageEntryPrice: string | null;
  lotCount: number;
  hasThesis: boolean;
}

export interface ThesisVersionRecord {
  versionNo: number;
  body: string;
  changeSummary: string | null;
  createdAt: number;
}

export interface ItemDetail extends ItemSummary {
  lots: Array<NewLot & { id: string }>;
  thesis: { currentVersionNo: number; body: string; versionCount: number } | null;
}

export interface PortfolioRepository {
  /**
   * Creates the item, its optional lot and its optional first thesis version
   * as one unit.
   *
   * §C.2 promises a one-tap save; a partially written item -- present but
   * without the purchase it was created to record -- is worse than a failure.
   */
  createItem(command: CreateItemCommand): Promise<CreatedItem>;

  listItems(userId: string): Promise<ItemSummary[]>;
  getItem(userId: string, itemId: string): Promise<ItemDetail | null>;

  /** Appends a thesis version; never overwrites (FR-054). */
  addThesisVersion(
    userId: string,
    itemId: string,
    body: string,
    changeSummary: string | null,
    now: number,
  ): Promise<{ versionNo: number } | null>;

  listThesisVersions(userId: string, itemId: string): Promise<ThesisVersionRecord[]>;

  /** Soft delete (FR-058). */
  softDeleteItem(userId: string, itemId: string, now: number): Promise<boolean>;
}
