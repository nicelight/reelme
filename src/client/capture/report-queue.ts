import type { CaptureReport } from '../../shared/capture-report';
import { ApiError, cloudOrigin, installationKeyStorage, request } from './api';

const prefix = 'reelme.captureReport.' + cloudOrigin + '.';
const limit = 120;
type Entry = { sessionId: string; report: CaptureReport };
const memory = new Map<string, Entry>();
let sending = false;
let retry: ReturnType<typeof setTimeout> | undefined;

function entries() {
  const all = new Map(memory);
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      try {
        const entry: Entry = JSON.parse(localStorage.getItem(key)!);
        if (typeof entry?.sessionId === 'string' && typeof entry?.report?.at === 'string' && key === prefix + entry.report.id) all.set(key, entry);
        else localStorage.removeItem(key);
      }
      catch { localStorage.removeItem(key); }
    }
  } catch { /* Private storage can be unavailable. */ }
  return [...all].sort((a, b) => a[1].report.at.localeCompare(b[1].report.at));
}
function remove(key: string) {
  memory.delete(key);
  try { localStorage.removeItem(key); } catch { /* Memory-only queue. */ }
}
export function enqueueReport(sessionId: string, report: CaptureReport) {
  const key = prefix + report.id;
  const entry = { sessionId, report };
  memory.set(key, entry);
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* Keep in memory until delivered. */ }
  const pending = entries();
  if (pending.length > limit) {
    const expendable = pending.filter(([, item]) => item.report.kind === 'attempt' && item.report.outcome === 'ok');
    const evictionOrder = new Set([...expendable, ...pending].map(([storageKey]) => storageKey));
    for (const old of [...evictionOrder].slice(0, pending.length - limit)) remove(old);
  }
  void flushReports();
}
export async function flushReports() {
  if (sending) return;
  sending = true;
  clearTimeout(retry);
  try {
    const key = localStorage.getItem(installationKeyStorage);
    if (!key) return;
    for (const [storageKey, item] of entries()) {
      try {
        await request('/api/capture/sessions/' + encodeURIComponent(item.sessionId) + '/capture-reports', key, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.report),
          signal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        if (!(error instanceof ApiError && [400,404,409,413,422].includes(error.status))) break;
      }
      remove(storageKey);
    }
  } catch { /* The capture UI never depends on delivery. */ }
  finally {
    sending = false;
    if (entries().length) retry = setTimeout(() => void flushReports(), 15_000);
  }
}
