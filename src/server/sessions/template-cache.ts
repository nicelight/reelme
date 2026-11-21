/** One in-process upload queue for saved slots and immutable session snapshots.
 * SQLite retains pending IDs for restart and URLs for completed files. */
import { randomUUID } from 'node:crypto';
import type { TemplateUploadStatus } from '../../shared/template-upload.js';
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createFalClient } from '@fal-ai/client';
import type { DB } from '../db.js';
import { readMedia } from '../scenarios/media.js';
import { GenerationFailure } from './generation-errors.js';

const retentionSeconds = 365 * 86400;
export type TemplateUpload = (file: Blob, signal: AbortSignal, progress?: (bytes: number) => void) => Promise<string>;
type Inputs = { videoId?: string; referenceIds: string[] };
function ids(input: Inputs) {
  return [...new Set(input.videoId ? [input.videoId, ...input.referenceIds] : input.referenceIds)];
}

export function falTemplateUpload(key: string, transport: typeof fetch = fetch): TemplateUpload {
  return (file, signal, progress) => {
    const offsets = new WeakMap<Blob, number>();
    let nextOffset = 0;
    const fal = createFalClient({
      credentials: key, retry: { maxRetries: 0 },
      fetch: (url, init) => {
        const part = init?.body;
        if (!progress || init?.method !== 'PUT' || !(part instanceof Blob)) return transport(url, { ...init, signal });
        // The SDK retries a multipart PUT with the same slice. Count its offset once.
        const offset = offsets.get(part) ?? nextOffset;
        offsets.set(part, offset);
        nextOffset = offset + part.size;
        let sent = offset;
        const body = part.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            sent += chunk.byteLength;
            progress(sent);
            controller.enqueue(chunk);
          },
        }));
        const headers = new Headers(init.headers);
        headers.set('Content-Length', String(part.size));
        const request = { ...init, headers, signal, body, duplex: 'half' };
        return transport(url, request);
      },
    });
    return fal.storage.upload(file, { lifecycle: { expiresIn: retentionSeconds } });
  };
}

export function createTemplateCache(db: DB, dataDir: string, upload: TemplateUpload, options: {
  now?: () => number; timeoutMs?: number; backoffMs?: number; fetch?: typeof fetch;
  discard?: (url: string) => Promise<boolean>;
  onFailure?: (mediaId: string) => void;
} = {}) {
  const now = options.now ?? Date.now;
  const shutdown = new AbortController();
  const queued = new Set<string>();
  const active = new Map<string, Promise<void>>();
  const failed = new Map<string, number>();
  const cached = db.prepare<[string, number], { url: string }>('SELECT url FROM fal_template_cache WHERE media_id=? AND expires_at>?');
  const save = db.prepare(`INSERT INTO fal_template_cache(media_id,url,expires_at)
    SELECT id,?,? FROM slot_media WHERE id=?
    ON CONFLICT(media_id) DO UPDATE SET url=excluded.url,expires_at=excluded.expires_at`);

  let batch = randomUUID();
  const files = new Map<string, { size: number; sent: number; ready: boolean; error: boolean }>();
  function enqueue(id: string) {
    if (queued.has(id) || active.has(id)) return;
    if (!queued.size && !active.size) { batch = randomUUID(); files.clear(); }
    const size = db.prepare('SELECT size FROM slot_media WHERE id=?').pluck().get(id) as number | undefined;
    if (size !== undefined) db.prepare('INSERT OR IGNORE INTO fal_template_pending(media_id) VALUES (?)').run(id);
    files.set(id, { size: size ?? 0, sent: 0, ready: false, error: false });
    queued.add(id);
  }
  function status(): TemplateUploadStatus | null {
    const pending = queued.size + active.size > 0;
    const entries = [...files.values()];
    const errors = entries.filter(file => file.error).length;
    if (!pending && !errors) return null;
    return { batch, pending, totalFiles: files.size, readyFiles: entries.filter(file => file.ready).length,
      sentBytes: entries.reduce((sum, file) => sum + file.sent, 0),
      totalBytes: entries.reduce((sum, file) => sum + file.size, 0),
      error: errors ? `Не удалось загрузить файлы (${errors}). Сохраните сюжет ещё раз, чтобы повторить загрузку.` : null };
  }
  async function transfer(id: string) {
    const item = files.get(id)!;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const media = readMedia(db, id);
        const file = await openAsBlob(join(dataDir, 'media', media.path), { type: media.mime });
        const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(options.timeoutMs ?? 15 * 60_000)]);
        const expires = now() + retentionSeconds * 1000;
        item.sent = 0;
        const url = new URL(await upload(file, signal, bytes => { item.sent = Math.min(bytes, file.size); }));
        signal.throwIfAborted();
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid fal storage URL');
        const saved = save.run(url.href, expires, id);
        item.ready = true; item.sent = file.size;
        if (!saved.changes) await options.discard?.(url.href);
        return;
      } catch {
        if (shutdown.signal.aborted) return;
        if (attempt === 2) {
          item.error = true;
          failed.set(id, now() + 60_000);
          options.onFailure?.(id);
          return;
        }
        try { await delay((options.backoffMs ?? 1000) * 2 ** attempt, undefined, { signal: shutdown.signal }); }
        catch { return; }
      }
    }
  }
  function pump() {
    for (const id of queued) {
      if (shutdown.signal.aborted || active.size >= 2) break;
      queued.delete(id);
      active.set(id, transfer(id).finally(() => {
        if (!shutdown.signal.aborted) db.prepare('DELETE FROM fal_template_pending WHERE media_id=?').run(id);
        active.delete(id); pump();
      }));
    }
  }
  function resolveInputs(input: Inputs) {
    const urls = new Map<string, string>();
    const needed = ids(input);
    let exhausted = false;
    for (const id of needed) {
      const row = cached.get(id, now() + 3600_000);
      if (row) { urls.set(id, row.url); continue; }
      if ((failed.get(id) ?? 0) > now()) { exhausted = true; continue; }
      failed.delete(id);
      enqueue(id);
    }
    pump();
    if (exhausted) throw new GenerationFailure('TEMPLATE_UPLOAD_FAILED', 'Template upload attempts exhausted');
    return urls.size === needed.length ? urls : undefined;
  }
  for (const { media_id } of db.prepare('SELECT media_id FROM fal_template_pending').all() as { media_id: string }[]) {
    if (cached.get(media_id, now() + 3600_000)) db.prepare('DELETE FROM fal_template_pending WHERE media_id=?').run(media_id);
    else enqueue(media_id);
  }
  pump();
  return {
    status, resolveInputs,
    warm(input: Inputs) {
      for (const id of ids(input)) failed.delete(id);
      resolveInputs(input);
    },
    async invalidateMissing(input: Inputs) {
      const results = await Promise.all(ids(input).map(async id => {
        const row = cached.get(id, 0);
        if (!row) return false;
        try {
          const response = await (options.fetch ?? fetch)(row.url, { method: 'HEAD', redirect: 'error',
            signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(5000)]) });
          if (response.status !== 404 && response.status !== 410) return false;
          db.prepare('DELETE FROM fal_template_cache WHERE media_id=? AND url=?').run(id, row.url);
          return true;
        } catch { return false; }
      }));
      return results.includes(true);
    },
    async stop() {
      shutdown.abort();
      queued.clear();
      await Promise.allSettled(active.values());
    },
  };
}
export type TemplateCache = ReturnType<typeof createTemplateCache>;
