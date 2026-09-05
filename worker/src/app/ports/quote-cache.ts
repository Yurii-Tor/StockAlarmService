/**
 * Quote cache port.
 *
 * Quotes live in KV rather than D1 deliberately: a refresh is a cache write,
 * not a domain event, and routing them through D1 would spend the 100k/day
 * row-write budget on data that is disposable by definition (ASM-028).
 */

export interface CachedQuote {
  price: string | null;
  currency: string | null;
  /** The PROVIDER's as-of time (FR-024). */
  quoteAsOf: number | null;
  /** When WE fetched it. Drives TTL, never the displayed freshness. */
  retrievedAt: number;
  delayMinutes: number;
  source: string;
  previousClose: string | null;
  dayOpen: string | null;
  dayHigh: string | null;
  dayLow: string | null;
}

export interface QuoteCache {
  get(instrumentId: string): Promise<CachedQuote | null>;
  set(instrumentId: string, quote: CachedQuote, ttlSeconds: number): Promise<void>;
}

/**
 * Provider call budget.
 *
 * Finnhub's free tier allows roughly 60 calls/minute. Exceeding it returns
 * 429s that look like outages, so the budget is enforced before the call
 * rather than discovered after it.
 */
export interface CallBudget {
  /** Records a call and reports whether it was within budget. */
  tryConsume(provider: string, limitPerMinute: number): Promise<boolean>;
}
