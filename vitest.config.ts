import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// Tests run INSIDE workerd with real D1, Durable Object and Queue bindings,
// so integration tests exercise the actual runtime rather than mocks of it.
// The real migrations are applied before each suite, which means the schema
// invariants (unique dedup key, per-channel deliveries, nullable channels)
// are enforced by SQLite in tests exactly as they will be in production.
const migrations = await readD1Migrations('./worker/migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityDate: '2026-08-22',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          TEST_MIGRATIONS: migrations,
          /**
           * Pins the deterministic provider for every test (NFR-05).
           *
           * Not belt-and-braces: `auto` picks Finnhub whenever a key is
           * present, and .dev.vars is loaded here too -- so the moment a
           * developer adds a real key locally, the suite starts hitting a
           * live API and asserting on whatever the market happens to be
           * doing. That was observed, not theorised: a draft test failed
           * with the real MSFT price instead of the fixture.
           */
          MARKET_DATA_PROVIDER: 'fake',
          /** Same reasoning for mail: no test may send a real message. */
          EMAIL_TRANSPORT: 'console',
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts', 'worker/src/**/*.test.ts'],
    setupFiles: ['./tests/apply-migrations.ts'],
  },
});
