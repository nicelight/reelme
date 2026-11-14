/** Module contract: one in-process Sessions worker advances durable fal work.
 * Submit inputs use the saved snapshot/photos only. Confirmed IDs are committed
 * before observation and never resubmitted; network/files never run in SQL
 * transactions. A verified local result stays preparing until the issuance callback
 * owns ready; standalone generation has no authority to publish capabilities.
 * Deletion blocks new work and publication; late local output is discarded.
 * Errors retain the session/photos; public errors are fixed safe messages. */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionAvailable } from './availability.js';
import { deleteKnownOutput, type CleanupOptions } from './cleanup.js';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db.js';
import { readSession } from './index.js';
import { buildModelInput } from './model-input.js';
import { photoProviderUrl, slotProviderUrl } from './provider-media.js';
import type { FalTransport } from './fal.js';
import { InvalidVideo, prepareVideo } from './video.js';

interface Job { request_id: string | null; result_url: string | null; video_path: string | null; frame_path: string | null }
export interface GenerationOptions { deleteOutput?: CleanupOptions['deleteOutput']; client: FalTransport; download?: typeof fetch; intervalMs?: number; secret?: string; publishReady?: (id: string) => Promise<void> }
class GenerationFailure extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) { super(message, options); }
}
const messages: Record<string, string> = {
  FAL_REJECTED: 'Сервис отклонил запрос генерации. Обратитесь к сотруднику.',
  FAL_FAILED: 'Не удалось создать видео. Обратитесь к сотруднику.',
  INVALID_RESULT: 'Сервис вернул непригодное видео. Обратитесь к сотруднику.',
  GENERATION_RETRY: 'Обработка временно недоступна. Сервер повторит текущий шаг.',
};
function httpStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}
function safeDetail(error: unknown, secret?: string): unknown {
  const seen = new WeakSet<object>();
  function clean(value: unknown, key = ''): unknown {
    if (/authorization|cookie|token|secret|api.?key|url/i.test(key)) return '[redacted]';
    if (typeof value === 'string') {
      const text = secret ? value.replaceAll(secret, '[redacted]') : value;
      return text.replace(/https?:\/\/[^\s"'<>]+/gi, '[url]').replace(/\b(?:Key|Bearer)\s+[^\s"']+/gi, '[credential]');
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular]'; seen.add(value);
    const entries = value instanceof Error ? Object.entries({ ...value, name: value.name, message: value.message, stack: value.stack, cause: value.cause }) : Object.entries(value);
    return Object.fromEntries(entries.map(([k, v]) => [k, clean(v, k)]));
  }
  return clean(error);
}
export function createGenerationWorker(db: DB, dataDir: string, origin: string, log: FastifyBaseLogger, options: GenerationOptions) {
  let stopped = false; let active: Promise<void> | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
  const clearError = (id: string) => db.prepare('UPDATE generation_jobs SET error_code=NULL,error_message=NULL WHERE session_id=?').run(id);
  function failure(id: string, error: unknown, terminal: boolean, code: string) {
    if (!sessionAvailable(db, id)) return;
    db.transaction(() => {
      db.prepare('UPDATE generation_jobs SET error_code=?,error_message=? WHERE session_id=?').run(code, messages[code], id);
      if (terminal) db.prepare("UPDATE capture_sessions SET state='failed' WHERE id=?").run(id);
    })();
    log.error({ sessionId: id, code, detail: safeDetail(error, options.secret) }, 'Ошибка обработки видео');
  }
  async function advance(id: string) {
    if (!sessionAvailable(db, id)) return;
    const session = readSession(db, id);
    db.prepare('INSERT INTO generation_jobs(session_id) VALUES (?) ON CONFLICT DO NOTHING').run(id);
    const job = db.prepare('SELECT * FROM generation_jobs WHERE session_id=?').get(id) as Job;
    try {
      if (session.state === 'submit_pending') {
        // Also recover an accepted ID if a prior record already contains it.
        if (job.request_id) { db.prepare("UPDATE capture_sessions SET state='observing' WHERE id=?").run(id); return; }
        const input = session.snapshot.generation;
        const photos = db.prepare('SELECT pose_index FROM capture_photos WHERE session_id=? ORDER BY pose_index').all(id) as { pose_index: number }[];
        let payload: Record<string, unknown>;
        try {
          if (photos.some((photo, index) => photo.pose_index !== index)) throw new Error('Invalid photo order');
          payload = buildModelInput(session.snapshot, {
            photos: photos.map(photo => photoProviderUrl(db, origin, id, photo.pose_index)),
            video: input.videoId ? slotProviderUrl(db, origin, input.videoId) : undefined,
            references: input.referenceIds.map(mediaId => slotProviderUrl(db, origin, mediaId)),
          });
        } catch (error) { throw new GenerationFailure('FAL_REJECTED', 'Invalid generation snapshot/photos', { cause: error }); }
        let accepted;
        try { accepted = await options.client.submit(input.model, payload); }
        catch (error) {
          // An HTTP refusal is known, unlike a missing acknowledgement. SDK retries
          // transient transport statuses inside the single submit call already.
          if (httpStatus(error)) throw new GenerationFailure('FAL_REJECTED', 'fal refused submit', { cause: error });
          throw error;
        }
        if (!sessionAvailable(db, id)) return;
        if (!accepted.request_id) throw new Error('Missing submit acknowledgement');
        db.transaction(() => {
          db.prepare('UPDATE generation_jobs SET request_id=?,status_url=?,response_url=?,cancel_url=?,error_code=NULL,error_message=NULL WHERE session_id=?').run(accepted.request_id, accepted.status_url ?? null, accepted.response_url ?? null, accepted.cancel_url ?? null, id);
          db.prepare("UPDATE capture_sessions SET state='observing' WHERE id=?").run(id);
        })();
        return;
      }
      if (session.state === 'observing') {
        if (!job.request_id) throw new GenerationFailure('FAL_FAILED', 'Missing confirmed fal ID');
        const status = await options.client.status(session.snapshot.generation.model, job.request_id);
        if (!sessionAvailable(db, id)) return;
        if (status.error || status.status === 'FAILED') throw new GenerationFailure('FAL_FAILED', 'fal terminal status', { cause: status });
        if (status.status !== 'COMPLETED') { clearError(id); return; }
        let result: unknown;
        try { result = await options.client.result(session.snapshot.generation.model, job.request_id); }
        catch (error) {
          const code = httpStatus(error);
          if (code && ![408,429,502,503,504].includes(code)) throw new GenerationFailure('FAL_FAILED', 'fal result rejected', { cause: error });
          throw error;
        }
        const data = result as { error?: unknown; detail?: unknown; video?: { url?: unknown } } | null;
        if (!data || data.error || data.detail || typeof data.video?.url !== 'string') throw new GenerationFailure('FAL_FAILED', 'fal returned no video or an error', { cause: result });
        let url: URL;
        try { url = new URL(data.video.url); } catch { throw new GenerationFailure('INVALID_RESULT', 'Invalid result URL'); }
        if (url.protocol !== 'https:' || url.username || url.password) throw new GenerationFailure('INVALID_RESULT', 'Invalid result URL');
        if (!sessionAvailable(db, id)) { await deleteKnownOutput(url.href, log, options.deleteOutput); return; }
        db.transaction(() => {
          db.prepare('UPDATE generation_jobs SET result_url=?,error_code=NULL,error_message=NULL WHERE session_id=?').run(url.href, id);
          db.prepare("UPDATE capture_sessions SET state='preparing' WHERE id=?").run(id);
        })();
        return;
      }
      if (session.state === 'preparing' && !job.video_path) {
        if (!job.result_url) throw new GenerationFailure('INVALID_RESULT', 'Missing result URL');
        const prepared = await prepareVideo(dataDir, id, job.result_url, options.download);
        if (!sessionAvailable(db, id)) {
          await rm(join(dataDir, 'media', 'sessions', id), { recursive: true, force: true });
          return;
        }
        db.prepare(`UPDATE generation_jobs SET video_path=@video_path,frame_path=@frame_path,video_size=@video_size,frame_size=@frame_size,width=@width,height=@height,duration=@duration,error_code=NULL,error_message=NULL WHERE session_id=@id`).run({ ...prepared, id });
      }
      if (session.state === 'preparing') await options.publishReady?.(id);
    } catch (error) {
      const code = error instanceof GenerationFailure ? error.code : error instanceof InvalidVideo ? 'INVALID_RESULT' : 'GENERATION_RETRY';
      const rejectedStatus = session.state === 'observing' && (httpStatus(error) ?? 0) >= 400 && (httpStatus(error) ?? 0) < 500 && ![408,429].includes(httpStatus(error)!);
      failure(id, error, code !== 'GENERATION_RETRY' || rejectedStatus, rejectedStatus ? 'FAL_FAILED' : code);
    }
  }
  async function pass() {
    const rows = db.prepare(`SELECT s.id FROM capture_sessions s LEFT JOIN generation_jobs g ON g.session_id=s.id
      WHERE EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.deleting=0) AND (s.state IN ('submit_pending','observing') OR (s.state='preparing' AND (g.video_path IS NULL OR ?))) ORDER BY s.created_at,s.id`).all(options.publishReady ? 1 : 0) as { id: string }[];
    for (const row of rows) { if (stopped) break; await advance(row.id); }
  }
  function runOnce(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (!active) active = pass().finally(() => { active = undefined; });
    return active;
  }
  async function loop() {
    try { await runOnce(); }
    catch (error) { log.error({ detail: safeDetail(error, options.secret) }, 'Сбой фонового обработчика'); }
    if (!stopped) { timer = setTimeout(loop, options.intervalMs ?? 3000); timer.unref(); }
  }
  return { runOnce, start() { if (!timer && !stopped) { timer = setTimeout(loop, 0); timer.unref(); } }, async stop() { stopped = true; clearTimeout(timer); await active; } };
}
