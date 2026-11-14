/** Test-only Node/tsx fixture; explicit local config has no fal/SMTP credentials. */
import { resolve } from 'node:path';
import { createApp } from '../src/server/app.js';
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('Missing isolated DATA_DIR');
const app = await createApp({ origin:'http://127.0.0.1:3195',host:'127.0.0.1',port:3195,dataDir,clientDir:resolve('dist/client') },{now:()=>Date.parse('2026-11-14T17:00:00Z')});
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>{void app.close();});
await app.listen({host:'127.0.0.1',port:3195});
