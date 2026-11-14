import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { fixture, imageBytes, videoBytes, multipart } from './helpers.js';
import { seedArchive } from './archive-fixture.js';
import { openDatabase } from '../src/server/db.js';
import type { EventGallery } from '../src/shared/events.js';
import type { StartReceipt } from '../src/shared/capture.js';
const installation = { authorization: `Bearer ${'a'.repeat(43)}` };

test('archive: totals, snapshots, own media, permissions and read-only state after public hide', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.advance(Date.parse('2026-11-14T10:00:00Z') - Date.UTC(2026, 0, 1));
  const admin = await f.login(); const operator = await f.login('operator');
  const firstVideo = await videoBytes(f.root, 1); const secondVideo = await videoBytes(f.root, 2);
  const seed = await seedArchive(f.config.dataDir, firstVideo, secondVideo);
  const db = openDatabase(f.config.dataDir); t.after(() => db.close());
  const delivery = () => db.prepare('SELECT * FROM session_delivery ORDER BY session_id').all();
  const states = () => db.prepare('SELECT id,state FROM capture_sessions ORDER BY id').all();
  const firstDelivery = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(seed.first.id) as { receive_token: string; download_token: string };
  const list = () => f.app.inject({ url: '/api/events', headers: { cookie: operator } });
  assert.deepEqual((await list()).json(), [{ date: '2026-11-13', photoBytes: 0, videoBytes: 0 }]);
  for (const date of ['2026-11-14', '2026-11-15', '2026-11-99', 'invalid']) assert.equal((await f.app.inject({ url: `/api/events/${date}`, headers: { cookie: operator } })).statusCode, 404);
  // Use the existing confirmation and hide implementation; no SMTP worker required.
  assert.equal((await f.app.inject({ method: 'POST', url: `/api/receive/${firstDelivery.receive_token}/email`, payload: { email: 'visitor@example.test' } })).statusCode, 200);
  f.advance(180_000);
  assert.ok(!(await f.app.inject({ url: '/api/display/today', headers: { cookie: operator } })).json().sessions.some((s: { id: string }) => s.id === seed.first.id));
  f.advance(Date.parse('2026-11-14T17:00:00Z') - Date.parse('2026-11-14T10:03:00Z'));
  const beforeDelivery = delivery(); const beforeStates = states();
  assert.deepEqual((await list()).json(), [seed.expected, { date: '2026-11-13', photoBytes: 0, videoBytes: 0 }]);
  for (const cookie of [operator, admin]) {
    const detail = await f.app.inject({ url: '/api/events/2026-11-14', headers: { cookie } });
    assert.equal(detail.statusCode, 200); assert.doesNotMatch(detail.body, /fixture.test|receive_token|download_token|visitor@example|prompt|video_path/);
    const gallery = detail.json<EventGallery>();
    assert.deepEqual(gallery.sessions.map(s => s.number), [1, 2, 3, 4]);
    for (const [index, bytes] of [[0, firstVideo], [1, secondVideo]] as const) {
      const session = gallery.sessions[index];
      assert.equal(session.description, index === 0 ? 'Зелёная история' : 'Красная история');
      assert.deepEqual((await f.app.inject({ url: session.thumbnailUrl, headers: { cookie } })).rawPayload, index === 0 ? seed.thumb : seed.changed);
      const media = await f.app.inject({ url: session.videoUrl!, headers: { cookie } });
      assert.equal(media.statusCode, 200); assert.deepEqual(media.rawPayload, bytes);
      const range = await f.app.inject({ url: session.videoUrl!, headers: { cookie, range: 'bytes=0-31' } });
      assert.equal(range.statusCode, 206); assert.deepEqual(range.rawPayload, bytes.subarray(0,32));
    }
    for (const session of gallery.sessions.slice(2)) {
      assert.equal(session.videoUrl, null);
      assert.equal((await f.app.inject({ url: `/api/events/2026-11-14/${session.id}/video`, headers: { cookie } })).statusCode, 404);
    }
    assert.equal((await f.app.inject({ url: `/api/events/2026-11-13/${seed.first.id}/video`, headers: { cookie } })).statusCode, 404);
    assert.equal((await f.app.inject({ url: `/api/events/2026-11-15/${seed.first.id}/thumbnail`, headers: { cookie } })).statusCode, 404);
  }
  const urls = ['/api/events', '/api/events/2026-11-14', `/api/events/2026-11-14/${seed.first.id}/thumbnail`, `/api/events/2026-11-14/${seed.first.id}/video`];
  for (const url of urls) for (const [headers, status] of [[{},401], [installation,403], [{authorization:`Bearer ${firstDelivery.receive_token}`},401], [{authorization:`Bearer ${firstDelivery.download_token}`},401]] as const) {
    assert.equal((await f.app.inject({ url, headers })).statusCode, status);
  }
  assert.deepEqual(delivery(), beforeDelivery); assert.deepEqual(states(), beforeStates);
  await f.restart();
  assert.deepEqual((await list()).json()[0], seed.expected);
  assert.deepEqual((await f.app.inject({ url: `/download/${firstDelivery.download_token}` })).rawPayload, firstVideo);
});

test('archive calendar uses saved start identity when photo arrives after Novosibirsk midnight', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.advance(Date.parse('2026-01-01T16:59:59Z') - Date.UTC(2026, 0, 1));
  const cookie = await f.login(); const thumbnail = await f.upload(cookie, await imageBytes());
  const video = await f.upload(cookie, await videoBytes(f.root, 10), 'video/mp4', 'clip.mp4');
  const slotResponse = await f.app.inject({ method:'POST', url:'/api/admin/slots', headers:{cookie,origin:f.config.origin}, payload:{description:'История до полуночи',visible:true,thumbnailId:thumbnail.id,mode:'V2V',model:'minimax/h3-max/recast',videoId:video.id,referenceIds:[],resolution:'768P',recastShotsConfirmed:true} });
  assert.equal(slotResponse.statusCode,201,slotResponse.body);
  const payload = {startRequestId:randomUUID(),slotId:slotResponse.json().id};
  const start = async (body = payload) => (await f.app.inject({method:'POST',url:'/api/capture/sessions',headers:installation,payload:body})).json<StartReceipt>();
  const first = await start(); assert.equal(first.date,'2026-01-01'); assert.equal(first.number,1);
  f.advance(1000);
  const photo = await sharp(await imageBytes()).jpeg().toBuffer(); const part = multipart(photo,'image/jpeg','photo.jpg');
  const uploaded = await f.app.inject({method:'PUT',url:`/api/capture/sessions/${first.sessionId}/photos/0`,headers:{...installation,'content-type':part.contentType},payload:part.bytes});
  assert.equal(uploaded.statusCode,200); assert.equal(uploaded.json().date,first.date); assert.equal(uploaded.json().number,1);
  assert.equal((await start()).sessionId,first.sessionId);
  const second = await start({...payload,startRequestId:randomUUID()}); assert.equal(second.date,'2026-01-02'); assert.equal(second.number,1);
  const list = await f.app.inject({url:'/api/events',headers:{cookie}});
  assert.deepEqual(list.json(),[{date:'2026-01-01',photoBytes:photo.length,videoBytes:0}]);
  const detail = await f.app.inject({url:'/api/events/2026-01-01',headers:{cookie}});
  assert.equal(detail.json().sessions[0].id,first.sessionId);
  assert.equal((await f.app.inject({url:'/api/events/2026-01-02',headers:{cookie}})).statusCode,404);
});
