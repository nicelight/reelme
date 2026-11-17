/** Module contract: Sessions owns session start, daily numbering and accepted JPEGs.
 * A single SQLite transaction fixes Novosibirsk date, unique number and a value
 * snapshot from Scenarios. Repeated startRequestId returns the saved receipt,
 * including across edits, hidden slots and midnight. Manual admin tests alone use
 * saved test JPEGs, copied by position through the same intake/finalize. Legacy
 * tests retain their single-source retry; new plans never duplicate it.
 * Test retries retain their original source; concurrent preparation is rejected. Photo bytes are written and
 * decoded without image statistics before a short DB transaction publishes one position. Finalize changes
 * capturing to submit_pending once, only for a complete set; later photo writes
 * are refused, including uploads that started before finalize or event deletion. No camera/fal calls; generation errors are a safe projection from Sessions.
 * Source: docs/slot-setup/matrix.md. New session plans are immutable snapshots. */
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
import { MAX_PHOTO_BYTES, snapshotPosePlan, type StartReceipt, type SlotSnapshot, type SessionState, type CaptureStatus } from '../../shared/capture.js';
import { HttpError } from '../errors.js';

interface SessionRow {
  id: string; start_request_id: string; event_date: string; number: number;
  slot_id: string; snapshot: string; state: SessionState; created_at: number;
}
const startSchema = z.object({ startRequestId: z.string().uuid(), slotId: z.string().uuid() }).strict();
const sessionParams = z.object({ id: z.string().uuid() });
const photoParams = sessionParams.extend({ poseIndex: z.string().regex(/^[0-7]$/).transform(Number) });
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Novosibirsk', year: 'numeric', month: '2-digit', day: '2-digit' });
export function eventDate(timestamp: number): string {
  const fields = Object.fromEntries(dateFormatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
function receipt(row: SessionRow): StartReceipt {
  const snapshot = JSON.parse(row.snapshot) as SlotSnapshot;
  return { sessionId: row.id, date: row.event_date, number: row.number, state: row.state, posePlan: snapshotPosePlan(snapshot), story: sessionStory(snapshot) };
}
function sessionStory(snapshot: SlotSnapshot): NonNullable<StartReceipt['story']> {
  return { description: snapshot.description, thumbnailId: snapshot.thumbnailId };
}
export function readSession(db: DB, sessionId: string) {
  const row = db.prepare('SELECT s.* FROM capture_sessions s JOIN events e ON e.date=s.event_date WHERE s.id=? AND e.deleting=0').get(sessionId) as SessionRow | undefined;
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
  return { ...(error?.error_code ? { error: { code: error.error_code, message: error.error_message! } } : {}), sessionId, date: session.event_date, number: session.number, state: session.state, posePlan, story: sessionStory(session.snapshot), acceptedPoseIndices, complete, finalized: complete && session.state !== 'capturing' };
}
function requireCapturing(db: DB, sessionId: string, poseIndex: number) {
  const session = readSession(db, sessionId);
  if (session.state !== 'capturing') throw new HttpError(409, 'CAPTURE_CLOSED', 'Фотографии уже переданы на обработку');
  if (!snapshotPosePlan(session.snapshot).some(pose => pose.index === poseIndex)) throw new HttpError(400, 'INVALID_POSE', 'Эта позиция не входит в план съёмки');
}
async function inspectPhoto(path: string) {
  try {
    return await inspectJpeg(path, 40_000_000);
  } catch { throw new HttpError(400, 'INVALID_PHOTO', 'Нужен корректный JPEG до 40 мегапикселей'); }
}
export function registerSessions(app: FastifyInstance, db: DB, dataDir: string, access: Access, now: () => number) {
  const start = db.transaction((startRequestId: string, slotId: string, manualTest = false) => {
    const previous = db.prepare('SELECT * FROM capture_sessions WHERE start_request_id=?').get(startRequestId) as SessionRow | undefined;
    if (previous) {
      const saved = readSession(db, previous.id);
      if (previous.slot_id !== slotId || !!(saved.snapshot.testPhotoIds || saved.snapshot.testPhotoId) !== manualTest) throw new HttpError(409, 'START_CONFLICT', 'Этот запрос уже относится к другому сюжету');
      return { created: false, value: receipt(previous) };
    }
    // Read the current visibility/config under the same write transaction as numbering.
    const snapshot = snapshotSlot(db, slotId, manualTest);
    const createdAt = now(); const date = eventDate(createdAt);
    db.prepare('INSERT INTO events(date,next_number) VALUES (?,1) ON CONFLICT(date) DO NOTHING').run(date);
    if (db.prepare('SELECT 1 FROM events WHERE date=? AND deleting=1').get(date)) throw new HttpError(409, 'EVENT_DELETING', 'Мероприятие удаляется');
    const { number } = db.prepare('UPDATE events SET next_number=next_number+1 WHERE date=? RETURNING next_number-1 AS number').get(date) as { number: number };
    const row: SessionRow = {
      id: randomUUID(), start_request_id: startRequestId, event_date: date, number,
      slot_id: slotId, snapshot: JSON.stringify(snapshot), state: 'capturing', created_at: createdAt,
    };
    db.prepare('INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at) VALUES (@id,@start_request_id,@event_date,@number,@slot_id,@snapshot,@state,@created_at)').run(row);
    return { created: true, value: receipt(row) };
  });
  app.post('/api/capture/sessions', { preHandler: access.requireInstallation }, (request, reply) => {
    const { startRequestId, slotId } = startSchema.parse(request.body);
    const result = start.immediate(startRequestId, slotId);
    return reply.code(result.created ? 201 : 200).send(result.value);
  });
  app.get('/api/capture/sessions/:id/guides/:number', { preHandler: access.requireInstallation }, async (request, reply) => {
    const { id, number } = sessionParams.extend({ number: z.coerce.number().int().min(1).max(5) }).parse(request.params);
    const session = readSession(db, id);
    const guide = session.snapshot.posePlan?.find(pose => pose.guideNumber === number && pose.guideMediaId);
    if (!guide?.guideMediaId) throw new HttpError(404, 'NOT_FOUND', 'Образец ракурса не задан для этой сессии');
    return sendMedia(dataDir, readMedia(db, guide.guideMediaId), request, reply);
  });
  app.get('/api/capture/sessions/:id/thumbnail', { preHandler: access.requireInstallation }, async (request, reply) => {
    const { id } = sessionParams.parse(request.params);
    const session = readSession(db, id);
    return sendMedia(dataDir, readMedia(db, session.snapshot.thumbnailId), request, reply);
  });
  app.get('/api/capture/sessions/:id', { preHandler: access.requireInstallation }, request => {
    const { id } = sessionParams.parse(request.params);
    return captureStatus(db, id);
  });
  async function storePhoto(id: string, poseIndex: number, write: (path: string) => Promise<void>) {
    requireCapturing(db, id, poseIndex);
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
      previous = db.transaction(() => {
        requireCapturing(db, id, poseIndex);
        const old = db.prepare('SELECT path FROM capture_photos WHERE session_id=? AND pose_index=?').get(id, poseIndex) as { path: string } | undefined;
        db.prepare(`INSERT INTO capture_photos(session_id,pose_index,path,size,width,height) VALUES (?,?,?,?,?,?)
          ON CONFLICT(session_id,pose_index) DO UPDATE SET path=excluded.path,size=excluded.size,width=excluded.width,height=excluded.height`).run(id, poseIndex, relative, size, width, height);
        return old;
      }).immediate();
    } catch (error) { await rm(path, { force: true }); throw error; }
    if (previous) await rm(join(dataDir, 'media', previous.path), { force: true }).catch(() => app.log.warn({ code: 'PHOTO_CLEANUP_FAILED' }, 'Не удалён заменённый снимок'));
    return captureStatus(db, id);
  }
  app.put('/api/capture/sessions/:id/photos/:poseIndex', { preHandler: access.requireInstallation }, async request => {
    const { id, poseIndex } = photoParams.parse(request.params);
    requireCapturing(db, id, poseIndex);
    if (!request.isMultipart()) throw new HttpError(415, 'INVALID_PHOTO', 'Передайте JPEG в multipart-поле file');
    return storePhoto(id, poseIndex, async path => {
      let received = false;
      for await (const part of request.parts({ limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_PHOTO_BYTES } })) {
        if (part.type !== 'file' || part.fieldname !== 'file' || part.mimetype !== 'image/jpeg') throw new HttpError(400, 'INVALID_PHOTO', 'Передайте один JPEG в поле file');
        await pipeline(part.file, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
        if (part.file.truncated) throw new HttpError(413, 'PHOTO_TOO_LARGE', 'JPEG превышает 20 MiB');
        received = true;
      }
      if (!received) throw new HttpError(400, 'INVALID_PHOTO', 'Не получен JPEG');
    });
  });
  const finalize = db.transaction((sessionId: string) => {
    const status = captureStatus(db, sessionId);
    if (!status.complete) throw new HttpError(409, 'INCOMPLETE_PHOTOS', 'Получены не все фотографии');
    if (status.state === 'capturing') db.prepare("UPDATE capture_sessions SET state='submit_pending' WHERE id=? AND state='capturing'").run(sessionId);
    return captureStatus(db, sessionId);
  });
  app.post('/api/capture/sessions/:id/finalize', { preHandler: access.requireInstallation }, request => {
    const { id } = sessionParams.parse(request.params);
    return finalize.immediate(id);
  });
  const preparingTests = new Set<string>();
  const testBody = z.object({ startRequestId: z.string().uuid() }).strict();
  app.post('/api/admin/slots/:id/test-generations', { preHandler: [access.requireAdmin, access.requireOrigin] }, async (request, reply) => {
    const { id: slotId } = sessionParams.parse(request.params);
    const { startRequestId } = testBody.parse(request.body);
    const started = start.immediate(startRequestId, slotId, true);
    const id = started.value.sessionId;
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
      const status = finalize.immediate(id);
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
      return captureStatus(db, id);
    } finally { preparingTests.delete(id); }
  });
  app.get('/api/admin/slots/:id/sessions/:sessionId', { preHandler: access.requireAdmin }, request => {
    const { id, sessionId } = z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }).parse(request.params);
    if (readSession(db, sessionId).slot_id !== id) throw new HttpError(404, 'NOT_FOUND', 'Сессия этого сюжета не найдена');
    return captureStatus(db, sessionId);
  });
}
