/** Module contract: Scenarios owns slot configuration, prompt history and immutable media links.
 * Server validates every save against the finite model rules and stored media;
 * updates retain the previous prompt with its model and commit history with config.
 * only Access-verified admin can read/write editor data. Catalog exposes a
 * separate installation-only projection; no provider submission.
 * Source: docs/slot-setup/matrix.md. Editor defaults never rewrite raw legacy slots.
 */
import { materialIds, removeUnusedMaterials } from './cleanup.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { models, slotSchema, videoProblem, wanEditId, wanImageProblem, type SlotInput, type Slot, type SlotPromptVersion } from '../../shared/scenarios.js';
import { editorSlot, readSlot } from './store.js';
import { registerCatalog } from './catalog.js';
import { registerTemplateVideos } from './templates.js';
import { registerCaptureGuides } from './guides.js';
import { HttpError } from '../errors.js';
import { inspectMedia, readMedia, readTestPhoto, registerMedia } from './media.js';

function recentPrompts(history: SlotPromptVersion[], ...configs: Pick<SlotInput, 'model' | 'prompt'>[]) {
  const versions = configs.flatMap(({ model, prompt }) => {
    const text = prompt?.trim();
    return text ? [{ model, prompt: text }] : [];
  });
  const unique = new Map<string, SlotPromptVersion>();
  for (const version of [...versions, ...history]) {
    const key = JSON.stringify([version.model, version.prompt]);
    if (!unique.has(key)) unique.set(key, version);
  }
  return [...unique.values()].slice(0, 10);
}

