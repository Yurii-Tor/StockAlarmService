import {
  MarketDataUnavailable,
  type MarketDataProvider,
  type ProviderInstrument,
  type ProviderQuote,
} from '../../app/ports/market-data';

/**
 * Deterministic in-memory provider.
 *
 * Every test runs against this: no test may touch a live provider (NFR-05),
 * and a suite whose results depend on market hours is not a suite.
 *
 * The fixtures are chosen to exercise the requirements that are easy to get
 * wrong rather than to look realistic:
 *
 *  - MSFT on NASDAQ, which is acceptance criterion 1 verbatim.
 *  - A genuine duplicate symbol across two venues, so §B.1's "never
 *    automatically assume a ticker is unique" has something to fail against.
 *  - An instrument that resolves but cannot be quoted, for §B.3's
 *    metadata-without-price state.
 *  - A non-monitorable instrument, which must block price targets while
 *    leaving reminders and journal working (FR-033).
 */

export const FAKE_INSTRUMENTS: readonly ProviderInstrument[] = [
  {
    providerInstrumentId: 'MSFT',
    symbol: 'MSFT',
    displayName: 'Microsoft Corporation',
    assetType: 'stock',
    mic: 'XNAS',
    currency: 'USD',
    country: 'US',
    isin: null,
    figi: 'BBG000BPH459',
    isMonitorable: true,
  },
  {
    providerInstrumentId: 'AAPL',
    symbol: 'AAPL',
    displayName: 'Apple Inc',
    assetType: 'stock',
    mic: 'XNAS',
    currency: 'USD',
    country: 'US',
    isin: null,
    figi: 'BBG000B9XRY4',
    isMonitorable: true,
  },
  // The duplicate-symbol case. Same ticker, different venue and currency:
  // auto-selecting either one would be a §B.1 violation.
  {
    providerInstrumentId: 'VOD.L',
    symbol: 'VOD',
    displayName: 'Vodafone Group PLC',
    assetType: 'stock',
    mic: 'XLON',
    currency: 'GBP',
    country: 'GB',
    isin: 'GB00BH4HKS39',
    figi: 'BBG000C4R6H6',
    isMonitorable: true,
  },
  {
    providerInstrumentId: 'VOD',
    symbol: 'VOD',
    displayName: 'Vodafone Group PLC ADR',
    assetType: 'stock',
    mic: 'XNAS',
    currency: 'USD',
    country: 'US',
    isin: null,
    figi: 'BBG000CGA9F5',
    isMonitorable: true,
  },
  {
    providerInstrumentId: 'NOQUOTE',
    symbol: 'NOQUOTE',
    displayName: 'Resolves But Never Quotes SA',
    assetType: 'stock',
    mic: 'XNAS',
    currency: 'USD',
    country: 'US',
    isin: null,
    figi: null,
    isMonitorable: true,
  },
  {
    providerInstrumentId: 'UNMONITORABLE',
    symbol: 'UNMON',
    displayName: 'Unmonitorable Holdings',
    assetType: 'other',
    mic: 'OOTC',
    currency: 'USD',
    country: 'US',
    isin: null,
    figi: null,
    isMonitorable: false,
  },
];

/** Prices are fixed so assertions can be exact rather than approximate. */
const FAKE_PRICES: Readonly<Record<string, string>> = {
  MSFT: '480.15',
  AAPL: '227.40',
  'VOD.L': '0.78',
  VOD: '9.42',
  UNMONITORABLE: '1.00',
};

export interface FakeProviderOptions {
  /**
   * Fixed provider as-of time, epoch ms, so freshness is deterministic.
   *
   * Defaults to the current time, which makes quotes read as `realtime` in
   * local development. Tests that assert on freshness must pass an explicit
   * value rather than depend on when they happen to run.
   */
  quoteAsOf?: number;
  delayMinutes?: number;
  /** Symbols that should raise MarketDataUnavailable on getQuote. */
  failingSymbols?: readonly string[];
}

export class FakeMarketDataProvider implements MarketDataProvider {
  readonly name = 'fake';

  /** Call counts, so tests can assert the cache actually prevents fetches. */
  readonly calls = { listInstruments: 0, getQuote: 0 };

  constructor(private readonly options: FakeProviderOptions = {}) {}

  async listInstruments(exchange: string): Promise<ProviderInstrument[]> {
    this.calls.listInstruments += 1;
    if (exchange.toUpperCase() === 'US') {
      return FAKE_INSTRUMENTS.filter((i) => i.mic !== 'XLON').map((i) => ({ ...i }));
    }
    if (exchange.toUpperCase() === 'L') {
      return FAKE_INSTRUMENTS.filter((i) => i.mic === 'XLON').map((i) => ({ ...i }));
    }
    return FAKE_INSTRUMENTS.map((i) => ({ ...i }));
  }

  async getQuote(symbol: string): Promise<ProviderQuote> {
    this.calls.getQuote += 1;

    const failing = this.options.failingSymbols ?? ['NOQUOTE'];
    if (failing.includes(symbol)) {
      throw new MarketDataUnavailable(`Fake provider: no quote for ${symbol}`);
    }

    const price = FAKE_PRICES[symbol];
    if (!price) {
      throw new MarketDataUnavailable(`Fake provider: unknown symbol ${symbol}`);
    }

    return {
      price,
      currency: null,
      quoteAsOf: this.options.quoteAsOf ?? Date.now(),
      delayMinutes: this.options.delayMinutes ?? 0,
      previousClose: '470.00',
      dayOpen: '475.00',
      dayHigh: '482.00',
      dayLow: '474.00',
    };
  }
}
