/** Module contract: Scenarios owns slot configuration and immutable media links.
 * Server validates every save against the finite model rules and stored media;
 * only Access-verified admin can read/write editor data. Catalog exposes a
 * separate installation-only projection; no provider submission.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { models, slotSchema, videoProblem, type SlotInput } from '../../shared/scenarios.js';
import { readSlot } from './store.js';
import { registerCatalog } from './catalog.js';
import { HttpError } from '../errors.js';
import { readMedia, registerMedia } from './media.js';
export function registerScenarios(app: FastifyInstance, db: DB, dataDir: string, access: Access) {
  registerMedia(app, db, dataDir, access);
  registerCatalog(app, db, dataDir, access);
  function validate(body: unknown): SlotInput {
    const slot = slotSchema.parse(body);
    const image = (id: string) => { if (readMedia(db, id).kind !== 'image') throw new HttpError(400, 'INVALID_MEDIA', 'Выберите изображение'); };
    image(slot.thumbnailId);
    slot.referenceIds.forEach(image);
    if (slot.demoId && readMedia(db, slot.demoId).kind !== 'video') throw new HttpError(400, 'INVALID_MEDIA', 'Демоматериал должен быть видео');
    if (slot.videoId) {
      const problem = videoProblem(models.find(m => m.id === slot.model)!, readMedia(db, slot.videoId));
      if (problem) throw new HttpError(400, 'MODEL_LIMIT', problem);
    }
    return slot;
  }
  app.get('/api/admin/models', { preHandler: access.requireAdmin }, () => models);
  app.get('/api/admin/slots', { preHandler: access.requireAdmin }, () => {
    const rows = db.prepare('SELECT id,config FROM slots ORDER BY rowid').all() as { id: string; config: string }[];
    return rows.map(row => ({ ...JSON.parse(row.config), id: row.id }));
  });
  app.get<{ Params: { id: string } }>('/api/admin/slots/:id', { preHandler: access.requireAdmin }, request => readSlot(db, request.params.id));
  app.post('/api/admin/slots', { preHandler: [access.requireAdmin, access.requireOrigin] }, (request, reply) => {
    const slot = validate(request.body); const id = randomUUID();
    db.prepare('INSERT INTO slots(id,config) VALUES (?,?)').run(id, JSON.stringify(slot));
    return reply.code(201).send({ ...slot, id });
  });
  app.put<{ Params: { id: string } }>('/api/admin/slots/:id', { preHandler: [access.requireAdmin, access.requireOrigin] }, request => {
    readSlot(db, request.params.id);
    const slot = validate(request.body);
    db.prepare('UPDATE slots SET config=? WHERE id=?').run(JSON.stringify(slot), request.params.id);
    return { ...slot, id: request.params.id };
  });
}
