/** Destructive assertions are confined to mkdtemp-owned SQLite and media fixtures.
 * All fal/SMTP transports below are local doubles; no external deletion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { fixture, videoBytes } from './helpers.js';
import { seedArchive } from './archive-fixture.js';
import { openDatabase } from '../src/server/db.js';
import { createEventCleanup } from '../src/server/sessions/cleanup.js';
import { createFalDelete } from '../src/server/sessions/fal.js';
import { createGenerationWorker } from '../src/server/sessions/generation.js';
import { createEmailWorker } from '../src/server/sessions/email.js';
import { photoProviderUrl, slotProviderUrl } from '../src/server/sessions/provider-media.js';
import { publishReady } from '../src/server/sessions/receive.js';
const now = Date.parse('2026-11-14T17:00:00Z');
const installation = { authorization: `Bearer ${'a'.repeat(43)}` };
const quiet = { warn() {}, error() {} } as unknown as FastifyBaseLogger;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; };
async function seeded() {
  const f = await fixture(); f.advance(now - Date.UTC(2026, 0, 1));
  const admin = await f.login(); const operator = await f.login('operator');
  const bytes = await videoBytes(f.root, 1);
  const seed = await seedArchive(f.config.dataDir, bytes, bytes);
  const db = openDatabase(f.config.dataDir);
  return { f, db, seed, bytes, admin, operator };
}

test('cleanup manual: permissions, owned files/capabilities gone, other-day snapshot and current-slot materials survive', async t => {
  const { f, db, seed, admin, operator } = await seeded(); t.diagnostic(`isolated DB/media fixture: ${f.root}`); t.after(async () => { db.close(); await f.close(); });
  const target = '/api/events/2026-11-14';
  for (const [headers, expected] of [[{},401],[{cookie:operator},403],[installation,403]] as const) {
    assert.equal((await f.app.inject({ method:'DELETE',url:target,headers:{...headers,origin:f.config.origin} })).statusCode,expected);
  }
  for (const date of ['2026-11-15','2026-11-16']) assert.equal((await f.app.inject({method:'DELETE',url:`/api/events/${date}`,headers:{cookie:admin,origin:f.config.origin}})).statusCode,404);
  assert.equal((await f.app.inject({method:'DELETE',url:target,headers:{cookie:admin}})).statusCode,403);
  const own = await readdir(join(f.config.dataDir,'media','sessions',seed.first.id)); assert.ok(own.includes('result.mp4'));
  const delivery = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(seed.first.id) as {receive_token:string;download_token:string};
  const photoUrl = new URL(photoProviderUrl(db,f.config.origin,seed.first.id,0)).pathname;
  const sharedUrl = new URL(slotProviderUrl(db,f.config.origin,seed.thumbnailId)).pathname;
  const currentUrl = new URL(slotProviderUrl(db,f.config.origin,seed.changedId)).pathname;
  // A replaced material referenced only by the deleted snapshot must be reclaimed.
  const stale = randomUUID(); await writeFile(join(f.config.dataDir,'media',stale),'old');
  db.prepare("INSERT INTO slot_media(id,path,kind,mime,size,width,height) VALUES (?,?,'image','image/png',3,1,1)").run(stale,stale);
  const row = db.prepare('SELECT snapshot FROM capture_sessions WHERE id=?').get(seed.first.id) as {snapshot:string};
  const snapshot = JSON.parse(row.snapshot); snapshot.generation.referenceIds=[stale];
  db.prepare('UPDATE capture_sessions SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),seed.first.id);
  const staleUrl = new URL(slotProviderUrl(db,f.config.origin,stale)).pathname;
  const neighbor = db.prepare("SELECT id FROM capture_sessions WHERE event_date='2026-11-13'").get() as {id:string};
  await mkdir(join(f.config.dataDir,'media','sessions',neighbor.id));
  await writeFile(join(f.config.dataDir,'media','sessions',neighbor.id,'neighbor.txt'),'preserve');
  assert.equal((await f.app.inject({method:'DELETE',url:target,headers:{cookie:admin,origin:f.config.origin}})).statusCode,204);
  for (const id of [seed.first.id,seed.second.id,seed.partialId,seed.emptyId]) {
    assert.equal(db.prepare('SELECT 1 FROM capture_sessions WHERE id=?').get(id),undefined);
    await assert.rejects(readdir(join(f.config.dataDir,'media','sessions',id)),{code:'ENOENT'});
  }
  for (const url of [target,`${target}/${seed.first.id}/video`,`${target}/${seed.first.id}/thumbnail`, `/receive/${delivery.receive_token}`,`/api/receive/${delivery.receive_token}`,`/download/${delivery.download_token}`,photoUrl,staleUrl]) assert.equal((await f.app.inject({url,headers:{cookie:admin}})).statusCode,404,url);
  for (const url of [sharedUrl,currentUrl]) assert.equal((await f.app.inject({url})).statusCode,200,url);
  assert.deepEqual(await readFile(join(f.config.dataDir,'media',seed.thumbnailId)),seed.thumb);
  assert.deepEqual(await readFile(join(f.config.dataDir,'media',seed.changedId)),seed.changed);
  await assert.rejects(readFile(join(f.config.dataDir,'media',stale)),{code:'ENOENT'});
  assert.equal(await readFile(join(f.config.dataDir,'media','sessions',neighbor.id,'neighbor.txt'),'utf8'),'preserve');
  assert.equal((await f.app.inject({url:'/api/events/2026-11-13',headers:{cookie:operator}})).statusCode,200);
  assert.equal((await f.app.inject({method:'POST',url:`/api/capture/sessions/${seed.first.id}/finalize`,headers:installation})).statusCode,404);
  assert.equal((await f.app.inject({method:'POST',url:`/api/receive/${delivery.receive_token}/email`,payload:{email:'a@example.test'}})).statusCode,404);
  assert.equal(db.prepare("SELECT 1 FROM events WHERE date='2026-11-14'").get(),undefined);
});

test('retention: exactly 14 calendar days survive until Novosibirsk midnight; startup resumes saved deletion', async t => {
  const { f, db, seed } = await seeded(); t.diagnostic(`isolated DB/media fixture: ${f.root}`); t.after(async () => { db.close(); await f.close(); });
  let time = Date.parse('2026-11-28T16:59:59Z');
  const cleanup = createEventCleanup(db,f.config.dataDir,quiet,() => time,{deleteOutput:async()=>{}}); t.after(() => cleanup.stop());
  await cleanup.runOnce();
  assert.ok(db.prepare("SELECT 1 FROM events WHERE date='2026-11-14'").get());
  assert.equal(db.prepare("SELECT 1 FROM events WHERE date='2026-11-13'").get(),undefined);
  assert.ok(db.prepare("SELECT 1 FROM events WHERE date='2026-11-15'").get());
  time += 1000; await cleanup.runOnce();
  assert.equal(db.prepare("SELECT 1 FROM events WHERE date='2026-11-14'").get(),undefined);
  assert.ok(db.prepare("SELECT 1 FROM events WHERE date='2026-11-15'").get());
  await assert.rejects(readFile(join(f.config.dataDir,'media',seed.first.video_path)),{code:'ENOENT'});
  // A durable marker and a partially missing owned file emulate interrupted cleanup.
  const id = randomUUID(); const slot = (db.prepare('SELECT id FROM slots LIMIT 1').get() as {id:string}).id;
  db.prepare("INSERT INTO events(date,next_number,deleting) VALUES ('2026-11-12',2,1)").run();
  db.prepare("INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at) VALUES (?,?,'2026-11-12',1,?,?,'capturing',0)").run(id,randomUUID(),slot,JSON.stringify({thumbnailId:seed.changedId,generation:{referenceIds:[]}}));
  await mkdir(join(f.config.dataDir,'media','sessions',id)); await writeFile(join(f.config.dataDir,'media','sessions',id,'remaining.jpg'),'owned');
  await f.restart(); await f.app.ready();
  assert.equal(db.prepare("SELECT 1 FROM events WHERE date='2026-11-12'").get(),undefined);
  await assert.rejects(readdir(join(f.config.dataDir,'media','sessions',id)),{code:'ENOENT'});
  assert.deepEqual(await readFile(join(f.config.dataDir,'media',seed.changedId)),seed.changed);
});

test('deleting marker immediately closes every new operation, late generation publication and email fallback', async t => {
  const { f, db, seed, admin, bytes } = await seeded(); t.diagnostic(`isolated DB/media fixture: ${f.root}`); t.after(async () => { db.close(); await f.close(); });
  const entered = deferred(); const release = deferred(); let downloadCalls=0;
  db.prepare("UPDATE capture_sessions SET state='preparing' WHERE id=?").run(seed.first.id);
  db.prepare('UPDATE generation_jobs SET video_path=NULL,frame_path=NULL WHERE session_id=?').run(seed.first.id);
  const generation = createGenerationWorker(db,f.config.dataDir,f.config.origin,quiet,{client:{submit:async()=>{throw Error('unexpected');},status:async()=>{throw Error('unexpected');},result:async()=>{throw Error('unexpected');}},download:async()=>{downloadCalls++;entered.resolve();await release.promise;return new Response(bytes);},publishReady:id=>publishReady(db,f.config.dataDir,id)});
  const generating=generation.runOnce(); await entered.promise;
  const mailEntered=deferred(); const mailRelease=deferred(); let mailCalls=0;
  db.prepare("UPDATE session_delivery SET email_state='pending',email='visitor@example.test' WHERE session_id=?").run(seed.second.id);
  const email = createEmailWorker(db,f.config.dataDir,f.config.origin,quiet,{from:'sender@example.test',transport:{sendMail:async()=>{mailCalls++;mailEntered.resolve();await mailRelease.promise;throw {command:'DATA',responseCode:552,response:'5.3.4 message too large'};}}});
  const sending=email.runOnce(); await mailEntered.promise;
  const deleting = deferred(); const finishDelete = deferred();
  const cleanup=createEventCleanup(db,f.config.dataDir,quiet,()=>now,{deleteOutput:async()=>{deleting.resolve();await finishDelete.promise;}});
  const removing=cleanup.remove('2026-11-14'); await deleting.promise;
  assert.equal((db.prepare("SELECT deleting FROM events WHERE date='2026-11-14'").get() as {deleting:number}).deleting,1);
  const delivery = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(seed.second.id) as {receive_token:string;download_token:string};
  for (const url of ['/api/events/2026-11-14',`/api/events/2026-11-14/${seed.second.id}/video`,`/api/receive/${delivery.receive_token}`,`/download/${delivery.download_token}`,`/api/capture/sessions/${seed.first.id}`]) assert.equal((await f.app.inject({url,headers:url.includes('/capture/')?installation:{cookie:admin}})).statusCode,404,url);
  assert.ok(!(await f.app.inject({url:'/api/events',headers:{cookie:admin}})).json().some((e:{date:string})=>e.date==='2026-11-14'));
  assert.throws(()=>photoProviderUrl(db,f.config.origin,seed.second.id,0));
  const start=db.prepare('SELECT start_request_id,slot_id FROM capture_sessions WHERE id=?').get(seed.first.id) as {start_request_id:string;slot_id:string};
  assert.equal((await f.app.inject({method:'POST',url:'/api/capture/sessions',headers:installation,payload:{startRequestId:start.start_request_id,slotId:start.slot_id}})).statusCode,404);
  release.resolve(); mailRelease.resolve(); await generating; await sending;
  assert.equal(downloadCalls,1); assert.equal(mailCalls,1);
  await assert.rejects(readdir(join(f.config.dataDir,'media','sessions',seed.first.id)),{code:'ENOENT'});
  assert.equal((db.prepare('SELECT video_path FROM generation_jobs WHERE session_id=?').get(seed.first.id) as {video_path:string|null}).video_path,null);
  assert.notEqual((db.prepare('SELECT state FROM capture_sessions WHERE id=?').get(seed.first.id) as {state:string}).state,'ready');
  assert.notEqual((db.prepare('SELECT email_state FROM session_delivery WHERE session_id=?').get(seed.second.id) as {email_state:string}).email_state,'sent');
  finishDelete.resolve(); await removing; await cleanup.stop(); await generation.stop(); await email.stop();
  await assert.rejects(readdir(join(f.config.dataDir,'media','sessions',seed.first.id)),{code:'ENOENT'});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_delivery').get()?.n,0);
});

test('fal delete contract: known URL only, bounded POST, remote failure logged and local cleanup completes', async t => {
  const { f, db, seed } = await seeded(); t.diagnostic(`isolated DB/media fixture: ${f.root}`); t.after(async () => { db.close(); await f.close(); });
  const requests: {url:string;body:unknown}[]=[];
  const remove=createFalDelete('test-only-key',async(url,init)=>{
    assert.equal(url,'https://rest.fal.ai/storage/files/delete'); assert.equal(init?.method,'POST');
    assert.deepEqual(init?.headers,{Authorization:'Key test-only-key','Content-Type':'application/json'}); assert.ok(init?.signal);
    requests.push({url:String(url),body:JSON.parse(String(init?.body))}); return new Response('',{status:403});
  });
  const logs: unknown[]=[]; const log={warn:(value:unknown)=>logs.push(value),error:()=>{}} as unknown as FastifyBaseLogger;
  const cleanup=createEventCleanup(db,f.config.dataDir,log,()=>now,{deleteOutput:remove});
  await cleanup.remove('2026-11-14'); await cleanup.stop();
  assert.deepEqual(requests,[{url:'https://rest.fal.ai/storage/files/delete',body:{file_url:'https://fixture.test/private.mp4'}}]);
  assert.deepEqual(logs,[{code:'FAL_DELETE_FAILED'}]);
  assert.equal(db.prepare("SELECT 1 FROM events WHERE date='2026-11-14'").get(),undefined);
  await assert.rejects(readFile(join(f.config.dataDir,'media',seed.first.video_path)),{code:'ENOENT'});
  let called=false; await createFalDelete('test-only-key',async()=>{called=true;return new Response(null,{status:204});})('https://fixture.test/result.mp4'); assert.equal(called,true);
});
