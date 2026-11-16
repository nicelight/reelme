/** Retained real slot-result acceptance: controlled clocks/transport, actual
 * verified MP4s, additive legacy migration, private Range reads and cleanup. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, imageBytes, videoBytes, seedLegacySlot } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { createGenerationWorker, type GenerationOptions } from '../src/server/sessions/generation.js';
import { publishReady } from '../src/server/sessions/receive.js';
import type { LastSlotVideo, SlotInput } from '../src/shared/scenarios.js';

async function setup(t: TestContext) {
  const f = await fixture(); t.after(() => f.close()); const cookie = await f.login(); const operator = await f.login('operator');
  const admin = { cookie, origin: f.config.origin }; const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const photo = await f.upload(cookie, await sharp(await imageBytes()).jpeg().toBuffer(), 'image/jpeg', 'test.jpg');
  const input: SlotInput = { description: 'Последний результат', visible: true, simulateGeneration: false, testPhotoId: photo.id,
    thumbnailId: photo.id, mode: 'P2V', model: 'kling/v4/reference-to-video', referenceIds: [], prompt: '@Element1', resolution: '720p', duration: 3 };
  const bytes = await videoBytes(f.root, 1);
  let now = Date.UTC(2026,0,1,1);
  async function slot(simulateGeneration = false) {
    // Retained results deliberately include still-supported raw legacy slots.
    return seedLegacySlot(db, { ...input, simulateGeneration }).id;
  }
  async function start(id: string) {
    const res = await f.app.inject({ method: 'POST', url: `/api/admin/slots/${id}/test-generations`, headers: admin, payload: { startRequestId: randomUUID() } });
    assert.equal(res.statusCode, 201, res.body); return res.json().sessionId as string;
  }
  const latest = async (id: string) => (await f.app.inject({ url: `/api/admin/slots/${id}/latest-video`, headers: admin })).json<{ video: LastSlotVideo | null }>().video;
  const times = (id: string) => db.prepare('SELECT submitted_at,ready_at FROM generation_jobs WHERE session_id=?').get(id) as { submitted_at: number | null; ready_at: number | null };
  const worker = (options: GenerationOptions) => createGenerationWorker(db, f.config.dataDir, f.config.origin, f.app.log, { download: async () => new Response(bytes), ...options, now: () => now, publishReady: id => publishReady(db, f.config.dataDir, id, () => now) });
  return { f, db, admin, operator, bytes, input, slot, start, latest, times, worker, setTime(value: number) { now = value; }, get now() { return now; } };
}

test('submitted/ready times follow actual retry, confirmed-ID restart, queue/download and first publication; simulation leaves nulls', async t => {
  const h = await setup(t); const slot = await h.slot(); const id = await h.start(slot); const base = h.now;
  let attempts = 0; let completed = false;
  const options: GenerationOptions = { client: {
    async submit() { attempts++; if (attempts === 1) throw new TypeError('Lost acknowledgement'); return { request_id: 'confirmed' }; },
    async status(_model, requestId) { assert.equal(requestId, 'confirmed'); return { status: completed ? 'COMPLETED' : 'IN_QUEUE' }; },
    async result() { return { video: { url: 'https://fixture.test/result.mp4' } }; },
  }, download: async () => { h.setTime(base + 30_000); return new Response(h.bytes); } };
  let w = h.worker(options); await w.runOnce(); assert.deepEqual(h.times(id), { submitted_at: base, ready_at: null });
  h.setTime(base + 5_000); await w.runOnce(); assert.deepEqual(h.times(id), { submitted_at: base + 5_000, ready_at: null });
  await w.stop(); await h.f.restart(); w = h.worker(options);
  h.setTime(base + 10_000); await w.runOnce(); assert.deepEqual(h.times(id), { submitted_at: base + 5_000, ready_at: null });
  completed = true; h.setTime(base + 20_000); await w.runOnce(); await w.runOnce(); await w.stop();
  assert.deepEqual(h.times(id), { submitted_at: base + 5_000, ready_at: base + 30_000 }); assert.equal(attempts, 2);
  const result = await h.latest(slot); assert.equal(result?.elapsedMs, 25_000); assert.equal(result?.submittedAt, base + 5_000); assert.equal(result?.readyAt, base + 30_000);
  h.setTime(base + 90_000); await publishReady(h.db, h.f.config.dataDir, id, () => h.now);
  assert.equal(h.times(id).ready_at, base + 30_000);
  // Same slot, new simulated snapshot: neither success nor its timestamps may overwrite the real result.
  seedLegacySlot(h.db, { ...h.input, simulateGeneration: true }, slot);
  const simulated = await h.start(slot); let forbidden = 0;
  const reject = async (): Promise<never> => { forbidden++; throw new Error('Forbidden transport'); };
  w = h.worker({ client: { submit: reject, status: reject, result: reject }, download: reject }); await w.runOnce(); await w.stop();
  assert.equal(forbidden, 0); assert.deepEqual(h.times(simulated), { submitted_at: null, ready_at: null });
  assert.deepEqual(await h.latest(slot), result);
});

test('last real completion wins within its slot; failures/pending, Range, permissions, deletion and missing files preserve isolation', async t => {
  const h = await setup(t); const { f, db } = h; const a = await h.slot(); const b = await h.slot();
  assert.equal(await h.latest(a), null);
  const older = await h.start(a); f.advance(86400_000); const newer = await h.start(a);
  let submissions = 0; let releaseOlder = false;
  const client: NonNullable<GenerationOptions['client']> = {
    async submit() { return { request_id: `request-${++submissions}` }; },
    async status(_model, id) { return { status: id === 'request-1' && !releaseOlder ? 'IN_QUEUE' : 'COMPLETED' }; },
    async result() { return { video: { url: 'https://fixture.test/result.mp4' } }; },
  };
  let w = h.worker({ client }); await w.runOnce(); await w.runOnce();
  h.setTime(Date.UTC(2026,0,2,1)); await w.runOnce(); assert.equal((await h.latest(a))?.sessionId, newer);
  releaseOlder = true; await w.runOnce(); h.setTime(Date.UTC(2026,0,2,2)); await w.runOnce();
  const first = (await h.latest(a))!; assert.equal(first.sessionId, older);
  const other = await h.start(b); await w.runOnce(); await w.runOnce(); h.setTime(Date.UTC(2026,0,2,3)); await w.runOnce();
  assert.equal((await h.latest(b))?.sessionId, other); assert.deepEqual(await h.latest(a), first); await w.stop();
  // Later rejected and pending work do not replace the earlier successful result.
  const failed = await h.start(a); w = h.worker({ client: { ...client, submit: async () => { throw Object.assign(new Error('Refused'), { status: 422 }); } } });
  await w.runOnce(); await w.stop(); await h.start(a); assert.deepEqual(await h.latest(a), first);
  const get = (url: string, headers: Record<string,string> = h.admin) => f.app.inject({ url, headers });
  for (const headers of [{}, { cookie: h.operator }, { authorization: `Bearer ${'a'.repeat(43)}` }]) {
    for (const url of [`/api/admin/slots/${a}/latest-video`, first.videoUrl]) assert.equal((await get(url, headers)).statusCode, Object.keys(headers).length ? 403 : 401);
  }
  assert.equal((await get(`/api/admin/slots/${b}/results/${older}/video`)).statusCode, 404);
  assert.equal((await get(`/api/admin/slots/${a}/results/${failed}/video`)).statusCode, 404);
  assert.equal((await get(`/api/admin/slots/${randomUUID()}/latest-video`)).statusCode, 404);
  const full = await get(first.videoUrl); assert.equal(full.statusCode, 200); assert.deepEqual(full.rawPayload, h.bytes);
  assert.equal(full.headers['content-type'], 'video/mp4'); assert.equal(full.headers['cache-control'], 'no-store');
  for (const range of ['bytes=0-31', 'bytes=32-63', 'bytes=-16']) {
    const response = await get(first.videoUrl, { ...h.admin, range }); assert.equal(response.statusCode, 206);
    const expected = range === 'bytes=-16' ? h.bytes.subarray(-16) : range === 'bytes=0-31' ? h.bytes.subarray(0,32) : h.bytes.subarray(32,64);
    assert.deepEqual(response.rawPayload, expected);
  }
  assert.equal((await get(first.videoUrl, { ...h.admin, range: 'bytes=99999999-' })).statusCode, 416);
  assert.equal((db.prepare('SELECT opened_at FROM session_delivery WHERE session_id=?').get(older) as { opened_at: number | null }).opened_at, null);
  // Hiding for deletion takes effect before byte removal and read projection changes immediately.
  db.prepare("UPDATE events SET deleting=1 WHERE date='2026-01-01'").run();
  assert.equal((await get(first.videoUrl)).statusCode, 404); assert.equal((await h.latest(a))?.sessionId, newer);
  db.prepare("UPDATE events SET deleting=0 WHERE date='2026-01-01'").run();
  assert.equal((await f.app.inject({ method: 'DELETE', url: '/api/events/2026-01-01', headers: h.admin })).statusCode, 204);
  assert.equal((await h.latest(a))?.sessionId, newer); assert.equal((await get(first.videoUrl)).statusCode, 404);
  // A lost file is a safe 404, never the slot demo or a result of another session.
  const next = (await h.latest(a))!; const path = (db.prepare('SELECT video_path FROM generation_jobs WHERE session_id=?').get(newer) as { video_path: string }).video_path;
  await rm(join(f.config.dataDir, 'media', path)); assert.equal((await get(next.videoUrl)).statusCode, 404);
  f.advance(86400_000); assert.equal((await f.app.inject({ method: 'DELETE', url: '/api/events/2026-01-02', headers: h.admin })).statusCode, 204);
  assert.equal(await h.latest(a), null); assert.equal(await h.latest(b), null);
});

test('additive legacy migration keeps ready data/files and null timestamps; reopen is idempotent', async t => {
  const h = await setup(t); const { db, f } = h; const slot = await h.slot(); const id = await h.start(slot);
  const w = h.worker({ client: { submit: async () => ({ request_id: 'legacy' }), status: async () => ({ status: 'COMPLETED' }), result: async () => ({ video: { url: 'https://fixture.test/legacy.mp4' } }) } });
  await w.runOnce(); await w.runOnce(); await w.runOnce(); await w.stop();
  db.exec('ALTER TABLE generation_jobs DROP COLUMN submitted_at'); db.exec('ALTER TABLE generation_jobs DROP COLUMN ready_at'); db.pragma('user_version=6');
  const old = db.prepare('SELECT * FROM generation_jobs WHERE session_id=?').get(id) as { video_path: string };
  const bytes = await readFile(join(f.config.dataDir, 'media', old.video_path));
  for (let i = 0; i < 2; i++) { const reopened = openDatabase(f.config.dataDir); reopened.close(); }
  const current = db.prepare('SELECT * FROM generation_jobs WHERE session_id=?').get(id) as Record<string,unknown>;
  const { submitted_at, ready_at, ...preserved } = current;
  assert.equal(submitted_at, null); assert.equal(ready_at, null); assert.deepEqual(preserved, old);
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', old.video_path)), bytes);
  await f.restart(); const last = await h.latest(slot);
  assert.equal(last?.sessionId, id); assert.equal(last?.submittedAt, null); assert.equal(last?.readyAt, null); assert.equal(last?.elapsedMs, null);
  assert.equal((await f.app.inject({ url: last!.videoUrl, headers: h.admin })).statusCode, 200);
});
