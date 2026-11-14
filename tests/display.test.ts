import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { fixture, videoBytes } from './helpers.js';
import { preparedSession } from './receive-fixture.js';
import { openDatabase } from '../src/server/db.js';
import type { TodayDisplay } from '../src/shared/display.js';

const NOVEMBER = Date.parse('2026-11-14T10:00:00Z');
const JANUARY = Date.UTC(2026, 0, 1);
type Delivery = { receive_token: string; download_token: string; opened_at: number | null; email_confirmed_at: number | null; email_state: string };

test('operator display: six stages, explicit errors, stable order, private media, masked payload and matching QR', async t => {
  const f = await fixture(); t.after(() => f.close()); f.advance(NOVEMBER - JANUARY);
  const bytes = await videoBytes(f.root, 1);
  const first = await preparedSession(f.config.dataDir, bytes, 1);
  const second = await preparedSession(f.config.dataDir, bytes, 2);
  await f.restart(); await f.app.ready();
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const row = () => db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(first.id) as Delivery;
  const cookie = await f.login('operator'); const admin = await f.login('admin');
  const get = (url = '/api/display/today') => f.app.inject({ url, headers: { cookie } });
  const view = async () => (await get()).json<TodayDisplay>();
  const card = (await view()).sessions[0].card!;
  for (const url of ['/api/display/today', card.photoUrl, card.frameUrl, card.qrUrl]) {
    assert.equal((await f.app.inject(url)).statusCode, 401, url);
    assert.equal((await f.app.inject({ url, headers: { cookie: admin } })).statusCode, 403, url);
    assert.equal((await f.app.inject({ url, headers: { authorization: `Bearer ${'a'.repeat(43)}` } })).statusCode, 403, url);
    for (const token of [row().receive_token, row().download_token]) assert.equal((await f.app.inject({ url, headers: { authorization: `Bearer ${token}` } })).statusCode, 401, url);
    assert.equal((await get(url)).statusCode, 200, url);
  }
  assert.deepEqual((await get(card.photoUrl)).rawPayload, first.photo);
  assert.deepEqual((await get(card.frameUrl)).rawPayload, await readFile(join(f.config.dataDir, 'media', first.frame_path)));
  const png = await sharp((await get(card.qrUrl)).rawPayload).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(jsQR(new Uint8ClampedArray(png.data), png.info.width, png.info.height)?.data, `${f.config.origin}/receive/${row().receive_token}`);
  assert.equal(row().opened_at, null); assert.equal(row().email_confirmed_at, null);
  assert.equal((await get()).headers['cache-control'], 'no-store');
  for (const [state, stage, label] of [
    ['capturing', 0, 'Съёмка'], ['submit_pending', 1, 'Отправка на генерацию'], ['observing', 2, 'Генерация'],
    ['preparing', 3, 'Подготовка для скачивания'], ['ready', 4, 'Видео ждёт скачивания'],
  ] as const) {
    db.prepare('UPDATE capture_sessions SET state=? WHERE id=?').run(state, first.id);
    const items = (await view()).sessions;
    assert.deepEqual(items.map(item => item.id), [first.id, second.id]);
    assert.equal(items[0].stage, stage); assert.equal(items[0].label, label);
    assert.equal(items[0].card !== null, state === 'ready');
  }
  await f.app.inject({ method: 'POST', url: `/api/receive/${row().receive_token}/opened` });
  assert.equal((await view()).sessions[0].stage, 5);
  f.advance(181_000); assert.equal((await view()).sessions.length, 2); // opening starts no deadline
  await f.app.inject({ method: 'POST', url: `/api/receive/${row().receive_token}/email`, payload: { email: 'mailname@example.com' } });
  assert.equal((await view()).sessions[0].stage, 5);
  db.prepare("UPDATE session_delivery SET email_state='failed',email_error='SECRET_RAW_ERROR' WHERE session_id=?").run(first.id);
  assert.equal((await view()).sessions[0].stage, 5); assert.match((await view()).sessions[0].error!, /повторите/);
  db.prepare("UPDATE session_delivery SET email_state='sent',sent_at=? WHERE session_id=?").run(NOVEMBER, first.id);
  assert.equal((await view()).sessions[0].stage, 6);
  assert.equal((await view()).sessions[0].label, 'Видео отправлено на mailname***@***.com');
  assert.doesNotMatch((await get()).body, /mailname@example\.com|SECRET_RAW_ERROR|fixture.test|download_token|receive_token|video_path/);
  db.prepare("UPDATE capture_sessions SET state='failed' WHERE id=?").run(second.id);
  const failed = (await view()).sessions[1]; assert.equal(failed.stage, 0); assert.equal(failed.card, null); assert.match(failed.error!, /Не удалось создать/);
});

test('first-confirmation deadline survives retry/restart; today is Novosibirsk; hidden data and links remain', async t => {
  const f = await fixture(); t.after(() => f.close()); f.advance(NOVEMBER - JANUARY);
  const bytes = await videoBytes(f.root, 1); const session = await preparedSession(f.config.dataDir, bytes);
  await f.restart(); await f.app.ready();
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const row = () => db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id) as Delivery;
  const original = row(); const cookie = await f.login('operator');
  const view = async () => (await f.app.inject({ url: '/api/display/today', headers: { cookie } })).json<TodayDisplay>();
  const card = (await view()).sessions[0].card!;
  const confirm = () => f.app.inject({ method: 'POST', url: `/api/receive/${original.receive_token}/email`, payload: { email: 'corrected@example.test' } });
  await confirm(); const confirmed = row().email_confirmed_at;
  f.advance(60_000); db.prepare("UPDATE session_delivery SET email_state='failed' WHERE session_id=?").run(session.id);
  await confirm(); assert.equal(row().email_confirmed_at, confirmed);
  db.prepare("UPDATE session_delivery SET email_state='failed' WHERE session_id=?").run(session.id);
  await f.restart(); await f.app.ready(); assert.equal(row().email_confirmed_at, confirmed);
  f.advance(119_000); assert.equal((await view()).sessions.length, 1); assert.equal((await view()).sessions[0].hideAt, confirmed! + 180_000);
  f.advance(1000); assert.equal((await view()).sessions.length, 0);
  for (const url of Object.values(card)) assert.equal((await f.app.inject({ url, headers: { cookie } })).statusCode, 404);
  assert.equal((await f.app.inject(`/api/receive/${original.receive_token}`)).statusCode, 200);
  assert.deepEqual((await f.app.inject(`/download/${original.download_token}`)).rawPayload, bytes);
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', session.video_path)), bytes);
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', `sessions/${session.id}/photo.jpg`)), session.photo);
  // Independent of hide time, a session belongs to the event at creation.
  db.prepare('UPDATE session_delivery SET email_confirmed_at=NULL WHERE session_id=?').run(session.id);
  f.advance(Date.parse('2026-11-14T16:59:59Z') - NOVEMBER - 180_000);
  assert.equal((await view()).date, '2026-11-14'); assert.equal((await view()).sessions.length, 1);
  f.advance(1000); assert.equal((await view()).date, '2026-11-15'); assert.equal((await view()).sessions.length, 0);
  assert.equal((await f.app.inject(`/receive/${original.receive_token}`)).statusCode, 200);
  assert.deepEqual((await f.app.inject(`/download/${original.download_token}`)).rawPayload, bytes);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM capture_sessions WHERE id=?').get(session.id) as { n: number }).n, 1);
});
