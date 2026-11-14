/** Ten additional endpoints through the real worker/files, with a controlled
 * fal SDK HTTP transport. No external generation or CDN upload is performed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, multipart } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { createGenerationWorker } from '../src/server/sessions/generation.js';
import { createFalTransport } from '../src/server/sessions/fal.js';
import { models, slotSchema, type SlotInput } from '../src/shared/scenarios.js';
import { buildModelInput } from '../src/server/sessions/model-input.js';

const endpoints = [
  'fal-ai/kling-video/o1/video-to-video/edit', 'fal-ai/kling-video/o3/pro/video-to-video/edit',
  'kling/v4/video-to-video/edit', 'kling/v4/flash/video-to-video',
  'kling/v4/reference-to-video', 'fal-ai/kling-video/o3/pro/reference-to-video',
  'kling/v4/flash/reference-to-video', 'minimax/h3-max/reference-to-video',
  'fal-ai/vidu/q4/reference-to-video', 'google/gemini-omni-flash/v1.2/reference-to-video',
];
const installation = { authorization: `Bearer ${'a'.repeat(43)}` };
const promptFor = (endpoint: string) => endpoint.startsWith('minimax/')
  ? 'Image 1, Image 2, Image 3 and Image 4 show the same person walking through Image 5.'
  : endpoint.startsWith('fal-ai/vidu/')
    ? '[@reference_image_1], [@reference_image_2], [@reference_image_3], [@reference_image_4] show the same person in [@reference_image_5].'
    : endpoint.startsWith('google/')
      ? '<IMAGE_REF_0>, <IMAGE_REF_1>, <IMAGE_REF_2>, <IMAGE_REF_3> show the same person in <IMAGE_REF_4>.'
      : '@Element1 walks through the scene.';

test('ten model inputs, snapshot isolation and reusable P2V URLs yield decoded session-owned results', async t => {
  const f = await fixture(); t.after(() => f.close());
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const cookie = await f.login(); const admin = { cookie, origin: f.config.origin };
  const images = await Promise.all(['#aabbcc', '#bbccdd', '#ccddee', '#ddeeff'].map(background =>
    sharp({ create: { width: 720, height: 720, channels: 3, background } }).jpeg().toBuffer()));
  const referenceIds = [] as string[];
  for (const image of images.slice(0, 3)) referenceIds.push((await f.upload(cookie, image, 'image/jpeg', 'reference.jpg')).id);
  const clipPath = join(f.root, 'source.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:r=24', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', clipPath]);
  const bytes = await readFile(clipPath);
  const videoId = (await f.upload(cookie, bytes, 'video/mp4', 'source.mp4')).id;
  const requests: { endpoint: string; input: Record<string, any>; requestId: string }[] = [];
  const httpCalls: { method: string; url: string }[] = [];
  const transport: typeof fetch = async (url, options) => {
    const method = options?.method?.toUpperCase() ?? 'GET'; const address = String(url);
    httpCalls.push({ method, url: address });
    assert.ok(address.startsWith('https://queue.fal.run/'));
    let data;
    if (method === 'POST') {
      const requestId = `request-${requests.length}`;
      requests.push({ endpoint: address.slice('https://queue.fal.run/'.length).split('?')[0], input: JSON.parse(String(options!.body)), requestId });
      data = { request_id: requestId, status_url: `${address}/requests/${requestId}/status`, response_url: `${address}/requests/${requestId}` };
    } else if (address.includes('/status')) data = { status: 'COMPLETED' };
    else data = { video: { url: `https://cdn.fal.test/${address.split('/').pop()}.mp4` } };
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  const downloaded: string[] = [];
  const runner = createGenerationWorker(db, f.config.dataDir, f.config.origin, f.app.log, {
    client: createFalTransport('controlled-test-key', transport),
    download: async url => { downloaded.push(String(url)); return new Response(bytes); },
  });
  t.after(() => runner.stop());
  const sessions: { id: string; input: SlotInput; slotId: string }[] = [];
  async function capture(slotId: string, input: SlotInput) {
    const start = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: randomUUID() } });
    assert.equal(start.statusCode, 201, start.body); const id = start.json().sessionId as string;
    // Arrival order must not become model order.
    for (const pose of [3, 1, 0, 2]) {
      const part = multipart(images[pose], 'image/jpeg', 'visitor.jpg');
      const upload = await f.app.inject({ method: 'PUT', url: `/api/capture/sessions/${id}/photos/${pose}`, headers: { ...installation, 'content-type': part.contentType }, payload: part.bytes });
      assert.equal(upload.statusCode, 200, upload.body);
    }
    const final = await f.app.inject({ method: 'POST', url: `/api/capture/sessions/${id}/finalize`, headers: installation });
    assert.equal(final.statusCode, 200, final.body);
    sessions.push({ id, input, slotId }); return id;
  }
  for (const endpoint of endpoints) {
    const model = models.find(model => model.id === endpoint)!;
    const input: SlotInput = { description: model.name, visible: true, thumbnailId: referenceIds[0], mode: model.mode, model: endpoint,
      referenceIds: model.mode === 'P2V' ? referenceIds : [], prompt: promptFor(endpoint),
      ...(model.resolutions.length ? { resolution: model.resolutions.at(-1) } : {}),
      ...(model.mode === 'P2V' ? { duration: 10, demoId: videoId } : { videoId }),
      ...(endpoint.startsWith('minimax/') ? { duration: 0.92, promptExpansionMode: 'disabled' as const } : {}),
    };
    const slot = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: admin, payload: input });
    assert.equal(slot.statusCode, 201, slot.body);
    await capture(slot.json().id, input);
  }
  const old = sessions.find(s => s.input.model === 'kling/v4/reference-to-video')!;
  await capture(old.slotId, old.input);
  const changed: SlotInput = { ...old.input, model: 'google/gemini-omni-flash/v1.2/reference-to-video', prompt: 'Changed prompt <IMAGE_REF_0>', resolution: '4k', duration: 15, referenceIds: [referenceIds[2]] };
  const update = await f.app.inject({ method: 'PUT', url: `/api/admin/slots/${old.slotId}`, headers: admin, payload: changed });
  assert.equal(update.statusCode, 200, update.body);
  await capture(old.slotId, changed);
  await runner.runOnce();
  assert.equal(requests.length, sessions.length);
  const observation: unknown[] = [];
  const payloads = new Map<string, Record<string, any>>();
  for (const session of sessions) {
    const job = db.prepare('SELECT request_id FROM generation_jobs WHERE session_id=?').get(session.id) as { request_id: string };
    const request = requests.find(request => request.requestId === job.request_id)!;
    const { input } = request; payloads.set(session.id, input);
    assert.equal(request.endpoint, session.input.model);
    assert.equal(input.prompt, session.input.prompt);
    assert.equal(input.resolution, session.input.resolution);
    assert.equal('resolution' in input, session.input.resolution !== undefined);
    assert.equal('video_url' in input, session.input.mode === 'V2V');
    assert.equal('duration' in input, session.input.mode === 'P2V');
    if (session.input.mode === 'V2V') {
      const response = await f.app.inject({ url: new URL(input.video_url).pathname });
      assert.equal(response.statusCode, 200); assert.deepEqual(response.rawPayload, bytes);
    }
    if (session.input.mode === 'P2V') assert.equal(input.duration,
      session.input.model === 'fal-ai/kling-video/o3/pro/reference-to-video' ? String(session.input.duration) : session.input.duration);
    const kling = session.input.model.includes('kling');
    if (kling) assert.equal(input.elements.length, 1);
    const photoUrls: string[] = kling ? [input.elements[0].frontal_image_url, ...input.elements[0].reference_image_urls] : (input.reference_image_urls ?? input.image_urls).slice(0, 4);
    const refs: string[] = kling ? input.image_urls : (input.reference_image_urls ?? input.image_urls).slice(4);
    assert.equal(photoUrls.length, 4); assert.equal(refs.length, session.input.referenceIds.length);
    for (const [index, url] of photoUrls.entries()) {
      assert.equal(new URL(url).origin, f.config.origin);
      const identity = db.prepare('SELECT session_id,pose_index FROM provider_media WHERE token=?').get(new URL(url).pathname.split('/').pop());
      assert.deepEqual(identity, { session_id: session.id, pose_index: index });
      const response = await f.app.inject({ url: new URL(url).pathname });
      assert.equal(response.statusCode, 200); assert.deepEqual(response.rawPayload, images[index]);
    }
    for (const [index, url] of refs.entries()) {
      const identity = db.prepare('SELECT slot_media_id FROM provider_media WHERE token=?').get(new URL(url).pathname.split('/').pop()) as { slot_media_id: string };
      assert.equal(identity.slot_media_id, session.input.referenceIds[index]);
      const response = await f.app.inject({ url: new URL(url).pathname }); assert.equal(response.statusCode, 200);
      assert.deepEqual(response.rawPayload, images[referenceIds.indexOf(identity.slot_media_id)]);
    }
    if (session.input.mode === 'P2V') {
      assert.equal('video_urls' in input, false); assert.equal('reference_video_urls' in input, false);
      assert.equal('demoId' in input, false);
    }
    if (session.input.model.startsWith('minimax/')) assert.equal(input.prompt_expansion_mode, 'disabled');
    observation.push({ sessionId: session.id, endpoint: request.endpoint, input });
  }
  assert.deepEqual(payloads.get(old.id)!.image_urls, payloads.get(sessions[10].id)!.image_urls);
  assert.notEqual(payloads.get(old.id)!.elements[0].frontal_image_url, payloads.get(sessions[10].id)!.elements[0].frontal_image_url);
  assert.equal(payloads.get(old.id)!.duration, 10); assert.equal(payloads.get(sessions[11].id)!.duration, 15);
  await runner.runOnce(); await runner.runOnce(); await runner.runOnce();
  assert.equal(requests.length, sessions.length); assert.equal(downloaded.length, sessions.length);
  const jobs = [];
  for (const session of sessions) {
    const job = db.prepare('SELECT * FROM generation_jobs WHERE session_id=?').get(session.id) as any;
    assert.equal(job.error_code, null); assert.equal(job.width, 1280); assert.equal(job.height, 720); assert.equal(job.duration, 3);
    assert.ok(job.video_size > 0); assert.match(job.video_path, new RegExp(`^sessions/${session.id}/`));
    assert.deepEqual(await readFile(join(f.config.dataDir, 'media', job.video_path)), bytes);
    assert.equal((await sharp(join(f.config.dataDir, 'media', job.frame_path)).metadata()).format, 'jpeg');
    assert.equal((db.prepare('SELECT state FROM capture_sessions WHERE id=?').get(session.id) as any).state, 'preparing');
    jobs.push({ sessionId: session.id, requestId: job.request_id, videoSize: job.video_size, width: job.width, height: job.height, duration: job.duration });
  }
  assert.equal(httpCalls.filter(call => call.method === 'POST').length, sessions.length);
  const artifacts = process.env.REELME_MODEL_ARTIFACTS;
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, 'model-observations.json'), JSON.stringify({ transport: 'controlled fal SDK HTTP; no live API or CDN uploads', inputs: observation, jobs,
      stableP2VReferences: true, oldSnapshotRetained: true, demoExcluded: true, providerMediaRoutes: 'in-process HTTPS-origin requests; public TLS not exercised', httpCalls, downloads: downloaded }, null, 2) + '\n');
  }
});

test('model prompt limits reject oversized saved settings and incomplete photo sets', () => {
  for (const endpoint of endpoints) {
    const model = models.find(m => m.id === endpoint)!;
    const input = { description: 'test', visible: true, thumbnailId: randomUUID(), mode: model.mode, model: endpoint, referenceIds: [], prompt: 'valid',
      ...(model.resolutions.length ? { resolution: model.defaultResolution } : {}),
      ...(model.mode === 'P2V' ? { duration: 10 } : { videoId: randomUUID() }),
      ...(endpoint.startsWith('minimax/') ? { promptExpansionMode: 'disabled' as const } : {}),
    };
    const limit = endpoint.startsWith('fal-ai/kling-video/') ? 2500 : endpoint.startsWith('fal-ai/vidu/') ? 5000 : 10000;
    assert.equal(slotSchema.safeParse({ ...input, prompt: 'x'.repeat(limit) }).success, true, endpoint);
    assert.equal(slotSchema.safeParse({ ...input, prompt: 'x'.repeat(limit + 1) }).success, false, endpoint);
    assert.equal(slotSchema.safeParse({ ...input, prompt: '' }).success, false, endpoint);
    const { description, thumbnailId, visible: _, ...generation } = slotSchema.parse(input);
    assert.throws(() => buildModelInput({ slotId: randomUUID(), description, thumbnailId, expectedPhotos: 4, generation }, { photos: ['https://test/one'], video: 'https://test/video', references: [] }));
  }
});
