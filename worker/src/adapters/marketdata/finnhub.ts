import {
  MarketDataUnavailable,
  type MarketDataProvider,
  type ProviderInstrument,
  type ProviderQuote,
} from '../../app/ports/market-data';

/**
 * Finnhub adapter.
 *
 * Field availability verified against a live free-tier key on 2026-09-05
 * (docs/02-assumptions.md §E). Two findings shape this code:
 *
 *  - `/search` returns only symbol, description, displaySymbol and type. No
 *    exchange, MIC or currency, so it CANNOT satisfy acceptance criterion 1.
 *    It is therefore not used at all; search runs locally over the synced
 *    universe from `/stock/symbol`, which does carry mic and currency.
 *  - `isin` came back empty on all 30,991 US rows -- entitlement-gated. It is
 *    read anyway (so a paid tier lights it up automatically) but must be
 *    treated as normally absent.
 */

const BASE_URL = 'https://finnhub.io/api/v1';

interface FinnhubSymbolRow {
  symbol?: string;
  displaySymbol?: string;
  description?: string;
  type?: string;
  mic?: string;
  currency?: string;
  figi?: string;
  isin?: string;
}

interface FinnhubQuoteResponse {
  c?: number; // current
  d?: number; // change
  dp?: number; // change percent
  h?: number; // day high
  l?: number; // day low
  o?: number; // day open
  pc?: number; // previous close
  t?: number; // provider timestamp, epoch SECONDS
}

/** Finnhub `type` values mapped onto our asset-type vocabulary. */
function mapAssetType(type: string | undefined): string {
  const t = (type ?? '').toLowerCase();
  if (t.includes('etf')) return 'etf';
  if (t.includes('fund')) return 'fund';
  if (t.includes('bond')) return 'bond';
  if (t.includes('warrant')) return 'warrant';
  if (t.includes('right')) return 'right';
  if (t.includes('reit')) return 'reit';
  if (t.includes('common stock') || t === 'stock' || t === 'equity') return 'stock';
  return t ? 'other' : 'stock';
}

export class FinnhubMarketDataProvider implements MarketDataProvider {
  readonly name = 'finnhub';

  constructor(private readonly apiKey: string) {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('token', this.apiKey);

    let response: Response;
    try {
      response = await fetch(url, { headers: { accept: 'application/json' } });
    } catch (cause) {
      throw new MarketDataUnavailable('Finnhub request failed', cause, true);
    }

    if (response.status === 429) {
      throw new MarketDataUnavailable('Finnhub rate limit exceeded', undefined, true);
    }
    if (response.status === 401 || response.status === 403) {
      // Not retryable: retrying a bad key just burns budget and hides the
      // real problem behind generic failure noise.
      throw new MarketDataUnavailable('Finnhub rejected the API key', undefined, false);
    }
    if (!response.ok) {
      throw new MarketDataUnavailable(`Finnhub returned ${response.status}`, undefined, true);
    }

    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new MarketDataUnavailable('Finnhub returned unreadable JSON', cause, true);
    }
  }

  async listInstruments(exchange: string): Promise<ProviderInstrument[]> {
    const rows = await this.get<FinnhubSymbolRow[]>('/stock/symbol', { exchange });

    if (!Array.isArray(rows)) {
      throw new MarketDataUnavailable('Finnhub returned a non-array symbol list');
    }

    return rows
      .filter((r): r is FinnhubSymbolRow & { symbol: string } => Boolean(r.symbol))
      .map((r) => ({
        // Symbol is unique within a Finnhub exchange listing and is what the
        // quote endpoint takes, so it doubles as the provider instrument id.
        providerInstrumentId: r.symbol,
        symbol: r.displaySymbol?.trim() || r.symbol,
        displayName: r.description?.trim() || r.symbol,
        assetType: mapAssetType(r.type),
        mic: r.mic?.trim() || null,
        currency: r.currency?.trim() || null,
        country: null,
        // Empty string on the free tier; normalise to null so "absent" has
        // exactly one representation.
        isin: r.isin?.trim() || null,
        figi: r.figi?.trim() || null,
        isMonitorable: true,
      }));
  }

  async getQuote(symbol: string): Promise<ProviderQuote> {
    const q = await this.get<FinnhubQuoteResponse>('/quote', { symbol });

    // Finnhub answers an unknown symbol with a 200 and zeroes rather than an
    // error, so an all-zero payload means "no data", not "worth nothing".
    const hasData = typeof q.c === 'number' && q.c !== 0;
    if (!hasData) {
      throw new MarketDataUnavailable(`No quote data for ${symbol}`, undefined, true);
    }

    return {
      price: String(q.c),
      currency: null, // Not returned here; taken from instrument metadata.
      // `t` is epoch SECONDS. Multiplying is not cosmetic: treating it as
      // milliseconds dates every quote to 1970 and makes freshness meaningless.
      quoteAsOf: typeof q.t === 'number' && q.t > 0 ? q.t * 1000 : null,
      // Finnhub declares no delay field. US equities are real-time on this
      // tier, so freshness is derived from the age of `t` instead -- which is
      // what correctly marks an out-of-hours close as stale rather than current.
      delayMinutes: 0,
      previousClose: typeof q.pc === 'number' && q.pc !== 0 ? String(q.pc) : null,
      dayOpen: typeof q.o === 'number' && q.o !== 0 ? String(q.o) : null,
      dayHigh: typeof q.h === 'number' && q.h !== 0 ? String(q.h) : null,
      dayLow: typeof q.l === 'number' && q.l !== 0 ? String(q.l) : null,
    };
  }
}
