import { applyD1Migrations, env } from 'cloudflare:test';

// Every test suite starts against the real schema, built from the same
// migration files that run in production.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
