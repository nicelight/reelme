/** Module contract: read-only projection of currently visible slots for the
 * installation and the public promo page. Public routes never start capture.
 * Media access is restricted to that visible slot's thumbnail and preview;
 * editor references/settings and hidden or replaced media are not catalog data.
 * V2V drafts without a source cannot be started. Source: docs/slot-setup/matrix.md. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Access } from '../access/index.js';
import type { DB } from '../db.js';
import type { Slot } from '../../shared/scenarios.js';
import type { CatalogPage } from '../../shared/capture.js';
import { catalogItem, visibleSlot } from './store.js';
import { readMedia, sendMedia } from './media.js';
import { HttpError } from '../errors.js';
const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).strict();
const available = "json_extract(config,'$.visible')=1 AND (json_extract(config,'$.mode')<>'V2V' OR json_extract(config,'$.videoId') IS NOT NULL)";
export function registerCatalog(app: FastifyInstance, db: DB, dataDir: string, access: Access) {
  function list(request: FastifyRequest): CatalogPage {
    const { page } = pageQuery.parse(request.query);
    const pageSize = 12;
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM slots WHERE ${available}`).get() as { total: number };
    const rows = db.prepare(`SELECT id,config FROM slots WHERE ${available} ORDER BY rowid LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize) as { id: string; config: string }[];
    const result: CatalogPage = {
      items: rows.map(row => catalogItem(db, { ...JSON.parse(row.config), id: row.id } as Slot)),
      page, pageSize, total, totalPages: Math.ceil(total / pageSize),
    };
    return result;
  }
  app.get('/api/catalog', { preHandler: access.requireInstallation }, list);
  app.get('/api/public/catalog', list);
  app.get<{ Params: { id: string } }>('/api/catalog/:id', { preHandler: access.requireInstallation }, request => catalogItem(db, visibleSlot(db, request.params.id)));
  async function media(request: FastifyRequest<{ Params: { id: string; mediaId: string } }>, reply: FastifyReply) {
    const item = catalogItem(db, visibleSlot(db, request.params.id));
    if (request.params.mediaId !== item.thumbnailId && request.params.mediaId !== item.previewId) throw new HttpError(404, 'NOT_FOUND', 'Материал не найден');
    return sendMedia(dataDir, readMedia(db, request.params.mediaId), request, reply);
  }
  app.get<{ Params: { id: string; mediaId: string } }>('/api/catalog/:id/media/:mediaId', { preHandler: access.requireInstallation }, media);
  app.get<{ Params: { id: string; mediaId: string } }>('/api/public/catalog/:id/media/:mediaId', media);
}
