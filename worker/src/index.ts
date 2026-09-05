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

    // One structured line per exchange. `estimatedRowsWritten` is the number
    // that matters: D1's write limit is per ACCOUNT, so this job competes
    // with every other database on it (see sync.ts for what happened when it
    // did not).
    console.log(JSON.stringify({ event: 'instrument_sync', ...report }));

    if (report.budgetExhausted) {
      // Not an error: the cap did its job. But the universe is incomplete
      // until subsequent runs drain the backlog, and silence here would look
      // identical to a finished sync.
      console.warn(
        JSON.stringify({
          event: 'instrument_sync_incomplete',
          exchange,
          deferred: report.deferred,
          reason: 'write budget reached; remaining rows resume on the next run',
        }),
      );
    }
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
