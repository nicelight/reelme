/** Contract checks for installation catalog, atomic starts and immutable session inputs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, imageBytes, videoBytes } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { readMedia } from '../src/server/scenarios/media.js';
import type { SlotInput } from '../src/shared/scenarios.js';
import type { CatalogPage, SlotSnapshot, StartReceipt } from '../src/shared/capture.js';

const installation = { authorization: `Bearer ${'a'.repeat(43)}`, origin: 'http://localhost:5513' };
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function setup(f: Fixture) {
  const cookie = await f.login();
  const image = await imageBytes();
  const video = await videoBytes(f.root);
  const thumbnail = await f.upload(cookie, image);
  const clip = await f.upload(cookie, video, 'video/mp4', 'clip.mp4');
  const recast: SlotInput = { description: 'Первый сюжет для посетителя', visible: true, thumbnailId: thumbnail.id, mode: 'V2V', model: 'minimax/h3-max/recast', referenceIds: [], videoId: clip.id, resolution: '768P', recastShotsConfirmed: true };
  async function save(input: SlotInput, id?: string) {
    const response = await f.app.inject({ method: id ? 'PUT' : 'POST', url: `/api/admin/slots${id ? `/${id}` : ''}`, headers: { cookie, origin: f.config.origin }, payload: input });
    assert.equal(response.statusCode, id ? 200 : 201, response.body);
    return response.json<{ id: string }>().id;
  }
  return { cookie, image, video, thumbnail, clip, recast, save };
}
async function start(f: Fixture, slotId: string, startRequestId = randomUUID(), status = 201) {
  const response = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId } });
  assert.equal(response.statusCode, status, response.body);
  return response.json<StartReceipt>();
}
function snapshot(f: Fixture, sessionId: string): SlotSnapshot {
  const db = openDatabase(f.config.dataDir);
  try {
    const row = db.prepare('SELECT snapshot FROM capture_sessions WHERE id=?').get(sessionId) as { snapshot: string };
    assert.ok(row, 'session is persisted');
    return JSON.parse(row.snapshot);
  } finally { db.close(); }
}

test('installation catalog paginates 13 visible slots and protects current preview media', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const ids: string[] = [];
  for (let i = 0; i < 13; i++) ids.push(await s.save({ ...s.recast, description: `Сюжет номер ${i} полное описание` }));
  const hidden = await s.save({ ...s.recast, visible: false });
  for (const [page, expected] of [[1, ids.slice(0, 12)], [2, ids.slice(12)]] as const) {
    const response = await f.app.inject({ url: `/api/catalog?page=${page}`, headers: installation });
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json<CatalogPage>();
    assert.deepEqual({ page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages }, { page, pageSize: 12, total: 13, totalPages: 2 });
    assert.deepEqual(result.items.map(item => item.id), expected);
    assert.deepEqual(result.items[0], { id: expected[0], description: `Сюжет номер ${page === 1 ? 0 : 12} полное описание`, thumbnailId: s.thumbnail.id, mode: 'V2V', previewId: s.clip.id });
  }
  const detail = await f.app.inject({ url: `/api/catalog/${ids[0]}`, headers: installation });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().description, 'Сюжет номер 0 полное описание');
  for (const id of [hidden, randomUUID()]) {
    assert.equal((await f.app.inject({ url: `/api/catalog/${id}`, headers: installation })).statusCode, 404);
    assert.equal((await f.app.inject({ url: `/api/catalog/${id}/media/${s.clip.id}`, headers: installation })).statusCode, 404);
  }
  const mediaUrl = `/api/catalog/${ids[0]}/media/${s.clip.id}`;
  const full = await f.app.inject({ url: mediaUrl, headers: installation });
  assert.equal(full.statusCode, 200); assert.deepEqual(full.rawPayload, s.video);
  const range = await f.app.inject({ url: mediaUrl, headers: { ...installation, range: 'bytes=0-31' } });
  assert.equal(range.statusCode, 206); assert.deepEqual(range.rawPayload, s.video.subarray(0, 32));
  assert.equal(range.headers['content-range'], `bytes 0-31/${s.video.length}`);
  const thumbnail = await f.app.inject({ url: `/api/catalog/${ids[0]}/media/${s.thumbnail.id}`, headers: installation });
  assert.equal(thumbnail.statusCode, 200); assert.deepEqual(thumbnail.rawPayload, s.image);
  const operator = await f.login('operator');
  for (const headers of [{}, { authorization: 'Bearer invalid' }, { cookie: s.cookie }, { cookie: operator }]) {
    const expected = 'cookie' in headers ? 403 : 401;
    for (const url of ['/api/catalog', `/api/catalog/${ids[0]}`, mediaUrl]) assert.equal((await f.app.inject({ url, headers })).statusCode, expected, url);
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: { ...headers, origin: installation.origin }, payload: { startRequestId: randomUUID(), slotId: ids[0] } })).statusCode, expected);
  }
});

test('starts are idempotent, numbered per Novosibirsk date, and reject unavailable or invalid requests', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const slotId = await s.save(s.recast);
  const other = await s.save(s.recast);
  const hidden = await s.save({ ...s.recast, visible: false });
  for (const id of [hidden, randomUUID()]) assert.equal((await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { startRequestId: randomUUID(), slotId: id } })).statusCode, 404);
  for (const payload of [{ startRequestId: 'invalid', slotId }, { startRequestId: randomUUID(), slotId: 'invalid' }, { startRequestId: randomUUID(), slotId, role: 'admin' }]) assert.equal((await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload })).statusCode, 400);
  f.advance(17 * 60 * 60 * 1000 - 1000);
  const key = randomUUID();
  const first = await start(f, slotId, key);
  assert.equal(first.date, '2026-01-01'); assert.equal(first.number, 1); assert.equal(first.state, 'capturing');
  assert.match(first.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(first.posePlan.length, 1); assert.equal(first.posePlan[0].key, 'front');
  assert.ok(first.posePlan[0].instruction);
  assert.deepEqual(await start(f, slotId, key, 200), first);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { startRequestId: key, slotId: other } })).statusCode, 409);
  const concurrent = await Promise.all([start(f, slotId), start(f, slotId)]);
  assert.equal(new Set([first.number, ...concurrent.map(r => r.number)]).size, 3);
  assert.ok(concurrent.every(r => r.date === first.date));
  const sameKey = randomUUID();
  const repeats = await Promise.all([f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { startRequestId: sameKey, slotId } }), f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { startRequestId: sameKey, slotId } })]);
  assert.deepEqual(repeats.map(r => r.statusCode).sort(), [200, 201]); assert.deepEqual(repeats[0].json(), repeats[1].json());
  await s.save({ ...s.recast, visible: false, description: 'Изменённый скрытый сюжет' }, slotId);
  f.advance(2000);
  const tomorrow = await start(f, other);
  assert.equal(tomorrow.date, '2026-01-02'); assert.equal(tomorrow.number, 1);
  assert.deepEqual(await start(f, slotId, key, 200), first);
  await f.restart();
  assert.deepEqual(await start(f, slotId, key, 200), first);
  assert.equal((await start(f, other)).number, 2);
});

test('session snapshots preserve replaced settings and bytes across restart; P2V demo stays outside generation', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const slotId = await s.save(s.recast);
  const a = await start(f, slotId);
  const old = snapshot(f, a.sessionId);
  assert.deepEqual(old, { slotId, description: s.recast.description, thumbnailId: s.thumbnail.id, expectedPhotos: 1, generation: { mode: 'V2V', model: s.recast.model, referenceIds: [], videoId: s.clip.id, resolution: '768P', recastShotsConfirmed: true } });
  const newThumbnail = await f.upload(s.cookie, s.image);
  const reference = await f.upload(s.cookie, s.image);
  const demo = await f.upload(s.cookie, s.video, 'video/mp4', 'demo.mp4');
  const p2v: SlotInput = { description: 'Новый сюжет и модель', visible: true, thumbnailId: newThumbnail.id, mode: 'P2V', model: 'kling/v4/reference-to-video', referenceIds: [reference.id], demoId: demo.id, prompt: 'Посетитель @Element1 в новом сюжете', resolution: '1080p', duration: 7 };
  await s.save(p2v, slotId);
  const b = await start(f, slotId);
  assert.equal(b.posePlan.length, 4);
  assert.deepEqual(b.posePlan.map(p => p.index), [0, 1, 2, 3]);
  assert.equal(new Set(b.posePlan.map(p => p.key)).size, 4);
  assert.ok(b.posePlan.every(p => p.instruction.length > 0));
  const fresh = snapshot(f, b.sessionId);
  assert.deepEqual(fresh, { slotId, description: p2v.description, thumbnailId: newThumbnail.id, demoId: demo.id, expectedPhotos: 4, generation: { mode: p2v.mode, model: p2v.model, referenceIds: [reference.id], prompt: p2v.prompt, resolution: '1080p', duration: 7 } });
  const detail = await f.app.inject({ url: `/api/catalog/${slotId}`, headers: installation });
  assert.equal(detail.json().previewId, demo.id);
  for (const id of [reference.id, s.clip.id, s.thumbnail.id, randomUUID()]) assert.equal((await f.app.inject({ url: `/api/catalog/${slotId}/media/${id}`, headers: installation })).statusCode, 404);
  assert.equal((await f.app.inject({ url: `/api/catalog/${slotId}/media/${demo.id}`, headers: installation })).statusCode, 200);
  const { demoId: _demo, ...noDemo } = p2v;
  await s.save(noDemo, slotId);
  assert.equal((await f.app.inject({ url: `/api/catalog/${slotId}`, headers: installation })).json().previewId, undefined);
  async function checkSaved() {
    assert.deepEqual(snapshot(f, a.sessionId), old); assert.deepEqual(snapshot(f, b.sessionId), fresh);
    const db = openDatabase(f.config.dataDir);
    try {
      for (const [id, bytes] of [[s.thumbnail.id, s.image], [s.clip.id, s.video], [newThumbnail.id, s.image], [reference.id, s.image], [demo.id, s.video]] as const) {
        const media = readMedia(db, id);
        assert.deepEqual(await readFile(join(f.config.dataDir, 'media', media.path)), bytes);
      }
    } finally { db.close(); }
  }
  await checkSaved(); await f.restart(); await checkSaved();
});
