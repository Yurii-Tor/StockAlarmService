import type { MarketDataProvider } from '../../app/ports/market-data';
import { FinnhubMarketDataProvider } from './finnhub';
import { FakeMarketDataProvider } from './fake';

/**
 * Selects the market-data adapter (spec §B: "the configured provider").
 *
 * `auto` (the default) picks Finnhub when an API key is present and the fake
 * otherwise. That ordering matters: tests and fresh checkouts have no key and
 * must get deterministic fixtures, while production has one and must not
 * silently serve fixture prices. Setting `fake` explicitly always wins, so
 * the real provider can be switched off without removing the key.
 *
 * A quote from the fake always carries `source: "fake"`, so fixture data can
 * never be mistaken for market data.
 */
export function createProvider(env: {
  MARKET_DATA_PROVIDER?: string;
  FINNHUB_API_KEY?: string;
}): MarketDataProvider {
  const configured = env.MARKET_DATA_PROVIDER ?? 'auto';

  if (configured === 'fake') return new FakeMarketDataProvider();

  if (configured === 'finnhub') {
    if (!env.FINNHUB_API_KEY) {
      // Explicitly asking for Finnhub without a key is a misconfiguration,
      // not a reason to quietly serve fixtures.
      throw new Error(
        'MARKET_DATA_PROVIDER=finnhub but FINNHUB_API_KEY is not set. ' +
          'Set the secret, or use "fake"/"auto".',
      );
    }
    return new FinnhubMarketDataProvider(env.FINNHUB_API_KEY);
  }

  return env.FINNHUB_API_KEY
    ? new FinnhubMarketDataProvider(env.FINNHUB_API_KEY)
    : new FakeMarketDataProvider();
}

export { FinnhubMarketDataProvider, FakeMarketDataProvider };
