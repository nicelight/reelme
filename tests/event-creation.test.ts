/** Event setup uses the real API and isolated SQLite. Date, first-visitor gate,
 * retries, migration and automatic numbering survive server/browser lifetimes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { fixture, imageBytes, seedLegacySlot, videoBytes } from './helpers.js';
import { openDatabase } from '../src/server/db.js';
import { preparedSession } from './receive-fixture.js';
import { publishReady } from '../src/server/sessions/receive.js';
import type { EventSetup } from '../src/shared/events.js';

const installation = { authorization: `Bearer ${'a'.repeat(43)}`, origin: 'http://localhost:5513' };
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function prepare(f: Fixture) {
  const cookie = await f.login();
  const thumbnail = await f.upload(cookie, await imageBytes());
  const jpeg = await f.upload(cookie, await sharp(await imageBytes()).jpeg().toBuffer(), 'image/jpeg', 'test.jpg');
  const db = openDatabase(f.config.dataDir);
  const slot = seedLegacySlot(db, { description: 'Сюжет мероприятия', visible: true,
    thumbnailId: thumbnail.id, mode: 'P2V', model: 'kling/v4/reference-to-video', referenceIds: [],
    prompt: '@Element1 walks', resolution: '720p', duration: 3, simulateGeneration: true, testPhotoId: jpeg.id });
  db.close();
  return { slotId: slot.id, cookie };
}
function send(f: Fixture, slotId: string, eventSetup?: EventSetup, startRequestId = randomUUID()) {
  return f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation,
    payload: { slotId, startRequestId, ...(eventSetup ? { eventSetup } : {}) } });
}
function rows(f: Fixture) {
  const db = openDatabase(f.config.dataDir);
  try { return db.prepare('SELECT date,name,participant_range,location,setup_complete,next_number FROM events ORDER BY date').all(); }
  finally { db.close(); }
}

test('first Save is atomic, validated and idempotent; subsequent visitors/restart skip setup and archive keeps metadata', async t => {
  const f = await fixture(); t.after(() => f.close());
  const { slotId, cookie } = await prepare(f);
  const key = randomUUID();
  const check = await send(f, slotId, { action: 'check' }, key);
  assert.equal(check.statusCode, 409); assert.equal(check.json().code, 'EVENT_SETUP_REQUIRED');
  assert.deepEqual(rows(f), []);
  for (const bad of [
    { action: 'save', name: ' ', participantRange: '0–50', location: 'Новосибирск' },
    { action: 'save', name: 'Вечер', participantRange: '1000+', location: 'Новосибирск' },
    { action: 'save', name: 'Вечер', participantRange: '0–50', location: ' ' },
  ]) {
    const response = await f.app.inject({ method: 'POST', url: '/api/capture/sessions', headers: installation, payload: { slotId, startRequestId: key, eventSetup: bad } });
    assert.equal(response.statusCode, 400);
  }
  assert.deepEqual(rows(f), []);
  const saved = await send(f, slotId, { action: 'save', name: '  День команды  ', participantRange: '100–300', location: '  Томск  ' }, key);
  assert.equal(saved.statusCode, 201, saved.body); assert.equal(saved.json().number, 1);
  assert.deepEqual(rows(f), [{ date: '2026-01-01', name: 'День команды', participant_range: '100–300', location: 'Томск', setup_complete: 1, next_number: 2 }]);
  const retried = await send(f, slotId, { action: 'skip' }, key);
  assert.equal(retried.statusCode, 200); assert.deepEqual(retried.json(), saved.json());
  await f.restart();
  const next = await send(f, slotId, { action: 'check' });
  assert.equal(next.statusCode, 201); assert.equal(next.json().number, 2);
  f.advance(24 * 60 * 60 * 1000);
  assert.equal((await send(f, slotId, { action: 'check' })).json().code, 'EVENT_SETUP_REQUIRED');
  const skipped = await send(f, slotId, { action: 'skip' });
  assert.equal(skipped.statusCode, 201); assert.equal(skipped.json().number, 1);
  const list = await f.app.inject({ url: '/api/events', headers: { cookie } });
  assert.deepEqual(list.json(), [{ date: '2026-01-01', name: 'День команды', participantRange: '100–300', location: 'Томск', photoBytes: 0, videoBytes: 0 }]);
  const gallery = await f.app.inject({ url: '/api/events/2026-01-01', headers: { cookie } });
  assert.equal(gallery.json().name, 'День команды'); assert.equal(gallery.json().sessions.length, 2);
  assert.deepEqual(rows(f)[1], { date: '2026-01-02', name: 'Session_2', participant_range: null, location: 'Новосибирск', setup_complete: 1, next_number: 2 });
});

test('admin tests do not consume first-visitor setup; Skip persists and automatic names are not reused after deletion', async t => {
  const f = await fixture(); t.after(() => f.close());
  const { slotId, cookie } = await prepare(f);
  const today = async () => (await f.app.inject({ url: '/api/statuses', headers: { cookie } })).json();
  const empty = await today();
  assert.equal(empty.date, '2026-01-01');
  assert.equal(empty.eventName, null);
  assert.deepEqual(empty.sessions, []);
  assert.deepEqual(rows(f), []);
  const manual = await f.app.inject({ method: 'POST', url: `/api/admin/slots/${slotId}/test-generations`, headers: { cookie, origin: f.config.origin }, payload: { startRequestId: randomUUID() } });
  assert.equal(manual.statusCode, 201, manual.body);
  const started = await today();
  assert.equal(started.eventName, 'Session_1');
  assert.deepEqual(started.sessions.map((s: { id: string; number: number }) => [s.id, s.number]), [[manual.json().sessionId, 1]]);
  await f.restart();
  assert.equal((await send(f, slotId, { action: 'check' })).json().code, 'EVENT_SETUP_REQUIRED');
  const skipped = await send(f, slotId, { action: 'skip' });
  assert.equal(skipped.statusCode, 201); assert.equal(skipped.json().number, 2);
  await f.restart();
  assert.equal((await send(f, slotId, { action: 'check' })).statusCode, 201);
  f.advance(24 * 60 * 60 * 1000);
  assert.equal((await f.app.inject({ method: 'DELETE', url: '/api/events/2026-01-01', headers: { cookie, origin: f.config.origin } })).statusCode, 204);
  await f.restart();
  assert.equal((await send(f, slotId, { action: 'skip' })).statusCode, 201);
  assert.deepEqual(rows(f), [{ date: '2026-01-02', name: 'Session_2', participant_range: null, location: 'Новосибирск', setup_complete: 1, next_number: 2 }]);
});

test('legacy event migration preserves sessions and prevents retroactive setup for existing ordinary capture', async t => {
  const f = await fixture(); t.after(() => f.close());
  const { slotId } = await prepare(f);
  const previous = await send(f, slotId);
  assert.equal(previous.statusCode, 201);
  const db = openDatabase(f.config.dataDir);
  db.exec('ALTER TABLE events DROP COLUMN name; ALTER TABLE events DROP COLUMN participant_range; ALTER TABLE events DROP COLUMN location; ALTER TABLE events DROP COLUMN setup_complete; DROP TABLE event_name_counter;');
  db.close();
  await f.restart();
  assert.deepEqual(rows(f), [{ date: '2026-01-01', name: 'Session_1', participant_range: null, location: 'Новосибирск', setup_complete: 1, next_number: 2 }]);
  assert.equal((await send(f, slotId, { action: 'check' })).statusCode, 201);
  const status = await f.app.inject({ url: `/api/capture/sessions/${previous.json().sessionId}`, headers: installation });
  assert.equal(status.statusCode, 200); assert.equal(status.json().number, 1);
});

test('finishing an event archives only its own sessions and preserves the daily visitor counter', async t => {
  const f = await fixture(); t.after(() => f.close());
  const {slotId, cookie} = await prepare(f);
  const operator = await f.login('operator');
  const headers = {cookie: operator, origin: f.config.origin};
  const current = async () => (await f.app.inject({url:'/api/events/current',headers})).json().event;
  const get = async (url: string) => (await f.app.inject({url,headers})).json();
  const finish = (key: string) => f.app.inject({method:'POST',url:`/api/events/${key}/finish`,headers});
  assert.equal(await current(), null);
  const firstKey = randomUUID();
  const morning = (await send(f,slotId,{action:'save',name:'Утро',participantRange:'0–50',location:'Зал'},firstKey)).json();
  const first = await current();
  const path = '/api/events/' + first.key + '/finish';
  assert.equal((await f.app.inject({method:'POST',url:path,headers:{cookie:operator}})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:path,headers:{origin:f.config.origin}})).statusCode,401);
  assert.equal((await f.app.inject({method:'POST',url:path,headers:{...installation,origin:f.config.origin}})).statusCode,403);
  assert.equal((await finish(first.key)).statusCode,204);
  assert.equal(await current(),null);
  assert.deepEqual((await get('/api/display/today')).sessions,[]);
  assert.deepEqual((await get('/api/events')).map((e: {name:string})=>e.name),['Утро']);
  assert.equal((await send(f,slotId,{action:'check'})).json().code,'EVENT_SETUP_REQUIRED');
  assert.equal((await send(f,slotId,{action:'check'},firstKey)).json().sessionId,morning.sessionId);
  const evening = (await send(f,slotId,{action:'save',name:'Вечер',participantRange:'50–100',location:'Клуб'})).json();
  assert.equal(evening.number,morning.number+1);
  const second = await current();
  assert.notEqual(second.key,first.key);
  await f.restart();
  await finish(first.key);
  assert.deepEqual(await current(),second);
  assert.deepEqual((await get('/api/display/today')).sessions.map((s:{id:string})=>s.id),[evening.sessionId]);
  assert.deepEqual((await get('/api/statuses')).sessions.map((s:{eventName:string})=>s.eventName),['Вечер','Утро']);
  await finish(second.key);
  for (const [event,id] of [[first,morning.sessionId],[second,evening.sessionId]]) {
    const gallery = await get('/api/events/' + event.key);
    assert.deepEqual(gallery.sessions.map((s:{id:string})=>s.id),[id]);
    assert.equal((await f.app.inject({url:gallery.sessions[0].thumbnailUrl,headers})).statusCode,200);
  }
  const erase = () => f.app.inject({method:'DELETE',url:'/api/events/' + first.key,headers:{cookie,origin:f.config.origin}});
  assert.equal((await erase()).statusCode,409);
  f.advance(86_400_000);
  assert.equal((await erase()).statusCode,204);
  assert.equal((await get('/api/events/' + second.key)).sessions[0].id,evening.sessionId);
  assert.equal((await send(f,slotId,{action:'skip'})).json().number,1);
});

test('a closed event can still publish its prepared video and serve the issued guest link', async t => {
  const f = await fixture(); t.after(() => f.close());
  const when = Date.parse('2026-11-14T09:00:00Z');
  f.advance(when - Date.UTC(2026,0,1));
  const bytes = await videoBytes(f.root, 1);
  const prepared = await preparedSession(f.config.dataDir,bytes);
  const {slotId,cookie} = await prepare(f);
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const headers = {cookie,origin:f.config.origin};
  const close = await f.app.inject({method:'POST',url:'/api/events/2026-11-14/finish',headers});
  assert.equal(close.statusCode,204);
  const next = await send(f,slotId,{action:'skip'});
  assert.equal(next.json().number,2);
  await publishReady(db,f.config.dataDir,prepared.id,f.config.origin,()=>when);
  const tokens = db.prepare<[string],{receive_token:string;download_token:string}>('SELECT receive_token,download_token FROM session_delivery WHERE session_id=?').get(prepared.id)!;
  assert.equal((await f.app.inject({url:'/api/receive/'+tokens.receive_token})).statusCode,200);
  assert.deepEqual((await f.app.inject({url:'/download/'+tokens.download_token})).rawPayload,bytes);
  const archive = (await f.app.inject({url:'/api/events/2026-11-14',headers})).json();
  assert.equal(archive.sessions.length,1);
  assert.deepEqual((await f.app.inject({url:archive.sessions[0].videoUrl,headers})).rawPayload,bytes);
  assert.equal((await f.app.inject({url:'/api/display/'+prepared.id+'/video',headers})).statusCode,404);
});
