import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { KvInstrumentDirectory } from '../../worker/src/adapters/cache/kv-instrument-directory';
import { FakeMarketDataProvider } from '../../worker/src/adapters/marketdata/fake';
import { refreshInstrumentDirectory } from '../../worker/src/app/instruments/directory-refresh';
import { FixedClock } from '../../worker/src/domain/time/clock';

/**
 * Proves acceptance criteria 1, 2 and 3 against the on-demand architecture:
 * live provider search, a KV directory for venue metadata, and **no D1 write
 * anywhere in the flow**.
 *
 * That last property is the point. The previous design kept ~31,000
 * instruments in D1, cost 177,888 billable writes to seed, and took the whole
 * Cloudflare account offline for four hours.
 */

const ORIGIN = 'http://localhost:8787';
const NOW = 1_788_600_000_000;

async function resetAll() {
  for (const t of [
    'sessions',
    'accounts',
    'verifications',
    'user_settings',
    'users',
    'instruments',
  ]) {
    await env.DB.prepare(`delete from ${t}`).run();
  }
  const { keys } = await env.CACHE.list();
  await Promise.all(keys.map((k) => env.CACHE.delete(k.name)));
}

/** Both exchanges, so the duplicate-ticker fixture has metadata on each side. */
async function seedDirectory(exchanges: readonly string[] = ['US', 'L']) {
  return refreshInstrumentDirectory(
    new FakeMarketDataProvider(),
    new KvInstrumentDirectory(env.CACHE),
    new FixedClock(NOW),
    exchanges,
  );
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
  await resetAll();
  await seedDirectory();
  cookie = await signIn();
});

describe('directory refresh (replaces the D1 sync that caused the outage)', () => {
  it('writes shards to KV and nothing at all to D1', async () => {
    await resetAll();
    const report = await seedDirectory();

    expect(report.failed).toBe(false);
    expect(report.entries).toBeGreaterThan(0);
    expect(report.shardsWritten).toBeGreaterThan(0);

    // The whole point: the searchable directory costs zero D1 rows.
    const rows = await env.DB.prepare(`select count(*) as c from instruments`).first<{
      c: number;
    }>();
    expect(rows!.c).toBe(0);
  });

  it('writes nothing on a second, unchanged refresh', async () => {
    const second = await seedDirectory();

    // Rewriting every shard nightly would spend the KV budget (1,000
    // writes/day) re-storing identical data -- the same mistake that caused
    // the D1 outage, in a different store.
    expect(second.shardsWritten).toBe(0);
    expect(second.kvWrites).toBe(0);
    expect(second.shardsUnchanged).toBe(second.shards);
  });

  it('leaves the existing directory intact when the provider fails', async () => {
    const failing = {
      name: 'fake',
      search: async () => [],
      listInstruments: async () => {
        throw new Error('provider down');
      },
      getQuote: async () => {
        throw new Error('provider down');
      },
    };

    const report = await refreshInstrumentDirectory(
      failing as never,
      new KvInstrumentDirectory(env.CACHE),
      new FixedClock(NOW),
      ['US'],
    );
    expect(report.failed).toBe(true);

    // A partial refresh would delete every symbol of the failed exchange,
    // because refresh replaces shard contents. Search must keep working.
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=MSFT`, {
      headers: { cookie },
    });
    const body = (await res.json()) as { results: Array<{ exchange: string }> };
    expect(body.results[0]!.exchange).toBe('NASDAQ');
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

    const body = (await res.json()) as { results: Array<Record<string, unknown>> };
    const msft = body.results[0]!;

    // Acceptance criterion 1, from a live search plus KV metadata.
    expect(msft['symbol']).toBe('MSFT');
    expect(msft['displayName']).toBe('Microsoft Corporation');
    expect(msft['exchange']).toBe('NASDAQ');
    expect(msft['currency']).toBe('USD');
    expect(msft['secondaryLine']).toBe('NASDAQ · Stock · USD');

    // The reference needs no stored row.
    expect(msft['instrumentRef']).toBe('fake:MSFT');
  });

  it('costs no database writes', async () => {
    await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=MSFT`, { headers: { cookie } });
    await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=VOD`, { headers: { cookie } });

    const rows = await env.DB.prepare(`select count(*) as c from instruments`).first<{
      c: number;
    }>();
    expect(rows!.c).toBe(0);
  });

  it('flags a duplicate ticker across venues instead of picking one', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=VOD`, {
      headers: { cookie },
    });
    const body = (await res.json()) as {
      results: Array<{ symbol: string; currency: string | null; isAmbiguousSymbol: boolean }>;
      requiresDisambiguation: boolean;
    };

    const vod = body.results.filter((r) => r.symbol === 'VOD' || r.symbol === 'VOD.L');
    expect(vod).toHaveLength(2);

    // Venue suffixes make this detectable without a local index: VOD and
    // VOD.L share a base ticker but are different instruments.
    expect(vod.map((r) => r.currency).sort()).toEqual(['GBP', 'USD']);
    expect(vod.every((r) => r.isAmbiguousSymbol)).toBe(true);
    expect(body.requiresDisambiguation).toBe(true);
  });

  it('does not flag ambiguity for a unique ticker', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=AAPL`, {
      headers: { cookie },
    });
    const body = (await res.json()) as { requiresDisambiguation: boolean };
    expect(body.requiresDisambiguation).toBe(false);
  });

  it('still returns a symbol missing from the directory, marked unknown', async () => {
    // A venue we do not sync. Showing it honestly beats hiding it or
    // inventing a currency (§B.2, §B.3).
    const { keys } = await env.CACHE.list();
    await Promise.all(keys.map((k) => env.CACHE.delete(k.name)));
    await seedDirectory(['US']);

    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/search?q=VOD`, {
      headers: { cookie },
    });
    const body = (await res.json()) as {
      results: Array<{
        symbol: string;
        metadataKnown: boolean;
        secondaryLine: string;
        isMonitorable: boolean;
      }>;
    };

    const london = body.results.find((r) => r.symbol === 'VOD.L')!;
    expect(london.metadataKnown).toBe(false);
    expect(london.secondaryLine).toBe('Venue and currency unknown');
    // §B.3: unresolvable metadata blocks price targets, not reminders.
    expect(london.isMonitorable).toBe(false);
  });
});

