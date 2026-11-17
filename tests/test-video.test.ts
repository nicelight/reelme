/** Full offline generation uses public capture APIs and the ordinary durable
 * worker/publication. Real provider transports are forbidden, not simulated as
 * successful; SQLite, JPEG, MP4, FFmpeg, QR and retention are real. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, imageBytes, multipart } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { createGenerationWorker, type GenerationOptions } from '../src/server/sessions/generation.js';
import { publishReady } from '../src/server/sessions/receive.js';
import { createEventCleanup } from '../src/server/sessions/cleanup.js';
import { readSession } from '../src/server/sessions/index.js';
import { createApp } from '../src/server/app.js';
import type { ConfiguredSlotInput, Slot } from '../src/shared/scenarios.js';
import type { StartReceipt } from '../src/shared/capture.js';
import type { TodayDisplay } from '../src/shared/display.js';

const installation = { authorization: `Bearer ${'a'.repeat(43)}` };
async function setup(t: TestContext) {
  const f = await fixture(); t.after(() => f.close());
  const cookie = await f.login(); const operator = await f.login('operator');
  const admin = { cookie, origin: f.config.origin };
  const thumbnail = await f.upload(cookie, await imageBytes());
  const jpeg = await sharp(await imageBytes()).jpeg().toBuffer();
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const directory = join(f.config.clientDir, 'test-videos');
  await mkdir(directory); await cp('public/test-videos', directory, { recursive: true });
  let time = Date.UTC(2026, 0, 1);
  let providerCalls = 0;
  const forbidden = async (): Promise<never> => { providerCalls++; throw new Error('Real provider must not be called'); };
  const input: ConfiguredSlotInput = { participants: 1, photosPerParticipant: 1, orientation: 'landscape', aspectRatio: '16:9',
    description: 'Полный тест без fal', visible: true, thumbnailId: thumbnail.id, mode: 'P2V', model: 'minimax/h3-max/reference-to-video',
    resolution: '768P', duration: 5, prompt: 'Preserve the person', promptExpansionMode: 'disabled', referenceIds: [],
    simulateGeneration: true, simulationOutput: 'video' };
  async function save(value = input, id?: string) {
    const response = await f.app.inject({ method: id ? 'PUT' : 'POST', url: `/api/admin/slots${id ? `/${id}` : ''}`, headers: admin, payload: value });
    assert.equal(response.statusCode, id ? 200 : 201, response.body); return response.json<Slot>();
  }
  async function start(slot: string, finalize = true) {
    const response = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId: slot, startRequestId: randomUUID() } });
    assert.equal(response.statusCode, 201, response.body);
    const receipt = response.json<StartReceipt>();
    const part = multipart(jpeg, 'image/jpeg', 'visitor.jpg');
    for (const pose of receipt.posePlan) {
      assert.equal((await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${receipt.sessionId}/photos/${pose.index}`, headers: { ...installation, 'content-type': part.contentType }, payload: part.bytes })).statusCode, 200);
    }
    if (finalize) assert.equal((await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${receipt.sessionId}/finalize`, headers: installation })).statusCode, 200);
    return receipt.sessionId;
  }
  const protectedOptions: GenerationOptions = { client: { submit: forbidden, status: forbidden, result: forbidden }, download: forbidden, deleteOutput: forbidden };
  function worker(options: GenerationOptions = {}) {
    const worker = createGenerationWorker(db, f.config.dataDir, f.config.origin, f.app.log, { ...protectedOptions, testVideoDir: directory, now: () => time,
      publishReady: id => publishReady(db, f.config.dataDir, id, f.config.origin, () => time), ...options });
    t.after(() => worker.stop()); return worker;
  }
  return { f, db, admin, operator, input, jpeg, directory, save, start, worker, protectedOptions,
    now: () => time, advance(ms: number) { time += ms; f.advance(ms); }, calls: () => providerCalls,
    state: (id: string) => readSession(db, id).state,
    job: (id: string) => db.prepare('SELECT * FROM generation_jobs WHERE session_id=?').get(id) as { request_id: string; submitted_at: number; ready_at: number; video_path: string; width: number; height: number },
    delivery: (id: string) => db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(id) as { receive_token: string; download_token: string },
  };
}

test('test-video snapshots survive edits and every worker restart, deliver both orientations, preserve the last real result and clean without fal', async t => {
  const h = await setup(t); const { f, db } = h;
  const slot = await h.save({ ...h.input, simulateGeneration: false, simulationOutput: undefined });
  const real = await h.start(slot.id);
  const bytes = await readFile(join(h.directory, 'landscape.mp4'));
  let worker = h.worker({ client: { submit: async () => ({ request_id: 'real-fixture' }), status: async () => ({ status: 'COMPLETED' }), result: async () => ({ video: { url: 'https://fixture.test/real.mp4' } }) }, download: async () => new Response(bytes) });
  await worker.runOnce(); await worker.runOnce(); await worker.runOnce(); await worker.stop();
  assert.equal(h.state(real), 'ready');
  const ids: string[] = [];
  for (const orientation of ['landscape', 'portrait'] as const) {
    await h.save({ ...h.input, orientation, aspectRatio: orientation === 'portrait' ? '9:16' : '16:9' }, slot.id);
    const id = await h.start(slot.id, false); ids.push(id);
    await h.save({ ...h.input, simulateGeneration: false, simulationOutput: undefined }, slot.id);
    await f.restart();
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${id}/finalize`, headers: installation })).statusCode, 200);
    worker = h.worker(); await worker.runOnce(); await worker.stop();
    assert.equal(h.state(id), 'observing'); const submitted = h.job(id);
    worker = h.worker(); await worker.runOnce(); await worker.stop();
    assert.equal(h.state(id), 'observing');
    h.advance(3000);
    worker = h.worker(); await worker.runOnce(); await worker.stop(); assert.equal(h.state(id), 'preparing');
    await f.restart();
    worker = h.worker(); await worker.runOnce(); await worker.stop();
    assert.equal(h.state(id), 'ready'); assert.equal(h.job(id).request_id, submitted.request_id); assert.equal(h.job(id).submitted_at, submitted.submitted_at);
    assert.equal(h.job(id).width, orientation === 'portrait' ? 360 : 640);
    const delivery = h.delivery(id); assert.ok(delivery);
    assert.deepEqual((await f.app.inject(`/download/${delivery.download_token}`)).rawPayload, await readFile(join(h.directory, `${orientation}.mp4`)));
    assert.deepEqual((await f.app.inject(`/api/receive/${delivery.receive_token}/photo`)).rawPayload, h.jpeg);
    assert.equal((await f.app.inject({ url: `/api/display/${id}/qr`, headers: { cookie: h.operator } })).statusCode, 200);
    const display = (await f.app.inject({ url: '/api/display/today', headers: { cookie: h.operator } })).json<TodayDisplay>().sessions.find(row => row.id === id)!;
    assert.equal(display.stage, 4); assert.equal(display.simulation?.status, 'passed'); assert.ok(display.card);
    assert.equal((await f.app.inject({ url: `/api/admin/slots/${slot.id}/latest-video`, headers: h.admin })).json().video.sessionId, real);
    await f.restart(); assert.deepEqual(h.delivery(id), delivery);
  }
  assert.notEqual(h.delivery(ids[0]).receive_token, h.delivery(ids[1]).receive_token);
  assert.equal(h.calls(), 0);
  h.advance(86400_000);
  const gallery = (await f.app.inject({ url: '/api/events/2026-01-01', headers: h.admin })).json();
  assert.equal(gallery.sessions.filter((row: { testVideo?: boolean }) => row.testVideo).length, 2);
  const deleted: string[] = [];
  const cleanup = createEventCleanup(db, f.config.dataDir, f.app.log, h.now, { deleteOutput: async url => { deleted.push(url); } });
  await cleanup.remove('2026-01-01'); await cleanup.stop();
  assert.deepEqual(deleted, ['https://fixture.test/real.mp4']);
  for (const id of ids) assert.equal(db.prepare('SELECT 1 FROM capture_sessions WHERE id=?').get(id), undefined);
});

test('test-video validates inputs, does not publish missing/corrupt clips, and resumes download without provider calls', async t => {
  const h = await setup(t); const { f, db } = h;
  const invalid = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: h.admin, payload: { ...h.input, simulateGeneration: false } });
  assert.equal(invalid.statusCode, 400);
  const slot = await h.save();
  const brokenInput = await h.start(slot.id);
  const photo = db.prepare('SELECT path FROM capture_photos WHERE session_id=?').get(brokenInput) as { path: string };
  await rm(join(f.config.dataDir, 'media', photo.path));
  let worker = h.worker(); await worker.runOnce(); await worker.stop();
  assert.equal(h.state(brokenInput), 'failed'); assert.equal(h.delivery(brokenInput), undefined);
  const id = await h.start(slot.id);
  worker = h.worker(); await worker.runOnce(); h.advance(3000); await worker.runOnce(); await worker.stop();
  const submitted = h.job(id);
  const path = join(h.directory, 'landscape.mp4'); const bytes = await readFile(path); await rm(path);
  worker = h.worker(); await worker.runOnce(); await worker.stop();
  assert.equal(h.state(id), 'preparing'); assert.equal(h.delivery(id), undefined);
  await writeFile(path, bytes); await f.restart();
  worker = h.worker(); await worker.runOnce(); await worker.stop();
  assert.equal(h.state(id), 'ready'); assert.equal(h.job(id).submitted_at, submitted.submitted_at); assert.equal(h.job(id).request_id, submitted.request_id);
  const corrupt = await h.start(slot.id);
  await writeFile(path, 'not a video');
  worker = h.worker(); await worker.runOnce(); h.advance(3000); await worker.runOnce(); await worker.runOnce(); await worker.stop();
  assert.equal(h.state(corrupt), 'failed'); assert.equal(h.delivery(corrupt), undefined);
  assert.equal(h.calls(), 0);
});

test('application startup runs full test-video without FAL_KEY and publishes ordinary receive/download capabilities', async t => {
  const h = await setup(t); const id = await h.start((await h.save()).id);
  await h.f.app.close();
  const app = await createApp(h.f.config, { now: h.now, generation: { intervalMs: 20 } });
  t.after(() => app.close()); await app.ready();
  for (let i = 0; i < 150 && h.state(id) !== 'ready'; i++) { h.advance(1000); await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(h.state(id), 'ready');
  assert.equal((await app.inject(`/api/receive/${h.delivery(id).receive_token}`)).statusCode, 200);
  assert.equal((await app.inject(`/download/${h.delivery(id).download_token}`)).statusCode, 200);
});
