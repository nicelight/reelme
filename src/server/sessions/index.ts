/** Module contract: Sessions owns session start, daily numbering and accepted JPEGs.
 * A single SQLite transaction fixes Novosibirsk date, unique number and a value
 * snapshot from Scenarios. Repeated startRequestId returns the saved receipt,
 * including across edits, hidden slots and midnight. Photo bytes are written and
 * decoded before a short DB transaction publishes one position. Finalize changes
 * capturing to submit_pending once, only for a complete set; later photo writes
 * are refused, including uploads that started before finalize. No camera/fal calls. */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { snapshotSlot } from '../scenarios/store.js';
import { photoPoses, type StartReceipt, type SlotSnapshot, type SessionState, type CaptureStatus } from '../../shared/capture.js';
import { HttpError } from '../errors.js';

interface SessionRow {
  id: string; start_request_id: string; event_date: string; number: number;
  slot_id: string; snapshot: string; state: SessionState; created_at: number;
}
const startSchema = z.object({ startRequestId: z.string().uuid(), slotId: z.string().uuid() }).strict();
const sessionParams = z.object({ id: z.string().uuid() });
const photoParams = sessionParams.extend({ poseIndex: z.string().regex(/^[0-3]$/).transform(Number) });
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Novosibirsk', year: 'numeric', month: '2-digit', day: '2-digit' });
export function eventDate(timestamp: number): string {
  const fields = Object.fromEntries(dateFormatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
function receipt(row: SessionRow): StartReceipt {
  const snapshot = JSON.parse(row.snapshot) as SlotSnapshot;
  return { sessionId: row.id, date: row.event_date, number: row.number, state: row.state, posePlan: photoPoses.slice(0, snapshot.expectedPhotos).map(pose => ({ ...pose })) };
}
export function readSession(db: DB, sessionId: string) {
  const row = db.prepare('SELECT * FROM capture_sessions WHERE id=?').get(sessionId) as SessionRow | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Сессия не найдена');
  return { ...row, snapshot: JSON.parse(row.snapshot) as SlotSnapshot };
}
export function captureStatus(db: DB, sessionId: string): CaptureStatus {
  const session = readSession(db, sessionId);
  const acceptedPoseIndices = (db.prepare('SELECT pose_index FROM capture_photos WHERE session_id=? ORDER BY pose_index').all(sessionId) as { pose_index: number }[]).map(row => row.pose_index);
  const posePlan = photoPoses.slice(0, session.snapshot.expectedPhotos).map(pose => ({ ...pose }));
  const complete = acceptedPoseIndices.length === posePlan.length && posePlan.every(pose => acceptedPoseIndices.includes(pose.index));
  return { sessionId, date: session.event_date, number: session.number, state: session.state, posePlan, acceptedPoseIndices, complete, finalized: complete && session.state !== 'capturing' };
}
function requireCapturing(db: DB, sessionId: string, poseIndex: number) {
  const session = readSession(db, sessionId);
  if (session.state !== 'capturing') throw new HttpError(409, 'CAPTURE_CLOSED', 'Фотографии уже переданы на обработку');
  if (poseIndex >= session.snapshot.expectedPhotos) throw new HttpError(400, 'INVALID_POSE', 'Эта позиция не входит в план съёмки');
}
async function inspectPhoto(path: string) {
  try {
    const image = sharp(path, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const meta = await image.metadata();
    if (meta.format !== 'jpeg' || !meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error();
    await image.stats();
    return { width: meta.width, height: meta.height };
  } catch { throw new HttpError(400, 'INVALID_PHOTO', 'Нужен корректный JPEG до 40 мегапикселей'); }
}
export function registerSessions(app: FastifyInstance, db: DB, dataDir: string, access: Access, now: () => number) {
  const start = db.transaction((startRequestId: string, slotId: string) => {
    const previous = db.prepare('SELECT * FROM capture_sessions WHERE start_request_id=?').get(startRequestId) as SessionRow | undefined;
    if (previous) {
      if (previous.slot_id !== slotId) throw new HttpError(409, 'START_CONFLICT', 'Этот запрос уже относится к другому сюжету');
      return { created: false, value: receipt(previous) };
    }
    // Read the current visibility/config under the same write transaction as numbering.
    const snapshot = snapshotSlot(db, slotId);
    const createdAt = now(); const date = eventDate(createdAt);
    db.prepare('INSERT INTO events(date,next_number) VALUES (?,1) ON CONFLICT(date) DO NOTHING').run(date);
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
  app.get('/api/capture/sessions/:id', { preHandler: access.requireInstallation }, request => {
    const { id } = sessionParams.parse(request.params);
    return captureStatus(db, id);
  });
  app.put('/api/capture/sessions/:id/photos/:poseIndex', { preHandler: access.requireInstallation }, async request => {
    const { id, poseIndex } = photoParams.parse(request.params);
    requireCapturing(db, id, poseIndex);
    if (!request.isMultipart()) throw new HttpError(415, 'INVALID_PHOTO', 'Передайте JPEG в multipart-поле file');
    // Unique path per attempt: never overwrite a file that finalize may have accepted.
    const relative = `sessions/${id}/${randomUUID()}.jpg`;
    const directory = join(dataDir, 'media', 'sessions', id);
    const path = join(dataDir, 'media', relative);
    let previous: { path: string } | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      let received = false;
      for await (const part of request.parts({ limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_PHOTO_BYTES } })) {
        if (part.type !== 'file' || part.fieldname !== 'file' || part.mimetype !== 'image/jpeg') throw new HttpError(400, 'INVALID_PHOTO', 'Передайте один JPEG в поле file');
        await pipeline(part.file, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
        if (part.file.truncated) throw new HttpError(413, 'PHOTO_TOO_LARGE', 'JPEG превышает 20 MiB');
        received = true;
      }
      if (!received) throw new HttpError(400, 'INVALID_PHOTO', 'Не получен JPEG');
      const { width, height } = await inspectPhoto(path);
      const { size } = await stat(path);
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
}
