/** Legacy manual slot-test acceptance uses ordinary admin/capture APIs, real private
 * files/SQLite and injected provider transport. No camera or paid calls. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, imageBytes, multipart, videoBytes, seedLegacySlot } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { readSession } from '../src/server/sessions/index.js';
import { createGenerationWorker, type GenerationOptions } from '../src/server/sessions/generation.js';
import { publishReady } from '../src/server/sessions/receive.js';
import { createEventCleanup } from '../src/server/sessions/cleanup.js';
import { normalizeSlotForEditor, type SlotInput } from '../src/shared/scenarios.js';
import type { CaptureStatus } from '../src/shared/capture.js';
const installation = { authorization: `Bearer ${'a'.repeat(43)}` };
async function setup(t: TestContext) {
  const f = await fixture(); t.after(() => f.close()); const cookie = await f.login();
  const admin = { cookie, origin: f.config.origin }; const operator = await f.login('operator');
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const thumb = await f.upload(cookie, await imageBytes());
  const jpeg = await sharp(await imageBytes()).jpeg().toBuffer();
  const photo = await f.upload(cookie, jpeg, 'image/jpeg', 'test.jpg');
  const input: SlotInput = { description: 'Ручной тест сюжета', visible: false, simulateGeneration: true, testPhotoId: photo.id,
    thumbnailId: thumb.id, mode: 'P2V', model: 'kling/v4/reference-to-video', referenceIds: [], prompt: '@Element1 walks', resolution: '720p', duration: 3 };
  async function save(value: SlotInput = input, id?: string) {
    return seedLegacySlot(db, value, id);
  }
  const send = (slotId: string, startRequestId = randomUUID()) => f.app.inject({ method: 'POST', url: `/api/admin/slots/${slotId}/test-generations`, headers: admin, payload: { startRequestId } });
  const get = async (slotId: string, id: string) => (await f.app.inject({ url: `/api/admin/slots/${slotId}/sessions/${id}`, headers: admin })).json<CaptureStatus>();
  const photos = (id: string) => db.prepare('SELECT pose_index,path FROM capture_photos WHERE session_id=? ORDER BY pose_index').all(id) as { pose_index: number; path: string }[];
  function worker(options: GenerationOptions = {}) { return createGenerationWorker(db, f.config.dataDir, f.config.origin, f.app.log, { ...options, publishReady: id => publishReady(db, f.config.dataDir, id, f.config.origin) }); }
  return { f, db, admin, operator, jpeg, photo, thumb, input, save, send, get, photos, worker };
}

test('legacy manual hidden-slot tests own 1/4 photos, snapshot-only fixture and idempotent real/simulated processing; camera stays separate', async t => {
  const h = await setup(t); const { f, db } = h;
  const slot = await h.save(); const key = randomUUID();
  const response = await h.send(slot.id, key); assert.equal(response.statusCode, 201, response.body);
  const first = response.json<CaptureStatus>(); assert.equal(first.finalized, true); assert.deepEqual(first.acceptedPoseIndices, [0,1,2,3]);
  const snapshot = readSession(db, first.sessionId).snapshot;
  assert.equal(snapshot.testPhotoId, h.photo.id); assert.equal('testPhotoId' in snapshot.generation, false);
  for (const photo of h.photos(first.sessionId)) { assert.notEqual(photo.path, h.photo.id); assert.deepEqual(await readFile(join(f.config.dataDir, 'media', photo.path)), h.jpeg); }
  assert.equal(new Set(h.photos(first.sessionId).map(p => p.path)).size, 4);
  assert.equal((await h.send(slot.id, key)).json().sessionId, first.sessionId);
  let calls = 0; const forbidden = async (): Promise<never> => { calls++; throw new Error('External transport forbidden'); };
  let worker = h.worker({ client: { submit: forbidden, status: forbidden, result: forbidden }, download: forbidden });
  await worker.runOnce(); await worker.stop(); assert.equal(calls, 0);
  assert.equal((await h.get(slot.id, first.sessionId)).state, 'simulated');
  assert.equal((await h.send(slot.id, key)).statusCode, 200);
  const bytes = await videoBytes(f.root, 5); const video = await f.upload(h.admin.cookie, bytes, 'video/mp4', 'source.mp4');
  const recast = await h.save({ ...h.input, mode: 'V2V', model: 'minimax/h3-max/recast', resolution: '768P', duration: undefined, prompt: undefined, videoId: video.id, recastShotsConfirmed: true, simulateGeneration: false });
  const realKey = randomUUID(); const real = (await h.send(recast.id, realKey)).json<CaptureStatus>();
  assert.deepEqual(real.acceptedPoseIndices, [0]);
  const count = { submit: 0, status: 0, result: 0, download: 0 };
  worker = h.worker({ client: {
    async submit(model, payload) { count.submit++; assert.equal(model, 'minimax/h3-max/recast'); assert.equal((payload.reference_image_urls as string[]).length, 1); assert.equal('testPhotoId' in payload, false); return { request_id: 'manual-real' }; },
    async status() { count.status++; return { status: 'COMPLETED' }; }, async result() { count.result++; return { video: { url: 'https://fixture.test/result.mp4' } }; },
  }, download: async () => { count.download++; return new Response(bytes); } });
  for (let i = 0; i < 4; i++) await worker.runOnce();
  assert.equal((await h.get(recast.id, real.sessionId)).state, 'ready');
  for (let i = 0; i < 2; i++) assert.equal((await h.send(recast.id, realKey)).json().sessionId, real.sessionId);
  await worker.runOnce(); await worker.stop(); assert.deepEqual(count, { submit: 1, status: 1, result: 1, download: 1 });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM capture_sessions').get() as { n: number }).n, 2);
  // Ordinary camera start never copies the fixture and never puts it in its snapshot.
  await h.save({ ...h.input, visible: true }, slot.id);
  const cameraKey = randomUUID();
  const camera = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId: slot.id, startRequestId: cameraKey } });
  const cameraId = camera.json().sessionId;
  assert.equal(readSession(db, cameraId).snapshot.testPhotoId, undefined); assert.equal(h.photos(cameraId).length, 0);
  const own = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  const part = multipart(own, 'image/jpeg', 'camera.jpg');
  assert.equal((await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${cameraId}/photos/0`, headers: { ...installation, 'content-type': part.contentType }, payload: part.bytes })).statusCode, 200);
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', h.photos(cameraId)[0].path)), own);
  assert.equal((await h.send(slot.id, cameraKey)).json().code, 'START_CONFLICT');
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId: slot.id, startRequestId: key } })).json().code, 'START_CONFLICT');
  const catalog = await f.app.inject({ url: '/api/catalog', headers: installation }); assert.doesNotMatch(catalog.body, /testPhotoId|simulateGeneration/);
  assert.equal((await f.app.inject({ url: `/api/catalog/${slot.id}/media/${h.photo.id}`, headers: installation })).statusCode, 404);
});

test('legacy manual request retry, concurrent preparation and partial restart retain the original fixture; preparation failure is terminal', async t => {
  const h = await setup(t); const { f, db } = h; const slot = await h.save(); const key = randomUUID();
  const results = await Promise.all([h.send(slot.id, key), h.send(slot.id, key)]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [201,409]);
  assert.equal(results.find(r => r.statusCode === 409)!.json().code, 'TEST_IN_PROGRESS');
  const accepted = results.find(r => r.statusCode === 201)!.json<CaptureStatus>();
  const id = accepted.sessionId; const original = h.photos(id);
  // Persisted partial preparation after a process interruption, before finalize.
  db.prepare("UPDATE capture_sessions SET state='capturing' WHERE id=?").run(id);
  db.prepare('DELETE FROM capture_photos WHERE session_id=? AND pose_index>0').run(id);
  for (const p of original.slice(1)) await rm(join(f.config.dataDir, 'media', p.path));
  const changedBytes = await sharp(await imageBytes()).resize(32,32).jpeg().toBuffer();
  const changed = await f.upload(h.admin.cookie, changedBytes, 'image/jpeg', 'changed.jpg');
  await h.save({ ...h.input, testPhotoId: changed.id, simulateGeneration: false }, slot.id);
  await f.restart();
  const recovered = await h.send(slot.id, key); assert.equal(recovered.statusCode, 200); assert.equal(recovered.json().sessionId, id);
  assert.equal(h.photos(id)[0].path, original[0].path);
  for (const p of h.photos(id)) assert.deepEqual(await readFile(join(f.config.dataDir, 'media', p.path)), h.jpeg);
  assert.equal(readSession(db, id).snapshot.generation.simulateGeneration, true);
  const worker = h.worker(); await worker.runOnce(); await worker.stop(); assert.equal((await h.get(slot.id, id)).state, 'simulated');
  const next = await h.send(slot.id); assert.equal(next.statusCode, 201); assert.notEqual(next.json().sessionId, id); assert.equal(next.json().number, accepted.number + 1);
  for (const p of h.photos(next.json().sessionId)) assert.deepEqual(await readFile(join(f.config.dataDir, 'media', p.path)), changedBytes);
  assert.equal(readSession(db, next.json().sessionId).snapshot.testPhotoId, changed.id);
  // Missing and corrupt stored sources become safe failed sessions, never pending.
  for (const corruption of ['missing', 'invalid-jpeg']) {
    const source = await f.upload(h.admin.cookie, h.jpeg, 'image/jpeg', 'broken.jpg');
    await h.save({ ...h.input, testPhotoId: source.id }, slot.id);
    const path = join(f.config.dataDir, 'media', source.id);
    if (corruption === 'missing') await rm(path); else await writeFile(path, 'not-a-jpeg');
    const failedKey = randomUUID(); const failed = (await h.send(slot.id, failedKey)).json<CaptureStatus>();
    assert.equal(failed.state, 'failed'); assert.equal(failed.error?.code, 'TEST_PREPARATION_FAILED');
    assert.match(failed.error!.message, /тестовую фотографию/); assert.doesNotMatch(JSON.stringify(failed), /ENOENT|not-a-jpeg|\/tmp\//);
    assert.equal((await h.send(slot.id, failedKey)).json().sessionId, failed.sessionId);
    assert.equal(db.prepare('SELECT request_id FROM generation_jobs WHERE session_id=?').get(failed.sessionId) && (db.prepare('SELECT request_id FROM generation_jobs WHERE session_id=?').get(failed.sessionId) as any).request_id, null);
    assert.equal(h.photos(failed.sessionId).length, 0);
  }
});

test('test settings and routes validate JPEG/size, saved slot/body, account/origin and matching session', async t => {
  const h = await setup(t); const { f, db } = h;
  const slot = await h.save(); const valid = (await h.send(slot.id)).json<CaptureStatus>();
  for (const headers of [{ origin: f.config.origin }, { ...installation, origin: f.config.origin }, { cookie: h.operator, origin: f.config.origin }]) {
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/admin/slots/${slot.id}/test-generations`, headers, payload: { startRequestId: randomUUID() } })).statusCode, 'cookie' in headers || 'authorization' in headers ? 403 : 401);
    assert.equal((await f.app.inject({ url: `/api/admin/slots/${slot.id}/sessions/${valid.sessionId}`, headers })).statusCode, 'cookie' in headers || 'authorization' in headers ? 403 : 401);
  }
  assert.equal((await f.app.inject({ method: 'POST', url: `/api/admin/slots/${slot.id}/test-generations`, headers: { cookie: h.admin.cookie, origin: 'https://other.test' }, payload: { startRequestId: randomUUID() } })).statusCode, 403);
  for (const override of [{ testPhotoId: h.photo.id }, { path: '/tmp/private' }, { simulateGeneration: false }, { url: 'https://external.test/input' }]) {
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/admin/slots/${slot.id}/test-generations`, headers: h.admin, payload: { startRequestId: randomUUID(), ...override } })).statusCode, 400);
  }
  const other = await h.save(); assert.equal((await f.app.inject({ url: `/api/admin/slots/${other.id}/sessions/${valid.sessionId}`, headers: h.admin })).statusCode, 404);
  const noPhoto = await h.save({ ...h.input, testPhotoId: undefined });
  assert.equal((await h.send(noPhoto.id)).json().code, 'TEST_PHOTO_REQUIRED');
  assert.equal((await h.send(randomUUID())).statusCode, 404);
  for (const bad of [h.thumb.id, h.photo.id]) {
    if (bad === h.photo.id) db.prepare('UPDATE slot_media SET size=? WHERE id=?').run(20 * 1024 * 1024 + 1, bad);
    const saved = await f.app.inject({ method: 'PUT', url: `/api/admin/slots/${slot.id}`, headers: h.admin, payload: { ...normalizeSlotForEditor(h.input), testPhotoId: bad } });
    assert.equal(saved.statusCode, 400); assert.equal(saved.json().code, 'INVALID_PHOTO');
  }
  for (const [bytes, mime] of [[Buffer.from('bad jpeg'), 'image/jpeg'], [await imageBytes(), 'image/jpeg']] as const) {
    const part = multipart(bytes, mime, 'wrong.jpg');
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/slot-media', headers: { ...h.admin, 'content-type': part.contentType }, payload: part.bytes })).statusCode, 400);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM capture_sessions').get() as { n: number }).n, 1);
});

test('event cleanup removes owned test copies while preserving current fixture and another day snapshot source', async t => {
  const h = await setup(t); const { f, db } = h; const slot = await h.save();
  const dayOne = (await h.send(slot.id)).json<CaptureStatus>();
  f.advance(86400_000); const dayTwo = (await h.send(slot.id)).json<CaptureStatus>();
  const newPhoto = await f.upload(h.admin.cookie, h.jpeg, 'image/jpeg', 'new.jpg');
  await h.save({ ...h.input, testPhotoId: newPhoto.id }, slot.id);
  const current = (await h.send(slot.id)).json<CaptureStatus>();
  let deletes = 0; const cleanup = createEventCleanup(db, f.config.dataDir, f.app.log, () => Date.UTC(2026,0,3), { deleteOutput: async () => { deletes++; } });
  await cleanup.remove(dayOne.date);
  await assert.rejects(readdir(join(f.config.dataDir, 'media', 'sessions', dayOne.sessionId)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', h.photo.id)), h.jpeg);
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', newPhoto.id)), h.jpeg);
  assert.equal(h.photos(dayTwo.sessionId).length, 4); assert.equal(h.photos(current.sessionId).length, 4);
  await cleanup.remove(dayTwo.date); await cleanup.stop(); assert.equal(deletes, 0);
  await assert.rejects(readFile(join(f.config.dataDir, 'media', h.photo.id)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', newPhoto.id)), h.jpeg);
  assert.equal(db.prepare('SELECT 1 FROM capture_sessions LIMIT 1').get(), undefined);
});
