import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, videoBytes } from './helpers.js';
import { preparedSession } from './receive-fixture.js';
import { openDatabase } from '../src/server/db.js';
import type { TodayDisplay } from '../src/shared/display.js';

test('display duration: admin-only enum, origin guard, persistent value and operator projection', async t => {
  const f = await fixture(); t.after(() => f.close());
  const admin = await f.login('admin'); const operator = await f.login('operator');
  const url = '/api/admin/display-settings';
  const get = () => f.app.inject({ url, headers: { cookie: admin } });
  const set = (payload: unknown, headers = { cookie: admin, origin: f.config.origin }) => f.app.inject({ method: 'PUT', url, headers, payload });
  assert.deepEqual((await get()).json(), { pageDurationSeconds: 10 });
  for (const headers of [{}, { cookie: operator }, { authorization: `Bearer ${'a'.repeat(43)}` }]) {
    assert.equal((await f.app.inject({ url, headers })).statusCode, Object.keys(headers).length ? 403 : 401);
    assert.equal((await f.app.inject({ method: 'PUT', url, headers: { ...headers, origin: f.config.origin }, payload: { pageDurationSeconds: 30 } })).statusCode, Object.keys(headers).length ? 403 : 401);
  }
  assert.equal((await set({ pageDurationSeconds: 30 }, { cookie: admin, origin: 'https://other.test' })).statusCode, 403);
  for (const pageDurationSeconds of [0, 9, 11, 15, 61, 20.5, '30', null]) assert.equal((await set({ pageDurationSeconds })).statusCode, 400);
  assert.equal((await set({ pageDurationSeconds: 20, extra: true })).statusCode, 400);
  for (const seconds of [10, 20, 30, 40, 50, 60]) {
    const response = await set({ pageDurationSeconds: seconds });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { pageDurationSeconds: seconds });
    assert.equal((await f.app.inject({ url: '/api/display/today', headers: { cookie: operator } })).json<TodayDisplay>().pageDurationSeconds, seconds);
  }
  await f.restart();
  assert.deepEqual((await get()).json(), { pageDurationSeconds: 60 });
});

test('display exposes existing ready timestamp without fabricating legacy history', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.advance(Date.parse('2026-11-14T10:00:00Z') - Date.UTC(2026, 0, 1));
  const bytes = await videoBytes(f.root, 1);
  const session = await preparedSession(f.config.dataDir, bytes);
  await f.restart(); await f.app.ready();
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const cookie = await f.login('operator');
  const view = async () => (await f.app.inject({ url: '/api/display/today', headers: { cookie } })).json<TodayDisplay>().sessions[0];
  db.prepare('UPDATE generation_jobs SET ready_at=? WHERE session_id=?').run(12345, session.id);
  assert.equal((await view()).readyAt, 12345);
  db.prepare('UPDATE generation_jobs SET ready_at=NULL WHERE session_id=?').run(session.id);
  assert.equal((await view()).readyAt, null);
  db.prepare("UPDATE capture_sessions SET state='observing' WHERE id=?").run(session.id);
  assert.equal((await view()).readyAt, null);
});
