import { Hono } from 'hono';
import { D1PortfolioRepository } from '../adapters/db/portfolio-repository';
import { KvInstrumentDirectory } from '../adapters/cache/kv-instrument-directory';
import { createProvider } from '../adapters/marketdata';
import { resolveInstrument } from '../app/instruments/search';
import { buildCreateItemCommand, type CreateItemInput } from '../app/portfolio/create-item';
import { schema } from '../adapters/db/client';
import { eq, isNull, or } from 'drizzle-orm';
import type { AppContext } from './context';
import { problem, requireSession } from './context';

/**
 * Portfolio: items, lots and thesis (§5 of the consolidated spec).
 *
 * This is where an instrument first reaches D1. Search and drafts write
 * nothing; a row appears only because the user chose to keep something.
 */
export const investmentItems = new Hono<AppContext>();

investmentItems.post('/investment-items', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to save an item.');

  const input = (await c.req.json().catch(() => null)) as CreateItemInput | null;
  if (!input) return problem(c, 400, 'Bad Request', 'A JSON body is required.');

  const instrument = input.instrumentRef
    ? await resolveInstrument(
        createProvider(c.env),
        new KvInstrumentDirectory(c.env.CACHE),
        input.instrumentRef,
      )
    : null;

  const db = c.get('db');
  const [settings] = await db
    .select({ tz: schema.userSettings.defaultTimezone })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, session.user.id))
    .limit(1);

  const built = buildCreateItemCommand(
    session.user.id,
    input,
    instrument,
    { timezone: settings?.tz ?? 'Europe/Bucharest' },
    c.get('clock').now(),
  );

  if (!built.ok) {
    return c.json(
      {
        type: 'about:blank',
        title: 'Unprocessable Entity',
        status: 422,
        detail: 'The item could not be saved.',
        errors: built.errors,
      },
      422,
      { 'content-type': 'application/problem+json' },
    );
  }

  const repo = new D1PortfolioRepository(c.env.DB);
  const created = await repo.createItem(built.command);
  const detail = await repo.getItem(session.user.id, created.id);

  return c.json(detail, 201);
});

investmentItems.get('/investment-items', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to view your portfolio.');

  const repo = new D1PortfolioRepository(c.env.DB);
  return c.json({ items: await repo.listItems(session.user.id) });
});

investmentItems.get('/investment-items/:id', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to view this item.');

  const repo = new D1PortfolioRepository(c.env.DB);
  const item = await repo.getItem(session.user.id, c.req.param('id'));
  // 404 rather than 403 for someone else's item: confirming it exists would
  // leak that another account holds it.
  if (!item) return problem(c, 404, 'Not Found', 'No such item.');

  return c.json(item);
});

investmentItems.delete('/investment-items/:id', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to delete this item.');

  const repo = new D1PortfolioRepository(c.env.DB);
  const deleted = await repo.softDeleteItem(
    session.user.id,
    c.req.param('id'),
    c.get('clock').now(),
  );
  if (!deleted) return problem(c, 404, 'Not Found', 'No such item.');

  return c.body(null, 204);
});

/**
 * Saves a thesis revision.
 *
 * PUT, but append-only underneath: a new version is inserted and the current
 * pointer moves. Nothing is ever overwritten (FR-054), which is what makes
 * "read your original thesis" meaningful months later (§E.3).
 */
investmentItems.put('/investment-items/:id/thesis', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to edit the thesis.');

  const body = (await c.req.json().catch(() => null)) as {
    body?: string;
    changeSummary?: string | null;
  } | null;

  const text = body?.body?.trim();
  if (!text) return problem(c, 422, 'Unprocessable Entity', 'A thesis body is required.');

  const repo = new D1PortfolioRepository(c.env.DB);
  const result = await repo.addThesisVersion(
    session.user.id,
    c.req.param('id'),
    text,
    body?.changeSummary?.trim() || null,
    c.get('clock').now(),
  );
  if (!result) return problem(c, 404, 'Not Found', 'No such item.');

  return c.json(result, 201);
});

investmentItems.get('/investment-items/:id/thesis/versions', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to view thesis history.');

  const repo = new D1PortfolioRepository(c.env.DB);
  const versions = await repo.listThesisVersions(session.user.id, c.req.param('id'));

  return c.json({ versions });
});

/** §C.3 templates: system-provided plus the user's own. */
investmentItems.get('/thesis-templates', async (c) => {
  const session = await requireSession(c);
  if (!session) return problem(c, 401, 'Unauthorized', 'Sign in to view templates.');

  const templates = await c
    .get('db')
    .select({
      id: schema.thesisTemplates.id,
      name: schema.thesisTemplates.name,
      body: schema.thesisTemplates.body,
      isDefault: schema.thesisTemplates.isDefault,
      userId: schema.thesisTemplates.userId,
    })
    .from(schema.thesisTemplates)
    .where(
      or(
        isNull(schema.thesisTemplates.userId),
        eq(schema.thesisTemplates.userId, session.user.id),
      ),
    );

  return c.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      body: t.body,
      isDefault: t.isDefault,
      isSystem: t.userId === null,
    })),
  });
});
