import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { D1InstrumentRepository } from '../../worker/src/adapters/db/instrument-repository';
import { FAKE_INSTRUMENTS } from '../../worker/src/adapters/marketdata/fake';
import { syncInstrumentUniverse } from '../../worker/src/app/instruments/sync';
import { FixedClock } from '../../worker/src/domain/time/clock';

/**
 * Proves acceptance criteria 1, 2 and 3 through the real HTTP surface, with
 * the real schema and the real FTS5 index.
 */

const ORIGIN = 'http://localhost:8787';
const NOW = 1_788_600_000_000;

async function resetDb() {
  for (const t of [
    'instruments_fts',
    'instruments',
    'sessions',
    'accounts',
    'verifications',
    'user_settings',
    'users',
  ]) {
    await env.DB.prepare(`delete from ${t}`).run();
  }
}

async function seedInstruments() {
  const repo = new D1InstrumentRepository(env.DB);
  return repo.upsertChanged('fake', FAKE_INSTRUMENTS, NOW);
}

async function signIn(email = 'investor@example.com'): Promise<string> {
  await SELF.fetch(`${ORIGIN}/api/v1/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, callbackURL: '/' }),
  });
  const row = await env.DB.prepare(
    `select identifier from verifications order by created_at desc limit 1`,
  ).first<{ identifier: string }>();

  const verified = await SELF.fetch(
    `${ORIGIN}/api/v1/auth/magic-link/verify?token=${row!.identifier}&callbackURL=/`,
    { redirect: 'manual' },
  );
  return verified.headers.getSetCookie().find((c) => c.includes('session_token'))!.split(';')[0]!;
}

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await seedInstruments();
  cookie = await signIn();
});

describe('instrument sync', () => {
  it('inserts on first run and writes nothing on an unchanged second run', async () => {
    // A full US universe is ~31,000 rows against a 100k/day D1 write budget,
    // so a truncate-and-reload nightly sync would burn a third of it to
    // change nothing (NFR-06).
    const second = await seedInstruments();

    expect(second.seen).toBe(FAKE_INSTRUMENTS.length);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(FAKE_INSTRUMENTS.length);
  });

  it('updates only the rows that actually changed', async () => {
    const changed = FAKE_INSTRUMENTS.map((i) =>
      i.symbol === 'MSFT' ? { ...i, displayName: 'Microsoft Corp (renamed)' } : i,
    );
    const repo = new D1InstrumentRepository(env.DB);
    const outcome = await repo.upsertChanged('fake', changed, NOW + 1000);

    expect(outcome.updated).toBe(1);
    expect(outcome.unchanged).toBe(FAKE_INSTRUMENTS.length - 1);
  });

  it('leaves the existing universe intact when the provider fails', async () => {
    const failing = {
      name: 'fake',
      listInstruments: async () => {
        throw new Error('provider down');
      },
      getQuote: async () => {
        throw new Error('provider down');
      },
    };

    const report = await syncInstrumentUniverse(
      failing as never,
      new D1InstrumentRepository(env.DB),
      new FixedClock(NOW),
      'US',
    );

    expect(report.failed).toBe(true);

    // Stale metadata still supports search; an emptied table would not.
    const remaining = await env.DB.prepare(
      `select count(*) as c from instruments`,
    ).first<{ c: number }>();
    expect(remaining!.c).toBe(FAKE_INSTRUMENTS.length);
  });
});

describe('GET /instruments/search (§B.1)', () => {
  it('requires a session', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=MSFT`);
    expect(res.status).toBe(401);
  });

  it('returns name, NASDAQ, stock type and USD for MSFT', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=MSFT`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      results: Array<Record<string, unknown>>;
      requiresDisambiguation: boolean;
    };
    const msft = body.results[0]!;

    // Acceptance criterion 1, field by field.
    expect(msft['symbol']).toBe('MSFT');
    expect(msft['displayName']).toBe('Microsoft Corporation');
    expect(msft['exchange']).toBe('NASDAQ');
    expect(msft['assetType']).toBe('stock');
    expect(msft['currency']).toBe('USD');

    // §B.1's two-line result format, assembled server-side so every client
    // renders the same thing.
    expect(msft['primaryLine']).toBe('MSFT — Microsoft Corporation');
    expect(msft['secondaryLine']).toBe('NASDAQ · Stock · USD');
  });

  it('flags a duplicate ticker across venues instead of picking one', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=VOD`, {
      headers: { cookie },
    });
    const body = (await res.json()) as {
      results: Array<{ symbol: string; mic: string; currency: string; isAmbiguousSymbol: boolean }>;
      requiresDisambiguation: boolean;
    };

    const vod = body.results.filter((r) => r.symbol === 'VOD');
    expect(vod).toHaveLength(2);
    expect(vod.map((r) => r.mic).sort()).toEqual(['XLON', 'XNAS']);
    expect(vod.map((r) => r.currency).sort()).toEqual(['GBP', 'USD']);

    // §B.1: "Never automatically assume a ticker is unique across all
    // exchanges." The server states the ambiguity as data so a client cannot
    // silently auto-select the wrong listing.
    expect(vod.every((r) => r.isAmbiguousSymbol)).toBe(true);
    expect(body.requiresDisambiguation).toBe(true);
  });

  it('does not flag ambiguity for a unique ticker', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=AAPL`, {
      headers: { cookie },
    });
    const body = (await res.json()) as {
      results: Array<{ isAmbiguousSymbol: boolean }>;
      requiresDisambiguation: boolean;
    };
    expect(body.requiresDisambiguation).toBe(false);
    expect(body.results[0]!.isAmbiguousSymbol).toBe(false);
  });

  it('matches on company name, not just ticker', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=microsoft`, {
      headers: { cookie },
    });
    const body = (await res.json()) as { results: Array<{ symbol: string }> };
    expect(body.results.map((r) => r.symbol)).toContain('MSFT');
  });

  it('returns an empty result rather than an error for junk input', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=%22%2A%2A%2A`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });
});

describe('GET /instruments/:id/quote (§B.2, §B.3)', () => {
  async function instrumentIdFor(symbol: string): Promise<string> {
    const row = await env.DB.prepare(
      `select id from instruments where symbol = ? limit 1`,
    )
      .bind(symbol)
      .first<{ id: string }>();
    return row!.id;
  }

  it('returns a price with its provenance and freshness', async () => {
    const id = await instrumentIdFor('MSFT');
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/${id}/quote`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const q = (await res.json()) as Record<string, unknown>;
    expect(q['price']).toBe('480.15');
    expect(q['currency']).toBe('USD');
    // FR-024: both timestamps present and distinct in meaning.
    expect(q['quoteAsOf']).toBeTruthy();
    expect(q['retrievedAt']).toBeTruthy();
    expect(q['freshness']).toBe('realtime');
    expect(q['mayBeCalledCurrent']).toBe(true);
  });

  it('keeps the instrument and reports price unavailable when the quote fails', async () => {
    const id = await instrumentIdFor('NOQUOTE');
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/${id}/quote`, {
      headers: { cookie },
    });

    // §B.3: metadata survives, the price does not pretend to exist, and the
    // client is told it may not call anything current.
    expect(res.status).toBe(200);
    const q = (await res.json()) as Record<string, unknown>;
    expect(q['price']).toBeNull();
    expect(q['freshness']).toBe('unavailable');
    expect(q['mayBeCalledCurrent']).toBe(false);
    expect(q['freshnessLabel']).toBe('price unavailable');
    expect(q['instrumentId']).toBe(id);
  });

  it('404s an unknown instrument as problem+json', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/does-not-exist/quote`, {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });
});

