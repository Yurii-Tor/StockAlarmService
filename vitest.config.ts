import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Tests run INSIDE workerd with real D1, Durable Object and Queue bindings,
// so integration tests exercise the actual runtime rather than mocks of it.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityDate: '2026-08-22',
        compatibilityFlags: ['nodejs_compat'],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts', 'worker/src/**/*.test.ts'],
  },
});
