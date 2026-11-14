/** Module contract: account-only read projection of past Novosibirsk events.
 * Counts stored session-owned files once, excluding shared scenario materials.
 * Saved snapshots select thumbnails; only this session's ready video is served.
 * Never changes generation/delivery state, opens visitor forms or deletes files. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import type { SlotSnapshot } from '../../shared/capture.js';
import type { ArchiveEvent, EventGallery } from '../../shared/events.js';
import { HttpError } from '../errors.js';
import { readMedia, sendMedia } from '../scenarios/media.js';
import { eventDate } from './index.js';

interface Row {
  id: string; number: number; snapshot: string; state: string;
  video_path: string | null; video_size: number | null; width: number; height: number;
}
const selection = `SELECT s.id,s.number,s.snapshot,s.state,g.video_path,g.video_size,g.width,g.height
  FROM capture_sessions s LEFT JOIN generation_jobs g ON g.session_id=s.id WHERE s.event_date=?`;
const hasVideo = (row: Row) => row.state === 'ready' && !!row.video_path && (row.video_size ?? 0) > 0;
export function registerEvents(app: FastifyInstance, db: DB, dataDir: string, access: Access, now: () => number) {
  async function account(request: FastifyRequest, reply: FastifyReply) {
    const role = access.context(request, reply);
    if (role !== 'operator' && role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Нужен аккаунт оператора или администратора');
  }
  function requirePast(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= eventDate(now()) || !db.prepare('SELECT 1 FROM events WHERE date=?').get(date)) {
      throw new HttpError(404, 'NOT_FOUND', 'Мероприятие отсутствует в архиве');
    }
  }
  app.get('/api/events', { preHandler: account }, (): ArchiveEvent[] => {
    // UNION groups by path before summing, so neither joins nor shared inputs multiply files.
    return db.prepare(`WITH files AS (
      SELECT s.event_date,p.path,p.size,'image' AS kind FROM capture_sessions s JOIN capture_photos p ON p.session_id=s.id
      UNION SELECT s.event_date,g.frame_path,g.frame_size,'image' FROM capture_sessions s JOIN generation_jobs g ON g.session_id=s.id WHERE g.frame_path IS NOT NULL AND g.frame_size IS NOT NULL
      UNION SELECT s.event_date,g.video_path,g.video_size,'video' FROM capture_sessions s JOIN generation_jobs g ON g.session_id=s.id WHERE g.video_path IS NOT NULL AND g.video_size IS NOT NULL
    ) SELECT e.date,COALESCE(SUM(CASE WHEN f.kind='image' THEN f.size ELSE 0 END),0) AS photoBytes,
      COALESCE(SUM(CASE WHEN f.kind='video' THEN f.size ELSE 0 END),0) AS videoBytes
      FROM events e LEFT JOIN files f ON f.event_date=e.date WHERE e.date<? GROUP BY e.date ORDER BY e.date DESC`).all(eventDate(now())) as ArchiveEvent[];
  });
  app.get<{ Params: { date: string } }>('/api/events/:date', { preHandler: account }, (request): EventGallery => {
    const { date } = request.params; requirePast(date);
    const rows = db.prepare(`${selection} ORDER BY s.number,s.id`).all(date) as Row[];
    return { date, sessions: rows.map(row => {
      const snapshot = JSON.parse(row.snapshot) as SlotSnapshot;
      const base = `/api/events/${date}/${row.id}`;
      return { id: row.id, number: row.number, description: snapshot.description,
        thumbnailUrl: `${base}/thumbnail`, videoUrl: hasVideo(row) ? `${base}/video` : null };
    }) };
  });
  for (const kind of ['thumbnail', 'video'] as const) {
    app.get<{ Params: { date: string; id: string } }>(`/api/events/:date/:id/${kind}`, { preHandler: account }, async (request, reply) => {
      const { date, id } = request.params; requirePast(date);
      const row = db.prepare(`${selection} AND s.id=?`).get(date, id) as Row | undefined;
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Фотосессия отсутствует в мероприятии');
      if (kind === 'thumbnail') {
        const snapshot = JSON.parse(row.snapshot) as SlotSnapshot;
        return sendMedia(dataDir, readMedia(db, snapshot.thumbnailId), request, reply);
      }
      if (!hasVideo(row)) throw new HttpError(404, 'NOT_FOUND', 'Готового видео пока нет');
      return sendMedia(dataDir, { id, path: row.video_path!, size: row.video_size!, kind: 'video', mime: 'video/mp4', width: row.width, height: row.height }, request, reply);
    });
  }
}
