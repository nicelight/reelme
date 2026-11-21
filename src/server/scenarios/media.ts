/** Module contract: validates uploaded local media before publishing metadata.
 * Bytes stream into unique private paths, never overwrite old materials. No
 * remote URLs or client paths are executed; failed uploads remove partial files.
 * sendMedia serves a stored file only after the caller checks surface permissions.
 * Source: docs/slot-setup/matrix.md.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { MAX_VIDEO_UPLOAD_BYTES, videoUploadLimitMessage, type Media } from '../../shared/scenarios.js';
import { HttpError } from '../errors.js';
import { MAX_PHOTO_BYTES } from '../../shared/capture.js';
const run = promisify(execFile);
interface StoredMedia extends Media { path: string; template_slot_id?: string | null; template_orientation?: string | null }
export function readMedia(db: DB, id: string): StoredMedia {
  const row = db.prepare("SELECT id,path,kind,mime,size,duration,width,height,template_slot_id,template_orientation FROM slot_media WHERE id=? AND owner='scenarios'").get(id) as StoredMedia | undefined;
  if (!row) throw new HttpError(400, 'INVALID_MEDIA', 'Материал не найден');
  return row;
}
export function readTestPhoto(db: DB, id: string): StoredMedia {
  const media = readMedia(db, id);
  if (media.kind !== 'image' || media.mime !== 'image/jpeg' || media.size > MAX_PHOTO_BYTES || media.width * media.height > 40_000_000) {
    throw new HttpError(400, 'INVALID_PHOTO', 'Тестовая фотография: JPEG до 20 MiB и 40 мегапикселей');
  }
  return media;
}
export function mediaInfo(row: StoredMedia): Media {
  return { id: row.id, kind: row.kind, mime: row.mime, size: row.size, ...(row.duration == null ? {} : { duration: row.duration }), width: row.width, height: row.height };
}
export async function inspectMedia(path: string, mime: string, rejectRotation = false): Promise<Omit<Media, 'id' | 'size'>> {
  if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    try {
      const image = sharp(path, { limitInputPixels: 40_000_000, failOn: 'warning' });
      const meta = await image.metadata();
      if (`image/${meta.format}` !== mime || !meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error();
      // Decode actual pixels: metadata-only success does not validate truncated input.
      await image.stats();
      return { kind: 'image', mime, width: meta.width, height: meta.height };
    } catch { throw new HttpError(400, 'INVALID_MEDIA', 'Нужен корректный JPEG, PNG или WebP (до 40 мегапикселей)'); }
  }
  if (['video/mp4', 'video/quicktime'].includes(mime)) {
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov', '-show_format', '-show_streams', '-of', 'json', path], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      const probe = JSON.parse(stdout);
      const stream = probe.streams.find((s: { codec_type: string; disposition?: { attached_pic: number } }) => s.codec_type === 'video' && !s.disposition?.attached_pic);
      const duration = Number(probe.format.duration);
      if (rejectRotation && (Number(stream?.tags?.rotate ?? 0) % 360 || stream?.side_data_list?.some((item: { rotation?: number }) => Number(item.rotation ?? 0) % 360))) throw new Error();
      if (!stream?.width || !stream.height || !Number.isFinite(duration) || duration <= 0) throw new Error();
      const rotation = Number(stream.side_data_list?.find((item: { rotation?: number }) => item.rotation != null)?.rotation ?? stream.tags?.rotate ?? 0);
      const swapAxes = Math.abs(rotation % 180) === 90;
      return { kind: 'video', mime, duration, width: swapAxes ? stream.height : stream.width, height: swapAxes ? stream.width : stream.height };
    } catch { throw new HttpError(400, 'INVALID_MEDIA', 'Нужен корректный MP4 или MOV с видеодорожкой'); }
  }
  throw new HttpError(400, 'INVALID_MEDIA', 'Поддерживаются JPEG, PNG, WebP, MP4 и MOV');
}
export function registerMedia(app: FastifyInstance, db: DB, dataDir: string, access: Access) {
  app.post('/api/admin/slot-media', { preHandler: [access.requireAdmin, access.requireOrigin] }, async (request, reply) => {
    const file = await request.file({ limits: { files: 1, fields: 0, parts: 1, fileSize: 300_000_000 } });
    if (!file) throw new HttpError(400, 'INVALID_MEDIA', 'Выберите файл');
    const id = randomUUID();
    const path = join(dataDir, 'media', id);
    try {
      async function* limitVideoBytes(chunks: AsyncIterable<Buffer>) {
        let bytes = 0;
        for await (const chunk of chunks) {
          bytes += chunk.length;
          if (bytes > MAX_VIDEO_UPLOAD_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', videoUploadLimitMessage);
          yield chunk;
        }
      }
      const stream = file.mimetype.startsWith('video/') ? limitVideoBytes(file.file) : file.file;
      await pipeline(stream, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      if (file.file.truncated) throw new HttpError(413, 'FILE_TOO_LARGE', 'Размер файла превышает 300 MB');
      const size = (await stat(path)).size;
      const meta = await inspectMedia(path, file.mimetype);
      db.prepare('INSERT INTO slot_media(id,path,kind,mime,size,duration,width,height) VALUES (?,?,?,?,?,?,?,?)').run(id, id, meta.kind, meta.mime, size, meta.duration ?? null, meta.width, meta.height);
      return reply.code(201).send({ id, size, ...meta });
    } catch (error) { await rm(path, { force: true }); throw error; }
  });
  app.get<{ Params: { id: string } }>('/api/admin/slot-media/:id/info', { preHandler: access.requireAdmin }, request => mediaInfo(readMedia(db, request.params.id)));
  app.get<{ Params: { id: string } }>('/api/admin/slot-media/:id', { preHandler: access.requireAdmin }, async (request, reply) => {
    const media = readMedia(db, request.params.id);
    return sendMedia(dataDir, media, request, reply, 'inline', media.kind === 'image' ? 'Cookie' : undefined);
  });
}

/** Call only after the route has verified access and the resource still exists. */
export function matchesPrivateCache(request: FastifyRequest, reply: FastifyReply, etag: string, varyBy: 'Authorization' | 'Cookie') {
  reply.header('Cache-Control', 'private, no-cache').header('ETag', etag);
  const vary = reply.getHeader('Vary');
  reply.header('Vary', vary ? `${vary}, ${varyBy}` : varyBy);
  return request.headers['if-none-match']?.split(',').some(value => {
    const tag = value.trim().replace(/^W\//, '');
    return tag === etag || tag === '*';
  });
}

export async function sendMedia(dataDir: string, media: StoredMedia, request: FastifyRequest, reply: FastifyReply, disposition = 'inline', varyBy?: 'Authorization' | 'Cookie') {
  const path = join(dataDir, 'media', media.path);
  const { size, mtimeMs } = await stat(path);
  if (varyBy) {
    // Installation media IDs identify immutable files. Display URLs identify a session.
    const etag = varyBy === 'Authorization' ? `"${media.id}"` : `"${media.id}-${size}-${mtimeMs}"`;
    if (matchesPrivateCache(request, reply, etag, varyBy)) return reply.code(304).send();
  }
  reply.header('Content-Type', media.mime).header('Accept-Ranges', 'bytes').header('Content-Disposition', disposition);
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(createReadStream(path, { start, end }));
  }
  return reply.header('Content-Length', size).send(createReadStream(path));
}
