/** Module contract: validates uploaded local media before publishing metadata.
 * Bytes stream into unique private paths, never overwrite old materials. No
 * remote URLs or client paths are executed; failed uploads remove partial files.
 * sendMedia serves a stored file only after the caller checks surface permissions.
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
import type { Media } from '../../shared/scenarios.js';
import { HttpError } from '../errors.js';
const run = promisify(execFile);
interface StoredMedia extends Media { path: string }
export function readMedia(db: DB, id: string): StoredMedia {
  const row = db.prepare("SELECT id,path,kind,mime,size,duration,width,height FROM slot_media WHERE id=? AND owner='scenarios'").get(id) as StoredMedia | undefined;
  if (!row) throw new HttpError(400, 'INVALID_MEDIA', 'Материал не найден');
  return row;
}
export function mediaInfo(row: StoredMedia): Media {
  return { id: row.id, kind: row.kind, mime: row.mime, size: row.size, ...(row.duration == null ? {} : { duration: row.duration }), width: row.width, height: row.height };
}
async function inspect(path: string, mime: string): Promise<Omit<Media, 'id' | 'size'>> {
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
      if (!stream?.width || !stream.height || !Number.isFinite(duration) || duration <= 0) throw new Error();
      return { kind: 'video', mime, duration, width: stream.width, height: stream.height };
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
      await pipeline(file.file, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      if (file.file.truncated) throw new HttpError(413, 'FILE_TOO_LARGE', 'Размер файла превышает 300 MB');
      const size = (await stat(path)).size;
      const meta = await inspect(path, file.mimetype);
      db.prepare('INSERT INTO slot_media(id,path,kind,mime,size,duration,width,height) VALUES (?,?,?,?,?,?,?,?)').run(id, id, meta.kind, meta.mime, size, meta.duration ?? null, meta.width, meta.height);
      return reply.code(201).send({ id, size, ...meta });
    } catch (error) { await rm(path, { force: true }); throw error; }
  });
  app.get<{ Params: { id: string } }>('/api/admin/slot-media/:id/info', { preHandler: access.requireAdmin }, request => mediaInfo(readMedia(db, request.params.id)));
  app.get<{ Params: { id: string } }>('/api/admin/slot-media/:id', { preHandler: access.requireAdmin }, async (request, reply) => {
    const media = readMedia(db, request.params.id);
    return sendMedia(dataDir, media, request, reply);
  });
}

/** Authorization belongs to the route: admin editor or visible catalog material. */
export async function sendMedia(dataDir: string, media: StoredMedia, request: FastifyRequest, reply: FastifyReply) {
  const path = join(dataDir, 'media', media.path);
  const size = (await stat(path)).size;
  reply.header('Content-Type', media.mime).header('Accept-Ranges', 'bytes').header('Content-Disposition', 'inline');
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
