/** Test-only process entrypoint: the real application with an injected loopback
 * SMTP transport. It never reads SMTP credentials or enables fal. */
import nodemailer from 'nodemailer';
import { resolve } from 'node:path';
import { createApp } from '../src/server/app.js';
const port = Number(process.env.EMAIL_TEST_SMTP_PORT);
if (!Number.isInteger(port) || port <= 0 || port > 65535 || !process.env.DATA_DIR) throw new Error('Missing local test configuration');
const app = await createApp({ origin: 'http://127.0.0.1:3197', host: '127.0.0.1', port: 3197,
  dataDir: process.env.DATA_DIR, clientDir: resolve('dist/client') }, { email: {
  from: 'sender@example.test', intervalMs: 1000,
  transport: nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true, socketTimeout: 15_000, connectionTimeout: 1000 }),
} });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port: 3197 });