describe('GET /instruments/:ref/quote (§B.2, §B.3)', () => {
  it('returns a price with provenance and freshness', async () => {
    const res = await SELF.fetch(
      `${ORIGIN}/api/v1/instruments/${encodeURIComponent('fake:MSFT')}/quote`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);

    const q = (await res.json()) as Record<string, unknown>;
    expect(q['price']).toBe('480.15');
    expect(q['currency']).toBe('USD');
    expect(q['freshness']).toBe('realtime');
    expect(q['instrumentRef']).toBe('fake:MSFT');
  });

  it('reports price unavailable without losing the instrument', async () => {
    const res = await SELF.fetch(
      `${ORIGIN}/api/v1/instruments/${encodeURIComponent('fake:NOQUOTE')}/quote`,
      { headers: { cookie } },
    );

    expect(res.status).toBe(200);
    const q = (await res.json()) as Record<string, unknown>;
    expect(q['price']).toBeNull();
    expect(q['freshness']).toBe('unavailable');
    expect(q['mayBeCalledCurrent']).toBe(false);
  });

  it('rejects a malformed reference', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/instruments/nonsense/quote`, {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });
});

describe('POST /investment-items/draft-from-instrument (§G.2)', () => {
  async function draft(body: Record<string, unknown>) {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/investment-items/draft-from-instrument`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, never> };
  }

  it('prefills everything derivable when the user says "I bought it"', async () => {
    const { status, body } = await draft({ instrumentRef: 'fake:MSFT', intent: 'open' });
    expect(status).toBe(200);

    const item = body['investmentItemDraft'] as unknown as Record<string, unknown>;
    const lot = body['lotDraft'] as unknown as Record<string, unknown>;

    expect(item['symbol']).toBe('MSFT');
    expect(item['exchange']).toBe('NASDAQ');
    expect(item['currency']).toBe('USD');
    expect(item['status']).toBe('open');

    expect(lot['entryPrice']).toBe('480.15');
    expect(lot['fees']).toBe('0');
    expect(lot['quantity']).toBeNull();
    expect(body['requiredFields']).toEqual(['quantity']);
  });

  it('creates no lot when only watching', async () => {
    const { body } = await draft({ instrumentRef: 'fake:MSFT', intent: 'watching' });
    expect(body['lotDraft']).toBeNull();
  });

  it('asks for a price when no quote was available', async () => {
    const { body } = await draft({ instrumentRef: 'fake:NOQUOTE', intent: 'open' });
    const lot = body['lotDraft'] as unknown as Record<string, unknown>;

    expect(lot['entryPrice']).toBeNull();
    expect(lot['entryPriceSource']).toBe('manual');
    expect(body['requiredFields']).toEqual(['quantity', 'entryPrice']);
  });

  it('persists nothing, in any table', async () => {
    await draft({ instrumentRef: 'fake:MSFT', intent: 'open' });

    for (const table of ['investment_items', 'lots', 'instruments']) {
      const row = await env.DB.prepare(`select count(*) as c from ${table}`).first<{ c: number }>();
      expect(row!.c, table).toBe(0);
    }
  });

  it('rejects an unknown time zone rather than substituting one', async () => {
    const { status } = await draft({
      instrumentRef: 'fake:MSFT',
      intent: 'open',
      timezone: 'Mars/Olympus_Mons',
    });
    expect(status).toBe(400);
  });

  it('requires an instrumentRef', async () => {
    const { status } = await draft({ intent: 'open' });
    expect(status).toBe(400);
  });
});
