import type { Quote } from '../api/types';
import { formatAsOf } from '../lib/format';

/**
 * Quote provenance and freshness (§B.2).
 *
 * §B.2 states an absolute: the system "must never label stale or unavailable
 * data as 'current'". The decision is not re-derived here -- the server sends
 * `mayBeCalledCurrent`, and this component obeys it. Recomputing freshness in
 * the client would create a second implementation that drifts, and the one
 * the user reads would not be the one the alerts use.
 */

const TONE: Record<Quote['freshness'], string> = {
  realtime: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  delayed: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  stale: 'bg-orange-500/12 text-orange-700 dark:text-orange-300',
  unavailable: 'bg-red-500/12 text-red-700 dark:text-red-300',
};

/**
 * Wording is deliberately narrow. Only `realtime` may say "Current"; every
 * other state names what it actually is. NFR-09 also applies: the state is
 * carried by the words, not by the colour alone.
 */
const LABEL: Record<Quote['freshness'], string> = {
  realtime: 'Current',
  delayed: 'Delayed',
  stale: 'Last close',
  unavailable: 'Unavailable',
};

export function FreshnessBadge({ quote }: { quote: Quote }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE[quote.freshness]}`}
      title={quote.freshnessLabel}
    >
      {LABEL[quote.freshness]}
    </span>
  );
}

/**
 * The provenance line §B.2 asks for:
 *
 *     Last price: $480.15
 *     NASDAQ · USD · quote delayed 15 min · as of 2026-09-03 12:35 EEST
 */
export function QuoteProvenance({
  quote,
  exchange,
  timeZone,
}: {
  quote: Quote;
  exchange: string | null;
  timeZone: string;
}) {
  const asOf = formatAsOf(quote.quoteAsOf, timeZone);

  const parts = [exchange, quote.currency, quote.freshnessLabel, asOf ? `as of ${asOf}` : null]
    .filter((p): p is string => Boolean(p));

  return (
    <p className="text-xs text-(--color-ink-muted) leading-relaxed">{parts.join(' · ')}</p>
  );
}

export function PriceLine({ quote }: { quote: Quote }) {
  if (quote.price === null) {
    return (
      <p className="text-lg font-semibold text-(--color-ink-muted)">Price unavailable</p>
    );
  }

  // "Last price" rather than "Current price" unless the server allows it.
  const prefix = quote.mayBeCalledCurrent ? 'Current price' : 'Last price';

  return (
    <p className="text-2xl font-semibold tnum">
      <span className="mr-2 text-xs font-normal uppercase tracking-wide text-(--color-ink-muted)">
        {prefix}
      </span>
      {quote.price}
      {quote.currency ? <span className="ml-1 text-base font-normal">{quote.currency}</span> : null}
    </p>
  );
}
