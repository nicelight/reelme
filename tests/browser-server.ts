/** Isolated capture/editor HTTP fixture. Generation is off by default; explicit
 * manual-test scenarios enable the ordinary worker with local video/transport. */
import { createApp } from '../src/server/app.js';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../src/server/config.js';
const config = readConfig();
const app = await createApp(config, { generation: process.env.RUN_GENERATION === 'true' ? {
  intervalMs: 20,
  client: {
    async submit(_model, input) {
      if (input.prompt === 'fail-test') throw Object.assign(new Error('Controlled refusal'), { status: 422 });
      return { request_id: randomUUID() };
    },
    async status() { return { status: 'COMPLETED' }; },
    async result() { return { video: { url: 'https://fixture.test/video.mp4' } }; },
  },
  download: async () => new Response(await readFile(process.env.FIXTURE_VIDEO!)),
} : false });
// Only the isolated fixture allows its dynamically bound capture origin.
app.addHook('onSend', async (request, reply) => {
  if (request.headers.origin === process.env.CAPTURE_TEST_ORIGIN) reply.header('Access-Control-Allow-Origin', request.headers.origin);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close(); });
await app.listen({ host: config.host, port: config.port });
