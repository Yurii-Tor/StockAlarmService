import { Hono } from 'hono';
import { api } from './routes/app';
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

const app = new Hono<{ Bindings: Env }>();

app.route('/api/v1', api);

// Everything else is the SPA, served from the same origin.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController): Promise<void> {
    // Phase 5 wires these to DispatcherDO; see docs/04-operations.md §5.
    //   * * * * *   -> dispatch tick
    //   */5 * * * * -> quote refresh for instruments with active targets
    //   0 3 * * *   -> symbol-universe sync, retention pruning, digest
    console.log(`cron fired: ${event.cron}`);
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    // Phase 7 implements per-channel delivery consumers.
    console.log(`queue batch: ${batch.messages.length} message(s)`);
  },
} satisfies ExportedHandler<Env>;
