/** Publishes ready and its tokens only after video, frame, photo and saved QR exist.
 * Saved JPEGs must decode completely; their statistics are not needed for publication.
 * Receive/download tokens grant access only to their session and intended media.
 * Opening and email confirmation are separate events; retries preserve their first times.
 * Deleting events cannot publish or issue capabilities. */
import { sessionAvailable } from './availability.js';
import { recordHistory } from './history.js';
import type { Access } from '../access/index.js';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectJpeg, makeDisplayCover } from './jpeg.js';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { HttpError } from '../errors.js';
import { inspectMedia, sendMedia } from '../scenarios/media.js';
import type { EmailState, ReadyCard, ReceiveStatus } from '../../shared/receive.js';

interface Delivery {
  session_id: string; number: number; receive_token: string; download_token: string;
  email_state: EmailState; opened_at: number | null; email_confirmed_at: number | null;
}
interface FileRow { path: string; size: number; width: number; height: number }
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const missing = () => new HttpError(404, 'NOT_FOUND', 'Ссылка недоступна. Обратитесь к сотруднику.');
function delivery(db: DB, token: string, kind: 'receive' | 'download'): Delivery {
  if (!tokenPattern.test(token)) throw missing();
  const row = db.prepare(`SELECT d.*,s.number FROM session_delivery d JOIN capture_sessions s ON s.id=d.session_id WHERE d.${kind}_token=? AND s.state='ready' AND EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.event_no=s.event_no AND e.deleting=0)`).get(token) as Delivery | undefined;
  if (!row) throw missing();
  return row;
}
function status(row: Delivery): ReceiveStatus {
  return { number: row.number, photoUrl: `/api/receive/${row.receive_token}/photo`, emailState: row.email_state,
    videoUrl: `/download/${row.download_token}?inline=1`, downloadUrl: `/download/${row.download_token}`,
    canSubmit: row.email_state === 'not_requested' || row.email_state === 'failed', openedAt: row.opened_at, emailConfirmedAt: row.email_confirmed_at };
}
export function readyCard(db: DB, origin: string, sessionId: string): ReadyCard | undefined {
  const row = db.prepare("SELECT d.*,s.number FROM session_delivery d JOIN capture_sessions s ON s.id=d.session_id WHERE s.id=? AND s.state='ready' AND EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.event_no=s.event_no AND e.deleting=0)").get(sessionId) as Delivery | undefined;
  if (!row) return undefined;
  const base = `${origin}/api/receive/${row.receive_token}`;
  return { number: row.number, photoUrl: `${base}/photo`, frameUrl: `${base}/frame`, receiveUrl: `${origin}/receive/${row.receive_token}` };
}

/** Checks saved assets before issuing capabilities. A freshly prepared MP4 was
 * probed during frame extraction; recovery reopens its container metadata. */
