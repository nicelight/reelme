/** Module contract: staff event closure and archive projection; deletion is limited to dates before today.
 * Counts stored session-owned files once, excluding shared scenario materials.
 * Saved snapshots select thumbnails; only this session's ready video is served.
 * Deletion delegates to the shared restartable Sessions cleanup after role/date checks.
 * Saved slot material semantics: docs/slot-setup/matrix.md. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendPrivateJson } from '../http-cache.js';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import type { SlotSnapshot } from '../../shared/capture.js';
import { eventKey, type ArchiveEvent, type CurrentEvent, type EventDetails, type EventGallery } from '../../shared/events.js';
import { HttpError } from '../errors.js';
import { readMedia, sendMedia } from '../scenarios/media.js';
import { eventDate } from './index.js';
import type { createEventCleanup } from './cleanup.js';
import { videoDetails, videoDetailsColumns, type VideoDetailsRow } from './video-details.js';
import type { CostReader } from './fal-costs.js';
import { isTestVideo } from '../../shared/scenarios.js';

interface Row {
  id: string; number: number; snapshot: string; state: string;
  video_path: string | null; video_size: number | null; width: number; height: number;
}
const eventSessions = `FROM capture_sessions s LEFT JOIN generation_jobs g ON g.session_id=s.id WHERE s.event_date=? AND s.event_no=?`;
const selection = `SELECT s.id,s.number,s.snapshot,s.state,g.video_path,g.video_size,g.width,g.height ${eventSessions}`;
const hasVideo = (row: Row) => row.state === 'ready' && !!row.video_path && (row.video_size ?? 0) > 0;
export function registerEvents(app: FastifyInstance, db: DB, dataDir: string, access: Access, now: () => number, cleanup: ReturnType<typeof createEventCleanup>, costs: CostReader) {
  async function account(request: FastifyRequest, reply: FastifyReply) {
    const role = access.context(request, reply);
    if (role !== 'operator' && role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Нужен аккаунт оператора или администратора');
  }
  function parseKey(key: string) {
    const match = /^(\d{4}-\d{2}-\d{2})(?:~([1-9]\d*))?$/.exec(key);
    const eventNo = Number(match?.[2] ?? 1);
    if (!match || !Number.isSafeInteger(eventNo)) throw new HttpError(404, 'NOT_FOUND', 'Мероприятие не найдено');
    return { date: match[1], eventNo };
  }
  function requireArchived(key: string) {
    const { date, eventNo } = parseKey(key);
    const today = eventDate(now());
    const event = db.prepare('SELECT name,participant_range AS participantRange,location FROM events WHERE date=? AND event_no=? AND deleting=0 AND (date<? OR (date=? AND closed_at IS NOT NULL))')
      .get(date,eventNo,today,today) as Omit<EventDetails,'date'> | undefined;
    if (!event) throw new HttpError(404, 'NOT_FOUND', 'Мероприятие отсутствует в архиве');
    return { date, eventNo, event };
  }
  app.get('/api/events/current', { preHandler: account }, (): { event: CurrentEvent | null } => {
    const date = eventDate(now());
    const row = db.prepare('SELECT event_no,name FROM events WHERE date=? AND closed_at IS NULL AND deleting=0').get(date) as {event_no: number; name: string} | undefined;
    return { event: row ? { key: eventKey(date,row.event_no), name: row.name } : null };
  });
  app.post<{ Params: { key: string } }>('/api/events/:key/finish', { preHandler: [access.requireOrigin, account] }, (request, reply) => {
    const time = now(), { date, eventNo } = parseKey(request.params.key);
    if (date !== eventDate(time)) throw new HttpError(409, 'EVENT_CHANGED', 'День мероприятия уже завершён');
    // Repeat confirmations always address the event named in the dialog.
    const result = db.prepare('UPDATE events SET closed_at=COALESCE(closed_at,?) WHERE date=? AND event_no=? AND deleting=0').run(time,date,eventNo);
    if (!result.changes) throw new HttpError(404, 'NOT_FOUND', 'Мероприятие не найдено');
    return reply.code(204).send();
  });
  app.delete<{ Params: { key: string } }>('/api/events/:key', { preHandler: [access.requireAdmin, access.requireOrigin] }, async (request, reply) => {
    const { date, eventNo } = requireArchived(request.params.key);
    if (date >= eventDate(now())) throw new HttpError(409, 'EVENT_TODAY', 'Удаление доступно со следующего дня');
    await cleanup.remove(date,eventNo);
    return reply.code(204).send();
  });
  app.get('/api/admin/event-preparation', { preHandler: access.requireAdmin }, async () => cleanup.preview());
  app.post<{ Body: { through?: string } }>('/api/admin/event-preparation', { preHandler: [access.requireAdmin, access.requireOrigin] }, async (request, reply) => {
    const view = cleanup.prepare(request.body?.through);
    return reply.code(view.operation?.running ? 202 : 200).send(view);
  });
  app.get('/api/events', { preHandler: account }, (request, reply) => {
    // UNION groups by path before summing, so neither joins nor shared inputs multiply files.
    const today = eventDate(now());
    const rows = db.prepare(`WITH files AS (
      SELECT s.event_date,s.event_no,p.path,p.size,'image' AS kind FROM capture_sessions s JOIN capture_photos p ON p.session_id=s.id
      UNION SELECT s.event_date,s.event_no,g.frame_path,g.frame_size,'image' FROM capture_sessions s JOIN generation_jobs g ON g.session_id=s.id WHERE g.frame_path IS NOT NULL AND g.frame_size IS NOT NULL
      UNION SELECT s.event_date,s.event_no,g.video_path,g.video_size,'video' FROM capture_sessions s JOIN generation_jobs g ON g.session_id=s.id WHERE g.video_path IS NOT NULL AND g.video_size IS NOT NULL
    ) SELECT e.date,e.event_no,e.name,e.participant_range AS participantRange,e.location,COALESCE(SUM(CASE WHEN f.kind='image' THEN f.size ELSE 0 END),0) AS photoBytes,
      COALESCE(SUM(CASE WHEN f.kind='video' THEN f.size ELSE 0 END),0) AS videoBytes
      FROM events e LEFT JOIN files f ON f.event_date=e.date AND f.event_no=e.event_no
      WHERE (e.date<? OR (e.date=? AND e.closed_at IS NOT NULL)) AND e.deleting=0
      GROUP BY e.date,e.event_no ORDER BY e.date DESC,e.event_no DESC`).all(today,today) as (ArchiveEvent & {event_no: number})[];
    const events: ArchiveEvent[] = rows.map(({event_no, ...event}) => ({...event, ...(event_no > 1 && {eventNo: event_no}), ...(event.date === today && {closedToday: true})}));
    return sendPrivateJson(request, reply, events);
  });
  app.get<{ Params: { key: string } }>('/api/events/:key', { preHandler: account }, (request, reply) => {
    const key = request.params.key;
    const { date, eventNo, event } = requireArchived(key);
    const rows = db.prepare(`${selection} ORDER BY s.number,s.id`).all(date,eventNo) as Row[];
    const gallery: EventGallery = { ...event, date, ...(eventNo > 1 && {eventNo}), sessions: rows.map(row => {
      const snapshot = JSON.parse(row.snapshot) as SlotSnapshot;
      const base = `/api/events/${key}/${row.id}`;
      return { id: row.id, number: row.number, description: snapshot.description,
        ...(isTestVideo(snapshot.generation) ? { testVideo: true as const } : {}),
        thumbnailUrl: `${base}/thumbnail`, videoUrl: hasVideo(row) ? `${base}/video` : null };
    }) };
    return sendPrivateJson(request, reply, gallery);
  });
  app.get<{ Params: { key: string; id: string } }>('/api/events/:key/:id/video-details', { preHandler: account }, (request, reply) => {
    const { date, eventNo } = requireArchived(request.params.key);
    const row = db.prepare(`SELECT ${videoDetailsColumns} ${eventSessions}
      AND s.id=? AND s.state='ready' AND g.video_path IS NOT NULL AND g.video_size>0`)
      .get(date, eventNo, request.params.id) as VideoDetailsRow | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Готовое видео недоступно в этом мероприятии');
    return sendPrivateJson(request, reply, videoDetails(row, costs));
  });
  for (const kind of ['thumbnail', 'video'] as const) {
    app.get<{ Params: { key: string; id: string } }>(`/api/events/:key/:id/${kind}`, { preHandler: account }, async (request, reply) => {
      const { id } = request.params;
      const { date, eventNo } = requireArchived(request.params.key);
      const row = db.prepare(`${selection} AND s.id=?`).get(date,eventNo,id) as Row | undefined;
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Фотосессия отсутствует в мероприятии');
      if (kind === 'thumbnail') {
        const snapshot = JSON.parse(row.snapshot) as SlotSnapshot;
        return sendMedia(dataDir, readMedia(db, snapshot.thumbnailId), request, reply, 'inline', 'Cookie');
      }
      if (!hasVideo(row)) throw new HttpError(404, 'NOT_FOUND', 'Готового видео пока нет');
      return sendMedia(dataDir, { id, path: row.video_path!, size: row.video_size!, kind: 'video', mime: 'video/mp4', width: row.width, height: row.height }, request, reply, 'inline', 'Cookie');
    });
  }
}
