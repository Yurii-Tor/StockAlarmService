import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { searchInstruments, resolveInstrument } from '../app/instruments/search';
import { getQuote } from '../app/instruments/quotes';
import { buildDraft, type Intent, type UserDefaults } from '../app/instruments/draft';
import { KvCallBudget, KvQuoteCache } from '../adapters/cache/kv-quote-cache';
import { KvInstrumentDirectory } from '../adapters/cache/kv-instrument-directory';
import { createProvider } from '../adapters/marketdata';
import { schema } from '../adapters/db/client';
import { isValidTimeZone } from '../domain/time/format';
import type { AppContext } from './context';
import { problem, requireSession } from './context';

/**
 * Instrument discovery (§G.1) and the prefilled draft (§G.2).
 *
 * Every route here requires a session. Market data carries redistribution
 * terms (R2): serving quotes to the authenticated user who asked for them is
 * ordinary use, while an open endpoint would be republication.
 */
export const instruments = new Hono<AppContext>();

instruments.get('/instruments/search', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to search instruments.');

  const q = c.req.query('q') ?? '';
  const assetType = c.req.query('assetType');
  const limitRaw = Number(c.req.query('limit') ?? '20');
  const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

  const result = await searchInstruments(
    createProvider(c.env),
    new KvInstrumentDirectory(c.env.CACHE),
    q,
    { limit, ...(assetType ? { assetType } : {}) },
  );

  return c.json(result);
});

instruments.get('/instruments/:ref', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to view instruments.');

  const instrument = await resolveInstrument(
    createProvider(c.env),
    new KvInstrumentDirectory(c.env.CACHE),
    decodeURIComponent(c.req.param('ref')),
  );
  if (!instrument) return problem(c, 404, 'Not Found', 'Unrecognised instrument reference.');

  return c.json(instrument);
});

instruments.get('/instruments/:ref/quote', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to view quotes.');

  const provider = createProvider(c.env);
  const instrument = await resolveInstrument(
    provider,
    new KvInstrumentDirectory(c.env.CACHE),
    decodeURIComponent(c.req.param('ref')),
  );
  if (!instrument) return problem(c, 404, 'Not Found', 'Unrecognised instrument reference.');

  const quote = await getQuote(
    {
      provider,
      cache: new KvQuoteCache(c.env.CACHE),
      clock: c.get('clock'),
      budget: new KvCallBudget(c.env.CACHE, () => c.get('clock').now()),
    },
    instrument,
    { forceRefresh: c.req.query('refresh') === 'true' },
  );

  return c.json(quote);
});

/**
 * §G.2. Persists nothing — this returns an editable proposal, and the user
 * commits it with a later POST /investment-items (FR-045).
 */
instruments.post('/investment-items/draft-from-instrument', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to create a draft.');

  const body = (await c.req.json().catch(() => null)) as {
    instrumentRef?: string;
    intent?: string;
    useLatestQuoteAsEntryPrice?: boolean;
    timezone?: string;
  } | null;

  if (!body?.instrumentRef) {
    return problem(c, 400, 'Bad Request', 'instrumentRef is required.');
  }

  const intent: Intent = body.intent === 'open' ? 'open' : 'watching';

  if (body.timezone && !isValidTimeZone(body.timezone)) {
    // Rejected rather than silently replaced: a reminder written against a
    // zone the scheduler cannot resolve would fire at the wrong time with no
    // error anywhere (ADR-0003).
    return problem(c, 400, 'Bad Request', `Unknown time zone: ${body.timezone}`);
  }

  const db = c.get('db');
  const provider = createProvider(c.env);
  const instrument = await resolveInstrument(
    provider,
    new KvInstrumentDirectory(c.env.CACHE),
    body.instrumentRef,
  );
  if (!instrument) return problem(c, 404, 'Not Found', 'Unrecognised instrument reference.');

  const [settings] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, session.user.id))
    .limit(1);

  const defaults: UserDefaults = {
    timezone: settings?.defaultTimezone ?? 'Europe/Bucharest',
    defaultNewItemStatus: settings?.defaultNewItemStatus ?? 'watching',
    prefillEntryPriceFromLatestQuote: settings?.prefillEntryPriceFromLatestQuote ?? true,
    lastUsedBrokerName: settings?.lastUsedBrokerName ?? null,
    defaultBrokerName: settings?.defaultBrokerName ?? null,
    defaultReviewPlanMode: settings?.defaultReviewPlanMode ?? 'none',
    defaultReviewChannels: settings
      ? (JSON.parse(settings.defaultReviewChannels) as string[])
      : ['in_app'],
  };

  const quote = await getQuote(
    {
      provider,
      cache: new KvQuoteCache(c.env.CACHE),
      clock: c.get('clock'),
      budget: new KvCallBudget(c.env.CACHE, () => c.get('clock').now()),
    },
    instrument,
  );

  const draft = buildDraft({
    instrument,
    quote,
    intent,
    defaults,
    now: c.get('clock').now(),
    ...(body.timezone ? { timezone: body.timezone } : {}),
    ...(body.useLatestQuoteAsEntryPrice !== undefined
      ? { useLatestQuoteAsEntryPrice: body.useLatestQuoteAsEntryPrice }
      : {}),
  });

  return c.json(draft);
});
