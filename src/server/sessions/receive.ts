/** Module contract: Sessions publishes a verified local result and its two distinct
 * capabilities atomically. Receive grants only its own form/photo/frame; download
 * grants only its video. Email acceptance owns first confirmation and pending,
 * never SMTP or sent. Neither opening nor retry changes the first confirmation.
 * Deleting events issue no capabilities or ready publication. Ready cards are internal projections for the authenticated display/archive. */
import { sessionAvailable } from './availability.js';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { HttpError } from '../errors.js';
import { sendMedia } from '../scenarios/media.js';
import type { EmailState, ReadyCard, ReceiveStatus } from '../../shared/receive.js';

const run = promisify(execFile);
interface Delivery {
  session_id: string; number: number; receive_token: string; download_token: string;
  email_state: EmailState; opened_at: number | null; email_confirmed_at: number | null;
}
interface FileRow { path: string; size: number; width: number; height: number }
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const missing = () => new HttpError(404, 'NOT_FOUND', 'Ссылка недоступна. Обратитесь к сотруднику.');
function delivery(db: DB, token: string, kind: 'receive' | 'download'): Delivery {
  if (!tokenPattern.test(token)) throw missing();
  const row = db.prepare(`SELECT d.*,s.number FROM session_delivery d JOIN capture_sessions s ON s.id=d.session_id WHERE d.${kind}_token=? AND s.state='ready' AND EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.deleting=0)`).get(token) as Delivery | undefined;
  if (!row) throw missing();
  return row;
}
function status(row: Delivery): ReceiveStatus {
  return { number: row.number, photoUrl: `/api/receive/${row.receive_token}/photo`, emailState: row.email_state,
    canSubmit: row.email_state === 'not_requested' || row.email_state === 'failed', openedAt: row.opened_at, emailConfirmedAt: row.email_confirmed_at };
}
export function readyCard(db: DB, origin: string, sessionId: string): ReadyCard | undefined {
  const row = db.prepare("SELECT d.*,s.number FROM session_delivery d JOIN capture_sessions s ON s.id=d.session_id WHERE s.id=? AND s.state='ready' AND EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.deleting=0)").get(sessionId) as Delivery | undefined;
  if (!row) return undefined;
  const base = `${origin}/api/receive/${row.receive_token}`;
  return { number: row.number, photoUrl: `${base}/photo`, frameUrl: `${base}/frame`, receiveUrl: `${origin}/receive/${row.receive_token}` };
}

/** Rechecks persisted files before publication, including recovery after restart.
 * Ordinary generation already decoded them; the recheck closes the saved-file
 * boundary before issuing permanent capabilities. No remote access or SQL awaits. */
