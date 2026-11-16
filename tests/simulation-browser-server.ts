/** Isolated no-key simulation application for Chromium; the ordinary worker
 * consumes captures seeded through the public APIs before listening. */
import { fixture, imageBytes, multipart } from './helpers.js';
import { createApp } from '../src/server/app.js';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { openDatabase } from '../src/server/db.js';
import assert from 'node:assert/strict';
const infoPath = process.env.FIXTURE_INFO;
if (!infoPath) throw new Error('Missing fixture info path');
const f = await fixture();
const db = openDatabase(f.config.dataDir);
const origin = 'http://127.0.0.1:3197';
const app = await createApp({ ...f.config, origin, clientDir: resolve('dist/client') }, { now: () => Date.UTC(2026, 0, 1) });
const cookie = await f.login(); const image = await f.upload(cookie, await imageBytes());
const saved = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: { cookie, origin: f.config.origin }, payload: {
  participants: 1, photosPerParticipant: 4, orientation: 'landscape', aspectRatio: '16:9',
  description: 'Тест эмуляции', visible: true, simulateGeneration: true, thumbnailId: image.id,
  mode: 'P2V', model: 'kling/v4/reference-to-video', prompt: '@Element1', resolution: '720p', duration: 3, referenceIds: [],
} });
assert.equal(saved.statusCode, 201, saved.body);
const headers = { authorization: `Bearer ${'a'.repeat(43)}` };
const jpeg = await sharp(await imageBytes()).jpeg().toBuffer();
for (const broken of [false, true]) {
  const started = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers, payload: { slotId: saved.json().id, startRequestId: randomUUID() } });
  assert.equal(started.statusCode, 201); const id = started.json().sessionId;
  const part = multipart(jpeg, 'image/jpeg', 'visitor.jpg');
  for (let pose = 0; pose < 4; pose++) assert.equal((await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${id}/photos/${pose}`, headers: { ...headers, 'content-type': part.contentType }, payload: part.bytes })).statusCode, 200);
  assert.equal((await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${id}/finalize`, headers })).statusCode, 200);
  if (broken) {
    const photo = db.prepare('SELECT path FROM capture_photos WHERE session_id=? LIMIT 1').get(id) as { path: string };
    await rm(join(f.config.dataDir, 'media', photo.path));
  }
}
db.close();
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void (async () => { await app.close(); await f.close(); })(); });
await app.listen({ host: '127.0.0.1', port: 3197 });
await writeFile(infoPath, JSON.stringify({ dataDir: f.config.dataDir }));
