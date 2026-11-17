/** Isolated capture/editor HTTP fixture. Generation is off by default; explicit
 * manual-test scenarios enable the ordinary worker with local video/transport. */
import { createApp } from '../src/server/app.js';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../src/server/config.js';
import nodemailer from 'nodemailer';
const config = readConfig();
const smtpPort = Number(process.env.EMAIL_TEST_SMTP_PORT);
const forbidden = () => { if (process.env.TEST_VIDEO_ONLY === 'true') throw new Error('Test-video scenario attempted a provider call'); };
const app = await createApp(config, { generation: process.env.RUN_GENERATION === 'true' ? {
  intervalMs: 20,
  client: {
    async submit(_model, input) {
      forbidden();
      if (input.prompt === 'fail-test') throw Object.assign(new Error('Controlled refusal'), { status: 422 });
      return { request_id: randomUUID() };
    },
    async status() { forbidden(); return { status: 'COMPLETED' }; },
    async result() { forbidden(); return { video: { url: 'https://fixture.test/video.mp4' } }; },
  },
  download: async () => { forbidden(); return new Response(await readFile(process.env.FIXTURE_VIDEO!)); },
} : false,
  ...(smtpPort ? { email: { from: 'sender@example.test', intervalMs: 100,
    transport: nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false, ignoreTLS: true, socketTimeout: 2000, connectionTimeout: 1000 }),
  } } : {}),
});
// Only the isolated fixture allows its dynamically bound capture origin.
app.addHook('onSend', async (request, reply) => {
  if (request.headers.origin === process.env.CAPTURE_TEST_ORIGIN) reply.header('Access-Control-Allow-Origin', request.headers.origin);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close(); });
await app.listen({ host: config.host, port: config.port });
process.send?.({ ready: config.origin });
