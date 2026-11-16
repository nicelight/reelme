/** Module contract: Scenarios owns five administrator-selected pose examples.
 * Assignments reference validated immutable images; reading returns fresh values
 * for snapshot creation. No camera or provider inputs. Source: docs/slot-setup/matrix.md. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { captureGuides, type CaptureGuide } from '../../shared/slot-setup.js';
import { HttpError } from '../errors.js';
import { readMedia } from './media.js';
export function readCaptureGuides(db: DB): CaptureGuide[] {
  const rows = db.prepare('SELECT number,media_id FROM capture_guides').all() as { number: number; media_id: string }[];
  return captureGuides.map(guide => {
    const mediaId = rows.find(row => row.number === guide.number)?.media_id;
    return { ...guide, ...(mediaId ? { mediaId } : {}) };
  });
}
export function registerCaptureGuides(app: FastifyInstance, db: DB, access: Access) {
  app.get('/api/admin/capture-guides', { preHandler: access.requireAdmin }, () => readCaptureGuides(db));
  app.put('/api/admin/capture-guides/:number', { preHandler: [access.requireAdmin, access.requireOrigin] }, request => {
    const { number } = z.object({ number: z.coerce.number().int().min(1).max(5) }).parse(request.params);
    const { mediaId } = z.object({ mediaId: z.string().uuid().nullable() }).strict().parse(request.body);
    if (mediaId) {
      if (readMedia(db, mediaId).kind !== 'image') throw new HttpError(400, 'INVALID_MEDIA', 'Образец ракурса должен быть изображением');
      db.prepare('INSERT INTO capture_guides(number,media_id) VALUES (?,?) ON CONFLICT(number) DO UPDATE SET media_id=excluded.media_id').run(number, mediaId);
    } else db.prepare('DELETE FROM capture_guides WHERE number=?').run(number);
    return readCaptureGuides(db).find(guide => guide.number === number)!;
  });
}
