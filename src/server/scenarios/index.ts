/** Module contract: Scenarios owns slot configuration and immutable media links.
 * Server validates every save against the finite model rules and stored media;
 * only Access-verified admin can read/write editor data. Catalog exposes a
 * separate installation-only projection; no provider submission.
 * Source: docs/slot-setup/matrix.md. Editor defaults never rewrite raw legacy slots.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { models, slotSchema, videoProblem, type SlotInput, type Slot } from '../../shared/scenarios.js';
import { editorSlot, readSlot } from './store.js';
import { registerCatalog } from './catalog.js';
import { registerTemplateVideos } from './templates.js';
import { registerCaptureGuides } from './guides.js';
import { HttpError } from '../errors.js';
import { readMedia, readTestPhoto, registerMedia } from './media.js';
export function registerScenarios(app: FastifyInstance, db: DB, dataDir: string, access: Access, templateVideosDir?: string) {
  registerMedia(app, db, dataDir, access);
  registerCatalog(app, db, dataDir, access);
  registerTemplateVideos(app, db, dataDir, access, templateVideosDir);
  registerCaptureGuides(app, db, access);
  function validate(body: unknown, slotId: string, previous?: Slot): SlotInput {
    const slot = slotSchema.parse(body);
    const image = (id: string) => { if (readMedia(db, id).kind !== 'image') throw new HttpError(400, 'INVALID_MEDIA', 'Выберите изображение'); };
    image(slot.thumbnailId);
    slot.referenceIds.forEach(image);
    if (slot.testPhotoId) readTestPhoto(db, slot.testPhotoId);
    slot.testPhotoIds?.forEach(id => readTestPhoto(db, id));
    if (slot.demoId && readMedia(db, slot.demoId).kind !== 'video') throw new HttpError(400, 'INVALID_MEDIA', 'Демоматериал должен быть видео');
    if (slot.videoId) {
      const media = readMedia(db, slot.videoId);
      const grandfathered = !media.template_slot_id && previous?.videoId === slot.videoId;
      if (!grandfathered && (media.template_slot_id !== slotId || media.template_orientation !== slot.orientation)) throw new HttpError(400, 'TEMPLATE_VIDEO_MISMATCH', 'Используйте шаблонный ролик этого сюжета и выбранной ориентации');
      const problem = videoProblem(models.find(m => m.id === slot.model)!, media);
      if (problem) throw new HttpError(400, 'MODEL_LIMIT', problem);
      if (!(slot.orientation === 'portrait' ? media.height > media.width : media.width > media.height)) throw new HttpError(400, 'VIDEO_ORIENTATION', 'Ориентация определяется исходным видео; выберите соответствующий исходник');
    }
    return slot;
  }
  app.get('/api/admin/models', { preHandler: access.requireAdmin }, () => models);
  app.get('/api/admin/slots', { preHandler: access.requireAdmin }, () => {
    const rows = db.prepare('SELECT id,config FROM slots ORDER BY rowid').all() as { id: string; config: string }[];
    return rows.map(row => editorSlot(db, { simulateGeneration: false, ...JSON.parse(row.config), id: row.id }));
  });
  app.get<{ Params: { id: string } }>('/api/admin/slots/:id', { preHandler: access.requireAdmin }, request => editorSlot(db, readSlot(db, request.params.id)));
  app.patch<{ Params: { id: string } }>('/api/admin/slots/:id/visibility', { preHandler: [access.requireAdmin, access.requireOrigin] }, (request, reply) => {
    const { visible } = z.object({ visible: z.boolean() }).strict().parse(request.body);
    const updated = db.prepare("UPDATE slots SET config=json_set(config, '$.visible', json(?)) WHERE id=?")
      .run(JSON.stringify(visible), request.params.id);
    if (!updated.changes) throw new HttpError(404, 'NOT_FOUND', 'Сюжет не найден');
    return reply.code(204).send();
  });
  app.post('/api/admin/slots', { preHandler: [access.requireAdmin, access.requireOrigin] }, (request, reply) => {
    const { id = randomUUID(), ...body } = z.object({ id: z.string().uuid().optional() }).passthrough().parse(request.body);
    if (db.prepare('SELECT 1 FROM slots WHERE id=?').get(id)) throw new HttpError(409, 'SLOT_EXISTS', 'Сюжет с этим ID уже существует');
    const slot = validate(body, id);
    db.prepare('INSERT INTO slots(id,config) VALUES (?,?)').run(id, JSON.stringify(slot));
    return reply.code(201).send({ ...slot, id });
  });
  app.put<{ Params: { id: string } }>('/api/admin/slots/:id', { preHandler: [access.requireAdmin, access.requireOrigin] }, request => {
    const previous = readSlot(db, request.params.id);
    const slot = validate(request.body, request.params.id, previous);
    db.prepare('UPDATE slots SET config=? WHERE id=?').run(JSON.stringify(slot), request.params.id);
    return { ...slot, id: request.params.id };
  });
}
