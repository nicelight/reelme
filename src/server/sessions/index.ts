/** Module contract: Sessions owns session start, daily numbering and accepted JPEGs.
 * A single SQLite transaction fixes Novosibirsk date, unique number and a value
 * snapshot from Scenarios. The first visitor setup and session start commit together;
 * admin test sessions do not complete event setup. Legacy ordinary starts keep their
 * implicit-event behavior. Repeated startRequestId returns the saved receipt,
 * including across edits, hidden slots and midnight. Manual admin tests alone use
 * saved test JPEGs, copied by position through the same intake/finalize. Legacy
 * tests retain their single-source retry; new plans never duplicate it.
 * Page contact is diagnostic only and stops on transfer or confirmed cancellation.
 * Test retries retain their original source; concurrent preparation is rejected. Photo bytes are written and
 * decoded without image statistics before a short DB transaction publishes one position. Finalize changes
 * capturing to submit_pending once, only for a complete set; later photo writes
 * are refused, including uploads that started before finalize or event deletion. No camera/fal calls; generation errors are a safe projection from Sessions.
 * Source: docs/slot-setup/matrix.md. New session plans are immutable snapshots. */
import { recordHistory } from './history.js';
import { captureReportSchema } from '../../shared/capture-report.js';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { inspectJpeg } from './jpeg.js';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { snapshotSlot } from '../scenarios/store.js';
import { readMedia, readTestPhoto, sendMedia } from '../scenarios/media.js';
import { wanEditId, wanImageProblem } from '../../shared/scenarios.js';
import { captureHeartbeatTimeoutMs, defaultCaptureSettings, type CaptureSettings, MAX_PHOTO_BYTES, snapshotPosePlan, type StartReceipt, type SlotSnapshot, type SessionState, type CaptureStatus } from '../../shared/capture.js';
import { HttpError } from '../errors.js';
import { participantRanges, type EventSetup } from '../../shared/events.js';

