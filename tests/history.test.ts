import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/server/db.js';
import { recordHistory } from '../src/server/sessions/history.js';

test('a busy receive page keeps bounded history, a visible gap and the paid generation evidence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'reelme-history-'));
  const db = openDatabase(dir);
  t.after(async () => { db.close(); await rm(dir, {recursive:true,force:true}); });
  db.exec(`INSERT INTO slots(id,config) VALUES ('slot','{}');
    INSERT INTO events(date,next_number) VALUES ('2026-11-21',2);
    INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at)
    VALUES ('one','start','2026-11-21',1,'slot','{}','ready',1)`);
  recordHistory(db,'one','worker','fal.submit','acknowledged','succeeded',{requestId:'paid-id'});
  for (let n=0;n<9;n++) {
    recordHistory(db,'one','worker','fal.status','provider_status','waiting',{providerStatus:'IN_QUEUE'},() => n);
  }
  assert.deepEqual(db.prepare("SELECT at,last_at,repeats FROM session_history WHERE event='provider_status'").get(), {at:0,last_at:8,repeats:9});
  for (let n=0;n<500;n++) {
    recordHistory(db,'one','server','delivery.download','range_served','succeeded',{method:'player'},() => n);
  }
  const counts = db.prepare('SELECT bucket,COUNT(*) AS n FROM session_history GROUP BY bucket ORDER BY bucket').all();
  assert.deepEqual(counts,[{bucket:'delivery',n:193},{bucket:'pipeline',n:2}]);
  assert.ok(db.prepare("SELECT 1 FROM session_history WHERE event='history_truncated'").get());
  assert.deepEqual(db.prepare("SELECT event,at FROM session_history ORDER BY id DESC LIMIT 1").get(), {event:'range_served',at:499});
  db.prepare("DELETE FROM capture_sessions WHERE id='one'").run();
  assert.equal(db.prepare('SELECT 1 FROM session_history').get(),undefined);
});