export async function publishReady(db: DB, dataDir: string, sessionId: string, origin: string, now: () => number = Date.now, freshlyPrepared = false) {
  const row = db.prepare(`SELECT g.* FROM generation_jobs g JOIN capture_sessions s ON s.id=g.session_id WHERE s.id=? AND s.state='preparing' AND EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.event_no=s.event_no AND e.deleting=0) AND g.video_path IS NOT NULL`).get(sessionId) as { video_path: string; frame_path: string; video_size: number; frame_size: number } | undefined;
  if (!row) return;
  let phase = 'validating';
  recordHistory(db, sessionId, 'server', 'delivery.publish', phase, 'started', {}, now);
  try {
    const video = join(dataDir, 'media', row.video_path);
    const frame = join(dataDir, 'media', row.frame_path);
    const photo = db.prepare('SELECT path FROM capture_photos WHERE session_id=? AND pose_index=0').get(sessionId) as { path: string } | undefined;
    if (!photo || !row.video_size || !row.frame_size || (await stat(video)).size !== row.video_size || (await stat(frame)).size !== row.frame_size) throw new Error('Missing files');
    if (!freshlyPrepared) await inspectMedia(video, 'video/mp4');
    await inspectJpeg(frame);
    const photoPath = join(dataDir, 'media', photo.path);
    await inspectJpeg(photoPath);
    const cover = await makeDisplayCover(photoPath);
    await writeFile(join(dataDir, 'media', 'sessions', sessionId, 'cover.jpg'), cover, { mode: 0o600 });
    const tokens = db.prepare('SELECT receive_token,download_token FROM session_delivery WHERE session_id=?').get(sessionId) as Pick<Delivery, 'receive_token' | 'download_token'> | undefined;
    const receiveToken = tokens?.receive_token ?? randomBytes(32).toString('base64url');
    const downloadToken = tokens?.download_token ?? randomBytes(32).toString('base64url');
    phase = 'creating_qr';
    recordHistory(db, sessionId, 'server', 'delivery.publish', phase, 'started', {}, now);
    const qr = await QRCode.toBuffer(`${origin}/receive/${receiveToken}`, { errorCorrectionLevel: 'M', margin: 4, scale: 6 });
    // The prepared directory already exists. Never recreate one removed by cleanup.
    await writeFile(join(dataDir, 'media', 'sessions', sessionId, 'qr.png'), qr, { mode: 0o600 });
    const published = db.transaction(() => {
      if (!sessionAvailable(db, sessionId)) return;
      if (!db.prepare("UPDATE capture_sessions SET state='ready' WHERE id=? AND state='preparing'").run(sessionId).changes) return;
      db.prepare('INSERT INTO session_delivery(session_id,receive_token,download_token) VALUES (?,?,?) ON CONFLICT(session_id) DO NOTHING').run(sessionId, receiveToken, downloadToken);
      db.prepare('UPDATE generation_jobs SET ready_at=COALESCE(ready_at,?),error_code=NULL,error_message=NULL WHERE session_id=?').run(now(), sessionId);
      return true;
    }).immediate();
    if (published) recordHistory(db, sessionId, 'server', 'delivery.publish', 'ready', 'succeeded', {}, now);
  } catch {
    db.transaction(() => {
      if (!sessionAvailable(db, sessionId)) return;
      db.prepare("UPDATE capture_sessions SET state='failed' WHERE id=? AND state='preparing'").run(sessionId);
      db.prepare("UPDATE generation_jobs SET error_code='INVALID_RESULT',error_message='Результат недоступен. Обратитесь к сотруднику.' WHERE session_id=?").run(sessionId);
    }).immediate();
    recordHistory(db, sessionId, 'server', 'delivery.publish', phase, 'failed', { code: 'INVALID_RESULT' }, now);
  }
}

// The cookie can reach just one receive API. Hash its random value together with
// the session ID before retention. Missing or disabled cookies need no fallback.
function profileLabel(id: string, value: string | undefined) {
  return value && /^[a-f0-9]{24}$/.test(value)
    ? createHash('sha256').update(id + value).digest('hex').slice(0, 12)
    : undefined;
}

