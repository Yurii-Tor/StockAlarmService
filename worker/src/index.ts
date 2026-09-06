import { Hono } from 'hono';
import { api } from './routes/app';
import { refreshInstrumentDirectory } from './app/instruments/directory-refresh';
import { KvInstrumentDirectory } from './adapters/cache/kv-instrument-directory';
import { createProvider } from './adapters/marketdata';
import { SystemClock } from './adapters/time/system-clock';
import type { Env } from './env';

export type { Env };

/**
 * Worker entrypoint. One Worker serves four surfaces on a single origin:
 * static assets, the API, cron, and queue consumers (ADR-0004).
 */

/**
 * Serializes occurrence claiming.
 *
 * D1 has no `SELECT ... FOR UPDATE SKIP LOCKED`, so a single Durable Object
 * instance takes that role: Cloudflare guarantees only one runs at a time for
 * a given id. Unique indexes remain the correctness backstop, which is why no
 * leader election is needed (ADR-0001, NFR-02).
 *
 * Phase 5 implements the §H.1 dispatch algorithm here.
 */
export class DispatcherDO implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(): Promise<Response> {
    return Response.json({ ok: true, implemented: false, phase: 5 });
  }
}

/**
 * Refreshes the KV instrument directory.
 *
 * D1 is deliberately untouched here. The predecessor of this job wrote 31,000
 * D1 rows and took the account offline; the directory now lives in KV, where
 * an unchanged day costs zero writes. A D1 row is created only when the user
 * saves an investment item.
 */
async function runDirectoryRefresh(env: Env): Promise<void> {
  const report = await refreshInstrumentDirectory(
    createProvider(env),
    new KvInstrumentDirectory(env.CACHE),
    new SystemClock(),
  );

  // `kvWrites` is the number to watch: it should normally be 0. A refresh
  // that writes every shard nightly means the change comparison has broken,
  // and the KV budget is 1,000 writes/day.
  console.log(JSON.stringify({ event: 'directory_refresh', ...report }));
}

const app = new Hono<{ Bindings: Env }>();

app.route('/api/v1', api);

// Everything else is the SPA, served from the same origin.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    switch (event.cron) {
      case '0 3 * * *':
        // Refreshes the searchable directory. Search itself is live against
        // the provider; this supplies the venue and currency that provider
        // search omits, which acceptance criterion 1 requires.
        ctx.waitUntil(runDirectoryRefresh(env));
        return;

      // The dispatch tick (Phase 5) and quote refresh (Phase 9) are NOT
      // registered in wrangler.jsonc yet. Register each one in the phase that
      // implements it, not before -- an empty per-minute cron costs 1,440
      // invocations a day and buys nothing.

      default:
        console.log(`unhandled cron: ${event.cron}`);
    }
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    // Phase 7 implements per-channel delivery consumers.
    console.log(`queue batch: ${batch.messages.length} message(s)`);
  },
} satisfies ExportedHandler<Env>;
