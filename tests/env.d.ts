// Binds the Worker's Env to the test runner's `env` import so integration
// tests get real, typed D1/KV/Queue/DO bindings inside workerd.
import type { Env } from '../worker/src/index';

declare module 'cloudflare:test' {
  // Module augmentation requires an interface here; it deliberately adds no
  // members of its own.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
