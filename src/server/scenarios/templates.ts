/** Module contract: imports a slot's named source into immutable media storage.
 * Only UUID/orientation select the file; the client cannot supply paths. Imported
 * bytes are validated before publication and existing media are never overwritten.
 * Source: docs/slot-setup/matrix.md. */
import { randomUUID } from 'node:crypto';
import { copyFile, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { models, videoProblem } from '../../shared/scenarios.js';
import { HttpError } from '../errors.js';
import { inspectMedia } from './media.js';

export function registerTemplateVideos(app: FastifyInstance, db: DB, dataDir: string, access: Access, templateVideosDir = resolve('media/template-videos')) {
  app.post('/api/admin/slots/:id/template-video', { preHandler: [access.requireAdmin, access.requireOrigin] }, async (request, reply) => {
    const { id: slotId } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { orientation, model: modelId } = z.object({ orientation: z.enum(['landscape', 'portrait']), model: z.string() }).strict().parse(request.body);
    const model = models.find(item => item.id === modelId && item.mode === 'V2V');
    if (!model) throw new HttpError(400, 'MODEL_LIMIT', 'Выберите модель Video2Video');
    const source = join(templateVideosDir, `${slotId}__${orientation}.mp4`);
    const sourceStat = await stat(source).catch(() => undefined);
    if (!sourceStat?.isFile()) throw new HttpError(404, 'TEMPLATE_VIDEO_MISSING', 'Шаблонный ролик этой ориентации не найден. Подготовьте файл с указанным именем.');
    if (sourceStat.size > 300_000_000) throw new HttpError(413, 'FILE_TOO_LARGE', 'Размер исходника превышает 300 MB');
    const id = randomUUID(); const path = join(dataDir, 'media', id);
    try {
      await copyFile(source, path, constants.COPYFILE_EXCL);
      const size = (await stat(path)).size;
      if (size > 300_000_000) throw new HttpError(413, 'FILE_TOO_LARGE', 'Размер исходника превышает 300 MB');
      const meta = await inspectMedia(path, 'video/mp4', true);
      const media = { id, size, ...meta };
      if (!(orientation === 'portrait' ? media.height > media.width : media.width > media.height)) throw new HttpError(400, 'VIDEO_ORIENTATION', 'Ориентация файла не соответствует выбранному варианту');
      const problem = videoProblem(model, media);
      if (problem) throw new HttpError(400, 'MODEL_LIMIT', problem);
      db.prepare('INSERT INTO slot_media(id,path,kind,mime,size,duration,width,height,template_slot_id,template_orientation) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, id, media.kind, media.mime, size, media.duration ?? null, media.width, media.height, slotId, orientation);
      return reply.code(201).send(media);
    } catch (error) { await rm(path, { force: true }); throw error; }
  });
}
