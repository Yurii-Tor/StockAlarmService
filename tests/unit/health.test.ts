import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/src/index';

describe('phase 0 scaffold', () => {
  it('reports liveness', async () => {
    const request = new Request('http://localhost/api/v1/health/live');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as never, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'live' });
  });

  it('resolves a half-hour DST zone, which reminder correctness depends on', async () => {
    // Australia/Lord_Howe has a 30-minute DST offset. If the runtime cannot
    // resolve it, the recurrence tests in Phase 5 are meaningless (ADR-0003).
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Australia/Lord_Howe',
      timeZoneName: 'short',
    }).format(new Date('2026-01-15T00:00:00Z'));

    expect(formatted).toBeTruthy();
  });


  it('reports readiness, proving the D1 binding resolves inside workerd', async () => {
    const request = new Request('http://localhost/api/v1/health/ready');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as never, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      checks: { database: string; timeZoneDataOk: boolean };
    };
    expect(body.status).toBe('ready');
    expect(body.checks.database).toBe('ok');
    expect(body.checks.timeZoneDataOk).toBe(true);
  });

  it('returns problem+json for unknown API routes', async () => {
    const request = new Request('http://localhost/api/v1/nope');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as never, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });
});
