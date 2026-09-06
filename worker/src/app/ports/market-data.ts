/**
 * The market-data port (spec §B: "the configured market-data provider").
 *
 * The abstraction is the requirement; Finnhub is merely the first adapter.
 * Nothing in domain/ or app/ may import a provider SDK or reference Finnhub
 * by name — enforced by lint (FR-0A8).
 */

export interface ProviderInstrument {
  /** Stable id within the provider's namespace. */
  providerInstrumentId: string;
  symbol: string;
  displayName: string;
  assetType: string;
  /** ISO 10383 MIC. The disambiguation key for §B.1. */
  mic: string | null;
  currency: string | null;
  country: string | null;
  isin: string | null;
  figi: string | null;
  /**
   * False when the provider cannot quote this instrument, which blocks price
   * targets while leaving reminders and journal available (FR-033, FR-066).
   */
  isMonitorable: boolean;
}

export interface ProviderQuote {
  price: string | null;
  currency: string | null;
  /** The PROVIDER's as-of time, epoch ms. Never our fetch time (FR-024). */
  quoteAsOf: number | null;
  /** Provider-declared delay; 0 for a real-time feed. */
  delayMinutes: number;
  previousClose: string | null;
  dayOpen: string | null;
  dayHigh: string | null;
  dayLow: string | null;
}

/**
 * A provider failure that must not be mistaken for "no such instrument".
 *
 * §B.3 requires that when metadata resolves but the quote fails, the
 * instrument is retained and the price shows as unavailable with a retry.
 * That distinction only survives if failure is a typed outcome rather than a
 * null return.
 */
export class MarketDataUnavailable extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'MarketDataUnavailable';
  }
}

/**
 * A search hit straight from the provider.
 *
 * Deliberately thin: provider search endpoints return no exchange, MIC or
 * currency. Those come from the instrument directory, keyed by symbol.
 */
export interface ProviderSearchHit {
  symbol: string;
  displayName: string;
  assetType: string;
}

export interface MarketDataProvider {
  readonly name: string;

  /**
   * Live symbol search.
   *
   * Costs one provider call and zero database writes. The results are not
   * sufficient on their own to satisfy acceptance criterion 1 -- they carry
   * no venue or currency -- so callers enrich them from the directory.
   */
  search(query: string): Promise<ProviderSearchHit[]>;

  /**
   * The full instrument universe for one venue, used by the nightly sync.
   *
   * Search is served locally from our own table, not from a provider search
   * endpoint: the thin search endpoints do not return exchange, MIC or
   * currency, so they cannot satisfy acceptance criterion 1 (verified
   * 2026-09-05; see docs/02-assumptions.md §E).
   */
  listInstruments(exchange: string): Promise<ProviderInstrument[]>;

  /** Latest quote, or MarketDataUnavailable. */
  getQuote(symbol: string): Promise<ProviderQuote>;
}
