// Best-effort observations. Call only outside business transactions. The bounded
// delivery bucket cannot displace evidence from capture or a paid submit.
import type { HistoryDetail } from '../../shared/statuses.js';
export type { HistoryDetail } from '../../shared/statuses.js';
import type { DB } from '../db.js';

type Source = 'capture' | 'worker' | 'server' | 'browser' | 'smtp';
export type HistoryOutcome = 'started' | 'succeeded' | 'waiting' | 'failed' | 'retry' | 'unknown' | 'cancelled';
// Keep the exact keys, order and scalar parameters used by the SDK. Media capabilities
// are interchangeable with authenticated links only in this diagnostic copy.
export function describeProviderRequest(endpoint: string, input: Record<string, unknown>, media?: ReadonlyMap<string, string>) {
  const json = JSON.stringify(input, (_key, value: unknown) => {
    if (typeof value !== 'string') return value;
    return media?.get(value) ?? value.replace(/https?:\/\/[^\s"'<>]+|\/provider-media\/[\w-]+/gi, '[URL]');
  });
  return { endpoint, input: JSON.parse(json) as Record<string, unknown> };
}
let warnedAt = 0;
function warn() {
  if (Date.now() - warnedAt > 60_000) {
    warnedAt = Date.now();
    console.warn('SESSION_HISTORY_UNAVAILABLE');
  }
}
function writer(db: DB) {
  const previous = db.prepare('SELECT id,source,step,event,outcome,detail FROM session_history WHERE session_id=? AND bucket=? ORDER BY id DESC LIMIT 1');
  const insert = db.prepare(`INSERT INTO session_history(session_id,at,last_at,source,step,event,outcome,detail,bucket,report_key)
    SELECT @id,@time,@time,@source,@step,@event,@outcome,@detail,@bucket,@reportKey
    WHERE EXISTS (SELECT 1 FROM capture_sessions s JOIN events e ON e.date=s.event_date AND e.event_no=s.event_no WHERE s.id=@id AND e.deleting=0)
    ON CONFLICT(session_id,report_key) DO NOTHING`);
  const bump = db.prepare('UPDATE session_history SET last_at=?,repeats=repeats+1 WHERE id=?');
  // Retain the first observations and the latest window; preserve a visible gap marker.
  // Preserve individual submit attempts and receipts while trimming repetitive observations.
  const overflow = db.prepare("SELECT id FROM session_history WHERE session_id=? AND bucket=? AND step<>'fal.submit' ORDER BY id LIMIT 1 OFFSET 192");
  const oldest = db.prepare("SELECT id FROM session_history WHERE session_id=? AND bucket=? AND step<>'fal.submit' AND event<>'history_truncated' ORDER BY id LIMIT 1 OFFSET 32");
  const trim = db.prepare('DELETE FROM session_history WHERE id=?');
  const markGap = db.prepare("UPDATE session_history SET source='server',step='history',event='history_truncated',outcome='unknown',detail='{}',report_key=NULL WHERE id=?");
  const omitted = db.prepare("SELECT id FROM session_history WHERE session_id=? AND bucket=? AND event='history_truncated'");
  return db.transaction((id: string, source: Source, step: string, event: string, outcome: HistoryOutcome, details: HistoryDetail, time: number, reportKey: string | null) => {
    const bucket = source === 'smtp' || step.startsWith('delivery.') && step !== 'delivery.publish' ? 'delivery' : 'pipeline';
    const detail = JSON.stringify(details);
    if (event === 'provider_status' || event === 'waiting' || outcome === 'retry') {
      const row = previous.get(id, bucket) as { id: number; source: string; step: string; event: string; outcome: string; detail: string } | undefined;
      if (row && row.source === source && row.step === step && row.event === event && row.outcome === outcome && row.detail === detail) {
        bump.run(time, row.id);
        return;
      }
    }
    const values = { id, time, source, step, event, outcome, detail, bucket, reportKey };
    if (!insert.run(values).changes || !overflow.get(id, bucket)) return;
    const middle = oldest.get(id, bucket) as { id: number };
    const gap = omitted.get(id, bucket) as { id: number } | undefined;
    if (gap) {
      trim.run(middle.id);
      bump.run(time, gap.id);
    } else {
      // Reuse the omitted observation's position; the newest step remains visible.
      markGap.run(middle.id);
    }
  });
}
const writers = new WeakMap<DB, ReturnType<typeof writer>>();
export function recordHistory(db: DB, id: string, source: Source, step: string, event: string, outcome: HistoryOutcome, detail: HistoryDetail = {}, now = Date.now, reportKey: string | null = null) {
  try {
    // A provider-supplied opaque ID is useful for correlation; drop unexpected free text/URLs.
    if (detail.requestId && !/^[a-zA-Z0-9_.:-]{1,160}$/.test(detail.requestId)) detail = { ...detail, requestId: undefined };
    let write = writers.get(db);
    if (!write) { write = writer(db); writers.set(db, write); }
    write(id, source, step, event, outcome, detail, now(), reportKey);
  } catch { warn(); }
}
// Count observed application submit starts, independently of the paid operation.
// This ordinal refers only to recorded calls; a failed diagnostic read returns no number.
export function nextSubmitAttempt(db: DB, id: string): number | undefined {
  try {
    const row = db.prepare("SELECT MAX(json_extract(detail,'$.attempt')) AS attempt FROM session_history WHERE session_id=? AND step='fal.submit'").get(id) as {attempt:number|null};
    return (row.attempt ?? 0) + 1;
  } catch { warn(); return undefined; }
}
