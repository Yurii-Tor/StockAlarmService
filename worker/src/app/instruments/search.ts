import { exchangeNameForMic } from '../../domain/instruments/exchanges';
import type { InstrumentDirectory } from '../ports/instrument-directory';
import type { MarketDataProvider } from '../ports/market-data';

/**
 * Instrument search (§B.1) — live, and free of database writes.
 *
 * Previously this ran over ~31,000 instrument rows kept in D1. That index
 * cost 177,888 billable writes to build and took the whole Cloudflare account
 * offline; it also existed to serve a user who adds a handful of instruments
 * a year. Search now costs one provider call plus a small number of KV reads,
 * and nothing is written anywhere until the user saves an item.
 *
 * The provider's search endpoint returns no venue or currency, so hits are
 * enriched from the directory. When a symbol is missing from the directory
 * (a venue we do not sync), the hit is still returned — with its venue and
 * currency shown as unknown rather than guessed.
 */

/**
 * A reference to an instrument that does not require a stored row.
 *
 * `provider:symbol`, e.g. `finnhub:MSFT`. This replaces §G.2's `instrumentId`
 * because there is no row to have an id until the user saves — see
 * docs/02-assumptions.md.
 */
export function instrumentRef(provider: string, symbol: string): string {
  return `${provider}:${symbol}`;
}

export function parseInstrumentRef(ref: string): { provider: string; symbol: string } | null {
  const at = ref.indexOf(':');
  if (at <= 0 || at === ref.length - 1) return null;
  return { provider: ref.slice(0, at), symbol: ref.slice(at + 1) };
}

/**
 * The part of a symbol shared across venues.
 *
 * Providers suffix the venue (`VOD`, `VOD.JO`, `VOD.VI`), so the text before
 * the first dot identifies the underlying ticker. This is how §B.1's
 * duplicate detection works without a local index.
 */
export function baseSymbol(symbol: string): string {
  const dot = symbol.indexOf('.');
  return (dot === -1 ? symbol : symbol.slice(0, dot)).toUpperCase();
}

export interface SearchResultView {
  instrumentRef: string;
  symbol: string;
  displayName: string;
  assetType: string;
  exchange: string | null;
  mic: string | null;
  currency: string | null;
  isin: string | null;
  figi: string | null;
  isMonitorable: boolean;
  /** True when the directory had no entry, so venue/currency are unknown. */
  metadataKnown: boolean;
  disambiguationLabel: string;
  isAmbiguousSymbol: boolean;
  primaryLine: string;
  secondaryLine: string;
}

export interface SearchInstrumentsResult {
  results: SearchResultView[];
  requiresDisambiguation: boolean;
}

function titleCaseAssetType(assetType: string): string {
  if (assetType === 'etf' || assetType === 'reit') return assetType.toUpperCase();
  return assetType.charAt(0).toUpperCase() + assetType.slice(1);
}

export async function searchInstruments(
  provider: MarketDataProvider,
  directory: InstrumentDirectory,
  rawQuery: string,
  options: { limit?: number; assetType?: string } = {},
): Promise<SearchInstrumentsResult> {
  const query = rawQuery.trim();
  if (query.length === 0) return { results: [], requiresDisambiguation: false };

  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);

  const hits = await provider.search(query);
  const filtered = options.assetType
    ? hits.filter((h) => h.assetType === options.assetType)
    : hits;

  // Over-fetch before trimming, so a sibling listing cannot fall outside the
  // limit and hide the fact that a ticker is ambiguous (§B.1).
  const considered = filtered.slice(0, Math.min(limit * 4, 100));
  const metadata = await directory.lookupMany(considered.map((h) => h.symbol));

  const baseCounts = new Map<string, number>();
  for (const hit of considered) {
    const base = baseSymbol(hit.symbol);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  const results = considered.slice(0, limit).map((hit): SearchResultView => {
    const entry = metadata.get(hit.symbol.toUpperCase());
    const exchange = exchangeNameForMic(entry?.mic ?? null);
    const currency = entry?.currency ?? null;

    const parts = [exchange, titleCaseAssetType(hit.assetType), currency].filter(
      (p): p is string => Boolean(p),
    );

    return {
      instrumentRef: instrumentRef(provider.name, hit.symbol),
      symbol: hit.symbol,
      displayName: entry?.displayName ?? hit.displayName,
      assetType: entry?.assetType ?? hit.assetType,
      exchange,
      mic: entry?.mic ?? null,
      currency,
      isin: entry?.isin ?? null,
      figi: entry?.figi ?? null,
      // §B.3: an instrument we cannot resolve to known venue metadata is not
      // monitorable, which blocks price targets while leaving reminders and
      // journal fully usable.
      isMonitorable: Boolean(entry),
      metadataKnown: Boolean(entry),
      disambiguationLabel: parts.join(' · '),
      isAmbiguousSymbol: (baseCounts.get(baseSymbol(hit.symbol)) ?? 0) > 1,
      primaryLine: `${hit.symbol} — ${entry?.displayName ?? hit.displayName}`,
      // Asset type alone is not a venue. Without directory metadata the
      // honest line says so, rather than showing "Stock" and implying we
      // know where it trades and in what currency (§B.2).
      secondaryLine: entry ? parts.join(' · ') : 'Venue and currency unknown',
    };
  });

  return {
    results,
    requiresDisambiguation: results.some((r) => r.isAmbiguousSymbol),
  };
}

export interface ResolvedInstrument {
  ref: string;
  provider: string;
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
}

/**
 * Resolves a reference to full instrument metadata, without touching D1.
 *
 * Returns null only when the reference is malformed or names an unknown
 * provider — an unknown symbol still resolves, with unknown metadata, so the
 * user can save it as a manual asset (§B.3).
 */
export async function resolveInstrument(
  provider: MarketDataProvider,
  directory: InstrumentDirectory,
  ref: string,
): Promise<ResolvedInstrument | null> {
  const parsed = parseInstrumentRef(ref);
  if (!parsed || parsed.provider !== provider.name) return null;

  const entry = await directory.lookup(parsed.symbol);

  return {
    ref,
    provider: parsed.provider,
    symbol: parsed.symbol,
    displayName: entry?.displayName ?? parsed.symbol,
    assetType: entry?.assetType ?? 'stock',
    exchange: exchangeNameForMic(entry?.mic ?? null),
    mic: entry?.mic ?? null,
    currency: entry?.currency ?? null,
    country: null,
    isin: entry?.isin ?? null,
    figi: entry?.figi ?? null,
    isMonitorable: Boolean(entry),
  };
}