export async function publishReady(db: DB, dataDir: string, sessionId: string) {
  const row = db.prepare(`SELECT g.* FROM generation_jobs g JOIN capture_sessions s ON s.id=g.session_id WHERE s.id=? AND s.state='preparing' AND EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.deleting=0) AND g.video_path IS NOT NULL`).get(sessionId) as { video_path: string; frame_path: string; video_size: number; frame_size: number } | undefined;
  if (!row) return;
  try {
    const video = join(dataDir, 'media', row.video_path);
    const frame = join(dataDir, 'media', row.frame_path);
    const photo = db.prepare('SELECT path FROM capture_photos WHERE session_id=? AND pose_index=0').get(sessionId) as { path: string } | undefined;
    if (!photo || !row.video_size || !row.frame_size || (await stat(video)).size !== row.video_size || (await stat(frame)).size !== row.frame_size) throw new Error('Missing files');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov', '-i', video, '-map', '0:v:0', '-f', 'null', '-'], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    await sharp(frame, { failOn: 'warning' }).stats();
    await sharp(join(dataDir, 'media', photo.path), { failOn: 'warning' }).stats();
    db.transaction(() => {
      if (!sessionAvailable(db, sessionId)) return;
      db.prepare('INSERT INTO session_delivery(session_id,receive_token,download_token) VALUES (?,?,?) ON CONFLICT(session_id) DO NOTHING').run(sessionId, randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url'));
      db.prepare("UPDATE capture_sessions SET state='ready' WHERE id=? AND state='preparing'").run(sessionId);
      db.prepare('UPDATE generation_jobs SET error_code=NULL,error_message=NULL WHERE session_id=?').run(sessionId);
    }).immediate();
  } catch {
    db.transaction(() => {
      if (!sessionAvailable(db, sessionId)) return;
      db.prepare("UPDATE capture_sessions SET state='failed' WHERE id=? AND state='preparing'").run(sessionId);
      db.prepare("UPDATE generation_jobs SET error_code='INVALID_RESULT',error_message='Результат недоступен. Обратитесь к сотруднику.' WHERE session_id=?").run(sessionId);
    }).immediate();
  }
}

export function registerReceive(app: FastifyInstance, db: DB, dataDir: string, clientDir: string, now: () => number) {
  app.get<{ Params: { token: string } }>('/receive/:token', async (request, reply) => {
    delivery(db, request.params.token, 'receive');
    const html = await readFile(join(clientDir, 'index.html'), 'utf8');
    // The shared Vite entry uses relative assets for the localhost capture loader.
    return reply.type('text/html').header('Cache-Control', 'private, no-store').send(html.replace('<head>', '<head><base href="/">'));
  });
  app.get<{ Params: { token: string } }>('/api/receive/:token', request => status(delivery(db, request.params.token, 'receive')));
  app.post<{ Params: { token: string } }>('/api/receive/:token/opened', request => {
    const row = delivery(db, request.params.token, 'receive');
    db.prepare('UPDATE session_delivery SET opened_at=COALESCE(opened_at,?) WHERE session_id=?').run(now(), row.session_id);
    return status(delivery(db, request.params.token, 'receive'));
  });
  const emailInput = z.object({ email: z.string().trim().max(254).email('Введите корректный email') }).strict();
  const acceptEmail = db.transaction((token: string, email: string) => {
    const row = delivery(db, token, 'receive');
    if (!['not_requested', 'failed'].includes(row.email_state)) throw new HttpError(409, 'EMAIL_ALREADY_REQUESTED', 'Письмо уже ожидает отправки, отправляется или отправлено.');
    const time = now();
    db.prepare(`UPDATE session_delivery SET email=?,email_state='pending',email_error=NULL,sent_at=NULL,
      opened_at=COALESCE(opened_at,?),email_confirmed_at=COALESCE(email_confirmed_at,?) WHERE session_id=?`).run(email, time, time, row.session_id);
    return status(delivery(db, token, 'receive'));
  });
  app.post<{ Params: { token: string } }>('/api/receive/:token/email', request => {
    delivery(db, request.params.token, 'receive');
    return acceptEmail.immediate(request.params.token, emailInput.parse(request.body).email);
  });
  for (const kind of ['photo', 'frame'] as const) {
    app.get<{ Params: { token: string } }>(`/api/receive/:token/${kind}`, async (request, reply) => {
      const row = delivery(db, request.params.token, 'receive');
      const file = (kind === 'photo'
        ? db.prepare('SELECT path,size,width,height FROM capture_photos WHERE session_id=? AND pose_index=0')
        : db.prepare('SELECT frame_path AS path,frame_size AS size,width,height FROM generation_jobs WHERE session_id=?')).get(row.session_id) as FileRow | undefined;
      if (!file) throw missing();
      return sendMedia(dataDir, { ...file, id: row.session_id, kind: 'image', mime: 'image/jpeg' }, request, reply);
    });
  }
  app.get<{ Params: { token: string } }>('/download/:token', async (request, reply) => {
    const row = delivery(db, request.params.token, 'download');
    const file = db.prepare('SELECT video_path AS path FROM generation_jobs WHERE session_id=?').get(row.session_id) as { path: string };
    const path = join(dataDir, 'media', file.path);
    let size: number;
    try { size = (await stat(path)).size; } catch { throw missing(); }
    return reply.type('video/mp4').header('Cache-Control', 'private, no-store').header('Content-Length', size)
      .header('Content-Disposition', `attachment; filename="reelme-${row.number}.mp4"`).send(createReadStream(path));
  });
}
