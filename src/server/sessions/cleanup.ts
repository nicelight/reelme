/** Module contract: archive, event preparation and retention share one serial
 * deletion per date. Persist confirmed dates before I/O so startup resumes them. Own
 * session directories and records are removed; Scenarios owns pruning materials.
 * Test-video results are local only and never enter fal deletion. fal errors are
 * logged without URLs/secrets and never prevent local cleanup. */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db.js';
import type { EventPreparation, PreparationProgress } from '../../shared/events.js';
import { HttpError } from '../errors.js';
import { eventDate } from './index.js';
import { materialIds, removeUnusedMaterials } from '../scenarios/cleanup.js';
export interface CleanupOptions { deleteOutput?: (url: string) => Promise<void>; intervalMs?: number }
const retentionDays = 14;
function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
export async function deleteKnownOutput(url: string, log: FastifyBaseLogger, deleteOutput?: CleanupOptions['deleteOutput']) {
  try {
    if (!deleteOutput) throw new Error('No fal deletion credentials');
    await deleteOutput(url);
    return true;
  } catch {
    log.warn({ code: 'FAL_DELETE_FAILED' }, 'Удаление CDN-копии fal не подтверждено; локальная очистка продолжается');
    return false;
  }
}
export function createEventCleanup(db: DB, dataDir: string, log: FastifyBaseLogger, now = Date.now, options: CleanupOptions = {}) {
  let stopped = false; let active: Promise<void> | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
  const running = new Map<string, Promise<number>>();
  let tail = Promise.resolve();
  let preparation: PreparationProgress | null = null;
  async function clean(date: string) {
    const sessions = db.prepare('SELECT id,snapshot FROM capture_sessions WHERE event_date=?').all(date) as { id: string; snapshot: string }[];
    const outputs = db.prepare(`SELECT DISTINCT g.result_url FROM generation_jobs g JOIN capture_sessions s ON s.id=g.session_id
      WHERE s.event_date=? AND g.result_url IS NOT NULL AND COALESCE(json_extract(s.snapshot,'$.generation.simulateGeneration'),0)=0`).all(date) as { result_url: string }[];
    let remoteErrors = 0;
    for (const output of outputs) {
      if (!await deleteKnownOutput(output.result_url, log, options.deleteOutput)) remoteErrors++;
    }
    for (const session of sessions) await rm(join(dataDir, 'media', 'sessions', session.id), { recursive: true, force: true });
    removeUnusedMaterials(db, dataDir, sessions.flatMap(s => materialIds(JSON.parse(s.snapshot))), date);
    db.transaction(() => {
      db.prepare('DELETE FROM capture_sessions WHERE event_date=?').run(date);
      db.prepare('DELETE FROM events WHERE date=? AND deleting=1').run(date);
    }).immediate();
    return remoteErrors;
  }
  function remove(date: string) {
    const existing = running.get(date);
    if (existing) return existing;
    if (!db.prepare('UPDATE events SET deleting=1 WHERE date=?').run(date).changes) return Promise.resolve(0);
    const promise = tail.then(() => setImmediate()).then(() => clean(date)).finally(() => running.delete(date));
    tail = promise.then(() => {}, () => {});
    running.set(date, promise);
    return promise;
  }
  function cutoff(advance = 0) { return shiftDate(eventDate(now()), advance - retentionDays); }
  function cleanDates(rows: { date: string }[], progress?: PreparationProgress) {
    return Promise.all(rows.map(async ({ date }) => {
      try {
        const remoteErrors = await remove(date);
        if (progress) { progress.deleted++; progress.remoteErrors += remoteErrors; }
      } catch {
        log.error({ code: 'EVENT_CLEANUP_FAILED', date }, 'Очистка мероприятия продолжится при следующей проверке');
        if (progress) progress.failed++;
      }
      if (progress) progress.running = progress.deleted + progress.failed < progress.total;
    }));
  }
  async function pass() {
    const boundary = cutoff();
    const rows = db.prepare('SELECT date FROM events WHERE deleting=1 OR date<? ORDER BY date').all(boundary) as { date: string }[];
    await cleanDates(rows);
  }
  function preview(boundary = cutoff(3)): EventPreparation {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM events WHERE date<?').get(boundary) as { count: number };
    return { through: shiftDate(boundary, -1), eligibleCount: count, operation: preparation && { ...preparation } };
  }
  function prepare(through: unknown): EventPreparation {
    const boundary = cutoff(3);
    const view = preview(boundary);
    if (preparation?.running) return view;
    if (through !== view.through) throw new HttpError(409, 'CONFIRM_DATE', 'Дата очистки изменилась. Нажмите «Подготовка к мероприятию» ещё раз.');
    if (!view.eligibleCount) return view;
    const rows = db.prepare('SELECT date FROM events WHERE date<? ORDER BY date').all(boundary) as { date: string }[];
    const progress: PreparationProgress = { running: true, total: rows.length, deleted: 0, failed: 0, remoteErrors: 0 };
    preparation = progress;
    void cleanDates(rows, progress);
    return { ...view, operation: { ...progress } };
  }
  function runOnce() {
    if (stopped) return Promise.resolve();
    if (!active) active = pass().finally(() => { active = undefined; });
    return active;
  }
  async function loop() { await runOnce(); if (!stopped) { timer = setTimeout(loop, options.intervalMs ?? 3600_000); timer.unref(); } }
  return { remove, preview, prepare, runOnce, start() { if (!timer && !stopped) { timer = setTimeout(loop, options.intervalMs ?? 3600_000); timer.unref(); } },
    async stop() { stopped = true; clearTimeout(timer); await active; await tail; } };
}
