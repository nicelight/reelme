/** Test-only real application process. Clock and mail acceptance are controlled by
 * local files; never reads fal/SMTP credentials and never sends external requests. */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from '../src/server/app.js';
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('Missing DATA_DIR');
const control = () => JSON.parse(readFileSync(join(dataDir, 'display-control.json'), 'utf8')) as { now: number; fail: boolean };
const app = await createApp({ origin: 'http://127.0.0.1:3197', host: '127.0.0.1', port: 3197,
  dataDir, clientDir: resolve('dist/client') }, { now: () => control().now, email: {
  from: 'sender@example.test', intervalMs: 100,
  transport: { async sendMail() {
    if (control().fail) throw Object.assign(new Error('Test-only refusal'), { code: 'EENVELOPE', responseCode: 550 });
    return { accepted: ['visitor@example.test'], rejected: [] };
  } },
} });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port: 3197 });
