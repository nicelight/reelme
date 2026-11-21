/** One in-process upload queue for saved slots and immutable session snapshots.
 * Only completed uploads are durable. Local originals remain owned by Scenarios. */
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createFalClient } from '@fal-ai/client';
import type { DB } from '../db.js';
import { readMedia } from '../scenarios/media.js';
import { GenerationFailure } from './generation-errors.js';

const retentionSeconds = 365 * 86400;
export type TemplateUpload = (file: Blob, signal: AbortSignal) => Promise<string>;
type Inputs = { videoId?: string; referenceIds: string[] };
function ids(input: Inputs) {
  return [...new Set(input.videoId ? [input.videoId, ...input.referenceIds] : input.referenceIds)];
}

export function falTemplateUpload(key: string, transport: typeof fetch = fetch): TemplateUpload {
  return (file, signal) => {
    const fal = createFalClient({
      credentials: key, retry: { maxRetries: 0 },
      fetch: (url, init) => transport(url, { ...init, signal }),
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

  async function transfer(id: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const media = readMedia(db, id);
        const file = await openAsBlob(join(dataDir, 'media', media.path), { type: media.mime });
        const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(options.timeoutMs ?? 15 * 60_000)]);
        const expires = now() + retentionSeconds * 1000;
        const url = new URL(await upload(file, signal));
        signal.throwIfAborted();
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid fal storage URL');
        const saved = save.run(url.href, expires, id);
        if (!saved.changes) await options.discard?.(url.href);
        return;
      } catch {
        if (shutdown.signal.aborted) return;
        if (attempt === 2) {
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
      active.set(id, transfer(id).finally(() => { active.delete(id); pump(); }));
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
      if (!active.has(id)) queued.add(id);
    }
    pump();
    if (exhausted) throw new GenerationFailure('TEMPLATE_UPLOAD_FAILED', 'Template upload attempts exhausted');
    return urls.size === needed.length ? urls : undefined;
  }
  return {
    resolveInputs,
    warm(input: Inputs) {
      try { resolveInputs(input); } catch (error) { if (!(error instanceof GenerationFailure)) throw error; }
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
