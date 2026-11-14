import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, imageBytes, videoBytes, multipart } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import type { SlotInput, Slot } from '../src/shared/scenarios.js';

const day = 86_400_000;
test('roles, origin, fixed admin expiry, persistent operator and logout revocation', async t => {
  const f = await fixture(); t.after(() => f.close());
  for (const origin of [undefined, 'https://foreign.test']) {
    const response = await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: origin ? { origin } : {}, payload: { username: 'admin', password: 'test-password' } });
    assert.equal(response.statusCode, 403);
  }
  const bad = await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: f.config.origin }, payload: { username: 'admin', password: 'wrong' } });
  assert.equal(bad.statusCode, 401);
  const admin = await f.login(); const operator = await f.login('operator');
  const stored = openDatabase(f.config.dataDir);
  const accounts = stored.prepare('SELECT password_hash FROM accounts').all() as Array<{ password_hash: string }>;
  assert.equal(accounts.length, 2);
  assert.ok(accounts.every(a => !a.password_hash.includes('test-password')));
  const sessions = stored.prepare('SELECT token_hash FROM auth_sessions').all() as Array<{ token_hash: string }>;
  assert.equal(sessions.length, 2);
  assert.ok(sessions.every(s => /^[a-f0-9]{64}$/.test(s.token_hash) && !admin.includes(s.token_hash) && !operator.includes(s.token_hash)));
  stored.close();
  const contexts = [{ headers: {}, code: 401 }, { headers: { authorization: 'Bearer invalid' }, code: 401 }, { headers: { cookie: operator }, code: 403 }, { headers: { authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, code: 403 }];
  for (const { headers, code } of contexts) {
    for (const [method, url] of [['GET', '/api/admin/models'], ['GET', '/api/admin/slots'], ['GET', `/api/admin/slots/${randomUUID()}`], ['POST', '/api/admin/slots'], ['PUT', `/api/admin/slots/${randomUUID()}`], ['POST', '/api/admin/slot-media'], ['GET', `/api/admin/slot-media/${randomUUID()}`], ['GET', `/api/admin/slot-media/${randomUUID()}/info`]] as const) {
      const response = await f.app.inject({ method, url, headers: { ...headers, origin: f.config.origin }, ...(method !== 'GET' ? { payload: { role: 'admin' } } : {}) });
      assert.equal(response.statusCode, code, `${method} ${url}: ${response.body}`);
    }
  }
  for (const url of ['/api/admin/slots', '/api/admin/slot-media', '/api/auth/logout']) {
    const response = await f.app.inject({ method: 'POST', url, headers: { cookie: admin, origin: 'https://foreign.test' }, payload: {} });
    assert.equal(response.statusCode, 403, url);
  }
  assert.equal((await f.app.inject({ url: '/api/admin/slots', headers: { cookie: admin } })).statusCode, 200);
  f.advance(29 * day);
  assert.equal((await f.app.inject({ url: '/api/auth/session', headers: { cookie: admin } })).statusCode, 200);
  await f.restart();
  f.advance(day);
  assert.equal((await f.app.inject({ url: '/api/auth/session', headers: { cookie: admin } })).statusCode, 401);
  f.advance(10 * 365 * day);
  const session = await f.app.inject({ url: '/api/auth/session', headers: { cookie: operator } });
  assert.equal(session.statusCode, 200); assert.equal(session.json().role, 'operator');
  assert.ok(session.headers['set-cookie'], 'operator cookie must be renewed on use');
  assert.ok([200, 204].includes((await f.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: operator, origin: f.config.origin } })).statusCode));
  assert.equal((await f.app.inject({ url: '/api/auth/session', headers: { cookie: operator } })).statusCode, 401);
});

