import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, videoBytes } from './helpers.js';
import { preparedSession } from './receive-fixture.js';
import { openDatabase } from '../src/server/db.js';
import { publishReady, readyCard } from '../src/server/sessions/receive.js';
import { createApp } from '../src/server/app.js';
import type { ReceiveStatus } from '../src/shared/receive.js';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { jpegFixtures } from './jpeg-fixture.js';

type Row = { receive_token: string; download_token: string; opened_at: number | null; email_confirmed_at: number | null; email: string | null; email_state: string };
function observeFfmpeg(t: TestContext) {
  const calls: string[][] = [];
  const onChild = (message: unknown) => {
    const { process: child } = message as { process: ChildProcess };
    child.once('spawn', () => { if (child.spawnfile === 'ffmpeg') calls.push(child.spawnargs); });
  };
  subscribe('child_process', onChild);
  t.after(() => { unsubscribe('child_process', onChild); });
  return calls;
}
test('restart publishes saved media without FFmpeg and preserves scoped guest links', async t => {
  const f = await fixture(); t.after(() => f.close());
  const bytes = await videoBytes(f.root, 2);
  const first = await preparedSession(f.config.dataDir, bytes);
  const second = await preparedSession(f.config.dataDir, await videoBytes(f.root, 3), 2);
  const ffmpegCalls = observeFfmpeg(t);
  await f.restart();
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  await f.app.ready();
  assert.deepEqual(ffmpegCalls, [], 'restart publishes the persisted card frame without running FFmpeg');
  const a = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(first.id) as Row;
  const b = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(second.id) as Row;
  assert.notEqual(a.receive_token, a.download_token); assert.notEqual(a.receive_token, b.receive_token);
  const page = `/receive/${a.receive_token}`;
  const api = `/api${page}`;
  assert.equal((await f.app.inject(page)).statusCode, 200);
  const res = await f.app.inject(api); const view = res.json<ReceiveStatus>();
  assert.equal(view.number, 1); assert.equal(view.canSubmit, true); assert.equal(view.emailState, 'not_requested');
  assert.equal(view.openedAt, null); assert.equal(view.emailConfirmedAt, null);
  assert.doesNotMatch(res.body, /fixture.test|email"|download_token|result_url|video_path/);
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual((await f.app.inject(view.photoUrl)).rawPayload, first.photo);
  const other = (await f.app.inject(`/api/receive/${b.receive_token}`)).json<ReceiveStatus>();
  assert.equal(other.number, 2); assert.deepEqual((await f.app.inject(other.photoUrl)).rawPayload, second.photo);
  const card = readyCard(db, f.config.origin, first.id)!;
  assert.equal(card.number, 1); assert.equal(card.receiveUrl, `${f.config.origin}${page}`);
  assert.equal((await f.app.inject(new URL(card.frameUrl).pathname)).statusCode, 200);
  const download = `/download/${a.download_token}`;
  assert.equal(view.downloadUrl, download);
  assert.equal(view.videoUrl, `${download}?inline=1`);
  assert.notEqual(view.videoUrl, other.videoUrl);
  const playback = await f.app.inject({ url: view.videoUrl, headers: { range: 'bytes=0-63' } });
  assert.equal(playback.statusCode, 206);
  assert.equal(playback.headers['content-type'], 'video/mp4');
  assert.equal(playback.headers['content-disposition'], 'inline');
  assert.equal(playback.headers['accept-ranges'], 'bytes');
  assert.equal(playback.headers['content-range'], `bytes 0-63/${bytes.length}`);
  assert.equal(playback.headers['cache-control'], 'private, no-store');
  assert.deepEqual(playback.rawPayload, bytes.subarray(0, 64));
  const tail = await f.app.inject({ url: view.downloadUrl, headers: { range: 'bytes=-32' } });
  assert.equal(tail.statusCode, 206); assert.match(String(tail.headers['content-disposition']), /attachment/);
  assert.deepEqual(tail.rawPayload, bytes.subarray(-32));
  const outOfRange = await f.app.inject({ url: view.videoUrl, headers: { range: `bytes=${bytes.length}-` } });
  assert.equal(outOfRange.statusCode, 416);
  assert.equal(outOfRange.headers['content-range'], `bytes */${bytes.length}`);
  assert.deepEqual(db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(first.id), a);
  const file = await f.app.inject(download);
  assert.equal(file.statusCode, 200); assert.match(String(file.headers['content-disposition']), /attachment.*reelme-1.mp4/);
  assert.deepEqual(file.rawPayload, bytes); assert.equal(file.headers['referrer-policy'], 'no-referrer');
  await f.app.inject(view.downloadUrl + '?purpose=share');
  await f.app.inject({ method: 'HEAD', url: view.downloadUrl });
  const transfers = db.prepare("SELECT event, json_extract(detail,'$.method') method FROM session_history WHERE session_id=? AND step='delivery.download' ORDER BY id").all(first.id);
  assert.deepEqual(transfers, [
    {event:'range_served',method:'player'}, {event:'range_served',method:'attachment'},
    {event:'transfer_error',method:'player'}, {event:'response_finished',method:'attachment'},
    {event:'response_finished',method:'share_preload'}, {event:'headers_served',method:'head'},
  ]);
  const signal = {id:randomUUID(),action:'share_cancelled'};
  const report = (origin: string, payload: object) => f.app.inject({method:'POST',url:api+'/activity',headers:{origin},payload});
  assert.equal((await report('https://elsewhere.test',signal)).statusCode,403);
  assert.equal((await report(f.config.origin,{...signal,extra:'private'})).statusCode,400);
  for (let i=0;i<2;i++) assert.equal((await report(f.config.origin,signal)).statusCode,204);
  assert.deepEqual(db.prepare("SELECT outcome FROM session_history WHERE session_id=? AND source='browser'").all(first.id), [{outcome:'cancelled'}]);
  assert.deepEqual(db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(first.id), a);
  for (const url of [`/download/${a.receive_token}`, `/download/${a.receive_token}?inline=1`, `/api/receive/${a.download_token}`, '/receive/1', '/api/receive/' + 'x'.repeat(43), '/download/1', '/media/', `/api/receive/${a.receive_token}/../../media/`, `/api/receive/${a.receive_token}/photo/1`]) assert.equal((await f.app.inject(url)).statusCode, 404, url);
  for (const url of ['/api/admin/slots', '/api/auth/session', `/api/capture/sessions/${first.id}`]) assert.equal((await f.app.inject({ url, headers: { authorization: `Bearer ${a.receive_token}` } })).statusCode, 401, url);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: { authorization: `Bearer ${a.receive_token}`, origin: f.config.origin }, payload: {} })).statusCode, 401);
  await f.restart(); await f.app.ready();
  assert.deepEqual((await f.app.inject(download)).rawPayload, bytes);
  assert.deepEqual(db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(first.id), a);
  db.prepare('UPDATE events SET deleting=1').run();
  for (const url of [api, view.videoUrl, view.downloadUrl]) assert.equal((await f.app.inject(url)).statusCode, 404);
  db.prepare('UPDATE events SET deleting=0').run();
  const artifact = process.env.REELME_RECEIVE_ARTIFACTS;
  if (artifact) { await mkdir(artifact, { recursive: true }); await writeFile(join(artifact, 'api-observations.json'), JSON.stringify({ localOnly: true, ready: true, sessions: 2, videoSha256: createHash('sha256').update(bytes).digest('hex'), restartPreservesTokensAndBytes: true, originalPhotoMatches: true, wrongScopeRejected: true, noAccountPrivileges: true }, null, 2) + '\n'); }
  db.prepare('DELETE FROM capture_sessions WHERE id=?').run(first.id);
  assert.equal((await f.app.inject(download)).statusCode, 404); assert.equal((await f.app.inject(api)).statusCode, 404);
  assert.equal((await f.app.inject(view.videoUrl)).statusCode, 404);
});

