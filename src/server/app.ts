/** Module contract: composes Fastify, Access, Scenarios and Sessions with private storage.
 * Public assets and scoped provider capabilities are served; capture-loader reads the current manifest
 * and imports cloud assets without changing localhost origin. No device APIs here.
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { openDatabase } from './db.js';
import { createAccess } from './access/index.js';
import { registerScenarios } from './scenarios/index.js';
import { registerSessions } from './sessions/index.js';
import { registerProviderMedia } from './sessions/provider-media.js';
import { createFalTransport } from './sessions/fal.js';
import { createGenerationWorker, type GenerationOptions } from './sessions/generation.js';
import { registerReceive, publishReady } from './sessions/receive.js';

export async function createApp(config: Config, options: { now?: () => number; logger?: boolean; generation?: GenerationOptions } = {}) {
  const app = Fastify({ logger: options.logger ? { redact: ['req.url', 'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] } : false, bodyLimit: 64 * 1024 });
  const db = openDatabase(config.dataDir);
  app.addHook('onClose', async () => { db.close(); });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', /^\/(provider-media|receive|download|api\/receive)\//.test(request.url) ? 'no-referrer' : 'same-origin');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ code: 'INVALID_INPUT', message: error.issues.map(i => i.message).join('; ') });
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
    // No request bodies, passwords, SQL, paths or provider details in error output.
    if (status >= 500) app.log.error({ code: error.code ?? 'INTERNAL' }, 'Ошибка сервера');
    return reply.code(status).send({ code: status >= 500 ? 'INTERNAL' : error.code ?? 'BAD_REQUEST', message: status >= 500 ? 'Ошибка сервера' : error.message });
  });
  await app.register(cookie);
  await app.register(cors, { origin: [config.origin, 'http://localhost:5513'], credentials: false, methods: ['GET', 'POST', 'PUT', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'], strictPreflight: true });
  await app.register(multipart);
  await app.register(rateLimit, { global: false });
  const access = await createAccess(app, db, config, options.now ?? Date.now);
  registerScenarios(app, db, config.dataDir, access);
  registerSessions(app, db, config.dataDir, access, options.now ?? Date.now);
  registerProviderMedia(app, db, config.dataDir);
  registerReceive(app, db, config.dataDir, config.clientDir, options.now ?? Date.now);
  const publish = (id: string) => publishReady(db, config.dataDir, id);
  app.addHook('onReady', async () => {
    // A serving client entrypoint is part of ready, also when fal is disabled.
    await readFile(join(config.clientDir, 'index.html'));
    const rows = db.prepare("SELECT s.id FROM capture_sessions s JOIN generation_jobs g ON g.session_id=s.id WHERE s.state='preparing' AND g.video_path IS NOT NULL").all() as { id: string }[];
    for (const row of rows) await publish(row.id);
  });
  const generation = options.generation ?? (config.falKey ? { client: createFalTransport(config.falKey), secret: config.falKey } : undefined);
  if (generation) {
    const worker = createGenerationWorker(db, config.dataDir, config.origin, app.log, { ...generation, publishReady: publish });
    app.addHook('onReady', async () => { worker.start(); });
    app.addHook('onClose', async () => { await worker.stop(); });
  }
  await app.register(fastifyStatic, { root: join(config.clientDir, 'assets'), prefix: '/assets/', decorateReply: false, immutable: true, maxAge: '1y', index: false });
  app.get('/', async (_request, reply) => reply.type('text/html').header('Cache-Control', 'no-cache').send(await readFile(join(config.clientDir, 'index.html'), 'utf8')));
  app.get('/admin', async (_request, reply) => reply.type('text/html').header('Cache-Control', 'no-cache').send(await readFile(join(config.clientDir, 'index.html'), 'utf8')));
  app.get('/capture-loader.js', async (_request, reply) => {
    type Entry = { file: string; css?: string[]; imports?: string[] };
    const manifest = JSON.parse(await readFile(join(config.clientDir, '.vite/manifest.json'), 'utf8')) as Record<string, Entry>;
    const entry = manifest['src/client/capture/main.ts'];
    const styles = new Set<string>(); const visited = new Set<string>();
    function collect(key: string) {
      if (visited.has(key)) return; visited.add(key);
      const item = manifest[key];
      for (const css of item.css ?? []) styles.add(css);
      for (const child of item.imports ?? []) collect(child);
    }
    collect('src/client/capture/main.ts');
    const urls = [...styles].map(file => new URL(file, config.origin).href);
    const source = `const styles=${JSON.stringify(urls)};for(const href of styles){const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);}await import(${JSON.stringify(new URL(entry.file, config.origin).href)});`;
    return reply.type('application/javascript').header('Cache-Control', 'no-store').send(source);
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: 'NOT_FOUND', message: 'Страница не найдена' }));
  return app;
}
