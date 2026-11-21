/** Configurable setup contracts: bounded representative cases, controlled provider,
 * real intake/storage and a pre-change database migration. No prompt-file sweep. Source: docs/slot-setup/matrix.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { fixture, imageBytes, multipart, videoBytes } from './helpers.js';
import { slotSetupMatrix } from '../src/shared/slot-prompt-selection.js';
import { allocatePhotoBudget, buildPosePlan, defaultSlotSetup, getSlotSetup, unequalPhotoMessage } from '../src/shared/slot-setup.js';
import { models, slotSchema, type ConfiguredSlotInput } from '../src/shared/scenarios.js';
import { snapshotPosePlan, type SlotSnapshot, type StartReceipt } from '../src/shared/capture.js';
import { openDatabase } from '../src/server/db.js';
import { readSession } from '../src/server/sessions/index.js';
import { createGenerationWorker } from '../src/server/sessions/generation.js';
import { buildModelInput } from '../src/server/sessions/model-input.js';
import { photoProviderUrl } from '../src/server/sessions/provider-media.js';

const installation = { authorization: `Bearer ${'a'.repeat(43)}` };
const wan = 'alibaba/wan-3.0/reference-to-video';
const o1 = 'fal-ai/kling-video/o1/video-to-video/edit';
const o3 = 'fal-ai/kling-video/o3/pro/reference-to-video';
const v4 = 'kling/v4/reference-to-video';
const h3 = 'minimax/h3-max/reference-to-video';
function config(modelId: string): ConfiguredSlotInput {
  const model = models.find(item => item.id === modelId)!;
  return { ...defaultSlotSetup(model.id, model.mode), description: 'Проверка setup', visible: true,
    thumbnailId: randomUUID(), model: model.id, mode: model.mode, simulateGeneration: false,
    referenceIds: [], prompt: modelId.includes('recast') ? '' : 'Preserve the photographed people.',
    ...(model.defaultResolution ? { resolution: model.defaultResolution } : {}),
    ...(model.mode === 'V2V' ? { videoId: randomUUID() } : { duration: 5 }),
    ...(modelId.includes('recast') ? { recastShotsConfirmed: true } : {}),
    ...(modelId === h3 ? { promptExpansionMode: 'disabled' as const } : {}) };
}

test('setup uses accepted Element/group/flat budgets and API-only output settings', () => {
  for (const [total, photos, additional, error] of [[5, [4, 1], 0, unequalPhotoMessage], [12, [4, 4], 4, undefined], [2, [2, 0], 0, unequalPhotoMessage]] as const) {
    assert.deepEqual(allocatePhotoBudget(total, 2, 4), { photos, additionalReferences: additional, error });
  }
  for (const [model, participants, count, extra] of [[o1, 2, 4, 2], [o3, 2, 4, 5], [v4, 2, 4, 10], [h3, 2, 4, 1], [wan, 2, 4, 2], [wan, 'group', 2, 8], [v4, 'group', 4, 6]] as const) {
    const input = { ...config(model), participants, photosPerParticipant: count };
    assert.equal(getSlotSetup(input).variant.additionalReferenceLimit, extra);
    assert.equal(slotSchema.safeParse({ ...input, referenceIds: Array.from({ length: extra }, () => randomUUID()) }).success, true);
    assert.equal(slotSchema.safeParse({ ...input, referenceIds: Array.from({ length: extra + 1 }, () => randomUUID()) }).success, false);
  }
  const valid = config(v4);
  for (const patch of [{ participants: undefined }, { photosPerParticipant: undefined }, { orientation: undefined }, { photosPerParticipant: 1 }, { participants: 3 }, { orientation: 'portrait', aspectRatio: '16:9' }, { aspectRatio: 'auto' }, { resolution: '4k' }, { duration: 31 }]) assert.equal(slotSchema.safeParse({ ...valid, ...patch }).success, false, JSON.stringify(patch));
  assert.equal(slotSchema.safeParse({ ...valid, orientation: 'portrait', aspectRatio: '9:16' }).success, true);
  assert.equal(slotSchema.safeParse({ ...config(o1), aspectRatio: '16:9' }).success, false);
  assert.equal(slotSchema.safeParse({ ...config(o1), resolution: '720p' }).success, false);
  assert.equal(slotSchema.safeParse({ ...config('kling/v4/flash/reference-to-video'), resolution: '1080p' }).success, false);
  assert.equal(slotSchema.safeParse({ ...config('minimax/h3-max/recast'), participants: 'group' }).success, false);
  for (const [id, max] of [['kling/v4/video-to-video/edit', 30], ['kling/v4/flash/video-to-video', 20]] as const) {
    for (const duration of [undefined, 3, max]) assert.ok(slotSchema.safeParse({ ...config(id), duration }).success);
    for (const duration of [2, 3.5, max + 1]) assert.equal(slotSchema.safeParse({ ...config(id), duration }).success, false);
  }
  for (const id of [o1, 'fal-ai/kling-video/o3/pro/video-to-video/edit', 'fal-ai/kling-video/o3/standard/video-to-video/edit', 'minimax/h3-max/recast']) {
    assert.equal(slotSchema.safeParse({ ...config(id), duration: 5 }).success, false);
  }
  const plan = buildPosePlan({ ...valid, participants: 2, photosPerParticipant: 4 });
  assert.deepEqual(plan.map(pose => [pose.index, pose.participant, pose.guideNumber]), [[0,1,1],[1,1,2],[2,1,3],[3,1,4],[4,2,1],[5,2,2],[6,2,3],[7,2,4]]);
  assert.ok(buildPosePlan({ ...valid, participants: 'group', photosPerParticipant: 3 }).every(pose => pose.guideNumber === 5 && pose.participant === 'group'));
  const guides = [{ number: 1 as const, instruction: 'Saved guide', mediaId: randomUUID() }];
  const saved = buildPosePlan({ ...config(h3), photosPerParticipant: 1 }, guides);
  guides[0].instruction = 'Changed guide';
  assert.equal(saved[0].instruction, 'Saved guide');
});

test('all configured endpoints receive ordered new plans through real intake and mocked fal submission', async t => {
  const f = await fixture(); t.after(() => f.close());
  const cookie = await f.login(); const admin = { cookie, origin: f.config.origin };
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const thumbnail = await f.upload(cookie, await imageBytes());
  const video = await f.upload(cookie, await videoBytes(f.root, 5), 'video/mp4', 'template.mp4');
  const bytes = await Promise.all(Array.from({ length: 8 }, (_, index) => sharp({ create: { width: 240, height: 240, channels: 3, background: { r: 20 * index, g: 30, b: 80 } } }).jpeg().toBuffer()));
  const wanReference = await f.upload(cookie, bytes[0], 'image/jpeg', 'reference.jpg');
  const records = new Map<string, { input: ConfiguredSlotInput; snapshot: SlotSnapshot }>();
  for (const model of models) {
    const isWan = model.id === wan;
    const input: ConfiguredSlotInput = { ...config(model.id), thumbnailId: thumbnail.id, participants: 2,
      photosPerParticipant: model.id.includes('recast') ? 1 : 4,
      referenceIds: model.id.includes('recast') ? [] : [isWan ? wanReference.id : thumbnail.id],
      ...(model.mode === 'V2V' ? { videoId: video.id } : {}),
      ...(model.id.includes('recast') ? { prompt: 'Replace two people from left to right.' } : {}) };
    if (model.editableVideoDuration) input.duration = 8;
    const slotId = randomUUID();
    if (model.mode === 'V2V') input.videoId = (await f.importTemplate(cookie, await videoBytes(f.root, isWan ? 14 : 5, 'blue', isWan ? 24 : 10), slotId, model.id)).id;
    const saved = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: admin, payload: { ...input, id: slotId } });
    assert.equal(saved.statusCode, 201, saved.body);
    const start = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId: saved.json().id, startRequestId: randomUUID() } });
    assert.equal(start.statusCode, 201, start.body);
    const receipt = start.json<StartReceipt>();
    assert.equal(receipt.posePlan.length, input.photosPerParticipant * 2);
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${receipt.sessionId}/finalize`, headers: installation })).statusCode, 409);
    for (const pose of [...receipt.posePlan].reverse()) {
      const body = multipart(bytes[pose.index], 'image/jpeg', 'camera.jpg');
      const result = await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${receipt.sessionId}/photos/${pose.index}`, headers: { ...installation, 'content-type': body.contentType }, payload: body.bytes });
      assert.equal(result.statusCode, 200, result.body);
    }
    const invalid = multipart(bytes[0], 'image/jpeg', 'outside.jpg');
    assert.equal((await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${receipt.sessionId}/photos/${receipt.posePlan.length}`, headers: { ...installation, 'content-type': invalid.contentType }, payload: invalid.bytes })).statusCode, 400);
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${receipt.sessionId}/finalize`, headers: installation })).statusCode, 200);
    const snapshot = readSession(db, receipt.sessionId).snapshot;
    assert.deepEqual(snapshot.posePlan, receipt.posePlan);
    records.set(model.id, { input, snapshot });
  }
  const calls = new Map<string, Record<string, any>>();
  const runner = createGenerationWorker(db, f.config.dataDir, f.config.origin, f.app.log, { client: {
    async submit(endpoint, payload) { calls.set(endpoint, payload); return { request_id: `test-${calls.size}` }; },
    async status() { throw new Error('Not requested in this submit test'); },
    async result() { throw new Error('Not requested in this submit test'); },
  } });
  t.after(() => runner.stop());
  await runner.runOnce();
  assert.equal(calls.size, models.length);
  for (const model of slotSetupMatrix.models) {
    const payload = calls.get(model.id)!; assert.ok(payload, model.id);
    const { input } = records.get(model.id)!;
    assert.equal(payload.prompt, input.prompt);
    const isWan = model.id === wan;
    assert.equal(payload.aspect_ratio, isWan ? 'adaptive' : model.orientationMode === 'aspect-ratio' ? '16:9' : undefined);
    assert.equal(payload.resolution, input.resolution);
    assert.equal(payload.duration, isWan ? 14 : model.id === o3 ? '5' : input.duration);
    if (isWan) {
      assert.equal(payload.video_url, undefined);
      assert.equal(payload.reference_video_urls.length, 1);
      const source = await f.app.inject({ url: new URL(payload.reference_video_urls[0]).pathname });
      assert.equal(source.statusCode, 200);
      assert.deepEqual(source.rawPayload, await readFile(join(f.config.dataDir, 'media', input.videoId!)));
      assert.equal(payload.enable_prompt_expansion, false);
      assert.equal(payload.reference_image_urls.length, 9);
      const scene = await f.app.inject({ url: new URL(payload.reference_image_urls[8]).pathname });
      assert.deepEqual(scene.rawPayload, bytes[0]);
    } else assert.equal(!!payload.video_url, model.mode === 'V2V');
    let photos: string[];
    if (model.referenceStrategy === 'elements') {
      assert.equal(payload.elements.length, 2);
      assert.equal(payload.image_urls.length, 1);
      photos = payload.elements.flatMap((element: any) => [element.frontal_image_url, ...element.reference_image_urls]);
      assert.ok(payload.elements.every((element: any) => element.reference_image_urls.length === 3));
    } else {
      const refs: string[] = payload.reference_image_urls ?? payload.image_urls;
      assert.equal(refs.length, model.referenceStrategy === 'recast' ? 2 : 9);
      photos = refs.slice(0, model.referenceStrategy === 'recast' ? 2 : 8);
      assert.equal(payload.elements, undefined);
    }
    for (const [index, url] of photos.entries()) {
      const media = await f.app.inject({ url: new URL(url).pathname });
      assert.equal(media.statusCode, 200); assert.deepEqual(media.rawPayload, bytes[index]);
    }
  }
  // Group input is ordinary images, in camera-then-reference order, without Elements.
  const group = slotSchema.parse({ ...config(v4), participants: 'group', photosPerParticipant: 3, referenceIds: [randomUUID()] });
  const { description, thumbnailId, visible: _visible, ...generation } = group;
  const groupSnapshot: SlotSnapshot = { slotId: randomUUID(), description, thumbnailId, generation, expectedPhotos: 3, posePlan: buildPosePlan(group) };
  const payload = buildModelInput(groupSnapshot, { photos: ['group-a', 'group-b', 'group-c'], references: ['scene'] });
  assert.equal(payload.elements, undefined); assert.deepEqual(payload.image_urls, ['group-a', 'group-b', 'group-c', 'scene']);
  const recast = records.get('minimax/h3-max/recast')!.snapshot;
  assert.equal('prompt' in buildModelInput({ ...recast, generation: { ...recast.generation, prompt: '' } }, { photos: ['one', 'two'], video: 'video', references: [] }), false);
  assert.throws(() => buildModelInput({ ...groupSnapshot, posePlan: groupSnapshot.posePlan!.map((pose, index) => ({ ...pose, participant: index === 1 ? 2 : 'group' })) }, { photos: ['a','b','c'], references: ['scene'] }), /participant/);
});

test('V2V drafts are saved but unavailable to catalog/start/test; direct invalid setup is rejected', async t => {
  const f = await fixture(); t.after(() => f.close()); const cookie = await f.login();
  const admin = { cookie, origin: f.config.origin };
  const thumbnail = await f.upload(cookie, await imageBytes());
  const draft = { ...config(o1), thumbnailId: thumbnail.id, videoId: undefined };
  const saved = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: admin, payload: draft });
  assert.equal(saved.statusCode, 201, saved.body); const id = saved.json().id;
  assert.equal((await f.app.inject({ url: '/api/catalog', headers: installation })).json().total, 0);
  assert.equal((await f.app.inject({ url: `/api/catalog/${id}`, headers: installation })).statusCode, 404);
  for (const url of ['/api/capture/sessions', `/api/admin/slots/${id}/test-generations`]) {
    const response = await f.app.inject({ method: 'POST', url, headers: url.includes('/admin/') ? admin : installation, payload: { startRequestId: randomUUID(), ...(url.includes('/admin/') ? {} : { slotId: id }) } });
    assert.equal(response.statusCode, 400, response.body); assert.equal(response.json().code, 'TEMPLATE_VIDEO_REQUIRED');
  }
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: admin, payload: { ...draft, participants: undefined } })).statusCode, 400);
  const video = await f.upload(cookie, await videoBytes(f.root, 5), 'video/mp4', 'landscape.mp4');
  const source = await f.importTemplate(cookie, await videoBytes(f.root, 5), id, o1);
  assert.equal((await f.app.inject({ method: 'PUT', url: `/api/admin/slots/${id}`, headers: admin, payload: { ...draft, videoId: source.id, orientation: 'portrait' } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: 'PUT', url: `/api/admin/slots/${id}`, headers: admin, payload: { ...draft, videoId: source.id } })).statusCode, 200);
  const rejectedTest = await f.app.inject({ method: 'POST', url: `/api/admin/slots/${id}/test-generations`, headers: admin, payload: { startRequestId: randomUUID() } });
  assert.equal(rejectedTest.statusCode, 400); assert.equal(rejectedTest.json().code, 'TEST_PHOTOS_REQUIRED');
});

test('old capture CHECK migration preserves rows, FK, provider URL and raw legacy snapshot until a new save', async t => {
  const f = await fixture(); t.after(() => f.close()); const cookie = await f.login(); const admin = { cookie, origin: f.config.origin };
  const thumbnail = await f.upload(cookie, await imageBytes());
  const slotId = randomUUID();
  const legacy = { description: 'Legacy 4k', visible: true, simulateGeneration: false, thumbnailId: thumbnail.id, model: 'google/gemini-omni-flash/v1.2/reference-to-video', mode: 'P2V', resolution: '4k', prompt: 'Existing prompt', duration: 5, referenceIds: [] };
  let db = openDatabase(f.config.dataDir);
  db.prepare('INSERT INTO slots(id,config) VALUES (?,?)').run(slotId, JSON.stringify(legacy));
  const projected = (await f.app.inject({ url: `/api/admin/slots/${slotId}`, headers: admin })).json();
  assert.equal(projected.participants, 1); assert.equal(projected.photosPerParticipant, 4); assert.equal(projected.resolution, '4k');
  assert.deepEqual(JSON.parse((db.prepare('SELECT config FROM slots WHERE id=?').get(slotId) as any).config), legacy);
  const visibilityUrl = `/api/admin/slots/${slotId}/visibility`;
  const patch = { method: 'PATCH' as const, url: visibilityUrl, headers: admin, payload: { visible: false } };
  assert.equal((await f.app.inject({ ...patch, headers: { ...admin, cookie: await f.login('operator') } })).statusCode, 403);
  assert.equal((await f.app.inject({ ...patch, headers: { cookie } })).statusCode, 403);
  assert.equal((await f.app.inject({ ...patch, payload: { visible: false, prompt: 'stale' } })).statusCode, 400);
  const rawSlot = db.prepare<[string], { config: string }>('SELECT config FROM slots WHERE id=?');
  for (const visible of [false, true]) {
    assert.equal((await f.app.inject({ ...patch, payload: { visible } })).statusCode, 204);
    assert.deepEqual(JSON.parse(rawSlot.get(slotId)!.config), { ...legacy, visible });
    assert.equal((await f.app.inject({ url: `/api/catalog/${slotId}`, headers: installation })).statusCode, visible ? 200 : 404);
  }
  const start = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: randomUUID() } });
  assert.equal(start.statusCode, 201, start.body); const old = start.json<StartReceipt>();
  assert.deepEqual(old.posePlan.map(pose => pose.key), ['front','up-left','down-right','profile-left']);
  const jpeg = await sharp(await imageBytes()).jpeg().toBuffer(); const body = multipart(jpeg, 'image/jpeg', 'legacy.jpg');
  for (let index = 0; index < 4; index++) assert.equal((await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${old.sessionId}/photos/${index}`, headers: { ...installation, 'content-type': body.contentType }, payload: body.bytes })).statusCode, 200);
  assert.equal((await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${old.sessionId}/finalize`, headers: installation })).statusCode, 200);
  const snapshotText = (db.prepare('SELECT snapshot FROM capture_sessions WHERE id=?').get(old.sessionId) as any).snapshot;
  const rows = db.prepare('SELECT * FROM capture_photos').all();
  const url = photoProviderUrl(db, f.config.origin, old.sessionId, 3);
  const tokens = db.prepare('SELECT * FROM provider_media').all();
  db.prepare("INSERT INTO generation_jobs(session_id,request_id) VALUES (?,'existing-provider-id')").run(old.sessionId);
  db.close(); await f.app.close();
  // Recreate exactly the pre-change CHECK while preserving accepted rows and capabilities.
  const oldDb = new Database(join(f.config.dataDir, 'reelme.sqlite'));
  oldDb.pragma('foreign_keys = OFF');
  oldDb.exec(`CREATE TABLE capture_photos_old (
    session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
    pose_index INTEGER NOT NULL CHECK(pose_index BETWEEN 0 AND 3),
    path TEXT UNIQUE NOT NULL, size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
    PRIMARY KEY(session_id,pose_index));
    INSERT INTO capture_photos_old SELECT * FROM capture_photos;
    DROP TABLE capture_photos;
    ALTER TABLE capture_photos_old RENAME TO capture_photos;
    PRAGMA user_version = 7;`);
  assert.deepEqual(oldDb.pragma('foreign_key_check'), []); oldDb.close();
  await f.restart();
  db = openDatabase(f.config.dataDir); t.after(() => db.close());
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.deepEqual(db.prepare('SELECT * FROM capture_photos').all(), rows);
  assert.deepEqual(db.prepare('SELECT * FROM provider_media').all(), tokens);
  assert.equal((db.prepare('SELECT request_id FROM generation_jobs WHERE session_id=?').get(old.sessionId) as any).request_id, 'existing-provider-id');
  assert.equal((db.prepare('SELECT snapshot FROM capture_sessions WHERE id=?').get(old.sessionId) as any).snapshot, snapshotText);
  assert.equal(photoProviderUrl(db, f.config.origin, old.sessionId, 3), url);
  assert.deepEqual((await f.app.inject({ url: new URL(url).pathname })).rawPayload, jpeg);
  const oldSnapshot = readSession(db, old.sessionId).snapshot;
  assert.equal(oldSnapshot.posePlan, undefined); assert.deepEqual(snapshotPosePlan(oldSnapshot), old.posePlan);
  assert.equal(buildModelInput(oldSnapshot, { photos: ['a','b','c','d'], references: [] }).resolution, '4k');
  const { id: _id, ...updated } = projected;
  const saved = await f.app.inject({ method: 'PUT', url: `/api/admin/slots/${slotId}`, headers: admin, payload: { ...updated, resolution: '1080p', participants: 2, photosPerParticipant: 4 } });
  assert.equal(saved.statusCode, 200, saved.body);
  const fresh = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: randomUUID() } });
  assert.equal(fresh.statusCode, 201); assert.equal(fresh.json().posePlan.length, 8);
  const accepted = await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${fresh.json().sessionId}/photos/7`, headers: { ...installation, 'content-type': body.contentType }, payload: body.bytes });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(readSession(db, fresh.json().sessionId).snapshot.posePlan?.[7].participant, 2);
  await f.restart();
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal((db.prepare('SELECT snapshot FROM capture_sessions WHERE id=?').get(old.sessionId) as any).snapshot, snapshotText);
  assert.deepEqual((await f.app.inject({ url: new URL(url).pathname })).rawPayload, jpeg);
  for (const row of rows as { path: string }[]) assert.deepEqual(await readFile(join(f.config.dataDir, 'media', row.path)), jpeg);
});
