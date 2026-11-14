/** Module contract: installation-only projection of currently visible slots.
 * Media access is restricted to that visible slot's thumbnail and preview;
 * editor references/settings and hidden or replaced media are not catalog data. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Access } from '../access/index.js';
import type { DB } from '../db.js';
import type { Slot } from '../../shared/scenarios.js';
import type { CatalogPage } from '../../shared/capture.js';
import { catalogItem, visibleSlot } from './store.js';
import { readMedia, sendMedia } from './media.js';
import { HttpError } from '../errors.js';
const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).strict();
export function registerCatalog(app: FastifyInstance, db: DB, dataDir: string, access: Access) {
  app.get('/api/catalog', { preHandler: access.requireInstallation }, request => {
    const { page } = pageQuery.parse(request.query);
    const pageSize = 12;
    const { total } = db.prepare("SELECT COUNT(*) AS total FROM slots WHERE json_extract(config,'$.visible')=1").get() as { total: number };
    const rows = db.prepare("SELECT id,config FROM slots WHERE json_extract(config,'$.visible')=1 ORDER BY rowid LIMIT ? OFFSET ?").all(pageSize, (page - 1) * pageSize) as { id: string; config: string }[];
    const result: CatalogPage = {
      items: rows.map(row => catalogItem({ ...JSON.parse(row.config), id: row.id } as Slot)),
      page, pageSize, total, totalPages: Math.ceil(total / pageSize),
    };
    return result;
  });
  app.get<{ Params: { id: string } }>('/api/catalog/:id', { preHandler: access.requireInstallation }, request => catalogItem(visibleSlot(db, request.params.id)));
  app.get<{ Params: { id: string; mediaId: string } }>('/api/catalog/:id/media/:mediaId', { preHandler: access.requireInstallation }, async (request, reply) => {
    const item = catalogItem(visibleSlot(db, request.params.id));
    if (request.params.mediaId !== item.thumbnailId && request.params.mediaId !== item.previewId) throw new HttpError(404, 'NOT_FOUND', 'Материал не найден');
    return sendMedia(dataDir, readMedia(db, request.params.mediaId), request, reply);
  });
}
