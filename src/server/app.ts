/** Composes HTTP, private storage and session workers. Startup restores unfinished
 * publication before workers start; publication uses the configured public origin.
 * Serves public promo /, account workspaces /admin, /operator and results /results;
 * private APIs retain their role checks. Capture-loader keeps the local camera origin. */
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
import { createTemplateCache, falTemplateUpload, type TemplateUpload } from './sessions/template-cache.js';
import { registerProviderMedia } from './sessions/provider-media.js';
import { createEventCleanup, deleteKnownOutput, type CleanupOptions } from './sessions/cleanup.js';
import { createFalDelete, createFalTransport } from './sessions/fal.js';
import { createGenerationWorker, type GenerationOptions } from './sessions/generation.js';
import { registerReceive, publishReady } from './sessions/receive.js';
import { registerEvents } from './sessions/events.js';
import { registerSlotResults } from './sessions/slot-results.js';
import { registerDisplay } from './sessions/display.js';
import { createEmailWorker, recoverEmail, type EmailOptions, type createSmtpTransport } from './sessions/email.js';
import { registerEmailSettings } from './sessions/email-settings.js';

export async function createApp(config: Config, options: { now?: () => number; logger?: boolean; generation?: Omit<GenerationOptions, 'templates'> | false; templateUpload?: TemplateUpload; email?: EmailOptions; smtpTransport?: typeof createSmtpTransport; cleanup?: CleanupOptions } = {}) {
  const app = Fastify({ logger: options.logger ? { redact: ['req.url', 'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] } : false, bodyLimit: 64 * 1024 });
  const db = openDatabase(config.dataDir);
  app.addHook('onClose', async () => { db.close(); });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', /^\/(provider-media|receive|download|api\/receive)\//.test(request.url) ? 'no-referrer' : 'same-origin');
    if (request.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ code: 'INVALID_INPUT', message: error.issues.map(i => i.message).join('; ') });
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
    // No request bodies, passwords, SQL, paths or provider details in error output.
    if (status >= 500) app.log.error({ code: error.code ?? 'INTERNAL' }, 'Ошибка сервера');
    return reply.code(status).send({ code: status >= 500 ? 'INTERNAL' : error.code ?? 'BAD_REQUEST', message: status >= 500 ? 'Ошибка сервера' : error.message });
  });
  await app.register(cookie);
  await app.register(cors, { origin: [config.origin, 'http://localhost:5513'], credentials: false, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'], strictPreflight: true });
  await app.register(multipart);
  await app.register(rateLimit, { global: false });
  const access = await createAccess(app, db, config, options.now ?? Date.now);
  const deleteOutput = options.cleanup?.deleteOutput ?? (config.falKey ? createFalDelete(config.falKey) : undefined);
  const upload = options.templateUpload ?? (config.falKey ? falTemplateUpload(config.falKey) : undefined);
  const templates = upload && options.generation !== false
    ? createTemplateCache(db, config.dataDir, upload, {
        discard: url => deleteKnownOutput(url, app.log, deleteOutput),
        onFailure: mediaId => app.log.error({ mediaId }, 'Исчерпаны попытки загрузки материала в fal CDN'),
      }) : undefined;
  if (templates) app.addHook('onClose', () => templates.stop());
  registerScenarios(app, db, config.dataDir, access, config.templateVideosDir, templates?.warm);
  registerSessions(app, db, config.dataDir, access, options.now ?? Date.now);
  registerSlotResults(app, db, config.dataDir, access);
  registerProviderMedia(app, db, config.dataDir);
  registerDisplay(app, db, config.dataDir, config.origin, access, options.now ?? Date.now);
  const cleanup = createEventCleanup(db, config.dataDir, app.log, options.now ?? Date.now, { ...options.cleanup, deleteOutput });
  registerEvents(app, db, config.dataDir, access, options.now ?? Date.now, cleanup);
  app.addHook('onReady', async () => { await cleanup.runOnce(); cleanup.start(); });
  app.addHook('onClose', async () => { await cleanup.stop(); });
  registerReceive(app, db, config.dataDir, config.clientDir, options.now ?? Date.now);
  const publish = (id: string, freshlyPrepared = false) => publishReady(db, config.dataDir, id, config.origin, options.now, freshlyPrepared);
  app.addHook('onReady', async () => {
    // A serving client entrypoint is part of ready, also when fal is disabled.
    await readFile(join(config.clientDir, 'index.html'));
    const rows = db.prepare("SELECT s.id FROM capture_sessions s JOIN generation_jobs g ON g.session_id=s.id WHERE s.state='preparing' AND EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.deleting=0) AND g.video_path IS NOT NULL").all() as { id: string }[];
    for (const row of rows) await publish(row.id);
  });
  const generation = options.generation ?? (config.falKey ? { client: createFalTransport(config.falKey), secret: config.falKey } : {});
  if (generation !== false) {
    const worker = createGenerationWorker(db, config.dataDir, config.origin, app.log, { templates, testVideoDir: join(config.clientDir, 'test-videos'), ...generation, now: options.now ?? generation.now, publishReady: publish, deleteOutput });
    app.addHook('onReady', async () => { worker.start(); });
    app.addHook('onClose', async () => { await worker.stop(); });
  }
  const current = registerEmailSettings(app, db, access, config.smtp, options.smtpTransport);
  const emailWorker = createEmailWorker(db, config.dataDir, config.origin, app.log, options.email ?? { current }, options.now);
  app.addHook('onReady', async () => { recoverEmail(db); emailWorker.start(); });
  app.addHook('onClose', async () => { await emailWorker.stop(); });
  await app.register(fastifyStatic, { root: join(config.clientDir, 'assets'), prefix: '/assets/', decorateReply: false, immutable: true, maxAge: '1y', index: false });
  // Stable prompt filenames must revalidate; empty Recast files are valid assets.
  await app.register(fastifyStatic, { root: join(config.clientDir, 'slot-prompts'), prefix: '/slot-prompts/', decorateReply: false, immutable: false, maxAge: 0, index: false, setHeaders: response => { response.header('Cache-Control', 'no-cache'); } });
  app.get('/', async (request, reply) => {
    if (new URL(request.url, config.origin).searchParams.get('screen') === 'results') return reply.redirect('/results', 308);
    return reply.type('text/html').header('Cache-Control', 'no-cache').send(await readFile(join(config.clientDir, 'index.html'), 'utf8'));
  });
  app.get('/admin', async (_request, reply) => reply.type('text/html').header('Cache-Control', 'no-cache').send(await readFile(join(config.clientDir, 'index.html'), 'utf8')));
  app.get('/operator', async (_request, reply) => reply.type('text/html').header('Cache-Control', 'no-cache').send(await readFile(join(config.clientDir, 'index.html'), 'utf8')));
  app.get('/results', async (_request, reply) => reply.type('text/html').header('Cache-Control', 'no-cache').send(await readFile(join(config.clientDir, 'index.html'), 'utf8')));
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