test('email acceptance is atomic, first confirmation is fixed and only failed permits manual retry', async t => {
  const f = await fixture(); t.after(() => f.close());
  const bytes = await videoBytes(f.root, 1);
  const session = await preparedSession(f.config.dataDir, bytes);
  await f.restart(); await f.app.ready();
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const row = () => db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id) as Row;
  const api = `/api/receive/${row().receive_token}`;
  const post = (suffix: string, payload?: unknown) => f.app.inject({ method: 'POST', url: `${api}/${suffix}`, payload });
  assert.equal((await post('opened')).statusCode, 200);
  const openedAt = row().opened_at;
  assert.equal(row().email_confirmed_at, null);
  f.advance(20_000); await post('opened'); assert.equal(row().opened_at, openedAt);
  for (const email of ['invalid', 'a\r\nb@example.test', '', 'x'.repeat(255) + '@example.test']) assert.equal((await post('email', { email })).statusCode, 400);
  assert.equal(row().email_state, 'not_requested'); assert.equal(row().email_confirmed_at, null);
  const accepted = await Promise.all([post('email', { email: 'visitor@example.test' }), post('email', { email: 'other@example.test' })]);
  assert.deepEqual(accepted.map(r => r.statusCode).sort(), [200, 409]);
  const confirmedAt = row().email_confirmed_at; assert.ok(confirmedAt! > openedAt!);
  assert.equal(row().email_state, 'pending'); assert.equal(row().opened_at, openedAt);
  assert.doesNotMatch(accepted.find(r => r.statusCode === 200)!.body, /visitor@|other@/);
  for (const value of ['pending', 'sending', 'sent']) {
    db.prepare('UPDATE session_delivery SET email_state=? WHERE session_id=?').run(value, session.id);
    f.advance(60_000);
    assert.equal((await post('email', { email: 'changed@example.test' })).statusCode, 409);
    const view = (await f.app.inject(api)).json<ReceiveStatus>(); assert.equal(view.canSubmit, false); assert.equal(view.emailState, value);
    assert.equal(row().email_confirmed_at, confirmedAt);
    assert.equal((db.prepare('SELECT state FROM capture_sessions WHERE id=?').get(session.id) as { state: string }).state, 'ready');
  }
  db.prepare("UPDATE session_delivery SET email_state='failed',email_error='private SMTP details' WHERE session_id=?").run(session.id);
  const failed = await f.app.inject(api); assert.equal(failed.json().canSubmit, true); assert.doesNotMatch(failed.body, /SMTP|private/);
  f.advance(60_000); assert.equal((await post('email', { email: 'corrected@example.test' })).statusCode, 200);
  assert.equal(row().email, 'corrected@example.test'); assert.equal(row().email_state, 'pending'); assert.equal(row().email_confirmed_at, confirmedAt);
  await f.restart(); assert.equal((await f.app.inject(api)).json().emailState, 'pending'); assert.equal(row().email_confirmed_at, confirmedAt);
  const second = await preparedSession(f.config.dataDir, bytes, 2); await publishReady(db, f.config.dataDir, second.id, f.config.origin);
  const secondRow = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(second.id) as Row;
  await f.app.inject({ method: 'POST', url: `/api/receive/${secondRow.receive_token}/email`, payload: { email: 'without-opened@example.test' } });
  const inferred = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(second.id) as Row;
  assert.equal(inferred.opened_at, inferred.email_confirmed_at); assert.ok(inferred.opened_at);
  const artifact = process.env.REELME_RECEIVE_ARTIFACTS;
  if (artifact) {
    await mkdir(artifact, { recursive: true });
    await writeFile(join(artifact, 'email-observations.json'), JSON.stringify({ clock: 'controlled fixture clock, milliseconds since epoch', openedAt, firstConfirmedAt: confirmedAt,
      afterRetryConfirmedAt: row().email_confirmed_at, afterRestartEmailState: row().email_state,
      concurrentAcceptStatuses: accepted.map(r => r.statusCode).sort(), repeatDenied: ['pending', 'sending', 'sent'], manualRetryAllowedFrom: 'failed',
      generationRemained: 'ready', missingOpenedInferred: inferred.opened_at === inferred.email_confirmed_at, smtpCalled: false }, null, 2) + '\n');
  }
});

