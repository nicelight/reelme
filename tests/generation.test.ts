/** Recast acceptance on real SQLite/files/FFmpeg with explicit fake fal transport.
 * No paid calls or external input uploads occur in this suite. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, imageBytes, videoBytes, multipart } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { createGenerationWorker } from '../src/server/sessions/generation.js';
import { createFalTransport, falHeaders, type FalTransport } from '../src/server/sessions/fal.js';
import { createApp } from '../src/server/app.js';
import type { CaptureStatus } from '../src/shared/capture.js';

const installation = { authorization: `Bearer ${'a'.repeat(43)}` };
const endpoint = 'minimax/h3-max/recast';
const receipt = (id: string) => ({ request_id: id, status_url: `https://queue.fal.run/minimax/h3-max/requests/${id}/status`, response_url: `https://queue.fal.run/minimax/h3-max/requests/${id}`, cancel_url: `https://queue.fal.run/minimax/h3-max/requests/${id}/cancel` });
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function setup(t: TestContext) {
  const f = await fixture(); t.after(() => f.close());
  const cookie = await f.login();
  const thumb = await f.upload(cookie, await imageBytes());
  const bytes = await videoBytes(f.root, 5);
  const clip = await f.upload(cookie, bytes, 'video/mp4', 'clip.mp4');
  const input = { description: 'Recast fixture', visible: true, thumbnailId: thumb.id, referenceIds: [], mode: 'V2V', model: endpoint, videoId: clip.id, resolution: '768P', recastShotsConfirmed: true };
  const response = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: { cookie, origin: f.config.origin }, payload: input });
  assert.equal(response.statusCode, 201, response.body);
  return { f, cookie, input, slotId: response.json().id as string, bytes };
}
async function captured(f: Fixture, slotId: string) {
  const response = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: randomUUID() } });
  assert.equal(response.statusCode, 201, response.body);
  const id = response.json().sessionId as string;
  const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#aabbcc' } }).jpeg().toBuffer();
  const part = multipart(bytes, 'image/jpeg', 'visitor.jpg');
  const upload = await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${id}/photos/0`, headers: { ...installation, 'content-type': part.contentType }, payload: part.bytes });
  assert.equal(upload.statusCode, 200, upload.body);
  const finalized = await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${id}/finalize`, headers: installation });
  assert.equal(finalized.statusCode, 200, finalized.body);
  return id;
}
async function state(f: Fixture, id: string) {
  const res = await f.app.inject({ url: `/api/capture/sessions/${id}`, headers: installation });
  assert.equal(res.statusCode, 200); return res.json<CaptureStatus>();
}
function fake() {
  const calls = { submit: [] as { endpoint: string; input: Record<string, unknown> }[], status: [] as string[], result: [] as string[], download: [] as string[] };
  const client: FalTransport = {
    async submit(endpoint, input) { calls.submit.push({ endpoint, input }); return receipt(`request-${calls.submit.length}`); },
    async status(_endpoint, id) { calls.status.push(id); return { status: 'COMPLETED' }; },
    async result(_endpoint, id) { calls.result.push(id); return { video: { url: `https://cdn.fal.test/${id}.mp4` } }; },
  };
  return { calls, client };
}
function worker(f: Fixture, client: FalTransport, download: typeof fetch) {
  const db = openDatabase(f.config.dataDir);
  const runner = createGenerationWorker(db, f.config.dataDir, f.config.origin, f.app.log, { client, download });
  return { db, ...runner, async close() { await runner.stop(); db.close(); } };
}

test('saved A/B snapshots, stable scoped provider URLs and verified files survive restart without resubmit/redownload', async t => {
  const { f, cookie, input, slotId, bytes } = await setup(t);
  const a = await captured(f, slotId);
  const replacementBytes = await videoBytes(f.root, 6);
  const replacement = await f.upload(cookie, replacementBytes, 'video/mp4', 'new.mp4');
  const changed = await f.app.inject({ method: 'PUT', url: `/api/admin/slots/${slotId}`, headers: { cookie, origin: f.config.origin }, payload: { ...input, videoId: replacement.id, resolution: '1080P' } });
  assert.equal(changed.statusCode, 200);
  const b = await captured(f, slotId); const c = await captured(f, slotId);
  const { calls, client } = fake();
  const download: typeof fetch = async url => { calls.download.push(String(url)); return new Response(bytes); };
  let w = worker(f, client, download); t.after(() => w.close());
  await w.runOnce();
  assert.equal(calls.submit.length, 3);
  const byId = (id: string) => {
    const job = w.db.prepare('SELECT request_id FROM generation_jobs WHERE session_id=?').get(id) as { request_id: string };
    return calls.submit[Number(job.request_id.split('-')[1]) - 1].input;
  };
  const ai = byId(a), bi = byId(b), ci = byId(c);
  assert.equal(ai.resolution, '768P'); assert.equal(bi.resolution, '1080P'); assert.equal('prompt' in ai, false);
  assert.notEqual(ai.video_url, bi.video_url); assert.equal(bi.video_url, ci.video_url);
  assert.equal((ai.reference_image_urls as string[]).length, 1);
  for (const [url, expected] of [[ai.video_url, bytes], [bi.video_url, replacementBytes]] as const) {
    const res = await f.app.inject({ url: new URL(String(url)).pathname });
    assert.equal(res.statusCode, 200); assert.deepEqual(res.rawPayload, expected);
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
  }
  const photo = await f.app.inject({ url: new URL((ai.reference_image_urls as string[])[0]).pathname });
  assert.equal(photo.statusCode, 200); assert.equal((await sharp(photo.rawPayload).metadata()).format, 'jpeg');
  assert.equal((await f.app.inject({ url: '/provider-media/' + 'a'.repeat(43) })).statusCode, 404);
  assert.equal((await f.app.inject({ url: '/provider-media/' })).statusCode, 404);
  assert.equal((await f.app.inject({ url: `/api/admin/slot-media/${input.videoId}` })).statusCode, 401);
  assert.equal((await f.app.inject({ url: '/api/admin/slots', headers: { authorization: `Bearer ${String(ai.video_url).split('/').pop()}` } })).statusCode, 401);
  const saved = w.db.prepare('SELECT * FROM generation_jobs WHERE session_id=?').get(a) as Record<string, unknown>;
  assert.ok(saved.status_url); assert.ok(saved.response_url); assert.ok(saved.cancel_url);
  await w.close(); await f.restart(); w = worker(f, client, download);
  await w.runOnce(); assert.equal((await state(f, a)).state, 'preparing');
  await w.runOnce();
  const job = w.db.prepare('SELECT * FROM generation_jobs WHERE session_id=?').get(a) as { video_path: string; frame_path: string; duration: number; width: number };
  assert.equal(job.duration, 5); assert.equal(job.width, 320);
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', job.video_path)), bytes);
  assert.equal((await sharp(join(f.config.dataDir, 'media', job.frame_path)).metadata()).format, 'jpeg');
  assert.equal((await state(f, a)).state, 'preparing'); assert.equal((await state(f, a)).error, undefined);
  await w.close(); await f.restart(); w = worker(f, client, download); await w.runOnce();
  assert.equal(calls.submit.length, 3); assert.equal(calls.download.length, 3);
  assert.equal((await state(f, a)).complete, true);
  const artifacts = process.env.REELME_GENERATION_ARTIFACTS;
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, 'generation-observations.json'), JSON.stringify({
      transport: 'controlled fake fal; no external API calls',
      sessions: [a, b, c],
      jobs: w.db.prepare('SELECT session_id,request_id,video_size,frame_size,width,height,duration FROM generation_jobs ORDER BY session_id').all(),
      inputAResolution: ai.resolution, inputBResolution: bi.resolution,
      oldAndNewVideoUrlsDiffer: ai.video_url !== bi.video_url,
      unchangedMaterialUrlIsStable: bi.video_url === ci.video_url,
      submitCount: calls.submit.length, downloadCount: calls.download.length,
      stateAfterRestart: (await state(f, a)).state,
      videoSha256: createHash('sha256').update(bytes).digest('hex'),
      verified: ['complete FFmpeg decode', 'ffprobe 320x240, 5 seconds', 'JPEG extracted', 'no ready before issuance'],
    }, null, 2) + '\n');
  }
});

test('missing submit acknowledgement retries, confirmed ID resumes after restart and transient polling only polls', async t => {
  const { f, slotId, bytes } = await setup(t); const id = await captured(f, slotId);
  const { calls, client } = fake();
  const submit = client.submit; let lost = true;
  client.submit = async (...args) => { if (lost) { lost = false; calls.submit.push({ endpoint: args[0], input: args[1] }); throw new TypeError('lost response'); } return submit(...args); };
  let w = worker(f, client, async () => new Response(bytes)); t.after(() => w.close());
  await w.runOnce(); assert.equal((await state(f, id)).state, 'submit_pending'); assert.equal((await state(f, id)).error?.code, 'GENERATION_RETRY');
  await w.runOnce(); assert.equal((await state(f, id)).state, 'observing'); assert.equal(calls.submit.length, 2);
  const status = client.status; let transient = true;
  client.status = async (...args) => { if (transient) { transient = false; throw Object.assign(new Error('poll unavailable'), { status: 503 }); } return status(...args); };
  await w.close(); await f.restart(); w = worker(f, client, async () => new Response(bytes));
  await w.runOnce(); assert.equal((await state(f, id)).state, 'observing');
  await w.runOnce(); assert.equal((await state(f, id)).state, 'preparing');
  assert.deepEqual(calls.status, ['request-2']); assert.deepEqual(calls.result, ['request-2']); assert.equal(calls.submit.length, 2);
});

test('explicit submit refusals and terminal COMPLETED errors never resubmit or erase photos', async t => {
  const { f, slotId, bytes } = await setup(t);
  for (const kind of ['refusal', 'result-error', 'status-error', 'result-http']) {
    const id = await captured(f, slotId); const { calls, client } = fake();
    if (kind === 'refusal') client.submit = async (...args) => { calls.submit.push({ endpoint: args[0], input: args[1] }); throw Object.assign(new Error('private provider detail'), { status: 422 }); };
    if (kind === 'result-error') client.result = async () => ({ error: 'private model error', video: { url: 'https://cdn.fal.test/no.mp4' } });
    if (kind === 'status-error') client.status = async () => ({ status: 'COMPLETED', error: 'terminal provider failure' });
    if (kind === 'result-http') client.result = async () => { throw Object.assign(new Error('validation error'), { status: 422 }); };
    const w = worker(f, client, async () => new Response(bytes));
    for (let i = 0; i < 4; i++) await w.runOnce();
    assert.equal(calls.submit.length, 1, kind);
    const value = await state(f, id); assert.equal(value.state, 'failed', kind); assert.equal(value.complete, true);
    assert.ok(value.error); assert.doesNotMatch(JSON.stringify(value), /private|provider failure|validation error/);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM capture_photos WHERE session_id=?').get(id) as { n: number }).n, 1);
    await w.close();
  }
});

test('download retry and preparing restart reuse saved result; empty/corrupt video never becomes ready', async t => {
  const { f, slotId, bytes } = await setup(t); const id = await captured(f, slotId);
  const { calls, client } = fake(); let attempts = 0;
  const download: typeof fetch = async url => { calls.download.push(String(url)); if (++attempts === 1) throw new TypeError('temporary download loss'); return new Response(bytes); };
  let w = worker(f, client, download); t.after(() => w.close());
  await w.runOnce(); await w.runOnce(); await w.runOnce();
  assert.equal((await state(f, id)).state, 'preparing'); assert.equal((await state(f, id)).error?.code, 'GENERATION_RETRY');
  await w.close(); await f.restart(); w = worker(f, client, download);
  await w.runOnce(); assert.equal((await state(f, id)).error, undefined);
  assert.equal(calls.submit.length, 1); assert.equal(calls.result.length, 1); assert.equal(calls.download.length, 2); assert.equal(calls.download[0], calls.download[1]);
  for (const bytes of [Buffer.alloc(0), Buffer.from('corrupt video')]) {
    const bad = await captured(f, slotId); const fakeClient = fake();
    const broken = worker(f, fakeClient.client, async () => new Response(bytes));
    await broken.runOnce(); await broken.runOnce(); await broken.runOnce(); await broken.runOnce();
    const status = await state(f, bad); assert.equal(status.state, 'failed'); assert.equal(status.error?.code, 'INVALID_RESULT'); assert.equal(status.complete, true);
    assert.equal(fakeClient.calls.submit.length, 1); await broken.close();
  }
});

test('fal SDK sends the accepted headers and model payload without CDN uploads; status/result target confirmed ID', async () => {
  const requests: { url: string; method: string; headers: Headers; body?: unknown }[] = [];
  const transport: typeof fetch = async (url, options) => {
    requests.push({ url: String(url), method: options?.method ?? 'GET', headers: new Headers(options?.headers), body: options?.body ? JSON.parse(String(options.body)) : undefined });
    const data = options?.method?.toUpperCase() === 'POST' ? receipt('confirmed') : String(url).includes('/status') ? { status: 'COMPLETED', request_id: 'confirmed' } : { video: { url: 'https://cdn.fal.test/result.mp4' } };
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'x-fal-request-id': 'confirmed' } });
  };
  const client = createFalTransport('test-server-key', transport);
  const input = { video_url: 'https://reelme.test/provider-media/video', reference_image_urls: ['https://reelme.test/provider-media/photo'], resolution: '768P' };
  assert.equal((await client.submit(endpoint, input)).request_id, 'confirmed');
  await client.status(endpoint, 'confirmed'); await client.result(endpoint, 'confirmed');
  assert.equal(requests.length, 3); assert.deepEqual(requests[0].body, input);
  assert.equal(requests[0].headers.get('authorization'), 'Key test-server-key');
  for (const [header, value] of Object.entries(falHeaders)) assert.equal(requests[0].headers.get(header), value);
  assert.equal(requests[0].headers.has('x-fal-no-retry'), false);
  assert.match(requests[1].url, /\/requests\/confirmed\/status/); assert.match(requests[2].url, /\/requests\/confirmed$/);
  assert.ok(requests.every(r => r.url.startsWith('https://queue.fal.run/')));
});

test('background fal submission does not hold capture HTTP and startup consumes persisted pending sessions', async t => {
  const { f, slotId } = await setup(t); const first = await captured(f, slotId);
  const { client } = fake(); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  client.submit = async () => { entered(); await gate; return receipt('slow'); };
  const app = await createApp(f.config, { generation: { client, intervalMs: 100_000 } });
  t.after(async () => { release(); await app.close(); });
  await app.listen({ host: '127.0.0.1', port: 0 }); await started;
  const status = await app.inject({ url: `/api/capture/sessions/${first}`, headers: installation });
  assert.equal(status.statusCode, 200); assert.equal(status.json().finalized, true);
  const next = await app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: randomUUID() } });
  assert.equal(next.statusCode, 201); assert.notEqual(next.json().sessionId, first);
  release();
});

test('provider failure details stay server-side with credentials and capability URLs redacted', async t => {
  const { f, slotId } = await setup(t); const id = await captured(f, slotId);
  const logs: unknown[] = []; const secret = 'test-private-fal-key'; const { client } = fake();
  client.submit = async () => { throw Object.assign(new Error(`Refused Key ${secret}`), { status: 422, body: { detail: `Cannot fetch https://reelme.test/provider-media/private-capability with ${secret}`, request_id: 'safe-request-id', token: 'private-token' } }); };
  const db = openDatabase(f.config.dataDir);
  const logger = { ...f.app.log, error: (record: unknown) => { logs.push(record); } } as typeof f.app.log;
  const w = createGenerationWorker(db, f.config.dataDir, f.config.origin, logger, { client, secret });
  t.after(async () => { await w.stop(); db.close(); });
  await w.runOnce();
  const logged = JSON.stringify(logs); assert.match(logged, /safe-request-id/); assert.match(logged, /422/);
  assert.doesNotMatch(logged, /test-private-fal-key|private-capability|private-token/);
  const publicStatus = JSON.stringify(await state(f, id)); assert.doesNotMatch(publicStatus, /safe-request-id|private|422|Cannot fetch/);
});