test('capture loader imports current manifest assets and permits localhost module CORS', async t => {
  const f = await fixture(); t.after(() => f.close());
  await mkdir(join(f.config.clientDir, '.vite'));
  await writeFile(join(f.config.clientDir, '.vite/manifest.json'), JSON.stringify({
    'src/client/capture/main.ts': { file: 'assets/capture-123.js', css: ['assets/capture-123.css'], imports: ['shared'] },
    shared: { file: 'assets/shared-123.js', css: ['assets/shared-123.css'] },
  }));
  const response = await f.app.inject({ url: '/capture-loader.js', headers: { origin: 'http://localhost:5513' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5513');
  assert.match(response.body, /https:\/\/reelme\.test\/assets\/capture-123\.js/);
  assert.match(response.body, /https:\/\/reelme\.test\/assets\/shared-123\.css/);
  assert.equal(response.headers['cache-control'], 'no-store');
  const preflight = await f.app.inject({ method: 'OPTIONS', url: '/api/admin/slots', headers: { origin: 'http://localhost:5513', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
  assert.equal(preflight.statusCode, 204);
  assert.match(String(preflight.headers['access-control-allow-headers']), /Authorization/i);
});

// Expected public model settings are explicit: a changed production registry must
// not silently change both the input and its expected result in these tests.
const cases: Array<[string, 'V2V' | 'P2V', string | undefined, number]> = [
  ['minimax/h3-max/recast', 'V2V', '768P', 30],
  ['fal-ai/kling-video/o1/video-to-video/edit', 'V2V', undefined, 10],
  ['fal-ai/kling-video/o3/pro/video-to-video/edit', 'V2V', undefined, 15],
  ['kling/v4/video-to-video/edit', 'V2V', '1080p', 30],
  ['kling/v4/flash/video-to-video', 'V2V', '720p', 20],
  ['kling/v4/reference-to-video', 'P2V', '1080p', 30],
  ['fal-ai/kling-video/o3/pro/reference-to-video', 'P2V', undefined, 15],
  ['kling/v4/flash/reference-to-video', 'P2V', '720p', 20],
  ['minimax/h3-max/reference-to-video', 'P2V', '480P', 15],
  ['fal-ai/vidu/q4/reference-to-video', 'P2V', '4K', 16],
  ['google/gemini-omni-flash/v1.2/reference-to-video', 'P2V', '4k', 15],
];

test('all eleven models save; invalid model settings and wrong media are rejected', async t => {
  const f = await fixture(); t.after(() => f.close());
  const cookie = await f.login(); const headers = { cookie, origin: f.config.origin };
  const image = await f.upload(cookie, await imageBytes());
  const video = await f.upload(cookie, await videoBytes(f.root), 'video/mp4', 'clip.mp4');
  const short = await f.upload(cookie, await videoBytes(f.root, 1), 'video/mp4', 'short.mp4');
  async function save(payload: unknown, expected: number) {
    const response = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers, payload: payload as object });
    assert.equal(response.statusCode, expected, response.body); return response;
  }
  for (const [model, mode, resolution, max] of cases) {
    await t.test(model, async () => {
      const recast = model === 'minimax/h3-max/recast';
      const input: SlotInput = { description: 'Первые три слова описания сюжета', visible: true, thumbnailId: image.id, model, mode, referenceIds: [], ...(resolution ? { resolution } : {}), ...(recast ? { recastShotsConfirmed: true } : { prompt: 'Transform the visitor' }), ...(mode === 'V2V' ? { videoId: video.id } : { duration: max }), ...(model === 'minimax/h3-max/reference-to-video' ? { promptExpansionMode: 'disabled' } : {}) };
      const saved = (await save(input, 201)).json<Slot>();
      const read = await f.app.inject({ url: `/api/admin/slots/${saved.id}`, headers });
      assert.equal(read.statusCode, 200); assert.deepEqual(read.json(), saved);
      await save({ ...input, prompt: recast ? 'Forbidden prompt' : '' }, 400);
      await save({ ...input, resolution: 'not-a-resolution' }, 400);
      await save({ ...input, mode: mode === 'V2V' ? 'P2V' : 'V2V' }, 400);
      await save(mode === 'P2V' ? { ...input, duration: max + 1 } : { ...input, videoId: short.id }, 400);
      await save(mode === 'P2V' ? { ...input, referenceIds: [video.id] } : { ...input, videoId: image.id }, 400);
      if (recast) await save({ ...input, recastShotsConfirmed: false }, 400);
    });
  }
  const base = { description: 'P2V без демо', visible: false, thumbnailId: image.id, model: 'kling/v4/reference-to-video', mode: 'P2V', resolution: '720p', prompt: '@Element1 visits @Image1', duration: 10, referenceIds: [image.id, image.id, image.id] };
  await save(base, 201);
  await save({ ...base, referenceIds: [image.id, image.id, image.id, image.id] }, 400);
  await save({ ...base, thumbnailId: video.id }, 400);
  await save({ ...base, thumbnailId: randomUUID() }, 400);
  await save({ ...base, demoId: image.id }, 400);
  const foreign = await f.upload(cookie, await imageBytes());
  const db = openDatabase(f.config.dataDir); db.prepare('UPDATE slot_media SET owner=? WHERE id=?').run('session', foreign.id); db.close();
  await save({ ...base, thumbnailId: foreign.id }, 400);
  const list = await f.app.inject({ url: '/api/admin/slots', headers });
  assert.equal(list.json().length, 12);
});

test('real file validation, immutable replacement and restart preserve old media', async t => {
  const f = await fixture(); t.after(() => f.close());
  const cookie = await f.login(); const headers = { cookie, origin: f.config.origin };
  const bytes = await imageBytes();
  for (const [data, mime, name] of [[Buffer.from('not an image'), 'image/png', 'bad.png'], [Buffer.from('not a video'), 'video/mp4', 'bad.mp4'], [bytes, 'application/javascript', 'script.js']] as const) {
    const part = multipart(data, mime, name);
    const response = await f.app.inject({ method: 'POST', url: '/api/admin/slot-media', headers: { ...headers, 'content-type': part.contentType }, payload: part.bytes });
    assert.ok([400, 415].includes(response.statusCode), response.body);
  }
  const old = await f.upload(cookie, bytes); const replacement = await f.upload(cookie, bytes);
  assert.notEqual(old.id, replacement.id);
  const input = { description: 'Сохранённый сюжет после перезапуска', visible: true, thumbnailId: old.id, mode: 'P2V', model: 'kling/v4/reference-to-video', referenceIds: [old.id], prompt: 'A visitor', duration: 10, resolution: '720p' };
  const created = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers, payload: input });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const updated = await f.app.inject({ method: 'PUT', url: `/api/admin/slots/${id}`, headers, payload: { ...input, thumbnailId: replacement.id, referenceIds: [replacement.id], visible: false } });
  assert.equal(updated.statusCode, 200, updated.body);
  await f.restart();
  const read = await f.app.inject({ url: `/api/admin/slots/${id}`, headers });
  assert.equal(read.statusCode, 200); assert.deepEqual(read.json(), updated.json());
  for (const media of [old, replacement]) {
    const response = await f.app.inject({ url: `/api/admin/slot-media/${media.id}`, headers });
    assert.equal(response.statusCode, 200); assert.deepEqual(response.rawPayload, bytes);
    assert.match(String(response.headers['content-type']), /image\/png/);
  }
});
