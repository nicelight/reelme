/** Sessions' read-only admin view of the last retained real video of a slot.
 * Stable session URLs read existing owned files, never capabilities or copies.
 * Ready/deletion/slot ownership govern every request; reads do not touch delivery
 * or retention. Legacy unknown times remain null. */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import type { LastSlotVideo } from '../../shared/scenarios.js';
import { readSlot } from '../scenarios/store.js';
import { sendMedia } from '../scenarios/media.js';
import { HttpError } from '../errors.js';

interface ResultRow {
  id: string; video_path: string; video_size: number; width: number; height: number;
  submitted_at: number | null; ready_at: number | null;
}
const selection = `SELECT s.id,g.video_path,g.video_size,g.width,g.height,g.submitted_at,g.ready_at
  FROM capture_sessions s JOIN generation_jobs g ON g.session_id=s.id JOIN events e ON e.date=s.event_date AND e.event_no=s.event_no
  WHERE s.slot_id=? AND s.state='ready' AND e.deleting=0 AND COALESCE(json_extract(s.snapshot,'$.generation.simulateGeneration'),0)=0
    AND g.video_path IS NOT NULL AND g.video_size>0`;
const params = z.object({ id: z.string().uuid() });
const timestamp = (value: number | null) => value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function registerSlotResults(app: FastifyInstance, db: DB, dataDir: string, access: Access) {
  app.get('/api/admin/slots/:id/latest-video', { preHandler: access.requireAdmin }, request => {
    const { id } = params.parse(request.params); readSlot(db, id);
    const row = db.prepare(`${selection} ORDER BY COALESCE(g.ready_at,s.created_at) DESC,s.created_at DESC,s.id DESC LIMIT 1`).get(id) as ResultRow | undefined;
    if (!row) return { video: null };
    const submittedAt = timestamp(row.submitted_at); const readyAt = timestamp(row.ready_at);
    const video: LastSlotVideo = { sessionId: row.id, videoUrl: `/api/admin/slots/${id}/results/${row.id}/video`, submittedAt, readyAt,
      elapsedMs: submittedAt !== null && readyAt !== null && readyAt >= submittedAt ? readyAt - submittedAt : null };
    return { video };
  });
  app.get('/api/admin/slots/:id/results/:sessionId/video', { preHandler: access.requireAdmin }, async (request, reply) => {
    const { id, sessionId } = params.extend({ sessionId: z.string().uuid() }).parse(request.params);
    const row = db.prepare(`${selection} AND s.id=?`).get(id, sessionId) as ResultRow | undefined;
    const missing = () => new HttpError(404, 'NOT_FOUND', 'Готовое видео этого сюжета недоступно');
    if (!row) throw missing();
    try { if (!(await stat(join(dataDir, 'media', row.video_path))).isFile()) throw missing(); } catch { throw missing(); }
    return sendMedia(dataDir, { id: row.id, path: row.video_path, kind: 'video', mime: 'video/mp4', size: row.video_size, width: row.width, height: row.height }, request, reply);
  });
}
