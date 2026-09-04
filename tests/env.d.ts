// `env` from "cloudflare:test" is typed as Cloudflare.Env, which
// worker-configuration.d.ts generates from wrangler.jsonc. Only the
// test-only binding needs declaring here.
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

declare global {
  namespace Cloudflare {
    interface Env {
      /** Injected by vitest.config.ts, applied in tests/apply-migrations.ts. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