export function registerScenarios(app: FastifyInstance, db: DB, dataDir: string, access: Access, templateVideosDir?: string, warm?: (slot: SlotInput) => void, discard?: (url: string) => Promise<boolean>) {
  registerMedia(app, db, dataDir, access);
  registerCatalog(app, db, dataDir, access);
  registerTemplateVideos(app, db, dataDir, access, templateVideosDir);
  registerCaptureGuides(app, db, dataDir, access);
  const selectPromptHistory = db.prepare<[string], string>('SELECT prompt_history FROM slots WHERE id=?').pluck();
  const updateSlot = db.prepare('UPDATE slots SET config=?,prompt_history=? WHERE id=?');
  const readPromptHistory = db.transaction((id: string) => {
    const slot = readSlot(db, id);
    return recentPrompts(JSON.parse(selectPromptHistory.get(id)!), slot);
  });
  const saveSlotUpdate = db.transaction((id: string, body: unknown, fps?: number) => {
    const previous = readSlot(db, id);
    const slot = validate(body, id, fps, previous);
    const history = recentPrompts(JSON.parse(selectPromptHistory.get(id)!), slot, previous);
    updateSlot.run(JSON.stringify(slot), JSON.stringify(history), id);
    return slot;
  });
  // Older imported videos only store dimensions and duration. Read frame rate from the immutable file.
  async function wanSourceFps(body: unknown) {
    const source = z.object({ model: z.literal(wanEditId), videoId: z.string().uuid() }).safeParse(body);
    if (!source.success) return;
    const media = readMedia(db, source.data.videoId);
    if (media.kind === 'video') return (await inspectMedia(join(dataDir, 'media', media.path), media.mime)).fps;
  }
  function validate(body: unknown, slotId: string, fps?: number, previous?: Slot): SlotInput {
    const slot = slotSchema.parse(body);
    const image = (id: string) => { if (readMedia(db, id).kind !== 'image') throw new HttpError(400, 'INVALID_MEDIA', 'Выберите изображение'); };
    image(slot.thumbnailId);
    slot.referenceIds.forEach(image);
    if (slot.model === wanEditId) {
      for (const id of [...slot.referenceIds, ...(slot.testPhotoIds ?? []), ...(slot.testPhotoId ? [slot.testPhotoId] : [])]) {
        const problem = wanImageProblem(readMedia(db, id));
        if (problem) throw new HttpError(400, 'MODEL_LIMIT', problem);
      }
    }
    if (slot.testPhotoId) readTestPhoto(db, slot.testPhotoId);
    slot.testPhotoIds?.forEach(id => readTestPhoto(db, id));
    if (slot.demoId && readMedia(db, slot.demoId).kind !== 'video') throw new HttpError(400, 'INVALID_MEDIA', 'Демоматериал должен быть видео');
    if (slot.videoId) {
      const media = readMedia(db, slot.videoId);
      const grandfathered = !media.template_slot_id && previous?.videoId === slot.videoId;
      if (!grandfathered && (media.template_slot_id !== slotId || media.template_orientation !== slot.orientation)) throw new HttpError(400, 'TEMPLATE_VIDEO_MISMATCH', 'Используйте шаблонный ролик этого сюжета и выбранной ориентации');
      const problem = videoProblem(models.find(m => m.id === slot.model)!, { ...media, fps });
      if (problem) throw new HttpError(400, 'MODEL_LIMIT', problem);
      if (!(slot.orientation === 'portrait' ? media.height > media.width : media.width > media.height)) throw new HttpError(400, 'VIDEO_ORIENTATION', 'Ориентация определяется исходным видео; выберите соответствующий исходник');
    }
    return slot;
  }
  app.get('/api/admin/models', { preHandler: access.requireAdmin }, () => models);
  app.get('/api/admin/slots', { preHandler: access.requireAdmin }, () => {
    const rows = db.prepare('SELECT id,config FROM slots WHERE deleted=0 ORDER BY rowid').all() as { id: string; config: string }[];
    return rows.map(row => editorSlot(db, { simulateGeneration: false, ...JSON.parse(row.config), id: row.id }));
  });
  app.get<{ Params: { id: string } }>('/api/admin/slots/:id', { preHandler: access.requireAdmin }, request => editorSlot(db, readSlot(db, request.params.id)));
  app.get<{ Params: { id: string } }>('/api/admin/slots/:id/prompt-history', { preHandler: access.requireAdmin }, request => readPromptHistory(request.params.id));
  app.delete<{ Params: { id: string } }>('/api/admin/slots/:id', { preHandler: [access.requireAdmin, access.requireOrigin] }, async (request, reply) => {
    const row = db.prepare('SELECT config FROM slots WHERE id=?').pluck().get(request.params.id) as string | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Сюжет не найден');
    // Keep the parent ID of historical sessions. Their snapshots own their media.
    db.prepare('UPDATE slots SET deleted=1 WHERE id=?').run(request.params.id);
    const urls = removeUnusedMaterials(db, dataDir, materialIds(JSON.parse(row)));
    for (const url of urls) await discard?.(url);
    return reply.code(204).send();
  });
  app.patch<{ Params: { id: string } }>('/api/admin/slots/:id/visibility', { preHandler: [access.requireAdmin, access.requireOrigin] }, (request, reply) => {
    const { visible } = z.object({ visible: z.boolean() }).strict().parse(request.body);
    const updated = db.prepare("UPDATE slots SET config=json_set(config, '$.visible', json(?)) WHERE deleted=0 AND id=?")
      .run(JSON.stringify(visible), request.params.id);
    if (!updated.changes) throw new HttpError(404, 'NOT_FOUND', 'Сюжет не найден');
    return reply.code(204).send();
  });
  app.post('/api/admin/slots', { preHandler: [access.requireAdmin, access.requireOrigin] }, async (request, reply) => {
    const { id = randomUUID(), ...body } = z.object({ id: z.string().uuid().optional() }).passthrough().parse(request.body);
    const fps = await wanSourceFps(body);
    if (db.prepare('SELECT 1 FROM slots WHERE id=?').get(id)) throw new HttpError(409, 'SLOT_EXISTS', 'Сюжет с этим ID уже существует');
    const slot = validate(body, id, fps);
    db.prepare('INSERT INTO slots(id,config) VALUES (?,?)').run(id, JSON.stringify(slot));
    if (!slot.simulateGeneration) warm?.(slot);
    return reply.code(201).send({ ...slot, id });
  });
  app.put<{ Params: { id: string } }>('/api/admin/slots/:id', { preHandler: [access.requireAdmin, access.requireOrigin] }, async request => {
    const fps = await wanSourceFps(request.body);
    const slot = saveSlotUpdate.immediate(request.params.id, request.body, fps);
    if (!slot.simulateGeneration) warm?.(slot);
    return { ...slot, id: request.params.id };
  });
}
