import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, videoBytes } from './helpers.js';
import { preparedSession } from './receive-fixture.js';
import { openDatabase } from '../src/server/db.js';
import { publishReady, readyCard } from '../src/server/sessions/receive.js';
import { createApp } from '../src/server/app.js';
import type { ReceiveStatus } from '../src/shared/receive.js';

type Row = { receive_token: string; download_token: string; opened_at: number | null; email_confirmed_at: number | null; email: string | null; email_state: string };
test('ready capabilities survive restart, isolate two sessions and serve the original photo/verified video', async t => {
  const f = await fixture(); t.after(() => f.close());
  const bytes = await videoBytes(f.root, 2);
  const first = await preparedSession(f.config.dataDir, bytes);
  const second = await preparedSession(f.config.dataDir, await videoBytes(f.root, 3), 2);
  await f.restart();
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  await f.app.ready();
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
  const file = await f.app.inject(download);
  assert.equal(file.statusCode, 200); assert.match(String(file.headers['content-disposition']), /attachment.*reelme-1.mp4/);
  assert.deepEqual(file.rawPayload, bytes); assert.equal(file.headers['referrer-policy'], 'no-referrer');
  for (const url of [`/download/${a.receive_token}`, `/api/receive/${a.download_token}`, '/receive/1', '/api/receive/' + 'x'.repeat(43), '/download/1', '/media/', `/api/receive/${a.receive_token}/../../media/`, `/api/receive/${a.receive_token}/photo/1`]) assert.equal((await f.app.inject(url)).statusCode, 404, url);
  for (const url of ['/api/admin/slots', '/api/auth/session', `/api/capture/sessions/${first.id}`]) assert.equal((await f.app.inject({ url, headers: { authorization: `Bearer ${a.receive_token}` } })).statusCode, 401, url);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/slots', headers: { authorization: `Bearer ${a.receive_token}`, origin: f.config.origin }, payload: {} })).statusCode, 401);
  await f.restart(); await f.app.ready();
  assert.deepEqual((await f.app.inject(download)).rawPayload, bytes);
  assert.deepEqual(db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(first.id), a);
  const artifact = process.env.REELME_RECEIVE_ARTIFACTS;
  if (artifact) { await mkdir(artifact, { recursive: true }); await writeFile(join(artifact, 'api-observations.json'), JSON.stringify({ localOnly: true, ready: true, sessions: 2, videoSha256: createHash('sha256').update(bytes).digest('hex'), restartPreservesTokensAndBytes: true, originalPhotoMatches: true, wrongScopeRejected: true, noAccountPrivileges: true }, null, 2) + '\n'); }
  db.prepare('DELETE FROM capture_sessions WHERE id=?').run(first.id);
  assert.equal((await f.app.inject(download)).statusCode, 404); assert.equal((await f.app.inject(api)).statusCode, 404);
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
  const second = await preparedSession(f.config.dataDir, bytes, 2); await publishReady(db, f.config.dataDir, second.id);
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
  for (const [index, kind] of ['missing', 'corrupt', 'frame'].entries()) {
    const session = await preparedSession(f.config.dataDir, bytes, index + 1);
    const path = join(f.config.dataDir, 'media', kind === 'frame' ? session.frame_path : session.video_path);
    if (kind === 'missing') await rm(path); else await writeFile(path, Buffer.alloc((await readFile(path)).length, 0));
    await publishReady(db, f.config.dataDir, session.id);
    assert.equal((db.prepare('SELECT state FROM capture_sessions WHERE id=?').get(session.id) as { state: string }).state, 'failed');
    assert.equal(db.prepare('SELECT session_id FROM session_delivery WHERE session_id=?').get(session.id), undefined);
    assert.equal(readyCard(db, f.config.origin, session.id), undefined);
    const state = await f.app.inject({ url: `/api/capture/sessions/${session.id}`, headers: { authorization: 'Bearer ' + 'a'.repeat(43) } });
    assert.equal(state.json().error.code, 'INVALID_RESULT'); assert.doesNotMatch(state.body, /fixture.test|video_path/);
  }
});

test('application generation callback publishes newly prepared results without email or another submit', async t => {
  const f = await fixture(); t.after(() => f.close());
  const bytes = await videoBytes(f.root, 1); const session = await preparedSession(f.config.dataDir, bytes);
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  db.prepare('UPDATE generation_jobs SET video_path=NULL,frame_path=NULL WHERE session_id=?').run(session.id);
  let downloads = 0;
  const app = await createApp(f.config, { generation: { intervalMs: 20, client: {
    async submit() { throw new Error('Unexpected submit'); }, async status() { throw new Error('Unexpected status'); }, async result() { throw new Error('Unexpected result'); },
  }, download: async () => { downloads++; return new Response(bytes); } } });
  t.after(() => app.close()); await app.ready();
  for (let i = 0; i < 150; i++) { if (db.prepare('SELECT session_id FROM session_delivery WHERE session_id=?').get(session.id)) break; await new Promise(resolve => setTimeout(resolve, 20)); }
  const row = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id) as Row;
  assert.ok(row); assert.equal(row.email_state, 'not_requested'); assert.equal(downloads, 1);
  assert.equal((await app.inject(`/download/${row.download_token}`)).statusCode, 200);
});