export function registerReceive(app: FastifyInstance, db: DB, dataDir: string, clientDir: string, now: () => number, requireOrigin: Access['requireOrigin']) {
  app.get<{ Params: { token: string } }>('/receive/:token', async (request, reply) => {
    delivery(db, request.params.token, 'receive');
    const html = await readFile(join(clientDir, 'index.html'), 'utf8');
    // The shared Vite entry uses relative assets for the localhost capture loader.
    return reply.type('text/html').header('Cache-Control', 'private, no-store').send(html.replace('<head>', '<head><base href="/">'));
  });
  app.get<{ Params: { token: string } }>('/api/receive/:token', request => status(delivery(db, request.params.token, 'receive')));
  app.post<{ Params: { token: string } }>('/api/receive/:token/opened', (request, reply) => {
    const row = delivery(db, request.params.token, 'receive');
    db.prepare('UPDATE session_delivery SET opened_at=COALESCE(opened_at,?) WHERE session_id=?').run(now(), row.session_id);
    const profile = profileLabel(row.session_id, request.cookies.reelme_receive_profile);
    if (!profile) {
      const value = randomBytes(12).toString('hex');
      reply.setCookie('reelme_receive_profile', value, { path: `/api/receive/${row.receive_token}`, httpOnly: true, sameSite: 'strict', secure: request.protocol === 'https', maxAge: 14 * 86400 });
      // A first response only offers a cookie. A later action confirms storage.
    }
    recordHistory(db, row.session_id, 'server', 'delivery.open', 'opened', 'succeeded', { profile }, now);
    return status(delivery(db, request.params.token, 'receive'));
  });
  const signalSchema = z.object({
    id: z.string().uuid(),
    action: z.enum(['download_clicked','share_started','share_returned','share_cancelled','share_failed']),
  }).strict();
  app.post<{ Params: { token: string } }>('/api/receive/:token/activity', {
    preHandler: requireOrigin, bodyLimit: 512, config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, (request, reply) => {
    const row = delivery(db, request.params.token, 'receive');
    const { id, action } = signalSchema.parse(request.body);
    const outcome = action === 'share_returned' ? 'succeeded' : action === 'share_cancelled' ? 'cancelled' : action === 'share_failed' ? 'failed' : 'started';
    const step = action === 'download_clicked' ? 'delivery.download' : 'delivery.share';
    recordHistory(db, row.session_id, 'browser', step, action, outcome, {
      profile: profileLabel(row.session_id, request.cookies.reelme_receive_profile), operationId: id,
    }, now, id + ':' + action);
    return reply.code(204).send();
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
    const row = delivery(db, request.params.token, 'receive');
    const accepted = acceptEmail.immediate(request.params.token, emailInput.parse(request.body).email);
    recordHistory(db, row.session_id, 'server', 'delivery.email', 'queued', 'succeeded', {
      profile: profileLabel(row.session_id, request.cookies.reelme_receive_profile),
    }, now);
    return accepted;
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
  app.get<{ Params: { token: string }; Querystring: { inline?: string; purpose?: string } }>('/download/:token', async (request, reply) => {
    const row = delivery(db, request.params.token, 'download');
    const method = request.method === 'HEAD' ? 'head' : request.query.inline === '1' ? 'player' : request.query.purpose === 'share' ? 'share_preload' : 'attachment';
    // One observation per response; 206 and aborted responses are labelled distinctly.
    // Attach before stat/sendMedia so the observed status includes file/stream errors.
    const completed = (ended: boolean) => {
      const httpStatus = reply.raw.statusCode;
      const event = !ended ? 'transfer_aborted' : httpStatus >= 400 ? 'transfer_error' : httpStatus === 206 ? 'range_served' : method === 'head' ? 'headers_served' : 'response_finished';
      recordHistory(db, row.session_id, 'server', 'delivery.download', event, ended && httpStatus < 400 ? 'succeeded' : 'failed', { method, httpStatus }, now);
    };
    const aborted = () => {
      reply.raw.removeListener('finish', finished);
      completed(false);
    };
    const finished = () => {
      reply.raw.removeListener('close', aborted);
      completed(true);
    };
    reply.raw.once('close', aborted);
    reply.raw.once('finish', finished);
    const file = db.prepare('SELECT video_path AS path,video_size AS size,width,height FROM generation_jobs WHERE session_id=?').get(row.session_id) as FileRow;
    try { await stat(join(dataDir, 'media', file.path)); } catch { throw missing(); }
    reply.header('Cache-Control', 'private, no-store');
    const disposition = request.query.inline === '1' ? 'inline' : `attachment; filename="reelme-${row.number}.mp4"`;
    return sendMedia(dataDir, { ...file, id: row.session_id, kind: 'video', mime: 'video/mp4' }, request, reply, disposition);
  });
}
