/** Test-only application process with a file-controlled Novosibirsk clock.
 * Explicit config disables fal/SMTP irrespective of developer environment. */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from '../src/server/app.js';
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('Missing DATA_DIR');
const app = await createApp({ origin: 'http://127.0.0.1:3196', host: '127.0.0.1', port: 3196,
  dataDir, clientDir: resolve('dist/client') }, { now: () => Number(readFileSync(join(dataDir, 'archive-clock'), 'utf8')) });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port: 3196 });
