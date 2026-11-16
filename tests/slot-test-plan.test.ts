/** Module contract: local acceptance for distinct manual-test sources and prompt
 * asset delivery. Uses isolated SQLite/media and sampled files, never fal/camera
 * or a catalogue-wide scan. Source: docs/slot-setup/matrix.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import sharp from 'sharp';
import { fixture, imageBytes } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { readSession } from '../src/server/sessions/index.js';
import { createGenerationWorker } from '../src/server/sessions/generation.js';
import { createEventCleanup } from '../src/server/sessions/cleanup.js';
import { materialIds } from '../src/server/scenarios/cleanup.js';
import type { CaptureStatus } from '../src/shared/capture.js';
import type { ConfiguredSlotInput } from '../src/shared/scenarios.js';
const installation = { authorization: `Bearer ${'a'.repeat(43)}` };

test('new manual test copies every active JPEG by saved pose; retry, ordinary capture and cleanup preserve ownership', async t => {
  const f = await fixture(); t.after(() => f.close()); const cookie = await f.login();
  const headers = { cookie, origin: f.config.origin }; const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const thumbnail = await f.upload(cookie, await imageBytes());
  const images = await Promise.all(['#112233', '#445566', '#778899', '#aabbcc', '#ddaabb'].map(color => sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).jpeg().toBuffer()));
  const media = [];
  for (const bytes of images) media.push(await f.upload(cookie, bytes, 'image/jpeg', 'pose.jpg'));
  const config: ConfiguredSlotInput = { description: 'Два человека и отдельные фото', visible: false, thumbnailId: thumbnail.id,
    mode: 'P2V', model: 'minimax/h3-max/reference-to-video', participants: 2, photosPerParticipant: 2,
    orientation: 'landscape', aspectRatio: '16:9', resolution: '768P', duration: 3, prompt: 'Two people', promptExpansionMode: 'disabled', referenceIds: [], simulateGeneration: true, testPhotoIds: media.slice(0, 4).map(m => m.id) };
  const save = async (input: ConfiguredSlotInput, id?: string) => f.app.inject({ method: id ? 'PUT' : 'POST', url: id ? `/api/admin/slots/${id}` : '/api/admin/slots', headers, payload: input });
  const saved = await save(config); assert.equal(saved.statusCode, 201, saved.body); const slotId = saved.json().id;
  const send = (key = randomUUID()) => f.app.inject({ method: 'POST', url: `/api/admin/slots/${slotId}/test-generations`, headers, payload: { startRequestId: key } });
  const photos = (id: string) => db.prepare('SELECT pose_index,path FROM capture_photos WHERE session_id=? ORDER BY pose_index').all(id) as { pose_index: number; path: string }[];
  const key = randomUUID(); const response = await send(key); assert.equal(response.statusCode, 201, response.body);
  const first = response.json<CaptureStatus>(); assert.equal(first.finalized, true); assert.deepEqual(first.acceptedPoseIndices, [0, 1, 2, 3]);
  const snapshot = readSession(db, first.sessionId).snapshot;
  assert.deepEqual(snapshot.testPhotoIds, config.testPhotoIds); assert.equal(snapshot.testPhotoId, undefined); assert.equal('testPhotoIds' in snapshot.generation, false);
  assert.deepEqual(snapshot.posePlan!.map(pose => pose.participant), [1, 1, 2, 2]);
  for (const row of photos(first.sessionId)) assert.deepEqual(await readFile(join(f.config.dataDir, 'media', row.path)), images[row.pose_index]);
  assert.equal((await send(key)).json().sessionId, first.sessionId);
  // Simulate an interrupted preparation after position zero, then edit current sources.
  const originalPhotos = photos(first.sessionId);
  db.prepare("UPDATE capture_sessions SET state='capturing' WHERE id=?").run(first.sessionId);
  db.prepare('DELETE FROM capture_photos WHERE session_id=? AND pose_index>0').run(first.sessionId);
  for (const row of originalPhotos.slice(1)) await rm(join(f.config.dataDir, 'media', row.path));
  const changed = { ...config, testPhotoIds: [media[4].id, ...config.testPhotoIds!.slice(1)] };
  assert.equal((await save(changed, slotId)).statusCode, 200);
  await f.restart(); assert.equal((await send(key)).statusCode, 200);
  assert.equal(photos(first.sessionId)[0].path, originalPhotos[0].path);
  for (const row of photos(first.sessionId)) assert.deepEqual(await readFile(join(f.config.dataDir, 'media', row.path)), images[row.pose_index]);
  let calls = 0; const forbidden = async (): Promise<never> => { calls++; throw new Error('External transport forbidden'); };
  const worker = createGenerationWorker(db, f.config.dataDir, f.config.origin, f.app.log, { client: { submit: forbidden, status: forbidden, result: forbidden }, download: forbidden });
  await worker.runOnce(); await worker.stop(); assert.equal(calls, 0); assert.equal(readSession(db, first.sessionId).state, 'simulated');
  // The next day's snapshot pins the old sources independently of current-slot edits.
  assert.equal((await save(config, slotId)).statusCode, 200); f.advance(86400_000);
  const second = (await send()).json<CaptureStatus>();
  assert.equal((await save({ ...changed, visible: true }, slotId)).statusCode, 200);
  const camera = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: randomUUID() } });
  assert.equal(camera.statusCode, 201, camera.body);
  assert.equal(readSession(db, camera.json().sessionId).snapshot.testPhotoIds, undefined); assert.equal(photos(camera.json().sessionId).length, 0);
  const conflict = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: key } });
  assert.equal(conflict.json().code, 'START_CONFLICT');
  const catalogue = await f.app.inject({ url: '/api/catalog', headers: installation }); assert.doesNotMatch(catalogue.body, /testPhotoIds|simulateGeneration/);
  assert(config.testPhotoIds!.every(id => materialIds(snapshot).includes(id)));
  const cleanup = createEventCleanup(db, f.config.dataDir, f.app.log, () => Date.UTC(2026, 0, 3));
  await cleanup.remove(first.date);
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', media[0].id)), images[0]);
  await cleanup.remove(second.date); await cleanup.stop();
  await assert.rejects(readFile(join(f.config.dataDir, 'media', media[0].id)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', media[4].id)), images[4]);
});

test('new test arrays reject incomplete, duplicate, excess and non-JPEG inputs; group uses distinct ordered positions', async t => {
  const f = await fixture(); t.after(() => f.close()); const cookie = await f.login(); const headers = { cookie, origin: f.config.origin };
  const db = openDatabase(f.config.dataDir); t.after(() => db.close()); const thumbnail = await f.upload(cookie, await imageBytes());
  const ids: string[] = []; const bytes: Buffer[] = [];
  for (let i = 0; i < 3; i++) { bytes.push(await sharp({ create: { width: 40 + i, height: 32, channels: 3, background: '#ddeecc' } }).jpeg().toBuffer()); ids.push((await f.upload(cookie, bytes[i], 'image/jpeg', `${i}.jpg`)).id); }
  const config: ConfiguredSlotInput = { description: 'Группа', visible: true, thumbnailId: thumbnail.id, mode: 'P2V', model: 'fal-ai/vidu/q4/reference-to-video', participants: 'group', photosPerParticipant: 3, orientation: 'portrait', aspectRatio: '9:16', resolution: '720p', duration: 3, prompt: 'Group', referenceIds: [], simulateGeneration: true };
  const save = (extra = {}) => f.app.inject({ method: 'POST', url: '/api/admin/slots', headers, payload: { ...config, ...extra } });
  for (const testPhotoIds of [[ids[0]], [ids[0], ids[0], ids[1]], [...ids, ids[0]], [thumbnail.id, ids[1], ids[2]]]) assert.equal((await save({ testPhotoIds })).statusCode, 400);
  const noSet = await save({ testPhotoId: ids[0] }); assert.equal(noSet.statusCode, 201);
  const denied = await f.app.inject({ method: 'POST', url: `/api/admin/slots/${noSet.json().id}/test-generations`, headers, payload: { startRequestId: randomUUID() } });
  assert.equal(denied.json().code, 'TEST_PHOTOS_REQUIRED');
  const group = await save({ testPhotoIds: ids }); assert.equal(group.statusCode, 201, group.body);
  const response = await f.app.inject({ method: 'POST', url: `/api/admin/slots/${group.json().id}/test-generations`, headers, payload: { startRequestId: randomUUID() } });
  assert.equal(response.statusCode, 201, response.body); const snapshot = readSession(db, response.json().sessionId).snapshot;
  assert.deepEqual(snapshot.posePlan!.map(pose => [pose.index, pose.participant, pose.guideNumber]), [[0,'group',5],[1,'group',5],[2,'group',5]]);
  const rows = db.prepare('SELECT pose_index,path FROM capture_photos WHERE session_id=? ORDER BY pose_index').all(response.json().sessionId) as {pose_index:number;path:string}[];
  for (const row of rows) assert.deepEqual(await readFile(join(f.config.dataDir, 'media', row.path)), bytes[row.pose_index]);
});

test('sampled prompt assets serve verbatim including empty Recast, with revalidation and real missing-file errors', async t => {
  const f = await fixture(); t.after(() => f.close());
  const files = ['recast/people-1__photos-1__refs-0.md', 'h3-reference/people-2__photos-4__refs-1.md'];
  for (const file of files) {
    const target = join(f.config.clientDir, 'slot-prompts', file); await mkdir(dirname(target), { recursive: true });
    await copyFile(join('public/slot-prompts', file), target);
  }
  await f.restart();
  for (const file of files) {
    const response = await f.app.inject({ url: `/slot-prompts/${file}` });
    assert.equal(response.statusCode, 200, response.body); assert.equal(response.body, await readFile(join('public/slot-prompts', file), 'utf8'));
    assert.equal(response.headers['cache-control'], 'no-cache'); assert.doesNotMatch(String(response.headers['cache-control']), /immutable/); assert(response.headers.etag);
    assert.equal((await f.app.inject({ url: `/slot-prompts/${file}`, headers: { 'if-none-match': response.headers.etag! } })).statusCode, 304);
  }
  assert.equal((await f.app.inject({ url: '/slot-prompts/missing.md' })).statusCode, 404);
});
