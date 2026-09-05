import type { Context } from 'hono';
import type { Database } from '../adapters/db/client';
import type { Auth } from '../adapters/auth';
import type { Mailer } from '../adapters/email/mailer';
import type { Clock } from '../domain/time/clock';
import type { Env } from '../env';

export type AppVariables = {
  db: Database;
  auth: Auth;
  mailer: Mailer;
  clock: Clock;
};

export type AppContext = { Bindings: Env; Variables: AppVariables };

export interface SessionUser {
  user: { id: string; email: string; name?: string | null };
}

/** Resolves the current session, or null when unauthenticated. */
export async function requireSession(
  c: Context<AppContext>,
): Promise<SessionUser | null> {
  const session = await c.get('auth').api.getSession({ headers: c.req.raw.headers });
  return session?.user ? (session as SessionUser) : null;
}

/** RFC 9457 problem+json. Used for every error response so clients see one shape. */
export function problem(
  c: Context<AppContext>,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
  title: string,
  detail?: string,
) {
  return c.json(
    { type: 'about:blank', title, status, ...(detail ? { detail } : {}) },
    status,
    { 'content-type': 'application/problem+json' },
  );
}
