// Phase 0 placeholder. Replaced by Vite in Phase 3.
// Exists so the single-origin assets binding in wrangler.jsonc resolves.
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(
  new URL('./dist/index.html', import.meta.url),
  '<!doctype html><meta charset="utf-8"><title>StockAlarm</title>\n' +
    '<p>Phase 0 scaffold. The React PWA lands in Phase 3.</p>\n',
);
console.log('web: placeholder build written to web/dist');
