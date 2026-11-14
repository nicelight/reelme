import { readConfig } from './config.js';
import { createApp } from './app.js';
process.umask(0o077);
const config = readConfig();
const app = await createApp(config, { logger: true });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close(); });
await app.listen({ host: config.host, port: config.port });
