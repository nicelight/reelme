/** Module contract: Scenarios owns five administrator-selected pose examples.
 * Assignments reference validated immutable images; reading returns fresh values
 * for snapshot creation. No camera or provider inputs. Source: docs/slot-setup/matrix.md. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { captureGuides, maxGuideCaptionLength, type CaptureGuide } from '../../shared/slot-setup.js';
import { HttpError } from '../errors.js';
import { readMedia, sendMedia } from './media.js';
export function readCaptureGuides(db: DB): CaptureGuide[] {
  const rows = db.prepare('SELECT number,media_id,caption FROM capture_guides').all() as { number: number; media_id: string | null; caption: string | null }[];
  return captureGuides.map(guide => {
    const row = rows.find(row => row.number === guide.number);
    return { ...guide, ...(row?.media_id ? { mediaId: row.media_id } : {}), ...(row?.caption ? { caption: row.caption } : {}) };
  });
}
export function registerCaptureGuides(app: FastifyInstance, db: DB, dataDir: string, access: Access) {
  app.get('/api/capture/guides/:mediaId', { preHandler: access.requireInstallation }, (request, reply) => {
    const { mediaId } = z.object({ mediaId: z.string().uuid() }).parse(request.params);
    if (!db.prepare('SELECT 1 FROM capture_guides WHERE media_id=?').get(mediaId)) {
      throw new HttpError(404, 'NOT_FOUND', 'Образец больше не назначен');
    }
    return sendMedia(dataDir, readMedia(db, mediaId), request, reply, 'inline', 'Authorization');
  });
  app.get('/api/admin/capture-guides', { preHandler: access.requireAdmin }, () => readCaptureGuides(db));
  app.put('/api/admin/capture-guides/:number', { preHandler: [access.requireAdmin, access.requireOrigin] }, request => {
    const { number } = z.object({ number: z.coerce.number().int().min(1).max(5) }).parse(request.params);
    const { mediaId, caption } = z.object({
      mediaId: z.string().uuid().nullable().optional(),
      caption: z.string().trim().max(maxGuideCaptionLength).optional(),
    }).strict().refine(fields => Object.keys(fields).length > 0).parse(request.body);
    if (mediaId && readMedia(db, mediaId).kind !== 'image') throw new HttpError(400, 'INVALID_MEDIA', 'Образец ракурса должен быть изображением');
    db.prepare(`INSERT INTO capture_guides(number,media_id,caption) VALUES (?,?,?)
      ON CONFLICT(number) DO UPDATE SET
        media_id=CASE WHEN ? THEN excluded.media_id ELSE capture_guides.media_id END,
        caption=CASE WHEN ? THEN excluded.caption ELSE capture_guides.caption END`)
      .run(number, mediaId ?? null, caption || null, Number(mediaId !== undefined), Number(caption !== undefined));
    return readCaptureGuides(db).find(guide => guide.number === number)!;
  });
}
