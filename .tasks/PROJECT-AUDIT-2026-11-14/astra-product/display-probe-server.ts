import { resolve } from 'node:path';
import { createApp } from '../../../src/server/app.ts';
const app = await createApp({ origin:'http://127.0.0.1:3291', host:'127.0.0.1',port:3291,dataDir:process.argv[2],clientDir:resolve('dist/client') }, {now:()=>Date.parse('2026-11-14T10:00:00Z')});
for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>{ void app.close(); });
await app.listen({host:'127.0.0.1',port:3291});
