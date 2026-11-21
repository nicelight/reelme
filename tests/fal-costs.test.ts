import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db.js';
import { fixture } from './helpers.js';

test('status reads stay ready during billing, retry missing charges and retain exact matched totals across restart', async t => {
  const f = await fixture();
  t.after(() => f.close());
  const db = openDatabase(f.config.dataDir);
  t.after(() => db.close());
  const date = '2025-12-26', submitted = Date.parse(date + 'T23:59:00Z');
  db.prepare("INSERT INTO events(date,next_number) VALUES (?,4)").run(date);
  db.prepare("INSERT INTO slots(id,config) VALUES ('slot','{}')").run();
  for (const [index, id] of ['live', 'free', 'demo'].entries()) {
    const snapshot = JSON.stringify({ generation: { simulateGeneration: id === 'demo', simulationOutput: 'video' } });
    db.prepare("INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at) VALUES (?,?,?,?, 'slot',?,'ready',?)")
      .run(id, id, date, index + 1, snapshot, submitted);
    db.prepare("INSERT INTO generation_jobs(session_id,request_id) VALUES (?,?)").run(id, 'request-' + id);
  }
  const calls: URL[] = [];
  const headers: Headers[] = [];
  let respond!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', (url: URL, init: RequestInit) => {
    calls.push(new URL(url));
    headers.push(new Headers(init.headers));
    return new Promise<Response>(resolve => { respond = resolve; });
  });
  Object.assign(f.config, { falBillingKey: 'test-billing' });
  await f.restart();
  const cookie = await f.login('operator');
  const list = async () => (await f.app.inject({ url: '/api/statuses?date=' + date, headers: { cookie } })).json().sessions;
  const first = await list();
  assert.equal(first.find((r: {id: string}) => r.id === 'live').state, 'ready');
  assert.deepEqual(first.map((r: {costUsd?: number | null}) => r.costUsd), [undefined, null, null]);
  await list();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].origin + calls[0].pathname, 'https://api.fal.ai/v1/models/billing-events');
  assert.deepEqual(calls[0].searchParams.getAll('request_id').sort(), ['request-free', 'request-live']);
  assert.ok(Date.parse(calls[0].searchParams.get('start')!) <= submitted);
  assert.ok(Date.parse(calls[0].searchParams.get('end')!) > submitted);
  assert.equal(headers[0].get('authorization'), 'Key test-billing');
  respond(new Response(null, {status:403}));
  await new Promise(resolve => setImmediate(resolve));
  await list();
  assert.equal(calls.length, 1);
  f.advance(60_000);
  await list();
  respond(Response.json({billing_events:[{request_id:'other',cost_total:9},{request_id:'request-free',cost_total:0}]}));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual((await list()).map((r: {costUsd?: number | null}) => r.costUsd), [undefined, 0, null]);
  f.advance(60_000);
  await list();
  assert.deepEqual(calls[2].searchParams.getAll('request_id'), ['request-live']);
  respond(Response.json({ billing_events: [{request_id:'request-live',cost_subtotal:0.05,cost_total:0.045}] }));
  await f.restart();
  assert.deepEqual((await list()).map((r: {costUsd?: number | null}) => r.costUsd), [undefined, 0, 0.045]);
  assert.equal(calls.length, 3);
});
