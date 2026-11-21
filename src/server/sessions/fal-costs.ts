/** Resolve costs for visible fal requests independently of generation and delivery.
 * Only a matching billed event can set a job's previously unknown USD amount. */
import type { DB } from '../db.js';

export const requestIdPattern = /^[a-zA-Z0-9_.:-]{1,160}$/;
export function isBillableRequest(id: string | null, simulated: boolean | undefined): id is string {
  return !!id && requestIdPattern.test(id) && !simulated && !id.startsWith('test-video:');
}
export type CostReader = ReturnType<typeof createCostReader>;

interface PendingCost { id: string; requestId: string; submittedAt: number }
const day = 86_400_000;
const retryInterval = 60_000;

export function createCostReader(db: DB, key: string | undefined, onError: (status?: number) => void, transport = fetch, now = Date.now) {
  const retryAt = new Map<string, number>();
  let running: Promise<void> | undefined;
  const save = db.prepare('UPDATE generation_jobs SET cost_usd=? WHERE session_id=? AND request_id=? AND cost_usd IS NULL');

  async function lookup(batch: PendingCost[], start: number, end: number) {
    const url = new URL('https://api.fal.ai/v1/models/billing-events');
    url.searchParams.set('start', new Date(start).toISOString());
    url.searchParams.set('end', new Date(end).toISOString());
    url.searchParams.set('limit', String(batch.length));
    const jobs = new Map(batch.map(job => [job.requestId, job.id]));
    for (const id of jobs.keys()) url.searchParams.append('request_id', id);
    const seen = new Set<string>();
    const signal = AbortSignal.timeout(8000);
    do {
      const response = await transport(url, { headers: { Authorization: 'Key ' + key }, redirect: 'error', signal });
      if (!response.ok) { onError(response.status); return; }
      const page = await response.json();
      for (const event of page.billing_events) {
        const id = jobs.get(event?.request_id);
        if (id && Number.isFinite(event.cost_total) && event.cost_total >= 0) {
          save.run(event.cost_total, id, event.request_id);
          jobs.delete(event.request_id);
        }
      }
      if (!jobs.size || !page.next_cursor || seen.has(page.next_cursor)) return;
      seen.add(page.next_cursor);
      url.searchParams.set('cursor', page.next_cursor);
    } while (true);
  }

  function refresh(pending: PendingCost[]) {
    if (!key || running || !pending.length) return;
    const time = now();
    for (const [id, due] of retryAt) if (due <= time) retryAt.delete(id);
    const due = pending.filter(job => !retryAt.has(job.requestId));
    if (!due.length) return;
    // Anchor the provider's 90-day window at submission so archived requests
    // remain searchable and billing events after midnight are included.
    const midnight = Math.floor(due[0].submittedAt / day) * day;
    const batch = due.filter(job => Math.floor(job.submittedAt / day) * day === midnight).slice(0, 50);
    for (const job of batch) retryAt.set(job.requestId, time + retryInterval);
    running = lookup(batch, midnight - day, Math.min(time + 1, midnight + 89 * day))
      .catch(() => onError()).finally(() => { running = undefined; });
  }
  return { refresh, idle: () => running };
}
