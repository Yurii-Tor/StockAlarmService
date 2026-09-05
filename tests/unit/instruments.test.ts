import { describe, expect, it } from 'vitest';
import {
  computeFreshness,
  describeFreshness,
  isCacheFresh,
  REALTIME_MAX_AGE_SECONDS,
} from '../../worker/src/domain/instruments/freshness';
import { exchangeNameForMic } from '../../worker/src/domain/instruments/exchanges';
import { buildDraft, type UserDefaults } from '../../worker/src/app/instruments/draft';
import { buildFtsQuery } from '../../worker/src/adapters/db/instrument-repository';
import type { StoredInstrument } from '../../worker/src/app/ports/instrument-repository';
import type { QuoteView } from '../../worker/src/app/instruments/quotes';

const NOW = 1_788_600_000_000;

describe('quote freshness (§B.2, FR-025)', () => {
  it('calls a fresh real-time quote current, and nothing else', () => {
    const fresh = computeFreshness({ quoteAsOf: NOW - 30_000, hasPrice: true, delayMinutes: 0, now: NOW });
    expect(fresh.freshness).toBe('realtime');
    expect(fresh.mayBeCalledCurrent).toBe(true);

    for (const state of [
      computeFreshness({ quoteAsOf: NOW - 3_600_000, hasPrice: true, delayMinutes: 0, now: NOW }),
      computeFreshness({ quoteAsOf: NOW - 60_000, hasPrice: true, delayMinutes: 15, now: NOW }),
      computeFreshness({ quoteAsOf: null, hasPrice: false, delayMinutes: 0, now: NOW }),
    ]) {
      expect(state.mayBeCalledCurrent).toBe(false);
    }
  });

  it('marks an out-of-hours close as stale, not current', () => {
    // The real case, observed against Finnhub on 2026-09-05: a price is
    // present and the payload looks healthy, but `t` is 6.5 hours behind.
    // Presenting that as "current" is the §B.2 violation this exists to stop.
    const result = computeFreshness({
      quoteAsOf: NOW - 6.5 * 3_600_000,
      hasPrice: true,
      delayMinutes: 0,
      now: NOW,
    });

    expect(result.freshness).toBe('stale');
    expect(result.mayBeCalledCurrent).toBe(false);
    expect(describeFreshness(result, 0)).toBe('last available price, 6h old');
  });

  it('treats a provider-declared delay as delayed rather than stale', () => {
    const result = computeFreshness({
      quoteAsOf: NOW - 10 * 60_000,
      hasPrice: true,
      delayMinutes: 15,
      now: NOW,
    });

    expect(result.freshness).toBe('delayed');
    // §B.2's required provenance clause.
    expect(describeFreshness(result, 15)).toBe('quote delayed 15 min');
  });

  it('marks a delayed feed stale once it exceeds its own declared delay', () => {
    const result = computeFreshness({
      quoteAsOf: NOW - 60 * 60_000,
      hasPrice: true,
      delayMinutes: 15,
      now: NOW,
    });
    expect(result.freshness).toBe('stale');
  });

  it('reports unavailable when there is no price', () => {
    const result = computeFreshness({ quoteAsOf: NOW, hasPrice: false, delayMinutes: 0, now: NOW });
    expect(result.freshness).toBe('unavailable');
    expect(result.ageSeconds).toBeNull();
    expect(describeFreshness(result, 0)).toBe('price unavailable');
  });

  it('does not report a negative age when the provider clock runs ahead', () => {
    const result = computeFreshness({ quoteAsOf: NOW + 5_000, hasPrice: true, delayMinutes: 0, now: NOW });
    expect(result.ageSeconds).toBe(0);
    expect(result.freshness).toBe('realtime');
  });

  it('drives cache TTL from our fetch time, not the provider timestamp', () => {
    // A six-hour-old closing price fetched one second ago is a fresh CACHE
    // entry and a stale QUOTE. Both must be true at once.
    expect(isCacheFresh(NOW - 1_000, NOW, 60)).toBe(true);
    expect(isCacheFresh(NOW - 61_000, NOW, 60)).toBe(false);
  });

  it('places the realtime boundary where documented', () => {
    const atLimit = computeFreshness({
      quoteAsOf: NOW - REALTIME_MAX_AGE_SECONDS * 1000,
      hasPrice: true,
      delayMinutes: 0,
      now: NOW,
    });
    expect(atLimit.freshness).toBe('realtime');

    const pastLimit = computeFreshness({
      quoteAsOf: NOW - (REALTIME_MAX_AGE_SECONDS + 1) * 1000,
      hasPrice: true,
      delayMinutes: 0,
      now: NOW,
    });
    expect(pastLimit.freshness).toBe('stale');
  });
});

describe('MIC to exchange name (OQ-14)', () => {
  it('renders the name criterion 1 asks for, not the MIC', () => {
    // "MSFT ... NASDAQ ... USD" -- nobody recognises XNAS.
    expect(exchangeNameForMic('XNAS')).toBe('NASDAQ');
    expect(exchangeNameForMic('XNYS')).toBe('NYSE');
    expect(exchangeNameForMic('ARCX')).toBe('NYSE Arca');
  });

  it('falls back to the MIC rather than inventing a name', () => {
    expect(exchangeNameForMic('XLON')).toBe('XLON');
    expect(exchangeNameForMic(null)).toBeNull();
  });
});

describe('FTS query building', () => {
  it('neutralises FTS5 operators in user input', () => {
    // An unescaped quote or a bare `NOT` would be a syntax error the user
    // cannot see or explain.
    expect(buildFtsQuery('MSFT')).toBe('"MSFT"*');
    expect(buildFtsQuery('micro soft')).toBe('"micro"* AND "soft"*');
    expect(buildFtsQuery('a"b')).toBe('"a"* AND "b"*');
    expect(buildFtsQuery('NOT (x)')).toBe('"NOT"* AND "x"*');
  });

  it('returns null for input with nothing searchable in it', () => {
    expect(buildFtsQuery('   ')).toBeNull();
    expect(buildFtsQuery('***')).toBeNull();
  });
});