test('missing or corrupt persisted video/frame cannot publish ready', async t => {
  const f = await fixture(); t.after(() => f.close());
  const bytes = await videoBytes(f.root, 1);
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  for (const [index, kind] of ['missing', 'corrupt', 'frame', 'qr-write'].entries()) {
    const session = await preparedSession(f.config.dataDir, bytes, index + 1);
    const path = join(f.config.dataDir, 'media', kind === 'frame' ? session.frame_path : session.video_path);
    if (kind === 'qr-write') await mkdir(join(f.config.dataDir, 'media', 'sessions', session.id, 'qr.png'));
    else if (kind === 'missing') await rm(path); else await writeFile(path, Buffer.alloc((await readFile(path)).length, 0));
    await publishReady(db, f.config.dataDir, session.id, f.config.origin);
    assert.equal((db.prepare('SELECT state FROM capture_sessions WHERE id=?').get(session.id) as { state: string }).state, 'failed');
    assert.equal(db.prepare('SELECT session_id FROM session_delivery WHERE session_id=?').get(session.id), undefined);
    assert.equal(readyCard(db, f.config.origin, session.id), undefined);
    const state = await f.app.inject({ url: `/api/capture/sessions/${session.id}`, headers: { authorization: 'Bearer ' + 'a'.repeat(43) } });
    assert.equal(state.json().error.code, 'INVALID_RESULT'); assert.doesNotMatch(state.body, /fixture.test|video_path/);
  }
});

