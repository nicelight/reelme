/** Module contract: imports a browser upload or a slot's named source into immutable media storage.
 * Only UUID/orientation select the file; the client cannot supply paths. Imported
 * bytes are validated before publication and existing media are never overwritten.
 * Source: docs/slot-setup/matrix.md. */
import { randomUUID } from 'node:crypto';
import { copyFile, rm, stat } from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { MAX_VIDEO_UPLOAD_BYTES, models, videoProblem, videoUploadLimitMessage } from '../../shared/scenarios.js';
import { HttpError } from '../errors.js';
import { inspectMedia } from './media.js';

export function registerTemplateVideos(app: FastifyInstance, db: DB, dataDir: string, access: Access, templateVideosDir = resolve('media/template-videos')) {
  app.post('/api/admin/slots/:id/template-video', { preHandler: [access.requireAdmin, access.requireOrigin] }, async (request, reply) => {
    const { id: slotId } = z.object({ id: z.string().uuid() }).parse(request.params);
    const upload = request.isMultipart();
    const { orientation, model: modelId } = z.object({ orientation: z.enum(['landscape', 'portrait']), model: z.string() }).strict().parse(upload ? request.query : request.body);
    const model = models.find(item => item.id === modelId && item.mode === 'V2V');
    if (!model) throw new HttpError(400, 'MODEL_LIMIT', 'Выберите модель Video2Video');
    const tooLarge = () => new HttpError(413, 'FILE_TOO_LARGE', videoUploadLimitMessage);
    const id = randomUUID();
    const path = join(dataDir, 'media', id);
    try {
      if (upload) {
        // Read one byte over the inclusive limit so an exact-limit MP4 is valid.
        const file = await request.file({ limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_VIDEO_UPLOAD_BYTES + 1 } });
        if (!file || file.mimetype !== 'video/mp4') throw new HttpError(400, 'INVALID_MEDIA', 'Выберите видео в формате MP4.');
        await pipeline(file.file, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
        if (file.file.truncated) throw tooLarge();
      } else {
        const source = join(templateVideosDir, `${slotId}__${orientation}.mp4`);
        const sourceStat = await stat(source).catch(() => undefined);
        if (!sourceStat?.isFile()) throw new HttpError(404, 'TEMPLATE_VIDEO_MISSING', 'Шаблонный ролик этой ориентации не найден. Подготовьте файл с указанным именем.');
        if (sourceStat.size > MAX_VIDEO_UPLOAD_BYTES) throw tooLarge();
        await copyFile(source, path, constants.COPYFILE_EXCL);
      }
      const size = (await stat(path)).size;
      if (size > MAX_VIDEO_UPLOAD_BYTES) throw tooLarge();
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
