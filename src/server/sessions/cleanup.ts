/** Module contract: manual and retention deletion share this restartable Sessions
 * path. Persist deleting before I/O; all readers/workers honor that marker. Own
 * session directories and records are removed; Scenarios owns pruning materials.
 * fal errors are logged without URLs/secrets and never prevent local cleanup. */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db.js';
import { eventDate } from './index.js';
import { materialIds, removeUnusedMaterials } from '../scenarios/cleanup.js';
export interface CleanupOptions { deleteOutput?: (url: string) => Promise<void>; intervalMs?: number }
export async function deleteKnownOutput(url: string, log: FastifyBaseLogger, deleteOutput?: CleanupOptions['deleteOutput']) {
  try {
    if (!deleteOutput) throw new Error('No fal deletion credentials');
    await deleteOutput(url);
  } catch { log.warn({ code: 'FAL_DELETE_FAILED' }, 'Удаление CDN-копии fal не подтверждено; локальная очистка продолжается'); }
}
export function createEventCleanup(db: DB, dataDir: string, log: FastifyBaseLogger, now = Date.now, options: CleanupOptions = {}) {
  let stopped = false; let active: Promise<void> | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
  const running = new Map<string, Promise<void>>();
  async function clean(date: string) {
    if (!db.prepare('SELECT 1 FROM events WHERE date=? AND deleting=1').get(date)) return;
    const sessions = db.prepare('SELECT id,snapshot FROM capture_sessions WHERE event_date=?').all(date) as { id: string; snapshot: string }[];
    const outputs = db.prepare('SELECT DISTINCT g.result_url FROM generation_jobs g JOIN capture_sessions s ON s.id=g.session_id WHERE s.event_date=? AND g.result_url IS NOT NULL').all(date) as { result_url: string }[];
    for (const output of outputs) await deleteKnownOutput(output.result_url, log, options.deleteOutput);
    for (const session of sessions) await rm(join(dataDir, 'media', 'sessions', session.id), { recursive: true, force: true });
    removeUnusedMaterials(db, dataDir, sessions.flatMap(s => materialIds(JSON.parse(s.snapshot))), date);
    db.transaction(() => {
      db.prepare('DELETE FROM capture_sessions WHERE event_date=?').run(date);
      db.prepare('DELETE FROM events WHERE date=? AND deleting=1').run(date);
    }).immediate();
  }
  function remove(date: string) {
    // Synchronous marker precedes the first await and any new operation.
    db.prepare('UPDATE events SET deleting=1 WHERE date=?').run(date);
    let promise = running.get(date);
    if (!promise) { promise = clean(date).finally(() => running.delete(date)); running.set(date, promise); }
    return promise;
  }
  async function pass() {
    const cutoff = new Date(Date.parse(`${eventDate(now())}T00:00:00Z`) - 14 * 86400_000).toISOString().slice(0, 10);
    const rows = db.prepare('SELECT date FROM events WHERE deleting=1 OR date<? ORDER BY date').all(cutoff) as { date: string }[];
    for (const row of rows) {
      try { await remove(row.date); }
      catch { log.error({ code: 'EVENT_CLEANUP_FAILED', date: row.date }, 'Очистка мероприятия продолжится при следующей проверке'); }
    }
  }
  function runOnce() {
    if (stopped) return Promise.resolve();
    if (!active) active = pass().finally(() => { active = undefined; });
    return active;
  }
  async function loop() { await runOnce(); if (!stopped) { timer = setTimeout(loop, options.intervalMs ?? 3600_000); timer.unref(); } }
  return { remove, runOnce, start() { if (!timer && !stopped) { timer = setTimeout(loop, options.intervalMs ?? 3600_000); timer.unref(); } },
    async stop() { stopped = true; clearTimeout(timer); await active; await Promise.allSettled(running.values()); } };
}
