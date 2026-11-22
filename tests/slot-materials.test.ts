/** Module contract: real isolated import/guide APIs and immutable snapshot cleanup.
 * Local synthetic media only; no provider calls or project template files.
 * Source: docs/slot-setup/matrix.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, imageBytes, videoBytes } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { readSession } from '../src/server/sessions/index.js';
import { buildModelInput } from '../src/server/sessions/model-input.js';
import { slotProviderUrl } from '../src/server/sessions/provider-media.js';
import { createEventCleanup } from '../src/server/sessions/cleanup.js';
import { materialIds } from '../src/server/scenarios/cleanup.js';
import type { CaptureGuide } from '../src/shared/slot-setup.js';
import type { StartReceipt } from '../src/shared/capture.js';
const installation = { authorization: `Bearer ${'a'.repeat(43)}` };
const recast = 'minimax/h3-max/recast';
const flash = 'kling/v4/flash/video-to-video';
const p2v = 'kling/v4/reference-to-video';

test('named source imports preserve draft identity, provenance, ranges and old session bytes', async t => {
  const f = await fixture(); t.after(() => f.close()); const cookie = await f.login();
  const admin = { cookie, origin: f.config.origin }; const operator = await f.login('operator');
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const id = randomUUID(); const thumbnail = await f.upload(cookie, await imageBytes());
  const bytes = await videoBytes(f.root, 5);
  const importUrl = `/api/admin/slots/${id}/template-video`;
  for (const [headers, expected] of [[{}, 401], [{ cookie: operator }, 403], [installation, 403], [{ cookie }, 403]] as const) {
    assert.equal((await f.app.inject({ method: 'POST', url: importUrl, headers, payload: { orientation: 'landscape', model: recast } })).statusCode, expected);
  }
  const missing = await f.app.inject({ method: 'POST', url: importUrl, headers: admin, payload: { orientation: 'landscape', model: recast } });
  assert.equal(missing.statusCode, 404); assert.equal(missing.json().code, 'TEMPLATE_VIDEO_MISSING');
  const invalidId = await f.app.inject({ method: 'POST', url: '/api/admin/slots/not-a-uuid/template-video', headers: admin, payload: { orientation: 'landscape', model: recast } });
  assert.equal(invalidId.statusCode, 400);
  const input = { participants: 1, photosPerParticipant: 1, orientation: 'landscape', description: 'Fixed source', visible: true, thumbnailId: thumbnail.id, model: recast, mode: 'V2V', resolution: '768P', referenceIds: [], prompt: '', recastShotsConfirmed: true };
  const draft = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: admin, payload: { ...input, id } });
  assert.equal(draft.statusCode, 201, draft.body); assert.equal(draft.json().id, id);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: admin, payload: { ...input, id } })).statusCode, 409);
  assert.equal((await f.app.inject({ url: '/api/catalog', headers: installation })).json().total, 0);
  const uploaded = await f.upload(cookie, bytes, 'video/mp4', 'arbitrary.mp4');
  const put = (videoId: string, extra = {}) => f.app.inject({ method: 'PUT', url: `/api/admin/slots/${id}`, headers: admin, payload: { ...input, videoId, ...extra } });
  assert.equal((await put(uploaded.id)).json().code, 'TEMPLATE_VIDEO_MISMATCH');
  const source = await f.importTemplate(cookie, bytes, id);
  assert.equal((await put(source.id)).statusCode, 200);
  const stored = db.prepare('SELECT template_slot_id,template_orientation FROM slot_media WHERE id=?').get(source.id);
  assert.deepEqual(stored, { template_slot_id: id, template_orientation: 'landscape' });
  const wrongSlot = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: admin, payload: { ...input, id: randomUUID(), videoId: source.id } });
  assert.equal(wrongSlot.json().code, 'TEMPLATE_VIDEO_MISMATCH');
  assert.equal((await put(source.id, { orientation: 'portrait' })).statusCode, 400);
  const start = async () => {
    const result = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId: id, startRequestId: randomUUID() } });
    assert.equal(result.statusCode, 201, result.body); return result.json<StartReceipt>();
  };
  const before = await start();
  const changedBytes = await videoBytes(f.root, 6);
  await writeFile(join(f.config.templateVideosDir, `${id}__landscape.mp4`), changedBytes);
  assert.equal(readSession(db, before.sessionId).snapshot.generation.videoId, source.id);
  const providerPath = new URL(slotProviderUrl(db, f.config.origin, source.id)).pathname;
  assert.deepEqual((await f.app.inject({ url: providerPath })).rawPayload, bytes);
  const player = await f.app.inject({ url: `/api/admin/slot-media/${source.id}`, headers: { cookie, range: 'bytes=0-31' } });
  assert.equal(player.statusCode, 206); assert.deepEqual(player.rawPayload, bytes.subarray(0, 32));
  assert.equal(player.headers['content-range'], `bytes 0-31/${bytes.length}`);
  const replacement = await f.importTemplate(cookie, changedBytes, id);
  assert.notEqual(replacement.id, source.id); assert.equal((await put(replacement.id)).statusCode, 200);
  const after = await start(); assert.equal(readSession(db, after.sessionId).snapshot.generation.videoId, replacement.id);
  assert.equal(readSession(db, before.sessionId).snapshot.generation.videoId, source.id);
  assert.deepEqual((await f.app.inject({ url: providerPath })).rawPayload, bytes);
  await f.restart();
  assert.deepEqual((await f.app.inject({ url: `/api/admin/slot-media/${replacement.id}`, headers: { cookie } })).rawPayload, changedBytes);
  // Real orientation and duration are checked, not inferred from a filename.
  await mkdir(f.config.templateVideosDir, { recursive: true });
  await writeFile(join(f.config.templateVideosDir, `${id}__portrait.mp4`), bytes);
  assert.equal((await f.app.inject({ method: 'POST', url: importUrl, headers: admin, payload: { orientation: 'portrait', model: recast } })).json().code, 'VIDEO_ORIENTATION');
  await writeFile(join(f.config.templateVideosDir, `${id}__landscape.mp4`), await videoBytes(f.root, 1));
  assert.equal((await f.app.inject({ method: 'POST', url: importUrl, headers: admin, payload: { orientation: 'landscape', model: flash } })).json().code, 'MODEL_LIMIT');
  await truncate(join(f.config.templateVideosDir, `${id}__landscape.mp4`), 200_000_001);
  const oversized = await f.app.inject({ method: 'POST', url: importUrl, headers: admin, payload: { orientation: 'landscape', model: recast } });
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.json().code, 'FILE_TOO_LARGE');
});

test('already saved upload sources remain usable; arbitrary replacements need named import', async t => {
  const f = await fixture(); t.after(() => f.close()); const cookie = await f.login(); const admin = { cookie, origin: f.config.origin };
  const thumbnail = await f.upload(cookie, await imageBytes()); const bytes = await videoBytes(f.root, 5);
  const old = await f.upload(cookie, bytes, 'video/mp4', 'old.mp4'); const unrelated = await f.upload(cookie, bytes, 'video/mp4', 'new.mp4');
  const id = randomUUID(); const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const config = { participants: 1, photosPerParticipant: 1, orientation: 'landscape', description: 'Already saved source', visible: true, thumbnailId: thumbnail.id, videoId: old.id, model: recast, mode: 'V2V', resolution: '768P', referenceIds: [], recastShotsConfirmed: true };
  db.prepare('INSERT INTO slots(id,config) VALUES (?,?)').run(id, JSON.stringify(config));
  const save = (change = {}) => f.app.inject({ method: 'PUT', url: `/api/admin/slots/${id}`, headers: admin, payload: { ...config, ...change } });
  assert.equal((await save({ description: 'Edited existing source' })).statusCode, 200);
  assert.equal((await save({ videoId: unrelated.id })).json().code, 'TEMPLATE_VIDEO_MISMATCH');
  assert.equal((await save({ orientation: 'portrait' })).json().code, 'VIDEO_ORIENTATION');
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: admin, payload: config })).json().code, 'TEMPLATE_VIDEO_MISMATCH');
  const started = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId: id, startRequestId: randomUUID() } });
  assert.equal(started.statusCode, 201, started.body);
  const url = `/api/admin/slots/${id}`;
  const operator = await f.login('operator');
  for (const [headers, expected] of [[{}, 401], [{ cookie: operator, origin: f.config.origin }, 403], [{ cookie }, 403]] as const) {
    assert.equal((await f.app.inject({ method: 'DELETE', url, headers })).statusCode, expected);
  }
  assert.equal((await f.app.inject({ method: 'DELETE', url, headers: admin })).statusCode, 204);
  assert.equal((await f.app.inject({ url, headers: admin })).statusCode, 404);
  assert.deepEqual((await f.app.inject({ url: '/api/admin/slots', headers: admin })).json(), []);
  assert.equal((await f.app.inject('/api/public/catalog')).json().total, 0);
  assert.equal((await save()).statusCode, 404);
  const snapshot = readSession(db, started.json().sessionId).snapshot;
  assert.equal(snapshot.generation.videoId, old.id);
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', old.id)), bytes);
});

test('five admin guides are pinned to sessions, protected from cleanup and absent from fal inputs', async t => {
  const f = await fixture(); t.after(() => f.close()); const cookie = await f.login(); const operator = await f.login('operator');
  const admin = { cookie, origin: f.config.origin }; const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const image = await imageBytes(); const thumbnail = await f.upload(cookie, image);
  const jpeg = await f.upload(cookie, image); const nextImage = await f.upload(cookie, image);
  const demo = await f.upload(cookie, await videoBytes(f.root, 5), 'video/mp4', 'demo.mp4');
  const list = async () => (await f.app.inject({ url: '/api/admin/capture-guides', headers: { cookie } })).json<CaptureGuide[]>();
  assert.equal((await list()).length, 5); assert.ok((await list()).every(guide => !guide.mediaId));
  for (const [headers, expected] of [[{}, 401], [{ cookie: operator }, 403], [installation, 403]] as const) {
    assert.equal((await f.app.inject({ url: '/api/admin/capture-guides', headers })).statusCode, expected);
    assert.equal((await f.app.inject({ method: 'PUT', url: '/api/admin/capture-guides/1', headers: { ...headers, origin: f.config.origin }, payload: { mediaId: jpeg.id } })).statusCode, expected);
  }
  const assign = (number: number, mediaId: string | null) => f.app.inject({ method: 'PUT', url: `/api/admin/capture-guides/${number}`, headers: admin, payload: { mediaId } });
  const caption = (number: number, text: string) => f.app.inject({ method: 'PUT', url: `/api/admin/capture-guides/${number}`, headers: admin, payload: { caption: text } });
  assert.equal((await caption(1, '  Приподнимите подбородок  ')).json().caption, 'Приподнимите подбородок');
  assert.equal((await caption(1, 'я'.repeat(121))).statusCode, 400);
  assert.equal((await assign(1, demo.id)).statusCode, 400); assert.equal((await assign(6, jpeg.id)).statusCode, 400);
  for (let number = 1; number <= 5; number++) assert.equal((await assign(number, number === 1 ? jpeg.id : thumbnail.id)).statusCode, 200);
  const input = { participants: 1, photosPerParticipant: 4, orientation: 'landscape', aspectRatio: '16:9', description: 'Guided session', visible: true, thumbnailId: thumbnail.id, demoId: demo.id, model: p2v, mode: 'P2V', resolution: '720p', duration: 5, referenceIds: [], prompt: 'Keep @Element1' };
  const saved = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: admin, payload: input });
  assert.equal(saved.statusCode, 201, saved.body); const slotId = saved.json().id;
  const start = async () => {
    const result = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: randomUUID() } });
    assert.equal(result.statusCode, 201, result.body); return result.json<StartReceipt>();
  };
  const day1 = await start(); f.advance(86400_000); const day2 = await start();
  assert.deepEqual(day1.posePlan.map(pose => pose.guideMediaId), [jpeg.id, thumbnail.id, thumbnail.id, thumbnail.id]);
  assert.deepEqual(day1.posePlan.map(pose => pose.caption), ['Приподнимите подбородок', undefined, undefined, undefined]);
  const sharedGuide = `/api/capture/guides/${jpeg.id}`;
  assert.equal((await f.app.inject({ url: sharedGuide })).statusCode, 401);
  assert.deepEqual((await f.app.inject({ url: sharedGuide, headers: installation })).rawPayload, image);
  assert.equal((await f.app.inject({ url: `/api/capture/guides/${nextImage.id}`, headers: installation })).statusCode, 404);
  const sampleUrl = `/api/capture/sessions/${day2.sessionId}/guides/1`;
  for (const [headers, expected] of [[{}, 401], [{ cookie }, 403], [{ cookie: operator }, 403]] as const) assert.equal((await f.app.inject({ url: sampleUrl, headers })).statusCode, expected);
  const guide = await f.app.inject({ url: sampleUrl, headers: installation });
  assert.deepEqual(guide.rawPayload, image);
  assert.equal((await f.app.inject({ url: sampleUrl, headers: { ...installation, 'if-none-match': String(guide.headers.etag) } })).statusCode, 304);
  assert.equal((await f.app.inject({ url: `/api/capture/sessions/${day2.sessionId}/guides/5`, headers: installation })).statusCode, 404);
  const snap = readSession(db, day2.sessionId).snapshot;
  const payload = buildModelInput(snap, { photos: ['camera-0','camera-1','camera-2','camera-3'], references: [] });
  assert.deepEqual(payload, { prompt: input.prompt, elements: [{ frontal_image_url: 'camera-0', reference_image_urls: ['camera-1','camera-2','camera-3'] }], image_urls: [], duration: 5, resolution: '720p', aspect_ratio: '16:9' });
  assert.ok(materialIds(snap).includes(jpeg.id)); assert.equal(JSON.stringify(snap.generation).includes(jpeg.id), false);
  await caption(1, ' '); await caption(3, 'Левым плечом к камере');
  await assign(1, nextImage.id); await assign(3, null);
  assert.equal((await f.app.inject({ url: sharedGuide, headers: installation })).statusCode, 404);
  const fresh = await start(); assert.equal(fresh.posePlan[0].guideMediaId, nextImage.id); assert.equal(fresh.posePlan[2].guideMediaId, undefined);
  assert.equal(fresh.posePlan[0].caption, undefined);
  assert.equal(fresh.posePlan[2].caption, 'Левым плечом к камере');
  assert.equal(readSession(db, day2.sessionId).snapshot.posePlan![0].caption, 'Приподнимите подбородок');
  assert.equal((await f.app.inject({ url: `/api/capture/sessions/${fresh.sessionId}/guides/3`, headers: installation })).statusCode, 404);
  assert.deepEqual((await f.app.inject({ url: sampleUrl, headers: installation })).rawPayload, image);
  const cleanup = createEventCleanup(db, f.config.dataDir, f.app.log); t.after(() => cleanup.stop());
  await cleanup.remove(day1.date);
  assert.ok(db.prepare('SELECT 1 FROM slot_media WHERE id=?').get(jpeg.id));
  assert.deepEqual((await f.app.inject({ url: sampleUrl, headers: installation })).rawPayload, image);
  await cleanup.remove(day2.date);
  assert.equal(db.prepare('SELECT 1 FROM slot_media WHERE id=?').get(jpeg.id), undefined);
  assert.ok(db.prepare('SELECT 1 FROM slot_media WHERE id=?').get(nextImage.id), 'current guide remains even after its last session is deleted');
  await assert.rejects(readFile(join(f.config.dataDir, 'media', jpeg.id)), { code: 'ENOENT' });
  // Group always receives the fifth example, repeated for its requested positions.
  const update = await f.app.inject({ method: 'PUT', url: `/api/admin/slots/${slotId}`, headers: admin, payload: { ...input, participants: 'group', photosPerParticipant: 2 } });
  assert.equal(update.statusCode, 200);
  const group = await start(); assert.deepEqual(group.posePlan.map(pose => [pose.guideNumber, pose.guideMediaId]), [[5, thumbnail.id], [5, thumbnail.id]]);
});