describe('POST /investment-items/draft-from-instrument (§G.2)', () => {
  async function instrumentIdFor(symbol: string): Promise<string> {
    const row = await env.DB.prepare(`select id from instruments where symbol = ? limit 1`)
      .bind(symbol)
      .first<{ id: string }>();
    return row!.id;
  }

  async function draft(body: Record<string, unknown>) {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/investment-items/draft-from-instrument`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, never> };
  }

  it('prefills everything derivable when the user says "I bought it"', async () => {
    const instrumentId = await instrumentIdFor('MSFT');
    const { status, body } = await draft({ instrumentId, intent: 'open' });

    expect(status).toBe(200);

    const item = body['investmentItemDraft'] as unknown as Record<string, unknown>;
    const lot = body['lotDraft'] as unknown as Record<string, unknown>;

    // Criterion 2: symbol, name, exchange, currency, type, price, quote
    // timestamp/freshness, and creation time all arrive filled.
    expect(item['symbol']).toBe('MSFT');
    expect(item['name']).toBe('Microsoft Corporation');
    expect(item['exchange']).toBe('NASDAQ');
    expect(item['currency']).toBe('USD');
    expect(item['assetType']).toBe('stock');
    expect(item['createdAt']).toBeTruthy();
    expect(item['status']).toBe('open');

    // Criterion 3: date=now, price=latest quote, fees=0, status=open.
    expect(lot['entryPrice']).toBe('480.15');
    expect(lot['fees']).toBe('0');
    expect(lot['boughtAt']).toBe(item['createdAt']);
    expect(lot['entryPriceSource']).toBe('latest_quote');

    // The single thing the system cannot know.
    expect(lot['quantity']).toBeNull();
    expect(body['requiredFields']).toEqual(['quantity']);
  });

  it('creates no lot when the user is only watching', async () => {
    const instrumentId = await instrumentIdFor('MSFT');
    const { body } = await draft({ instrumentId, intent: 'watching' });

    expect(body['lotDraft']).toBeNull();
    expect((body['investmentItemDraft'] as unknown as Record<string, unknown>)['status']).toBe(
      'watching',
    );
  });

  it('defaults to watching when no intent is supplied (FR-070)', async () => {
    const instrumentId = await instrumentIdFor('MSFT');
    const { body } = await draft({ instrumentId });
    expect((body['investmentItemDraft'] as unknown as Record<string, unknown>)['status']).toBe(
      'watching',
    );
  });

  it('still produces a usable draft when the quote is unavailable', async () => {
    const instrumentId = await instrumentIdFor('NOQUOTE');
    const { status, body } = await draft({ instrumentId, intent: 'open' });

    expect(status).toBe(200);
    const lot = body['lotDraft'] as unknown as Record<string, unknown>;

    // §B.3: the selection survives, and the user is asked for the price
    // rather than handed a fabricated one.
    expect(lot['entryPrice']).toBeNull();
    expect(lot['entryPriceSource']).toBe('manual');
    expect(body['requiredFields']).toEqual(['quantity', 'entryPrice']);
  });

  it('persists nothing', async () => {
    const instrumentId = await instrumentIdFor('MSFT');
    await draft({ instrumentId, intent: 'open' });

    // §G.2 returns a proposal; the commit is a separate request (FR-045).
    const items = await env.DB.prepare(
      `select count(*) as c from investment_items`,
    ).first<{ c: number }>();
    const lots = await env.DB.prepare(`select count(*) as c from lots`).first<{ c: number }>();
    expect(items!.c).toBe(0);
    expect(lots!.c).toBe(0);
  });

  it('rejects an unknown time zone instead of silently substituting one', async () => {
    const instrumentId = await instrumentIdFor('MSFT');
    const { status } = await draft({ instrumentId, intent: 'open', timezone: 'Mars/Olympus_Mons' });

    // A reminder written against an unresolvable zone would fire at the wrong
    // time with no error anywhere (ADR-0003).
    expect(status).toBe(400);
  });

  it('requires an instrumentId', async () => {
    const { status } = await draft({ intent: 'open' });
    expect(status).toBe(400);
  });
});
