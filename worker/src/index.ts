/**
 * Worker entrypoint. One Worker serves four surfaces on a single origin:
 * static assets, the API, cron, and queue consumers (ADR-0004).
 *
 * Phase 0 scaffold: health only. Routes, dispatch and delivery land in
 * Phases 1, 5 and 7 respectively — see docs/03-traceability.md.
 */

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: Fetcher;
  DISPATCHER: DurableObjectNamespace;
  DELIVERY_QUEUE: Queue<unknown>;
  APP_BASE_URL: string;
  MARKET_DATA_PROVIDER: string;
}

/**
 * Serializes occurrence claiming. D1 has no SELECT ... FOR UPDATE SKIP
 * LOCKED, so a single Durable Object instance takes that role; unique
 * indexes remain the correctness backstop (ADR-0001).
 */
export class DispatcherDO implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(): Promise<Response> {
    // Phase 5 implements the §H.1 dispatch algorithm here.
    return Response.json({ ok: true, phase: 0 });
  }
}

async function health(env: Env): Promise<Response> {
  // The resolved tzdata version is load-bearing for reminder correctness:
  // a stale one makes reminders fire an hour off with no error (ADR-0003).
  const timeZoneDataOk = ((): boolean => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: 'Australia/Lord_Howe' }).format(0);
      return true;
    } catch {
      return false;
    }
  })();

  const database = await (async (): Promise<'ok' | 'unavailable'> => {
    try {
      await env.DB.prepare('select 1').first();
      return 'ok';
    } catch {
      return 'unavailable';
    }
  })();

  const ready = timeZoneDataOk && database === 'ok';
  return Response.json(
    {
      status: ready ? 'ready' : 'degraded',
      phase: 0,
      checks: { database, timeZoneDataOk },
      marketDataProvider: env.MARKET_DATA_PROVIDER,
    },
    { status: ready ? 200 : 503 },
  );
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/v1/health/live') {
      return Response.json({ status: 'live' });
    }
    if (url.pathname === '/api/v1/health/ready') {
      return health(env);
    }
    if (url.pathname.startsWith('/api/')) {
      return Response.json(
        { type: 'about:blank', title: 'Not Found', status: 404 },
        { status: 404, headers: { 'content-type': 'application/problem+json' } },
      );
    }

    // Everything else is the SPA, served from the same origin.
    return env.ASSETS.fetch(request);
  },

  async scheduled(event: ScheduledController): Promise<void> {
    // Phase 5 wires these to the dispatcher; see docs/04-operations.md §5.
    console.log(`cron fired: ${event.cron}`);
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    // Phase 7 implements per-channel delivery consumers.
    console.log(`queue batch: ${batch.messages.length} message(s)`);
  },
} satisfies ExportedHandler<Env>;
