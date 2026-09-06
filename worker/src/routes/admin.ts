import { Hono } from 'hono';
import { refreshInstrumentDirectory } from '../app/instruments/directory-refresh';
import { KvInstrumentDirectory } from '../adapters/cache/kv-instrument-directory';
import { createProvider } from '../adapters/marketdata';
import type { AppContext } from './context';
import { problem } from './context';

/**
 * Operator endpoints.
 *
 * These exist because "wait until 03:00 UTC" is not an acceptable answer
 * after a deploy that changes the sync, or when the instrument table is empty
 * and search returns nothing.
 *
 * Guarded by a bearer token rather than a user session: this is machine-facing
 * ops tooling, and requiring an interactive sign-in to re-run a sync would mean
 * emailing a magic link to a human to fix a background job.
 *
 * When ADMIN_TOKEN is unset the routes 404 rather than 401 -- an endpoint that
 * cannot be used should not advertise that it exists.
 */
export const admin = new Hono<AppContext>();

function authorize(c: { env: { ADMIN_TOKEN?: string }; req: { header: (n: string) => string | undefined } }) {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return 'disabled' as const;

  const provided = c.req.header('authorization');
  if (!provided) return 'unauthorized' as const;

  const token = provided.replace(/^Bearer\s+/i, '');

  // Constant-time comparison. A length check alone would leak the token
  // length, and a plain === leaks a prefix through timing.
  if (token.length !== expected.length) return 'unauthorized' as const;
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0 ? ('ok' as const) : ('unauthorized' as const);
}

admin.post('/admin/refresh-directory', async (c) => {
  const outcome = authorize(c);
  if (outcome === 'disabled') return problem(c, 404, 'Not Found');
  if (outcome === 'unauthorized') return problem(c, 401, 'Unauthorized', 'Invalid admin token.');

  const exchange = c.req.query('exchange');

  const report = await refreshInstrumentDirectory(
    createProvider(c.env),
    new KvInstrumentDirectory(c.env.CACHE),
    c.get('clock'),
    exchange ? [exchange] : undefined,
  );

  // 502 when the provider failed, so a monitoring check cannot read a failed
  // refresh as a successful one.
  return c.json(report, report.failed ? 502 : 200);
});
