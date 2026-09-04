import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './worker/src/adapters/db/schema/index.ts',
  out: './worker/migrations',
});