test('QR preparation precedes ready publication and repeated publication preserves tokens and QR', async t => {
  const f = await fixture(); t.after(() => f.close());
  const session = await preparedSession(f.config.dataDir, await videoBytes(f.root, 1));
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
  const generate = QRCode.toBuffer.bind(QRCode);
  t.mock.method(QRCode, 'toBuffer', async (text: string, options: QRCode.QRCodeToBufferOptions) => {
    entered.resolve(); await release.promise; return generate(text, options);
  });
  const publication = publishReady(db, f.config.dataDir, session.id, f.config.origin, () => 123);
  await entered.promise;
  assert.equal((db.prepare('SELECT state FROM capture_sessions WHERE id=?').get(session.id) as { state: string }).state, 'preparing');
  assert.equal(readyCard(db, f.config.origin, session.id), undefined);
  assert.equal(db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id), undefined);
  release.resolve(); await publication;
  const row = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id);
  const qrPath = join(f.config.dataDir, 'media', 'sessions', session.id, 'qr.png');
  const qr = await readFile(qrPath);
  assert.ok(qr.length > 0);
  await publishReady(db, f.config.dataDir, session.id, f.config.origin, () => 456);
  assert.deepEqual(db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id), row);
  assert.deepEqual(await readFile(qrPath), qr);
  assert.equal((db.prepare('SELECT ready_at FROM generation_jobs WHERE session_id=?').get(session.id) as { ready_at: number }).ready_at, 123);
});

test('late JPEG body damage in saved frame or photo prevents publication despite readable metadata', async t => {
  const f = await fixture(); t.after(() => f.close());
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const video = await videoBytes(f.root, 1); const sample = await jpegFixtures();
  for (const [index, kind] of ['frame', 'photo'].entries()) {
    const session = await preparedSession(f.config.dataDir, video, index + 1);
    const photo = db.prepare('SELECT path FROM capture_photos WHERE session_id=?').get(session.id) as { path: string };
    const relative = kind === 'frame' ? session.frame_path : photo.path;
    await writeFile(join(f.config.dataDir, 'media', relative), sample.broken.earlyEnd);
    if (kind === 'frame') db.prepare('UPDATE generation_jobs SET frame_size=? WHERE session_id=?').run(sample.broken.earlyEnd.length, session.id);
    await publishReady(db, f.config.dataDir, session.id, f.config.origin);
    assert.equal((db.prepare('SELECT state FROM capture_sessions WHERE id=?').get(session.id) as { state: string }).state, 'failed');
    assert.equal(db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id), undefined);
  }
});

test('fresh result uses FFmpeg only for the card frame and the issued QR leads to the original video', async t => {
  const f = await fixture(); t.after(() => f.close());
  const bytes = await videoBytes(f.root, 1); const session = await preparedSession(f.config.dataDir, bytes);
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  db.prepare('UPDATE generation_jobs SET video_path=NULL,frame_path=NULL WHERE session_id=?').run(session.id);
  const ffmpegCalls = observeFfmpeg(t);
  let downloads = 0;
  const app = await createApp(f.config, { now: () => Date.UTC(2026, 10, 14), generation: { intervalMs: 20, client: {
    async submit() { throw new Error('Unexpected submit'); }, async status() { throw new Error('Unexpected status'); }, async result() { throw new Error('Unexpected result'); },
  }, download: async () => { downloads++; return new Response(bytes); } } });
  t.after(() => app.close()); await app.ready();
  for (let i = 0; i < 150; i++) { if (db.prepare('SELECT session_id FROM session_delivery WHERE session_id=?').get(session.id)) break; await new Promise(resolve => setTimeout(resolve, 20)); }
  const row = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id) as Row;
  assert.ok(row); assert.equal(row.email_state, 'not_requested'); assert.equal(downloads, 1);
  assert.equal(ffmpegCalls.length, 1, 'only the card frame needs FFmpeg');
  const [args] = ffmpegCalls;
  assert.ok(args.includes('-frames:v') && args[args.indexOf('-frames:v') + 1] === '1');
  const qr = await readFile(join(f.config.dataDir, 'media', 'sessions', session.id, 'qr.png'));
  const { data, info } = await sharp(qr).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const receiveUrl = jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
  assert.equal(receiveUrl, `${f.config.origin}/receive/${row.receive_token}`);
  const response = await app.inject(`/api${new URL(receiveUrl!).pathname}`);
  const view = response.json<ReceiveStatus>();
  assert.deepEqual((await app.inject(view.downloadUrl)).rawPayload, bytes);
  const frame = await app.inject(`/api/receive/${row.receive_token}/frame`);
  assert.equal((await sharp(frame.rawPayload).metadata()).format, 'jpeg');
});
