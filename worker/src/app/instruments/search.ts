import { exchangeNameForMic } from '../../domain/instruments/exchanges';
import type { InstrumentRepository, InstrumentSearchHit } from '../ports/instrument-repository';

/**
 * Instrument search (§B.1).
 *
 * Runs against our own synced table, not a provider search endpoint. The
 * provider endpoints return no exchange, MIC or currency (verified
 * 2026-09-05), so they cannot produce the required result format:
 *
 *     MSFT — Microsoft Corporation
 *     NASDAQ · Stock · USD
 *
 * Serving search locally also means a provider outage degrades quotes only,
 * and that typing costs no API budget at all.
 */

export interface SearchResultView {
  instrumentId: string;
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
  /** §B.1: "a distinguishable label for duplicate ticker symbols". */
  disambiguationLabel: string;
  /** True when another hit shares this symbol. */
  isAmbiguousSymbol: boolean;
  /** The two lines §B.1 specifies, assembled server-side so every client agrees. */
  primaryLine: string;
  secondaryLine: string;
}

function titleCaseAssetType(assetType: string): string {
  if (assetType === 'etf' || assetType === 'reit') return assetType.toUpperCase();
  return assetType.charAt(0).toUpperCase() + assetType.slice(1);
}

export function toSearchResultView(hit: InstrumentSearchHit): SearchResultView {
  const exchange = hit.exchange ?? exchangeNameForMic(hit.mic);
  const parts = [exchange, titleCaseAssetType(hit.assetType), hit.currency].filter(
    (p): p is string => Boolean(p),
  );

  return {
    instrumentId: hit.id,
    symbol: hit.symbol,
    displayName: hit.displayName,
    assetType: hit.assetType,
    exchange,
    mic: hit.mic,
    currency: hit.currency,
    country: hit.country,
    isin: hit.isin,
    figi: hit.figi,
    isMonitorable: hit.isMonitorable,
    // Venue and currency are what actually distinguish two listings of the
    // same ticker, so the label leads with them.
    disambiguationLabel: parts.join(' · '),
    isAmbiguousSymbol: hit.isAmbiguousSymbol,
    primaryLine: `${hit.symbol} — ${hit.displayName}`,
    secondaryLine: parts.join(' · '),
  };
}

export interface SearchInstrumentsResult {
  results: SearchResultView[];
  /**
   * True when any symbol in the result set appears more than once.
   *
   * §B.1 forbids assuming a ticker is unique across exchanges, so this is
   * returned as data rather than left for the client to infer: a client that
   * forgets the check would silently auto-select the wrong listing.
   */
  requiresDisambiguation: boolean;
}

export async function searchInstruments(
  repo: InstrumentRepository,
  rawQuery: string,
  options: { limit?: number; assetType?: string } = {},
): Promise<SearchInstrumentsResult> {
  const query = rawQuery.trim();
  if (query.length === 0) {
    return { results: [], requiresDisambiguation: false };
  }

  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const hits = await repo.search(query, limit, options.assetType);
  const results = hits.map(toSearchResultView);

  return {
    results,
    requiresDisambiguation: results.some((r) => r.isAmbiguousSymbol),
  };
}
