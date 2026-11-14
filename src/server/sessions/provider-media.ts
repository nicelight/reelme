/** Module contract: Sessions issues stable capability URLs for concrete owned
 * files. Tokens grant only byte access to one stored slot material or finalized
 * session photo. Paths are resolved from owner metadata, never URL/user paths.
 * No public directory or credential/cookie requirement for fal's fetches. */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { readMedia, sendMedia } from '../scenarios/media.js';
import { HttpError } from '../errors.js';

export function slotProviderUrl(db: DB, origin: string, mediaId: string): string {
  readMedia(db, mediaId);
  db.prepare('INSERT INTO provider_media(token,slot_media_id) VALUES (?,?) ON CONFLICT(slot_media_id) DO NOTHING').run(randomBytes(32).toString('base64url'), mediaId);
  const { token } = db.prepare('SELECT token FROM provider_media WHERE slot_media_id=?').get(mediaId) as { token: string };
  return `${origin}/provider-media/${token}`;
}
export function photoProviderUrl(db: DB, origin: string, sessionId: string, poseIndex: number): string {
  const photo = db.prepare("SELECT p.path FROM capture_photos p JOIN capture_sessions s ON s.id=p.session_id WHERE p.session_id=? AND p.pose_index=? AND s.state<>'capturing'").get(sessionId, poseIndex);
  if (!photo) throw new HttpError(400, 'INVALID_PHOTO', 'Нет принятого снимка');
  db.prepare('INSERT INTO provider_media(token,session_id,pose_index) VALUES (?,?,?) ON CONFLICT(session_id,pose_index) DO NOTHING').run(randomBytes(32).toString('base64url'), sessionId, poseIndex);
  const { token } = db.prepare('SELECT token FROM provider_media WHERE session_id=? AND pose_index=?').get(sessionId, poseIndex) as { token: string };
  return `${origin}/provider-media/${token}`;
}
export function registerProviderMedia(app: FastifyInstance, db: DB, dataDir: string) {
  app.get<{ Params: { token: string } }>('/provider-media/:token', async (request, reply) => {
    const { token } = request.params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, 'NOT_FOUND', 'Файл не найден');
    const row = db.prepare('SELECT slot_media_id,session_id,pose_index FROM provider_media WHERE token=?').get(token) as { slot_media_id: string | null; session_id: string | null; pose_index: number | null } | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Файл не найден');
    reply.header('Cache-Control', 'private, no-store').header('Referrer-Policy', 'no-referrer');
    if (row.slot_media_id) return sendMedia(dataDir, readMedia(db, row.slot_media_id), request, reply);
    const photo = db.prepare('SELECT path,size,width,height FROM capture_photos WHERE session_id=? AND pose_index=?').get(row.session_id, row.pose_index) as { path: string; size: number; width: number; height: number } | undefined;
    if (!photo) throw new HttpError(404, 'NOT_FOUND', 'Файл не найден');
    return sendMedia(dataDir, { ...photo, id: row.session_id!, kind: 'image', mime: 'image/jpeg' }, request, reply);
  });
}
