import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { KvInstrumentDirectory } from '../../worker/src/adapters/cache/kv-instrument-directory';
import { FakeMarketDataProvider } from '../../worker/src/adapters/marketdata/fake';
import { refreshInstrumentDirectory } from '../../worker/src/app/instruments/directory-refresh';
import { FixedClock } from '../../worker/src/domain/time/clock';

const ORIGIN = 'http://localhost:8787';
const NOW = 1_788_600_000_000;

async function resetAll() {
  for (const t of [
    'thesis_versions',
    'theses',
    'lots',
    'investment_items',
    'instruments',
    'sessions',
    'accounts',
    'verifications',
    'user_settings',
    'users',
  ]) {
    await env.DB.prepare(`delete from ${t}`).run();
  }
  const { keys } = await env.CACHE.list();
  await Promise.all(keys.map((k) => env.CACHE.delete(k.name)));

  await refreshInstrumentDirectory(
    new FakeMarketDataProvider(),
    new KvInstrumentDirectory(env.CACHE),
    new FixedClock(NOW),
    ['US', 'L'],
  );
}

async function signIn(email: string): Promise<string> {
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
  const cookie = verified.headers
    .getSetCookie()
    .find((c) => c.includes('session_token'))!
    .split(';')[0]!;

  // Creates the settings row, as any authenticated read does.
  await SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { cookie } });
  return cookie;
}

let cookie: string;

beforeEach(async () => {
  await resetAll();
  cookie = await signIn('investor@example.com');
});

async function post(path: string, body: unknown, as = cookie) {
  const res = await SELF.fetch(`${ORIGIN}/api/v1${path}`, {
    method: 'POST',
    headers: { cookie: as, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as never };
}

describe('acceptance criterion 4: saving requires no reminder at all', () => {
  it('saves a watchlist item with no review date and no notification config', async () => {
    const { status, body } = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'watching',
    });

    expect(status).toBe(201);
    expect(body['status']).toBe('watching');
    expect(body['lots']).toEqual([]);

    // §D.1 is explicit that creating an item must never require a review
    // deadline or a push. Nothing scheduling-related may exist.
    for (const table of ['review_reminders', 'review_occurrences', 'notification_events']) {
      const row = await env.DB.prepare(`select count(*) as c from ${table}`).first<{ c: number }>();
      expect(row!.c, table).toBe(0);
    }
  });

  it('saves a purchase with no reminder either', async () => {
    const { status } = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'open',
      lot: { quantity: '25', entryPrice: '480.15' },
    });
    expect(status).toBe(201);

    const reminders = await env.DB.prepare(
      `select count(*) as c from review_reminders`,
    ).first<{ c: number }>();
    expect(reminders!.c).toBe(0);
  });
});

describe('saving a purchase', () => {
  it('stores the item, the lot and the instrument together', async () => {
    const { status, body } = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'open',
      lot: {
        quantity: '25',
        entryPrice: '480.15',
        fees: '1.50',
        brokerName: 'Interactive Brokers',
        entryPriceSource: 'latest_quote',
      },
    });

    expect(status).toBe(201);
    expect(body['symbol']).toBe('MSFT');
    expect(body['exchange']).toBe('NASDAQ');
    expect(body['currency']).toBe('USD');
    expect(body['lots']).toHaveLength(1);
    expect(body['lots'][0]['quantity']).toBe('25');
    expect(body['lots'][0]['entryPriceSource']).toBe('latest_quote');

    // The instrument reaches D1 only now — one row, not thirty thousand.
    const instruments = await env.DB.prepare(
      `select count(*) as c from instruments`,
    ).first<{ c: number }>();
    expect(instruments!.c).toBe(1);
  });

  it('reuses an existing instrument row for a second item', async () => {
    await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'watching',
    });
    await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'open',
      lot: { quantity: '5', entryPrice: '480' },
    });

    // OQ-4 allows the same instrument in two items; it must not duplicate the
    // instrument row, which would also double its write cost.
    const instruments = await env.DB.prepare(
      `select count(*) as c from instruments`,
    ).first<{ c: number }>();
    expect(instruments!.c).toBe(1);
  });

  it('records the last-used broker for next time (§C.2)', async () => {
    await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'open',
      lot: { quantity: '1', entryPrice: '480', brokerName: 'Interactive Brokers' },
    });

    const settings = await env.DB.prepare(
      `select last_used_broker_name as b from user_settings`,
    ).first<{ b: string }>();
    expect(settings!.b).toBe('Interactive Brokers');
  });

  it('rejects a purchase with no quantity, and writes nothing', async () => {
    const { status, body } = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'open',
      lot: { entryPrice: '480.15' },
    });

    expect(status).toBe(422);
    expect(body['errors']).toEqual([
      expect.objectContaining({ field: 'lot.quantity' }),
    ]);

    const items = await env.DB.prepare(
      `select count(*) as c from investment_items`,
    ).first<{ c: number }>();
    expect(items!.c).toBe(0);
  });

  it('rejects a non-numeric quantity rather than coercing it', async () => {
    const { status } = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'open',
      lot: { quantity: '25 shares', entryPrice: '480' },
    });
    expect(status).toBe(422);
  });

  it('computes aggregates with exact decimal arithmetic', async () => {
    const { body } = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'open',
      lot: { quantity: '3', entryPrice: '0.1', fees: '0.2' },
    });

    // 3 x 0.1 = 0.3 exactly. Through a JS float this is
    // 0.30000000000000004, which is not a cost basis anyone wants.
    expect(body['averageEntryPrice']).toBe('0.1');
    expect(body['totalFees']).toBe('0.2');
    expect(body['totalQuantity']).toBe('3');
  });
});

