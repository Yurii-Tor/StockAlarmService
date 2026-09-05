import {
  computeFreshness,
  describeFreshness,
  isCacheFresh,
  type QuoteFreshness,
} from '../../domain/instruments/freshness';
import type { Clock } from '../../domain/time/clock';
import { toIsoInstant } from '../../domain/time/format';
import { MarketDataUnavailable, type MarketDataProvider } from '../ports/market-data';
import type { CachedQuote, CallBudget, QuoteCache } from '../ports/quote-cache';
import type { StoredInstrument } from '../ports/instrument-repository';

/**
 * Quote retrieval (§B.2, §B.3).
 *
 * Two rules drive the whole module:
 *
 *  1. Never present data as more current than it is (§B.2). Freshness is
 *     computed from the provider's as-of time and returned alongside every
 *     price, so no caller can accidentally omit it.
 *  2. A failed quote must not discard resolved metadata (§B.3). Failure
 *     returns an `unavailable` view of a known instrument, never an error
 *     that collapses the whole selection.
 */

export interface QuoteView {
  instrumentId: string;
  price: string | null;
  currency: string | null;
  /** ISO-8601 of the PROVIDER's as-of time. Null when unavailable. */
  quoteAsOf: string | null;
  /** ISO-8601 of our fetch time. Exposed for cache diagnosis. */
  retrievedAt: string;
  delayMinutes: number;
  freshness: QuoteFreshness;
  ageSeconds: number | null;
  /** True only for `realtime`. Clients may say "current" iff this is true. */
  mayBeCalledCurrent: boolean;
  /** Ready-made provenance clause, e.g. "quote delayed 15 min". */
  freshnessLabel: string;
  source: string;
  previousClose: string | null;
  dayOpen: string | null;
  dayHigh: string | null;
  dayLow: string | null;
  /** True when this came from cache rather than a provider call. */
  cached: boolean;
}

/** Quotes go stale fast during trading; the cache exists to protect budget. */
export const QUOTE_TTL_SECONDS = 60;

/** Finnhub free tier is ~60 calls/minute. Stay under it deliberately. */
export const PROVIDER_CALLS_PER_MINUTE = 50;

function toView(
  instrument: StoredInstrument,
  cached: CachedQuote,
  now: number,
  fromCache: boolean,
): QuoteView {
  const result = computeFreshness({
    quoteAsOf: cached.quoteAsOf,
    hasPrice: cached.price !== null,
    delayMinutes: cached.delayMinutes,
    now,
  });

  return {
    instrumentId: instrument.id,
    price: cached.price,
    // The quote endpoint does not return a currency, so it comes from the
    // instrument's own metadata rather than being guessed or left blank.
    currency: cached.currency ?? instrument.currency,
    quoteAsOf: cached.quoteAsOf === null ? null : toIsoInstant(cached.quoteAsOf),
    retrievedAt: toIsoInstant(cached.retrievedAt),
    delayMinutes: cached.delayMinutes,
    freshness: result.freshness,
    ageSeconds: result.ageSeconds,
    mayBeCalledCurrent: result.mayBeCalledCurrent,
    freshnessLabel: describeFreshness(result, cached.delayMinutes),
    source: cached.source,
    previousClose: cached.previousClose,
    dayOpen: cached.dayOpen,
    dayHigh: cached.dayHigh,
    dayLow: cached.dayLow,
    cached: fromCache,
  };
}

function unavailableView(
  instrument: StoredInstrument,
  now: number,
  source: string,
): QuoteView {
  // §B.3: metadata is retained and the price shows as unavailable with a
  // retry. The instrument selection survives a provider outage.
  const result = computeFreshness({ quoteAsOf: null, hasPrice: false, delayMinutes: 0, now });
  return {
    instrumentId: instrument.id,
    price: null,
    currency: instrument.currency,
    quoteAsOf: null,
    retrievedAt: toIsoInstant(now),
    delayMinutes: 0,
    freshness: result.freshness,
    ageSeconds: null,
    mayBeCalledCurrent: false,
    freshnessLabel: describeFreshness(result, 0),
    source,
    previousClose: null,
    dayOpen: null,
    dayHigh: null,
    dayLow: null,
    cached: false,
  };
}

export interface QuoteDeps {
  provider: MarketDataProvider;
  cache: QuoteCache;
  clock: Clock;
  budget?: CallBudget;
}

export async function getQuote(
  deps: QuoteDeps,
  instrument: StoredInstrument,
  options: { forceRefresh?: boolean } = {},
): Promise<QuoteView> {
  const { provider, cache, clock, budget } = deps;
  const now = clock.now();

  if (!options.forceRefresh) {
    const cached = await cache.get(instrument.id);
    // TTL is measured from OUR fetch time, not the provider's as-of time:
    // re-fetching a six-hour-old closing price every minute would spend
    // budget to learn nothing.
    if (cached && isCacheFresh(cached.retrievedAt, now, QUOTE_TTL_SECONDS)) {
      return toView(instrument, cached, now, true);
    }
  }

  if (budget && !(await budget.tryConsume(provider.name, PROVIDER_CALLS_PER_MINUTE))) {
    // Over budget: serve a stale cached value if one exists rather than
    // hammering the provider into 429s that look like an outage.
    const cached = await cache.get(instrument.id);
    if (cached) return toView(instrument, cached, now, true);
    return unavailableView(instrument, now, provider.name);
  }

  try {
    const fetched = await provider.getQuote(instrument.providerInstrumentId);
    const record: CachedQuote = {
      price: fetched.price,
      currency: fetched.currency ?? instrument.currency,
      quoteAsOf: fetched.quoteAsOf,
      retrievedAt: now,
      delayMinutes: fetched.delayMinutes,
      source: provider.name,
      previousClose: fetched.previousClose,
      dayOpen: fetched.dayOpen,
      dayHigh: fetched.dayHigh,
      dayLow: fetched.dayLow,
    };
    await cache.set(instrument.id, record, QUOTE_TTL_SECONDS);
    return toView(instrument, record, now, false);
  } catch (error) {
    if (!(error instanceof MarketDataUnavailable)) throw error;

    // Prefer a stale price clearly labelled stale over no price at all --
    // but never relabel it as current. That is the whole point of §B.2.
    const cached = await cache.get(instrument.id);
    if (cached) return toView(instrument, cached, now, true);
    return unavailableView(instrument, now, provider.name);
  }
}
