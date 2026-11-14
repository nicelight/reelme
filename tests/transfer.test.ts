/** Accepted photo sets, durable handoff and installation access on real SQLite/files. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import sharp from 'sharp';
import { fixture, imageBytes, videoBytes, multipart } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import type { CaptureStatus, StartReceipt } from '../src/shared/capture.js';

const installation = { authorization: `Bearer ${'a'.repeat(43)}`, origin: 'http://localhost:5513' };
type Fixture = Awaited<ReturnType<typeof fixture>>;
type StoredPhoto = { session_id: string; pose_index: number; path: string; size: number; width: number; height: number };
const jpeg = (color: string) => sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).jpeg().toBuffer();
async function setup(f: Fixture) {
  const cookie = await f.login();
  const thumbnail = await f.upload(cookie, await imageBytes());
  const clip = await f.upload(cookie, await videoBytes(f.root), 'video/mp4', 'clip.mp4');
  const ids: string[] = [];
  for (const count of [1, 4]) {
    const response = await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: { cookie, origin: f.config.origin }, payload: {
      description: `Сюжет ${count} фото`, visible: true, thumbnailId: thumbnail.id, referenceIds: [],
      ...(count === 1 ? { mode: 'V2V', model: 'minimax/h3-max/recast', videoId: clip.id, resolution: '768P', recastShotsConfirmed: true }
        : { mode: 'P2V', model: 'kling/v4/reference-to-video', resolution: '720p', duration: 5, prompt: 'Visitor @Element1' }),
    } });
    assert.equal(response.statusCode, 201, response.body); ids.push(response.json().id);
  }
  return { cookie, ids };
}
async function start(f: Fixture, slotId: string) {
  const response = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: randomUUID() } });
  assert.equal(response.statusCode, 201); return response.json<StartReceipt>();
}
const path = (id: string) => `/api/capture/sessions/${id}`;
async function upload(f: Fixture, id: string, index: string | number, bytes: Buffer, mime = 'image/jpeg', headers: Record<string, string> = installation) {
  const part = multipart(bytes, mime, 'photo.jpg');
  return f.app.inject({ method: 'PUT', url: `${path(id)}/photos/${index}`, headers: { ...headers, 'content-type': part.contentType }, payload: part.bytes });
}
async function status(f: Fixture, id: string) {
  const response = await f.app.inject({ url: path(id), headers: installation });
  assert.equal(response.statusCode, 200); return response.json<CaptureStatus>();
}
const finalize = (f: Fixture, id: string) => f.app.inject({ method: 'POST', url: `${path(id)}/finalize`, headers: installation });
function stored(f: Fixture, id: string): StoredPhoto[] {
  const db = openDatabase(f.config.dataDir);
  try { return db.prepare('SELECT * FROM capture_photos WHERE session_id=? ORDER BY pose_index').all(id) as StoredPhoto[]; }
  finally { db.close(); }
}
async function assertBytes(f: Fixture, id: string, expected: Buffer[]) {
  const rows = stored(f, id); assert.equal(rows.length, expected.length);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].pose_index, i); assert.equal(rows[i].session_id, id);
    assert.equal(rows[i].size, expected[i].length); assert.equal(rows[i].width, 64); assert.equal(rows[i].height, 48);
    assert.deepEqual(await readFile(join(f.config.dataDir, 'media', rows[i].path)), expected[i]);
  }
}

test('complete sets persist across restart; retry replaces only one pose; finalize transitions once and releases next session', async t => {
  const f = await fixture(); t.after(() => f.close());
  const { ids } = await setup(f);
  const a = await start(f, ids[1]);
  const bytes = await Promise.all(['red', 'blue', 'green', 'orange'].map(jpeg));
  const initial = await status(f, a.sessionId);
  assert.deepEqual(initial.acceptedPoseIndices, []); assert.equal(initial.complete, false); assert.equal(initial.finalized, false);
  assert.equal((await finalize(f, a.sessionId)).statusCode, 409);
  assert.equal((await upload(f, a.sessionId, 0, bytes[0])).statusCode, 200);
  assert.equal((await upload(f, a.sessionId, 1, bytes[1])).statusCode, 200);
  const previous = stored(f, a.sessionId);
  assert.equal((await upload(f, a.sessionId, 0, bytes[0])).statusCode, 200);
  assert.equal(stored(f, a.sessionId)[1].path, previous[1].path);
  await assertBytes(f, a.sessionId, bytes.slice(0, 2));
  assert.equal((await finalize(f, a.sessionId)).json().code, 'INCOMPLETE_PHOTOS');
  for (let i = 2; i < 4; i++) assert.equal((await upload(f, a.sessionId, i, bytes[i])).statusCode, 200);
  const full = await status(f, a.sessionId);
  assert.equal(full.complete, true); assert.equal(full.finalized, false); assert.equal(full.state, 'capturing');
  const db = openDatabase(f.config.dataDir);
  db.exec(`CREATE TABLE test_transitions(session_id TEXT); CREATE TRIGGER test_capture_transition AFTER UPDATE OF state ON capture_sessions
    WHEN OLD.state='capturing' AND NEW.state='submit_pending' BEGIN INSERT INTO test_transitions VALUES (NEW.id); END;`);
  db.close();
  const finals = await Promise.all([finalize(f, a.sessionId), finalize(f, a.sessionId)]);
  assert.ok(finals.every(result => result.statusCode === 200)); assert.deepEqual(finals[0].json(), finals[1].json());
  assert.equal(finals[0].json().state, 'submit_pending'); assert.equal(finals[0].json().finalized, true);
  const audit = openDatabase(f.config.dataDir);
  assert.deepEqual(audit.prepare('SELECT * FROM test_transitions').all(), [{ session_id: a.sessionId }]); audit.close();
  const accepted = stored(f, a.sessionId);
  assert.equal((await upload(f, a.sessionId, 0, bytes[1])).statusCode, 409);
  assert.deepEqual(stored(f, a.sessionId), accepted);
  const b = await start(f, ids[0]);
  assert.notEqual(a.sessionId, b.sessionId); assert.equal(b.number, a.number + 1);
  assert.equal((await upload(f, b.sessionId, 0, bytes[3])).statusCode, 200);
  assert.equal((await finalize(f, b.sessionId)).statusCode, 200);
  // No generation consumer is running: the first session deliberately stays pending.
  assert.equal((await status(f, a.sessionId)).state, 'submit_pending');
  f.advance(25 * 60 * 60 * 1000); await f.restart();
  const recovered = await status(f, a.sessionId);
  assert.equal(recovered.date, a.date); assert.equal(recovered.number, a.number);
  assert.deepEqual(recovered.posePlan, a.posePlan); assert.equal(recovered.finalized, true);
  assert.deepEqual((await finalize(f, a.sessionId)).json(), recovered);
  await assertBytes(f, a.sessionId, bytes); await assertBytes(f, b.sessionId, [bytes[3]]);
});

test('capture endpoints enforce installation key/CORS and reject malformed images, positions and oversized uploads', async t => {
  const f = await fixture(); t.after(() => f.close());
  const { cookie, ids } = await setup(f); const operator = await f.login('operator');
  const a = await start(f, ids[0]); const image = await jpeg('red');
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { cookie }, { cookie: operator }]) {
    const expected = 'cookie' in headers ? 403 : 401;
    assert.equal((await f.app.inject({ url: path(a.sessionId), headers })).statusCode, expected);
    assert.equal((await f.app.inject({ method: 'POST', url: `${path(a.sessionId)}/finalize`, headers })).statusCode, expected);
    assert.equal((await upload(f, a.sessionId, 0, image, 'image/jpeg', headers)).statusCode, expected);
  }
  const preflight = await f.app.inject({ method: 'OPTIONS', url: `${path(a.sessionId)}/photos/0`, headers: { origin: installation.origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } });
  assert.equal(preflight.statusCode, 204); assert.equal(preflight.headers['access-control-allow-origin'], installation.origin);
  assert.match(String(preflight.headers['access-control-allow-methods']), /PUT/);
  assert.match(String(preflight.headers['access-control-allow-headers']), /Authorization/);
  const get = await f.app.inject({ url: path(a.sessionId), headers: installation });
  assert.equal(get.headers['access-control-allow-origin'], installation.origin); assert.equal(get.headers['cache-control'], 'no-store');
  const alien = await f.app.inject({ method: 'OPTIONS', url: `${path(a.sessionId)}/photos/0`, headers: { origin: 'https://untrusted.test', 'access-control-request-method': 'PUT' } });
  assert.equal(alien.headers['access-control-allow-origin'], undefined);
  for (const index of ['-1', '1', '4', '0.5', '00', 'no']) assert.equal((await upload(f, a.sessionId, index, image)).statusCode, 400, index);
  for (const [id, code] of [['bad-id', 400], [randomUUID(), 404]] as const) {
    assert.equal((await upload(f, id, 0, image)).statusCode, code);
    assert.equal((await f.app.inject({ url: path(id), headers: installation })).statusCode, code);
    assert.equal((await finalize(f, id)).statusCode, code);
  }
  assert.equal((await upload(f, a.sessionId, 0, image)).statusCode, 200);
  const before = stored(f, a.sessionId);
  for (const bytes of [Buffer.from('not a jpeg'), await imageBytes(), image.subarray(0, image.length / 2)]) {
    const response = await upload(f, a.sessionId, 0, bytes);
    assert.equal(response.statusCode, 400, response.body); assert.equal(response.json().code, 'INVALID_PHOTO');
  }
  assert.equal((await upload(f, a.sessionId, 0, image, 'image/png')).statusCode, 400);
  assert.equal((await upload(f, a.sessionId, 0, Buffer.alloc(20 * 1024 * 1024 + 1))).statusCode, 413);
  const wrongBody = await f.app.inject({ method: 'PUT', url: `${path(a.sessionId)}/photos/0`, headers: installation, payload: { image: 'bad' } });
  assert.equal(wrongBody.statusCode, 415);
  assert.deepEqual(stored(f, a.sessionId), before); await assertBytes(f, a.sessionId, [image]);
  assert.deepEqual(await readdir(join(f.config.dataDir, 'media', 'sessions', a.sessionId)), [before[0].path.split('/').pop()]);
});

test('an upload already in flight cannot change a finalized photo or hold a DB transaction while streaming', async t => {
  const f = await fixture(); t.after(() => f.close());
  const { ids } = await setup(f); const a = await start(f, ids[0]);
  const original = await jpeg('red'); const replacement = await jpeg('blue');
  assert.equal((await upload(f, a.sessionId, 0, original)).statusCode, 200);
  const before = stored(f, a.sessionId);
  const origin = await f.app.listen({ port: 0, host: '127.0.0.1' });
  const part = multipart(replacement, 'image/jpeg', 'replacement.jpg');
  let send!: ReturnType<typeof httpRequest>;
  const response = new Promise<{ code: number; body: string }>((resolve, reject) => {
    send = httpRequest(`${origin}${path(a.sessionId)}/photos/0`, { method: 'PUT', headers: { ...installation, 'content-type': part.contentType, 'content-length': part.bytes.length } }, res => {
      let body = ''; res.on('data', data => { body += data; }); res.on('end', () => resolve({ code: res.statusCode!, body }));
    });
    send.on('error', reject);
  });
  t.after(() => send.destroy());
  send.write(part.bytes.subarray(0, part.bytes.length - 64));
  const directory = join(f.config.dataDir, 'media', 'sessions', a.sessionId);
  for (let i = 0; i < 100 && (await readdir(directory)).length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await readdir(directory)).length, 2, 'new file is streaming but not published');
  const complete = await finalize(f, a.sessionId);
  assert.equal(complete.statusCode, 200); assert.equal(complete.json().state, 'submit_pending');
  send.end(part.bytes.subarray(part.bytes.length - 64));
  const late = await response;
  assert.equal(late.code, 409, late.body); assert.equal(JSON.parse(late.body).code, 'CAPTURE_CLOSED');
  assert.deepEqual(stored(f, a.sessionId), before); await assertBytes(f, a.sessionId, [original]);
  assert.equal((await readdir(directory)).length, 1, 'rejected replacement removed');
});