describe('manual assets (§B.3)', () => {
  it('saves an unlisted asset with no instrument at all', async () => {
    const { status, body } = await post('/investment-items', {
      manual: {
        symbol: 'PRIVATE',
        displayName: 'Unlisted Holding',
        assetType: 'other',
        currency: 'EUR',
      },
      intent: 'watching',
    });

    expect(status).toBe(201);
    expect(body['currency']).toBe('EUR');
    expect(body['instrumentRef']).toBeNull();

    const row = await env.DB.prepare(
      `select instrument_id from investment_items limit 1`,
    ).first<{ instrument_id: string | null }>();
    expect(row!.instrument_id).toBeNull();
  });

  it('requires the fields an instrument would have supplied', async () => {
    const { status, body } = await post('/investment-items', {
      manual: { symbol: '', displayName: '', currency: 'euro' },
      intent: 'watching',
    });

    expect(status).toBe(422);
    const fields = (body['errors'] as Array<{ field: string }>).map((e) => e.field);
    expect(fields).toContain('manual.symbol');
    expect(fields).toContain('manual.displayName');
    expect(fields).toContain('manual.currency');
  });

  it('refuses both an instrument reference and manual details', async () => {
    const { status } = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      manual: { symbol: 'X', displayName: 'X', currency: 'USD' },
      intent: 'watching',
    });
    expect(status).toBe(422);
  });
});

describe('thesis versioning (FR-054)', () => {
  async function createWithThesis(body: string) {
    const created = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'watching',
      thesis: { body },
    });
    return created.body['id'] as string;
  }

  it('never overwrites a revision', async () => {
    const id = await createWithThesis('Original reasoning.');

    const res = await SELF.fetch(`${ORIGIN}/api/v1/investment-items/${id}/thesis`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Revised reasoning.', changeSummary: 'Catalyst slipped' }),
    });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ versionNo: 2 });

    const history = await SELF.fetch(
      `${ORIGIN}/api/v1/investment-items/${id}/thesis/versions`,
      { headers: { cookie } },
    );
    const { versions } = (await history.json()) as {
      versions: Array<{ versionNo: number; body: string; changeSummary: string | null }>;
    };

    expect(versions.map((v) => v.versionNo)).toEqual([2, 1]);
    // §E.3's "read your original thesis" only works if v1 is untouched.
    expect(versions.find((v) => v.versionNo === 1)!.body).toBe('Original reasoning.');
    expect(versions.find((v) => v.versionNo === 2)!.changeSummary).toBe('Catalyst slipped');
  });

  it('shows the newest version on the item', async () => {
    const id = await createWithThesis('First.');
    await SELF.fetch(`${ORIGIN}/api/v1/investment-items/${id}/thesis`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Second.' }),
    });

    const res = await SELF.fetch(`${ORIGIN}/api/v1/investment-items/${id}`, {
      headers: { cookie },
    });
    const item = (await res.json()) as {
      thesis: { body: string; currentVersionNo: number; versionCount: number };
    };
    expect(item.thesis.body).toBe('Second.');
    expect(item.thesis.currentVersionNo).toBe(2);
    expect(item.thesis.versionCount).toBe(2);
  });

  it('starts a thesis on an item that was saved without one', async () => {
    const created = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'watching',
    });

    const res = await SELF.fetch(
      `${ORIGIN}/api/v1/investment-items/${created.body['id']}/thesis`,
      {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Added later.' }),
      },
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ versionNo: 1 });
  });
});

describe('ownership', () => {
  it('hides another account\'s item behind a 404', async () => {
    const created = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'watching',
    });

    const other = await signIn('someone-else@example.com');
    const res = await SELF.fetch(`${ORIGIN}/api/v1/investment-items/${created.body['id']}`, {
      headers: { cookie: other },
    });

    // 404, not 403: confirming existence would leak that another account
    // holds it (NFR-08).
    expect(res.status).toBe(404);

    const list = await SELF.fetch(`${ORIGIN}/api/v1/investment-items`, {
      headers: { cookie: other },
    });
    await expect(list.json()).resolves.toEqual({ items: [] });
  });
});

describe('deletion', () => {
  it('soft-deletes, keeping the thesis history', async () => {
    const created = await post('/investment-items', {
      instrumentRef: 'fake:MSFT',
      intent: 'watching',
      thesis: { body: 'Why I watched it.' },
    });
    const id = created.body['id'] as string;

    const res = await SELF.fetch(`${ORIGIN}/api/v1/investment-items/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(res.status).toBe(204);

    const gone = await SELF.fetch(`${ORIGIN}/api/v1/investment-items/${id}`, {
      headers: { cookie },
    });
    expect(gone.status).toBe(404);

    // FR-058: the record of a decision outlives the position it was about.
    const versions = await env.DB.prepare(
      `select count(*) as c from thesis_versions`,
    ).first<{ c: number }>();
    expect(versions!.c).toBe(1);
  });
});

describe('thesis templates (§C.3)', () => {
  it('offers the specification template, seeded verbatim', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/thesis-templates`, { headers: { cookie } });
    const { templates } = (await res.json()) as {
      templates: Array<{ name: string; body: string; isSystem: boolean }>;
    };

    const system = templates.find((t) => t.isSystem)!;
    expect(system.name).toBe('Long-term investment');
    for (const heading of [
      'Why I am interested / bought:',
      'Expected outcome / catalyst:',
      'Base target:',
      'Main risks:',
      'What would invalidate this idea:',
      'What I will review on the next date:',
    ]) {
      expect(system.body).toContain(heading);
    }
  });
});
