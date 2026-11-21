/** Module contract: independent in-process loops advance fal jobs and prepare
 * one local result at a time. Persisting result_url and preparing hands off the job.
 * Submit inputs use the saved snapshot/photos only. Simulation uses the same
 * preparation. Input-only simulation ends before transport/issuance; test-video
 * uses a local transport chosen from the immutable snapshot, never the fal client.
 * Confirmed IDs are committed before observation and never resubmitted; network/files never run in SQL
 * transactions. A verified local result stays preparing until the issuance callback
 * owns ready; standalone generation has no authority to publish capabilities.
 * Deletion blocks new work and publication; late local output is discarded.
 * Errors retain the session/photos; public errors are fixed safe messages.
 * Source: docs/slot-setup/matrix.md. Completeness follows the saved capture plan. */
import { nextSubmitAttempt, recordHistory, type HistoryDetail, type HistoryOutcome } from './history.js';
import type { TemplateCache } from './template-cache.js';
import { snapshotPosePlan } from '../../shared/capture.js';
import { open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sessionAvailable } from './availability.js';
import { deleteKnownOutput, type CleanupOptions } from './cleanup.js';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db.js';
import { readSession } from './index.js';
import { readMedia } from '../scenarios/media.js';
import { buildModelInput } from './model-input.js';
import { photoProviderUrl, slotProviderUrl } from './provider-media.js';
import type { FalTransport } from './fal.js';
import { InvalidVideo, prepareVideo } from './video.js';
import { falHistoryReason, GenerationFailure, generationMessages } from './generation-errors.js';
import { isTestVideo } from '../../shared/scenarios.js';
import { testVideoTransport } from './test-video.js';

