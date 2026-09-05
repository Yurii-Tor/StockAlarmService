/**
 * Quote freshness (FR-024, FR-025, FR-026).
 *
 * §B.2 states an absolute: the system "must never label stale or unavailable
 * data as 'current'". This module is where that is decided, as a pure
 * function of two timestamps, so the rule cannot be quietly relaxed at a call
 * site.
 *
 * The two timestamps are not interchangeable:
 *   quoteAsOf   -- the PROVIDER's own as-of time. What the user is shown.
 *   retrievedAt -- when WE fetched. What cache TTL is computed from.
 *
 * Collapsing them is exactly how stale data ends up labelled current: a quote
 * fetched one second ago can easily be six hours old, which is what Finnhub
 * returns outside market hours (verified 2026-09-05: `t` was 6.5 hours behind
 * while a price was still present).
 */

export type QuoteFreshness = 'realtime' | 'delayed' | 'stale' | 'unavailable';

export interface FreshnessInput {
  /** Provider's as-of time, epoch ms. Null when no usable quote exists. */
  quoteAsOf: number | null;
  /** Whether a usable price accompanied the quote. */
  hasPrice: boolean;
  /** Provider-declared delay in minutes; 0 when the feed is real-time. */
  delayMinutes: number;
  /** Current time, epoch ms, from the Clock port. */
  now: number;
}

export interface FreshnessResult {
  freshness: QuoteFreshness;
  /** How far behind `now` the provider's as-of time is, in seconds. */
  ageSeconds: number | null;
  /** True only for `realtime`. The UI may use the word "current" iff this. */
  mayBeCalledCurrent: boolean;
}

/** A real-time feed is only "current" while it is genuinely fresh. */
export const REALTIME_MAX_AGE_SECONDS = 120;

/** Grace beyond a declared delay before a delayed feed counts as stale. */
export const DELAYED_GRACE_SECONDS = 300;

export function computeFreshness(input: FreshnessInput): FreshnessResult {
  const { quoteAsOf, hasPrice, delayMinutes, now } = input;

  if (!hasPrice || quoteAsOf === null) {
    return { freshness: 'unavailable', ageSeconds: null, mayBeCalledCurrent: false };
  }

  // A provider clock slightly ahead of ours must not read as "very fresh"
  // in one direction and negative age in the other; clamp at zero.
  const ageSeconds = Math.max(0, Math.round((now - quoteAsOf) / 1000));

  if (delayMinutes > 0) {
    const tolerated = delayMinutes * 60 + DELAYED_GRACE_SECONDS;
    return ageSeconds <= tolerated
      ? { freshness: 'delayed', ageSeconds, mayBeCalledCurrent: false }
      : { freshness: 'stale', ageSeconds, mayBeCalledCurrent: false };
  }

  if (ageSeconds <= REALTIME_MAX_AGE_SECONDS) {
    return { freshness: 'realtime', ageSeconds, mayBeCalledCurrent: true };
  }

  // Has a price, but too old to present as current. This is the common case
  // outside market hours, and the one §B.2 is really about.
  return { freshness: 'stale', ageSeconds, mayBeCalledCurrent: false };
}

/**
 * Human-readable provenance for §B.2's required display:
 *
 *     NASDAQ · USD · quote delayed 15 min · as of 2026-09-03 12:35 EEST
 *
 * Returns the middle clause only; the caller supplies venue, currency and the
 * formatted timestamp, which are presentation concerns.
 */
export function describeFreshness(result: FreshnessResult, delayMinutes: number): string {
  switch (result.freshness) {
    case 'realtime':
      return 'real-time quote';
    case 'delayed':
      return `quote delayed ${delayMinutes} min`;
    case 'stale':
      return result.ageSeconds !== null && result.ageSeconds >= 3600
        ? `last available price, ${Math.floor(result.ageSeconds / 3600)}h old`
        : 'last available price';
    case 'unavailable':
      return 'price unavailable';
  }
}

/**
 * Whether a cached quote may be served without re-fetching.
 *
 * Computed from `retrievedAt`, NOT `quoteAsOf`: re-fetching a six-hour-old
 * closing price every 60 seconds would burn the provider budget to learn
 * nothing, so the cache decision and the freshness label are deliberately
 * driven by different clocks.
 */
export function isCacheFresh(retrievedAt: number, now: number, ttlSeconds: number): boolean {
  return now - retrievedAt < ttlSeconds * 1000;
}