describe('quick-add draft (§C.1, §C.2, §G.2)', () => {
  const instrument: StoredInstrument = {
    id: 'inst-msft',
    provider: 'fake',
    providerInstrumentId: 'MSFT',
    symbol: 'MSFT',
    displayName: 'Microsoft Corporation',
    assetType: 'stock',
    exchange: null,
    mic: 'XNAS',
    currency: 'USD',
    country: 'US',
    isin: null,
    figi: 'BBG000BPH459',
    isMonitorable: true,
    metadataUpdatedAt: NOW,
  };

  const quote: QuoteView = {
    instrumentId: 'inst-msft',
    price: '480.15',
    currency: 'USD',
    quoteAsOf: '2026-09-05T12:35:40Z',
    retrievedAt: '2026-09-05T12:36:00Z',
    delayMinutes: 0,
    freshness: 'realtime',
    ageSeconds: 20,
    mayBeCalledCurrent: true,
    freshnessLabel: 'real-time quote',
    source: 'fake',
    previousClose: '470.00',
    dayOpen: '475.00',
    dayHigh: '482.00',
    dayLow: '474.00',
    cached: false,
  };

  const defaults: UserDefaults = {
    timezone: 'Europe/Bucharest',
    defaultNewItemStatus: 'watching',
    prefillEntryPriceFromLatestQuote: true,
    lastUsedBrokerName: 'Interactive Brokers',
    defaultBrokerName: null,
    defaultReviewPlanMode: 'none',
    defaultReviewChannels: ['in_app'],
  };

  it('fills everything derivable and leaves only quantity for the user', () => {
    const draft = buildDraft({ instrument, quote, intent: 'open', defaults, now: NOW });

    // Criterion 3: date=now, price=latest quote, fees=0, status=open.
    expect(draft.investmentItemDraft.status).toBe('open');
    expect(draft.lotDraft?.entryPrice).toBe('480.15');
    expect(draft.lotDraft?.fees).toBe('0');
    expect(draft.lotDraft?.boughtAt).toBe(draft.investmentItemDraft.createdAt);

    // §C.1: "Quantity defaults to empty and is required."
    expect(draft.lotDraft?.quantity).toBeNull();
    expect(draft.requiredFields).toEqual(['quantity']);

    // §C.2: last-used broker, so the user retypes nothing.
    expect(draft.lotDraft?.brokerName).toBe('Interactive Brokers');

    // FR-043: provenance, so a later reader can tell a quote from a fill.
    expect(draft.lotDraft?.entryPriceSource).toBe('latest_quote');
    expect(draft.lotDraft?.quoteAsOf).toBe('2026-09-05T12:35:40Z');
  });

  it('renders creation time in the user timezone, not UTC', () => {
    const draft = buildDraft({ instrument, quote, intent: 'watching', defaults, now: NOW });
    // Europe/Bucharest is UTC+3 in September, so the offset must be present
    // and non-zero -- a bare Z would mean the zone was silently dropped.
    expect(draft.investmentItemDraft.createdAt).toMatch(/\+03:00$/);
  });

  it('creates no lot when the user is only watching (FR-042)', () => {
    const draft = buildDraft({ instrument, quote, intent: 'watching', defaults, now: NOW });
    expect(draft.lotDraft).toBeNull();
    expect(draft.investmentItemDraft.status).toBe('watching');
  });

  it('resolves the exchange name for criterion 1', () => {
    const draft = buildDraft({ instrument, quote, intent: 'watching', defaults, now: NOW });
    expect(draft.investmentItemDraft.exchange).toBe('NASDAQ');
    expect(draft.investmentItemDraft.currency).toBe('USD');
  });

  it('refuses to invent an entry price when no quote was available', () => {
    // Prefilling from an unavailable quote would write a fabricated number
    // into a purchase record -- the one place a wrong default really costs.
    const unavailable: QuoteView = {
      ...quote,
      price: null,
      quoteAsOf: null,
      freshness: 'unavailable',
      mayBeCalledCurrent: false,
    };

    const draft = buildDraft({ instrument, quote: unavailable, intent: 'open', defaults, now: NOW });

    expect(draft.lotDraft?.entryPrice).toBeNull();
    expect(draft.lotDraft?.entryPriceSource).toBe('manual');
    expect(draft.requiredFields).toEqual(['quantity', 'entryPrice']);
  });

  it('honours the user preference to not prefill from the quote', () => {
    const draft = buildDraft({
      instrument,
      quote,
      intent: 'open',
      defaults: { ...defaults, prefillEntryPriceFromLatestQuote: false },
      now: NOW,
    });
    expect(draft.lotDraft?.entryPrice).toBeNull();
    expect(draft.lotDraft?.entryPriceSource).toBe('manual');
  });

  it('lets the request override the account prefill preference', () => {
    const draft = buildDraft({
      instrument,
      quote,
      intent: 'open',
      defaults: { ...defaults, prefillEntryPriceFromLatestQuote: false },
      now: NOW,
      useLatestQuoteAsEntryPrice: true,
    });
    expect(draft.lotDraft?.entryPrice).toBe('480.15');
  });

  it('carries monitorability through so targets can be blocked (§B.3)', () => {
    const draft = buildDraft({
      instrument: { ...instrument, isMonitorable: false },
      quote,
      intent: 'watching',
      defaults,
      now: NOW,
    });
    expect(draft.investmentItemDraft.isMonitorable).toBe(false);
  });
});
