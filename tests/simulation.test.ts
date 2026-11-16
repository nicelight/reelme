/** Slot simulation acceptance: ordinary capture APIs, isolated SQLite/files and
 * controlled transports. No external provider or SMTP requests. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, imageBytes, multipart, videoBytes } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';
import { createGenerationWorker, type GenerationOptions } from '../src/server/sessions/generation.js';
import { createEventCleanup } from '../src/server/sessions/cleanup.js';
import { publishReady } from '../src/server/sessions/receive.js';
import { readSession } from '../src/server/sessions/index.js';
import type { CaptureStatus } from '../src/shared/capture.js';
import type { Slot, SlotInput } from '../src/shared/scenarios.js';
import type { TodayDisplay } from '../src/shared/display.js';

const installation = { authorization: `Bearer ${'a'.repeat(43)}` };
async function setup(t: TestContext) {
  const f = await fixture(); t.after(() => f.close());
  const cookie = await f.login(); const operator = await f.login('operator');
  const admin = { cookie, origin: f.config.origin };
  const image = await f.upload(cookie, await imageBytes());
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const jpeg = await sharp(await imageBytes()).jpeg().toBuffer();
  const input: SlotInput = { participants: 1, photosPerParticipant: 4, orientation: 'landscape', aspectRatio: '16:9', description: 'Проверяем сюжет', visible: true, simulateGeneration: true,
    thumbnailId: image.id, mode: 'P2V', model: 'kling/v4/reference-to-video',
    referenceIds: [image.id], prompt: '@Element1 walks', resolution: '720p', duration: 3 };
  async function save(value: unknown = input, id?: string) {
    const res = await f.app.inject({ method: id ? 'PUT' : 'POST', url: `/api/admin/slots${id ? '/' + id : ''}`, headers: admin, payload: value as any });
    assert.equal(res.statusCode, id ? 200 : 201, res.body); return res.json<Slot>();
  }
  async function start(slotId: string) {
    const res = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: randomUUID() } });
    assert.equal(res.statusCode, 201, res.body); return res.json<CaptureStatus>().sessionId;
  }
  async function photos(id: string, count = 4) {
    const part = multipart(jpeg, 'image/jpeg', 'visitor.jpg');
    for (const pose of Array.from({ length: count }, (_, i) => count - i - 1)) {
      const res = await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${id}/photos/${pose}`, headers: { ...installation, 'content-type': part.contentType }, payload: part.bytes });
      assert.equal(res.statusCode, 200, res.body);
    }
  }
  async function finalize(id: string) {
    const res = await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${id}/finalize`, headers: installation });
    assert.equal(res.statusCode, 200, res.body);
  }
  const status = async (id: string) => (await f.app.inject({ url: `/api/capture/sessions/${id}`, headers: installation })).json<CaptureStatus>();
  const display = async () => (await f.app.inject({ url: '/api/display/today', headers: { cookie: operator } })).json<TodayDisplay>();
  function worker(options: GenerationOptions = {}) {
    return createGenerationWorker(db, f.config.dataDir, f.config.origin, f.app.log, { ...options, publishReady: id => publishReady(db, f.config.dataDir, id) });
  }
  return { f, db, admin, operator, input, jpeg, save, start, photos, finalize, status, display, worker };
}
function forbiddenTransport() {
  const calls = { submit: 0, status: 0, result: 0, download: 0, delete: 0 };
  const reject = (kind: keyof typeof calls): never => { calls[kind]++; throw new Error(`Forbidden ${kind}`); };
  const options: GenerationOptions = {
    client: { submit: async () => reject('submit'), status: async () => reject('status'), result: async () => reject('result') },
    download: async () => reject('download'), deleteOutput: async () => reject('delete'),
  };
  return { calls, options };
}

test('simulation default, admin-only persistence, catalog privacy and immutable old/new snapshots; real positive control', async t => {
  const h = await setup(t); const { f, db } = h;
  const { simulateGeneration: _, participants: _people, photosPerParticipant: _photos, orientation: _orientation, aspectRatio: _ratio, ...legacyInput } = h.input;
  const slot = await h.save({ ...h.input, simulateGeneration: undefined }); assert.equal(slot.simulateGeneration, false);
  // Actual legacy stored JSON, not just omitted incoming field.
  db.prepare('UPDATE slots SET config=? WHERE id=?').run(JSON.stringify(legacyInput), slot.id);
  for (const url of ['/api/admin/slots', `/api/admin/slots/${slot.id}`]) {
    const value = (await f.app.inject({ url, headers: h.admin })).json();
    assert.equal((Array.isArray(value) ? value[0] : value).simulateGeneration, false);
  }
  const old = await h.start(slot.id);
  const snapshot = readSession(db, old).snapshot;
  delete (snapshot.generation as Partial<typeof snapshot.generation>).simulateGeneration;
  db.prepare('UPDATE capture_sessions SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot), old);
  assert.equal(readSession(db, old).snapshot.generation.simulateGeneration, false);
  await h.save(h.input, slot.id);
  const simulated = await h.start(slot.id);
  await h.save({ ...h.input, simulateGeneration: false }, slot.id);
  assert.equal(readSession(db, simulated).snapshot.generation.simulateGeneration, true);
  assert.equal(readSession(db, old).snapshot.generation.simulateGeneration, false);
  for (const headers of [{ origin: f.config.origin }, { ...installation, origin: f.config.origin }, { cookie: h.operator, origin: f.config.origin }]) {
    for (const method of ['POST', 'PUT'] as const) {
      const response = await f.app.inject({ method, url: `/api/admin/slots${method === 'PUT' ? '/' + slot.id : ''}`, headers, payload: h.input });
      assert.equal(response.statusCode, 'cookie' in headers || 'authorization' in headers ? 403 : 401);
    }
  }
  const catalog = await f.app.inject({ url: '/api/catalog', headers: installation });
  assert.equal(catalog.statusCode, 200); assert.doesNotMatch(catalog.body, /simulateGeneration|prompt|testPhoto/);
  for (const id of [old, simulated]) { await h.photos(id); await h.finalize(id); }
  const bytes = await videoBytes(f.root, 1);
  const calls = { submit: 0, status: 0, result: 0, download: 0 };
  const w = h.worker({ client: {
    async submit(endpoint, payload) {
      calls.submit++; assert.equal(endpoint, 'kling/v4/reference-to-video');
      assert.deepEqual(Object.keys(payload).sort(), ['duration', 'elements', 'image_urls', 'prompt', 'resolution']);
      assert.equal(payload.prompt, '@Element1 walks');
      return { request_id: 'controlled-real-id' };
    },
    async status(_model, id) { calls.status++; assert.equal(id, 'controlled-real-id'); return { status: 'COMPLETED' }; },
    async result() { calls.result++; return { video: { url: 'https://fixture.test/result.mp4' } }; },
  }, download: async () => { calls.download++; return new Response(bytes); } });
  for (let i = 0; i < 4; i++) await w.runOnce(); await w.stop();
  assert.deepEqual(calls, { submit: 1, status: 1, result: 1, download: 1 });
  assert.equal((await h.status(old)).state, 'ready'); assert.equal((await h.status(simulated)).state, 'simulated');
  const video = db.prepare('SELECT video_path FROM generation_jobs WHERE session_id=?').get(old) as { video_path: string };
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', video.video_path)), bytes);
  assert.ok(db.prepare('SELECT 1 FROM session_delivery WHERE session_id=?').get(old));
  assert.equal(db.prepare('SELECT 1 FROM session_delivery WHERE session_id=?').get(simulated), undefined);
});

test('one/four-photo simulations survive pending and terminal restart with zero provider calls, no delivery, ordinary archive/retention', async t => {
  const h = await setup(t); const { f, db } = h; const forbidden = forbiddenTransport();
  const p2v = await h.save();
  const bytes = await videoBytes(f.root, 5); const clip = await f.upload(h.admin.cookie, bytes, 'video/mp4', 'clip.mp4');
  const recast = await h.save({ participants: 1, photosPerParticipant: 1, orientation: 'landscape', description: 'Recast', visible: true, simulateGeneration: true, thumbnailId: h.input.thumbnailId,
    mode: 'V2V', model: 'minimax/h3-max/recast', videoId: clip.id, resolution: '768P', referenceIds: [], recastShotsConfirmed: true });
  const ids: string[] = [];
  for (const [slot, count] of [[p2v, 4], [recast, 1]] as const) {
    const id = await h.start(slot.id); ids.push(id); await h.photos(id, count); await h.finalize(id);
  }
  await f.restart(); let w = h.worker(forbidden.options); await w.runOnce(); await w.stop();
  await f.restart(); w = h.worker(forbidden.options); await w.runOnce(); await w.stop();
  for (const id of ids) {
    assert.equal((await h.status(id)).state, 'simulated');
    const job = db.prepare('SELECT request_id,result_url,video_path,frame_path FROM generation_jobs WHERE session_id=?').get(id);
    assert.deepEqual(job, { request_id: null, result_url: null, video_path: null, frame_path: null });
    const rows = db.prepare('SELECT path FROM capture_photos WHERE session_id=?').all(id) as { path: string }[];
    for (const row of rows) assert.deepEqual(await readFile(join(f.config.dataDir, 'media', row.path)), h.jpeg);
    assert.ok((await readdir(join(f.config.dataDir, 'media', 'sessions', id))).every(name => name.endsWith('.jpg')));
    assert.equal(db.prepare('SELECT 1 FROM session_delivery WHERE session_id=?').get(id), undefined);
    assert.equal((await f.app.inject({ url: `/api/display/${id}/qr`, headers: { cookie: h.operator } })).statusCode, 404);
  }
  const shown = (await h.display()).sessions;
  assert.equal(shown.length, 2);
  for (const row of shown) {
    assert.equal(row.card, null); assert.equal(row.stage, 0); assert.equal(row.hideAt, null);
    assert.deepEqual(row.simulation, { status: 'passed', message: 'Эмуляция успешна, но fal не отвечает', detail: 'Тестовый режим: fal не вызывался' });
  }
  f.advance(86400_000); assert.equal((await h.display()).sessions.length, 0);
  const archive = await f.app.inject({ url: '/api/events/2026-01-01', headers: h.admin });
  assert.equal(archive.statusCode, 200); assert.equal(archive.json().sessions.length, 2);
  assert.ok(archive.json().sessions.every((row: { videoUrl: unknown }) => row.videoUrl === null));
  const cleanup = createEventCleanup(db, f.config.dataDir, f.app.log, () => Date.UTC(2026, 0, 16), forbidden.options);
  await cleanup.runOnce(); await cleanup.stop();
  assert.equal(db.prepare('SELECT 1 FROM capture_sessions LIMIT 1').get(), undefined);
  for (const id of ids) await assert.rejects(readdir(join(f.config.dataDir, 'media', 'sessions', id)), { code: 'ENOENT' });
  assert.deepEqual(forbidden.calls, { submit: 0, status: 0, result: 0, download: 0, delete: 0 });
});

test('incomplete/order/missing-file/model-input failures never simulate success or call fal, including restart', async t => {
  const h = await setup(t); const { f, db } = h; const forbidden = forbiddenTransport();
  const slot = await h.save(); const ids: string[] = [];
  for (const kind of ['incomplete', 'order', 'photo-file', 'material-file', 'model-input']) {
    const id = await h.start(slot.id); ids.push(id); await h.photos(id, kind === 'incomplete' ? 3 : 4);
    if (kind === 'incomplete') {
      const final = await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${id}/finalize`, headers: installation });
      assert.equal(final.statusCode, 409);
      // Recover a damaged/persisted pending job: preparation must independently check completeness.
      db.prepare("UPDATE capture_sessions SET state='submit_pending' WHERE id=?").run(id);
    } else await h.finalize(id);
    if (kind === 'order') db.prepare('DELETE FROM capture_photos WHERE session_id=? AND pose_index=1').run(id);
    if (kind === 'photo-file') {
      const row = db.prepare('SELECT path FROM capture_photos WHERE session_id=? LIMIT 1').get(id) as { path: string };
      await rm(join(f.config.dataDir, 'media', row.path));
    }
    if (kind === 'material-file' || kind === 'model-input') {
      const snapshot = readSession(db, id).snapshot;
      if (kind === 'material-file') {
        const media = await f.upload(h.admin.cookie, await imageBytes());
        snapshot.generation.referenceIds = [media.id];
        const row = db.prepare('SELECT path FROM slot_media WHERE id=?').get(media.id) as { path: string };
        await rm(join(f.config.dataDir, 'media', row.path));
      } else snapshot.generation.duration = 999;
      db.prepare('UPDATE capture_sessions SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot), id);
    }
  }
  await f.restart(); let w = h.worker(forbidden.options); await w.runOnce(); await w.stop();
  await f.restart(); w = h.worker(forbidden.options); await w.runOnce(); await w.stop();
  for (const id of ids) {
    const status = await h.status(id); assert.equal(status.state, 'failed'); assert.equal(status.error?.code, 'INPUT_PREPARATION_FAILED');
    assert.match(status.error!.message, /подготовить фотографии или материалы/);
    assert.equal(db.prepare('SELECT 1 FROM session_delivery WHERE session_id=?').get(id), undefined);
  }
  for (const row of (await h.display()).sessions) { assert.equal(row.simulation?.status, 'failed'); assert.match(row.simulation!.detail!, /подготовить фотографии/); assert.equal(row.card, null); }
  assert.deepEqual(forbidden.calls, { submit: 0, status: 0, result: 0, download: 0, delete: 0 });
});

test('the application worker consumes pending simulation without FAL_KEY; real mode reports FAL_NOT_CONFIGURED', async t => {
  const h = await setup(t); const ids: string[] = [];
  for (const simulateGeneration of [true, false]) {
    const slot = await h.save({ ...h.input, simulateGeneration });
    const id = await h.start(slot.id); ids.push(id); await h.photos(id); await h.finalize(id);
  }
  const app = await createApp(h.f.config, { now: () => Date.UTC(2026, 0, 1) }); t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  for (let i = 0; i < 100; i++) {
    if (readSession(h.db, ids[0]).state === 'simulated' && readSession(h.db, ids[1]).state === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await h.status(ids[0])).state, 'simulated');
  assert.equal((await h.status(ids[1])).state, 'failed'); assert.equal((await h.status(ids[1])).error?.code, 'FAL_NOT_CONFIGURED');
  assert.equal((await h.display()).sessions[1].error, 'Сервис генерации не настроен. Обратитесь к сотруднику.');
  assert.equal(h.db.prepare('SELECT 1 FROM session_delivery LIMIT 1').get(), undefined);
});