interface SessionRow {
  id: string; start_request_id: string; event_date: string; event_no: number; number: number;
  slot_id: string; snapshot: string; state: SessionState; created_at: number; page_seen_at: number | null;
}
const eventSetupSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check') }).strict(),
  z.object({ action: z.literal('skip') }).strict(),
  z.object({ action: z.literal('save'), name: z.string().trim().min(1).max(120),
    participantRange: z.enum(participantRanges), location: z.string().trim().min(1).max(160) }).strict(),
]);
const startSchema = z.object({ startRequestId: z.string().uuid(), slotId: z.string().uuid(), eventSetup: eventSetupSchema.optional() }).strict();
const sessionParams = z.object({ id: z.string().uuid() });
const photoParams = sessionParams.extend({ poseIndex: z.string().regex(/^[0-7]$/).transform(Number) });
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Novosibirsk', year: 'numeric', month: '2-digit', day: '2-digit' });
export function eventDate(timestamp: number): string {
  const fields = Object.fromEntries(dateFormatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
function receipt(row: SessionRow): StartReceipt {
  const snapshot = JSON.parse(row.snapshot) as SlotSnapshot;
  return { sessionId: row.id, date: row.event_date, number: row.number, state: row.state, captureSettings: { ...defaultCaptureSettings, ...snapshot.captureSettings }, posePlan: snapshotPosePlan(snapshot), story: sessionStory(snapshot) };
}
function sessionStory(snapshot: SlotSnapshot): NonNullable<StartReceipt['story']> {
  return { slotId: snapshot.slotId, description: snapshot.description, thumbnailId: snapshot.thumbnailId };
}
export function readSession(db: DB, sessionId: string) {
  const row = db.prepare('SELECT s.* FROM capture_sessions s JOIN events e ON e.date=s.event_date AND e.event_no=s.event_no WHERE s.id=? AND e.deleting=0').get(sessionId) as SessionRow | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Сессия не найдена');
  const snapshot = JSON.parse(row.snapshot) as SlotSnapshot;
  snapshot.generation.simulateGeneration ??= false;
  return { ...row, snapshot };
}
export function captureStatus(db: DB, sessionId: string): CaptureStatus {
  const session = readSession(db, sessionId);
  const acceptedPoseIndices = (db.prepare('SELECT pose_index FROM capture_photos WHERE session_id=? ORDER BY pose_index').all(sessionId) as { pose_index: number }[]).map(row => row.pose_index);
  const posePlan = snapshotPosePlan(session.snapshot);
  const complete = acceptedPoseIndices.length === posePlan.length && posePlan.every(pose => acceptedPoseIndices.includes(pose.index));
  const error = db.prepare('SELECT error_code,error_message FROM generation_jobs WHERE session_id=?').get(sessionId) as { error_code: string | null; error_message: string | null } | undefined;
  return { ...(error?.error_code ? { error: { code: error.error_code, message: error.error_message! } } : {}), sessionId, date: session.event_date, number: session.number, state: session.state, captureSettings: { ...defaultCaptureSettings, ...session.snapshot.captureSettings }, posePlan, story: sessionStory(session.snapshot), acceptedPoseIndices, complete, finalized: complete && session.state !== 'capturing' && session.state !== 'cancelled' };
}
function requireCapturing(db: DB, sessionId: string, poseIndex: number) {
  const session = readSession(db, sessionId);
  if (session.state === 'cancelled') throw new HttpError(409, 'CAPTURE_CANCELLED', 'Фотосессия отменена оператором');
  if (session.state !== 'capturing') throw new HttpError(409, 'CAPTURE_CLOSED', 'Фотографии уже переданы на обработку');
  if (!snapshotPosePlan(session.snapshot).some(pose => pose.index === poseIndex)) throw new HttpError(400, 'INVALID_POSE', 'Эта позиция не входит в план съёмки');
  return session;
}
async function inspectPhoto(path: string) {
  try {
    return await inspectJpeg(path, 40_000_000);
  } catch { throw new HttpError(400, 'INVALID_PHOTO', 'Нужен корректный JPEG до 40 мегапикселей'); }
}
export function registerSessions(app: FastifyInstance, db: DB, dataDir: string, access: Access, now: () => number) {
  const seconds = z.number().int().min(1).max(60);
  const settingsSchema = z.object({
    photoMaxEdge: z.union([z.literal(0), z.literal(1024), z.literal(2048)]).optional(),
    sendCaptureLogs: z.boolean().optional(), startMode: z.enum(['manual', 'automatic']),
    countdownSeconds: seconds, reviewSeconds: seconds, receiptSeconds: seconds,
  }).strict();
  function settings(): CaptureSettings {
    const row = db.prepare('SELECT settings FROM capture_settings WHERE id=1').get() as { settings: string } | undefined;
    if (!row) return defaultCaptureSettings;
    const saved = settingsSchema.parse(JSON.parse(row.settings));
    return { ...defaultCaptureSettings, ...saved };
  }
  app.get('/api/admin/capture-settings', { preHandler: access.requireAdmin }, settings);
  app.put('/api/admin/capture-settings', { preHandler: [access.requireOrigin, access.requireAdmin] }, request => {
    const update = settingsSchema.parse(request.body);
    const value = { ...settings(), ...update };
    db.prepare('INSERT INTO capture_settings(id,settings) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings').run(JSON.stringify(value));
    return value;
  });
  const start = db.transaction((startRequestId: string, slotId: string, manualTest = false, eventSetup?: EventSetup) => {
    const previous = db.prepare('SELECT * FROM capture_sessions WHERE start_request_id=?').get(startRequestId) as SessionRow | undefined;
    if (previous) {
      const saved = readSession(db, previous.id);
      if (previous.slot_id !== slotId || !!(saved.snapshot.testPhotoIds || saved.snapshot.testPhotoId) !== manualTest) throw new HttpError(409, 'START_CONFLICT', 'Этот запрос уже относится к другому сюжету');
      return { created: false, value: receipt(previous) };
    }
    // Read the current visibility/config under the same write transaction as numbering.
    const snapshot = snapshotSlot(db, slotId, manualTest);
    snapshot.captureSettings = settings();
    const createdAt = now(); const date = eventDate(createdAt);
    const last = db.prepare('SELECT event_no,next_number,closed_at,setup_complete,deleting FROM events WHERE date=? ORDER BY event_no DESC LIMIT 1').get(date) as
      { event_no: number; next_number: number; closed_at: number | null; setup_complete: number; deleting: number } | undefined;
    const current = last?.closed_at === null ? last : undefined;
    if (current?.deleting) throw new HttpError(409, 'EVENT_DELETING', 'Мероприятие удаляется');
    if (!current?.setup_complete && eventSetup?.action === 'check') {
      throw new HttpError(409, 'EVENT_SETUP_REQUIRED', 'Перед первой съёмкой создайте мероприятие или нажмите «Пропустить».');
    }
    const eventNo = current?.event_no ?? (last?.event_no ?? 0) + 1;
    if (!current) {
      const { number } = db.prepare('UPDATE event_name_counter SET next_number=next_number+1 WHERE id=1 RETURNING next_number-1 AS number').get() as { number: number };
      db.prepare('INSERT INTO events(date,event_no,next_number,name) VALUES (?,?,?,?)').run(date, eventNo, last?.next_number ?? 1, `Session_${number}`);
    }
    if (!current?.setup_complete && !manualTest) {
      if (eventSetup?.action === 'save') {
        db.prepare('UPDATE events SET name=?,participant_range=?,location=?,setup_complete=1 WHERE date=? AND event_no=?')
          .run(eventSetup.name, eventSetup.participantRange, eventSetup.location, date, eventNo);
      } else db.prepare('UPDATE events SET setup_complete=1 WHERE date=? AND event_no=?').run(date, eventNo);
    }
    const { number } = db.prepare('UPDATE events SET next_number=next_number+1 WHERE date=? AND event_no=? RETURNING next_number-1 AS number').get(date, eventNo) as { number: number };
    const row: SessionRow = {
      id: randomUUID(), start_request_id: startRequestId, event_date: date, event_no: eventNo, number,
      slot_id: slotId, snapshot: JSON.stringify(snapshot), state: 'capturing', created_at: createdAt, page_seen_at: manualTest ? null : createdAt,
    };
    db.prepare('INSERT INTO capture_sessions(id,start_request_id,event_date,event_no,number,slot_id,snapshot,state,created_at,page_seen_at) VALUES (@id,@start_request_id,@event_date,@event_no,@number,@slot_id,@snapshot,@state,@created_at,@page_seen_at)').run(row);
    return { created: true, value: receipt(row) };
  });
  app.post('/api/capture/sessions', { preHandler: access.requireInstallation }, (request, reply) => {
    const { startRequestId, slotId, eventSetup } = startSchema.parse(request.body);
    const result = start.immediate(startRequestId, slotId, false, eventSetup);
    if (result.created) recordHistory(db, result.value.sessionId, 'capture', 'capture.start', 'number_assigned', 'succeeded', { total: result.value.posePlan.length }, now);
    return reply.code(result.created ? 201 : 200).send(result.value);
  });
  const pageContact = db.prepare<[string], { state: SessionState; page_seen_at: number | null }>(
    'SELECT s.state,s.page_seen_at FROM capture_sessions s JOIN events e ON e.date=s.event_date AND e.event_no=s.event_no AND e.deleting=0 WHERE s.id=?');
  const touchPage = db.prepare("UPDATE capture_sessions SET page_seen_at=? WHERE id=? AND state='capturing' AND page_seen_at=?");
  app.post('/api/capture/sessions/:id/heartbeat', { preHandler: access.requireInstallation }, (request, reply) => {
    const { id } = sessionParams.parse(request.params);
    const session = pageContact.get(id);
    if (!session) throw new HttpError(404, 'NOT_FOUND', 'Сессия не найдена');
    if (session.state === 'capturing' && session.page_seen_at !== null) {
      const time = now();
      const updated = touchPage.run(time, id, session.page_seen_at);
      if (updated.changes && time - session.page_seen_at > captureHeartbeatTimeoutMs) {
        recordHistory(db, id, 'server', 'capture.heartbeat', 'page_reconnected', 'succeeded', {}, () => time);
      }
    }
    return reply.code(204).send();
  });
  app.post('/api/capture/sessions/:id/capture-reports', { preHandler: access.requireInstallation, bodyLimit: 32 * 1024 }, (request, reply) => {
    const { id } = sessionParams.parse(request.params);
    const { snapshot } = readSession(db, id);
    if (!snapshot.captureSettings?.sendCaptureLogs) throw new HttpError(409, 'LOGGING_DISABLED', 'Диагностика выключена для этой сессии');
    const report = captureReportSchema.parse(request.body);
    if (report.pose >= snapshot.expectedPhotos) throw new HttpError(400, 'INVALID_POSE', 'Позиция вне плана съёмки');
    db.prepare('INSERT INTO capture_reports(session_id,report_id,case_id,received_at,report) VALUES(?,?,?,?,?) ON CONFLICT(session_id,report_id) DO NOTHING')
      .run(id, report.id, report.caseId, now(), JSON.stringify(report));
    return reply.code(204).send();
  });
  app.get('/api/capture/sessions/:id/guides/:number', { preHandler: access.requireInstallation }, async (request, reply) => {
    const { id, number } = sessionParams.extend({ number: z.coerce.number().int().min(1).max(5) }).parse(request.params);
    const session = readSession(db, id);
    const guide = session.snapshot.posePlan?.find(pose => pose.guideNumber === number && pose.guideMediaId);
    if (!guide?.guideMediaId) throw new HttpError(404, 'NOT_FOUND', 'Образец ракурса не задан для этой сессии');
    return sendMedia(dataDir, readMedia(db, guide.guideMediaId), request, reply, 'inline', 'Authorization');
  });
  app.get('/api/capture/sessions/:id/thumbnail', { preHandler: access.requireInstallation }, async (request, reply) => {
    const { id } = sessionParams.parse(request.params);
    const session = readSession(db, id);
    return sendMedia(dataDir, readMedia(db, session.snapshot.thumbnailId), request, reply, 'inline', 'Authorization');
  });
  app.get('/api/capture/sessions/:id', { preHandler: access.requireInstallation }, request => {
    const { id } = sessionParams.parse(request.params);
    return captureStatus(db, id);
  });
  app.post('/api/capture/sessions/:id/cancel', { preHandler: access.requireInstallation }, (request, reply) => {
    const { id } = sessionParams.parse(request.params);
    const session = readSession(db, id);
    if (session.state === 'cancelled') return reply.code(204).send();
    const changed = db.prepare("UPDATE capture_sessions SET state='cancelled', page_seen_at=NULL WHERE id=? AND state='capturing'").run(id);
    if (!changed.changes) throw new HttpError(409, 'CAPTURE_CLOSED', 'Фотосессия уже завершена');
    recordHistory(db, id, 'capture', 'capture.cancel', 'operator_cancelled', 'cancelled', {}, now);
    return reply.code(204).send();
  });
  // NULL disables page monitoring durably. A late heartbeat cannot re-enable it.
  const stopPageMonitoring = db.prepare("UPDATE capture_sessions SET page_seen_at=NULL WHERE id=? AND state='capturing' AND page_seen_at IS NOT NULL");
  app.post('/api/capture/sessions/:id/transfer', { preHandler: access.requireInstallation }, request => {
    const { id } = sessionParams.parse(request.params);
    const status = captureStatus(db, id);
    stopPageMonitoring.run(id);
    return status;
  });
  async function storePhoto(id: string, poseIndex: number, write: (path: string) => Promise<void>) {
    const session = requireCapturing(db, id, poseIndex);
    // Unique path per attempt: never overwrite a file that finalize may have accepted.
    const relative = `sessions/${id}/${randomUUID()}.jpg`;
    const directory = join(dataDir, 'media', 'sessions', id);
    const path = join(dataDir, 'media', relative);
    let previous: { path: string } | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await write(path);
      const { width, height } = await inspectPhoto(path);
      const { size } = await stat(path);
      if (size > MAX_PHOTO_BYTES) throw new HttpError(413, 'PHOTO_TOO_LARGE', 'JPEG превышает 20 MiB');
      if (session.snapshot.generation.model === wanEditId) {
        const problem = wanImageProblem({ width, height, size });
        if (problem) throw new HttpError(400, 'INVALID_PHOTO', problem);
      }
      previous = db.transaction(() => {
        requireCapturing(db, id, poseIndex);
        const old = db.prepare('SELECT path FROM capture_photos WHERE session_id=? AND pose_index=?').get(id, poseIndex) as { path: string } | undefined;
        db.prepare(`INSERT INTO capture_photos(session_id,pose_index,path,size,width,height) VALUES (?,?,?,?,?,?)
          ON CONFLICT(session_id,pose_index) DO UPDATE SET path=excluded.path,size=excluded.size,width=excluded.width,height=excluded.height`).run(id, poseIndex, relative, size, width, height);
        return old;
      }).immediate();
    } catch (error) { await rm(path, { force: true }); throw error; }
    if (previous) await rm(join(dataDir, 'media', previous.path), { force: true }).catch(() => app.log.warn({ code: 'PHOTO_CLEANUP_FAILED' }, 'Не удалён заменённый снимок'));
    const status = captureStatus(db, id);
    recordHistory(db, id, 'capture', 'capture.photo', previous ? 'replaced' : 'accepted', 'succeeded', { pose: poseIndex, accepted: status.acceptedPoseIndices.length, total: status.posePlan.length }, now);
    return status;
  }
  app.put('/api/capture/sessions/:id/photos/:poseIndex', { preHandler: access.requireInstallation }, async request => {
    const { id, poseIndex } = photoParams.parse(request.params);
    try {
      requireCapturing(db, id, poseIndex);
      if (!request.isMultipart()) throw new HttpError(415, 'INVALID_PHOTO', 'Передайте JPEG в multipart-поле file');
      // Older capture pages start transfer directly with the first upload.
      stopPageMonitoring.run(id);
      return await storePhoto(id, poseIndex, async path => {
        let received = false;
        for await (const part of request.parts({ limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_PHOTO_BYTES } })) {
          if (part.type !== 'file' || part.fieldname !== 'file' || part.mimetype !== 'image/jpeg') throw new HttpError(400, 'INVALID_PHOTO', 'Передайте один JPEG в поле file');
          await pipeline(part.file, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
          if (part.file.truncated) throw new HttpError(413, 'PHOTO_TOO_LARGE', 'JPEG превышает 20 MiB');
          received = true;
        }
        if (!received) throw new HttpError(400, 'INVALID_PHOTO', 'Не получен JPEG');
      });
    } catch (error) {
      recordHistory(db, id, 'capture', 'capture.photo', 'rejected', 'failed', { pose: poseIndex, code: error instanceof HttpError ? error.code : 'PHOTO_TRANSFER_FAILED' }, now);
      throw error;
    }
  });
  const finalize = db.transaction((sessionId: string) => {
    const status = captureStatus(db, sessionId);
    if (status.state === 'cancelled') throw new HttpError(409, 'CAPTURE_CANCELLED', 'Фотосессия отменена оператором');
    if (!status.complete) throw new HttpError(409, 'INCOMPLETE_PHOTOS', 'Получены не все фотографии');
    if (status.state === 'capturing') db.prepare("UPDATE capture_sessions SET state='submit_pending' WHERE id=? AND state='capturing'").run(sessionId);
    return { advanced: status.state === 'capturing', value: captureStatus(db, sessionId) };
  });
  function finishCapture(id: string) {
    try {
      const result = finalize.immediate(id);
      if (result.advanced) recordHistory(db, id, 'capture', 'capture.finalize', 'queued', 'succeeded', {}, now);
      return result.value;
    } catch (error) {
      if (error instanceof HttpError) recordHistory(db, id, 'capture', 'capture.finalize', 'rejected', 'failed', { code: error.code }, now);
      throw error;
    }
  }
  app.post('/api/capture/sessions/:id/finalize', { preHandler: access.requireInstallation }, request => {
    const { id } = sessionParams.parse(request.params);
    return finishCapture(id);
  });
  const preparingTests = new Set<string>();
  const testBody = z.object({ startRequestId: z.string().uuid() }).strict();
  app.post('/api/admin/slots/:id/test-generations', { preHandler: [access.requireAdmin, access.requireOrigin] }, async (request, reply) => {
    const { id: slotId } = sessionParams.parse(request.params);
    const { startRequestId } = testBody.parse(request.body);
    const started = start.immediate(startRequestId, slotId, true);
    const id = started.value.sessionId;
    if (started.created) recordHistory(db, id, 'capture', 'capture.start', 'number_assigned', 'succeeded', { mode: 'manual_test', total: started.value.posePlan.length }, now);
    if (preparingTests.has(id)) throw new HttpError(409, 'TEST_IN_PROGRESS', 'Тестовые фотографии ещё подготавливаются. Повторите запрос.');
    if (started.value.state !== 'capturing') return captureStatus(db, id);
    preparingTests.add(id);
    try {
      const session = readSession(db, id);
      const accepted = captureStatus(db, id).acceptedPoseIndices;
      for (const pose of snapshotPosePlan(session.snapshot)) {
        if (accepted.includes(pose.index)) continue;
        const source = session.snapshot.posePlan ? session.snapshot.testPhotoIds?.[pose.index] : session.snapshot.testPhotoId;
        if (!source) throw new Error('Missing saved test source');
        const media = readTestPhoto(db, source);
        const bytes = await readFile(join(dataDir, 'media', media.path));
        await storePhoto(id, pose.index, path => writeFile(path, bytes, { flag: 'wx', mode: 0o600 }));
      }
      const status = finishCapture(id);
      return reply.code(started.created ? 201 : 200).send(status);
    } catch {
      // No paths or decoder details in a public test result. Never queue partial input.
      db.transaction(() => {
        if (db.prepare("UPDATE capture_sessions SET state='failed' WHERE id=? AND state='capturing'").run(id).changes) {
          db.prepare(`INSERT INTO generation_jobs(session_id,error_code,error_message) VALUES (?,'TEST_PREPARATION_FAILED',?)
            ON CONFLICT(session_id) DO UPDATE SET error_code=excluded.error_code,error_message=excluded.error_message`)
            .run(id, 'Не удалось подготовить тестовую фотографию. Сохраните JPEG и запустите новый тест.');
        }
      })();
      recordHistory(db, id, 'capture', 'capture.photo', 'rejected', 'failed', { code: 'TEST_PREPARATION_FAILED' }, now);
      return captureStatus(db, id);
    } finally { preparingTests.delete(id); }
  });
  app.get('/api/admin/slots/:id/sessions/:sessionId', { preHandler: access.requireAdmin }, request => {
    const { id, sessionId } = z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }).parse(request.params);
    if (readSession(db, sessionId).slot_id !== id) throw new HttpError(404, 'NOT_FOUND', 'Сессия этого сюжета не найдена');
    return captureStatus(db, sessionId);
  });
}