interface Job { template_repaired: number; request_id: string | null; result_url: string | null; video_path: string | null; frame_path: string | null; submitted_at: number | null }
export interface GenerationOptions { templates?: TemplateCache; deleteOutput?: CleanupOptions['deleteOutput']; client?: FalTransport; download?: typeof fetch; testVideoDir?: string; intervalMs?: number; now?: () => number; secret?: string; publishReady?: (id: string, freshlyPrepared: boolean) => Promise<void> }
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
  let stopped = false;
  const clearError = (id: string) => db.prepare('UPDATE generation_jobs SET error_code=NULL,error_message=NULL WHERE session_id=?').run(id);
  function failure(id: string, error: unknown, terminal: boolean, code: keyof typeof generationMessages) {
    if (!sessionAvailable(db, id)) return;
    db.transaction(() => {
      db.prepare('UPDATE generation_jobs SET error_code=?,error_message=? WHERE session_id=?').run(code, generationMessages[code], id);
      if (terminal) db.prepare("UPDATE capture_sessions SET state='failed' WHERE id=?").run(id);
    })();
    log.error({ sessionId: id, code, detail: safeDetail(error, options.secret) }, 'Ошибка обработки видео');
  }
  async function advance(id: string) {
    if (!sessionAvailable(db, id)) return;
    const session = readSession(db, id);
    db.prepare('INSERT INTO generation_jobs(session_id) VALUES (?) ON CONFLICT DO NOTHING').run(id);
    const job = db.prepare('SELECT * FROM generation_jobs WHERE session_id=?').get(id) as Job;
    const input = session.snapshot.generation;
    const testVideo = isTestVideo(input);
    const inputOnly = input.simulateGeneration && !testVideo;
    const templates = input.simulateGeneration ? undefined : options.templates;
    let step = session.state === 'observing' ? 'fal.status' : session.state === 'preparing' ? 'video.download' : 'generation.inputs';
    const mode = testVideo ? 'test_video' : inputOnly ? 'simulation' : session.snapshot.testPhotoIds || session.snapshot.testPhotoId ? 'manual_test' : 'live';
    let submitting = false;
    const context: HistoryDetail = { mode, model: input.model, requestId: job.request_id ?? undefined };
    const observe = (event: string, outcome: HistoryOutcome, detail: HistoryDetail = {}) =>
      recordHistory(db, id, 'worker', step, event, outcome, { ...context, ...detail }, options.now);
    const transport = testVideo
      ? testVideoTransport(id, options.testVideoDir ?? resolve('dist/client/test-videos'), input.orientation === 'portrait', job.submitted_at, options.now ?? Date.now)
      : options;
    try {
      if (session.state === 'submit_pending') {
        // Also recover an accepted ID if a prior record already contains it.
        if (job.request_id && !inputOnly) { db.prepare("UPDATE capture_sessions SET state='observing' WHERE id=?").run(id); return; }
        const photos = db.prepare('SELECT pose_index,path FROM capture_photos WHERE session_id=? ORDER BY pose_index').all(id) as { pose_index: number; path: string }[];
        let payload: Record<string, unknown>;
        try {
          const plan = snapshotPosePlan(session.snapshot);
          if (photos.length !== plan.length || photos.some((photo, index) => photo.pose_index !== plan[index].index)) throw new Error('Incomplete or unordered photos');
          if (templates) step = 'template.cdn';
          const urls = templates?.resolveInputs(input);
          if (templates && !urls) { observe('waiting', 'waiting'); return; }
          if (urls && urls.size) observe('available', 'succeeded');
          step = 'generation.inputs';
          const templateUrl = (mediaId: string) => urls ? urls.get(mediaId)! : slotProviderUrl(db, origin, mediaId);
          const paths = photos.map(photo => photo.path);
          if (!urls) {
            for (const mediaId of [input.videoId, ...input.referenceIds]) {
              if (mediaId) paths.push(readMedia(db, mediaId).path);
            }
          }
          for (const path of paths) {
            const file = await open(join(dataDir, 'media', path), 'r');
            try {
              if (!(await file.stat()).isFile() || (await file.read(Buffer.alloc(1), 0, 1, 0)).bytesRead !== 1) throw new Error('Unreadable input file');
            } finally { await file.close(); }
          }
          payload = buildModelInput(session.snapshot, {
            photos: photos.map(photo => photoProviderUrl(db, origin, id, photo.pose_index)),
            video: input.videoId ? templateUrl(input.videoId) : undefined,
            references: input.referenceIds.map(templateUrl),
          });
        } catch (error) {
          if (error instanceof GenerationFailure) throw error;
          throw new GenerationFailure('INPUT_PREPARATION_FAILED', 'Invalid generation snapshot/photos', { cause: error });
        }
        if (!sessionAvailable(db, id)) return;
        observe('prepared', 'succeeded');
        if (inputOnly) {
          db.transaction(() => {
            clearError(id);
            db.prepare("UPDATE capture_sessions SET state='simulated' WHERE id=?").run(id);
          })();
          return;
        }
        step = 'fal.submit';
        if (!transport.client) throw new GenerationFailure('FAL_NOT_CONFIGURED', 'Missing fal transport');
        let accepted;
        try {
          db.prepare('UPDATE generation_jobs SET submitted_at=? WHERE session_id=?').run((options.now ?? Date.now)(), id);
          context.attempt = nextSubmitAttempt(db, id);
          observe('submit_started', 'started');
          submitting = true;
          accepted = await transport.client.submit(input.model, payload);
        }
        catch (error) {
          // An HTTP refusal is known, unlike a missing acknowledgement. SDK retries
          // transient transport statuses inside the single submit call already.
          if (httpStatus(error)) throw new GenerationFailure('FAL_REJECTED', 'fal refused submit', { cause: error });
          throw error;
        }
        if (!sessionAvailable(db, id)) return;
        if (!accepted.request_id) throw new Error('Missing submit acknowledgement');
        context.requestId = accepted.request_id;
        db.transaction(() => {
          db.prepare('UPDATE generation_jobs SET request_id=?,status_url=?,response_url=?,cancel_url=?,error_code=NULL,error_message=NULL WHERE session_id=?').run(accepted.request_id, accepted.status_url ?? null, accepted.response_url ?? null, accepted.cancel_url ?? null, id);
          db.prepare("UPDATE capture_sessions SET state='observing' WHERE id=?").run(id);
        })();
        observe('acknowledged', 'succeeded');
        return;
      }
      if (session.state === 'observing') {
        if (!transport.client) throw new GenerationFailure('FAL_NOT_CONFIGURED', 'Missing fal transport');
        if (!job.request_id) throw new GenerationFailure('FAL_FAILED', 'Missing confirmed fal ID');
        const status = await transport.client.status(input.model, job.request_id);
        if (!sessionAvailable(db, id)) return;
        if (status.error || status.status === 'FAILED') throw new GenerationFailure('FAL_FAILED', 'fal terminal status', { cause: status });
        const providerStatus = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'].includes(status.status) ? status.status : 'UNKNOWN';
        observe('provider_status', status.status === 'COMPLETED' ? 'succeeded' : 'waiting', { providerStatus });
        if (status.status !== 'COMPLETED') { clearError(id); return; }
        step = 'fal.result';
        observe('retrieving', 'started');
        let result: unknown;
        try { result = await transport.client.result(input.model, job.request_id); }
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
        if (!sessionAvailable(db, id)) { if (!testVideo) await deleteKnownOutput(url.href, log, options.deleteOutput); return; }
        db.transaction(() => {
          db.prepare('UPDATE generation_jobs SET result_url=?,error_code=NULL,error_message=NULL WHERE session_id=?').run(url.href, id);
          db.prepare("UPDATE capture_sessions SET state='preparing' WHERE id=?").run(id);
        })();
        observe('result_received', 'succeeded');
        return;
      }
      if (session.state === 'preparing' && !job.video_path) {
        if (!job.result_url) throw new GenerationFailure('INVALID_RESULT', 'Missing result URL');
        const prepared = await prepareVideo(dataDir, id, job.result_url, transport.download, (current, outcome, httpStatus) => {
          step = current;
          observe(outcome, outcome, { httpStatus });
        });
        if (!sessionAvailable(db, id)) {
          await rm(join(dataDir, 'media', 'sessions', id), { recursive: true, force: true });
          return;
        }
        db.prepare(`UPDATE generation_jobs SET video_path=@video_path,frame_path=@frame_path,video_size=@video_size,frame_size=@frame_size,width=@width,height=@height,duration=@duration,error_code=NULL,error_message=NULL WHERE session_id=@id`).run({ ...prepared, id });
      }
      if (session.state === 'preparing') {
        step = 'delivery.publish';
        await options.publishReady?.(id, !job.video_path);
      }
    } catch (error) {
      const code = error instanceof GenerationFailure ? error.code : error instanceof InvalidVideo ? 'INVALID_RESULT' : 'GENERATION_RETRY';
      const rejectedStatus = session.state === 'observing' && (httpStatus(error) ?? 0) >= 400 && (httpStatus(error) ?? 0) < 500 && ![408,429].includes(httpStatus(error)!);
      const providerDetail = !testVideo && step.startsWith('fal.') ? falHistoryReason(error, options.secret, input.prompt) : {};
      if (templates && (code === 'FAL_REJECTED' || code === 'FAL_FAILED' || rejectedStatus)) {
        const missing = await templates.invalidateMissing(input);
        if (missing && !job.request_id && !job.template_repaired && sessionAvailable(db, id)) {
          db.prepare('UPDATE generation_jobs SET template_repaired=1 WHERE session_id=?').run(id);
          observe('rejected', 'retry', { code, ...providerDetail });
          step = 'template.cdn';
          observe('repair', 'retry');
          templates.warm(input);
          return;
        }
      }
      const terminal = code !== 'GENERATION_RETRY' || rejectedStatus;
      const errorCode = rejectedStatus ? 'FAL_FAILED' : code;
      failure(id, error, terminal, errorCode);
      const missingAck = submitting && !context.requestId && !terminal;
      const event = missingAck ? 'ack_missing' : submitting && context.requestId ? 'ack_not_saved' : 'error';
      observe(event, missingAck ? 'unknown' : terminal ? 'failed' : 'retry', {
        code: errorCode, httpStatus: code === 'RESULT_GONE' ? 410 : httpStatus(error) ?? httpStatus((error as Error | null)?.cause),
        ...providerDetail,
      });
    }
  }
  function createLoop(condition: string) {
    const select = db.prepare<[], { id: string }>(`SELECT s.id FROM capture_sessions s
      JOIN events e ON e.date=s.event_date AND e.event_no=s.event_no LEFT JOIN generation_jobs g ON g.session_id=s.id
      WHERE e.deleting=0 AND ${condition} ORDER BY s.created_at,s.id`);
    let active: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pass() {
      for (const { id } of select.all()) {
        if (stopped) break;
        await advance(id);
      }
    }
    function runOnce() {
      if (stopped) return Promise.resolve();
      active ??= pass().finally(() => { active = undefined; });
      return active;
    }
    async function loop() {
      try { await runOnce(); }
      catch (error) { log.error({ detail: safeDetail(error, options.secret) }, 'Сбой фонового обработчика'); }
      if (!stopped) timer = setTimeout(loop, options.intervalMs ?? 3000).unref();
    }
    return {
      runOnce,
      start() { if (!timer && !stopped) timer = setTimeout(loop, 0).unref(); },
      stop() { clearTimeout(timer); return active; },
    };
  }
  const provider = createLoop("s.state IN ('submit_pending','observing')");
  const preparation = createLoop(options.publishReady ? "s.state='preparing'" : "s.state='preparing' AND g.video_path IS NULL");
  return {
    async runOnce() { await Promise.all([preparation.runOnce(), provider.runOnce()]); },
    start() { provider.start(); preparation.start(); },
    async stop() {
      stopped = true;
      await Promise.allSettled([provider.stop(), preparation.stop()]);
    },
  };
}
