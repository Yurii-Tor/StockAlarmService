import { Hono } from 'hono';
import { api } from './routes/app';
import { syncInstrumentUniverse } from './app/instruments/sync';
import { D1InstrumentRepository } from './adapters/db/instrument-repository';
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

/** Exchanges whose universe is synced nightly. */
const SYNCED_EXCHANGES = ['US'] as const;

async function runNightlySync(env: Env): Promise<void> {
  const provider = createProvider(env);
  const repo = new D1InstrumentRepository(env.DB);
  const clock = new SystemClock();

  for (const exchange of SYNCED_EXCHANGES) {
    const report = await syncInstrumentUniverse(provider, repo, clock, exchange);

    // Logged as one structured line per exchange: `inserted` and `updated`
    // are the numbers that consume the D1 write budget, so a sudden jump in
    // either is the signal that the incremental diff has stopped working
    // (NFR-06).
    console.log(
      JSON.stringify({ event: 'instrument_sync', ...report }),
    );
  }
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
        // Nightly instrument-universe sync. This is what makes local search
        // possible, and therefore what makes acceptance criterion 1
        // achievable: provider search endpoints return no exchange, MIC or
        // currency, but the per-exchange listing does.
        ctx.waitUntil(runNightlySync(env));
        return;

      case '*/5 * * * *':
        // Phase 9: quote refresh for instruments with active price targets.
        return;

      case '* * * * *':
        // Phase 5: the §H.1 dispatch tick, via DispatcherDO.
        return;

      default:
        console.log(`unhandled cron: ${event.cron}`);
    }
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    // Phase 7 implements per-channel delivery consumers.
    console.log(`queue batch: ${batch.messages.length} message(s)`);
  },
} satisfies ExportedHandler<Env>;
