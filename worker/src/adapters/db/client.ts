import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

/** One Drizzle client per request. D1 bindings are per-invocation. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema, logger: false });
}

export { schema };
