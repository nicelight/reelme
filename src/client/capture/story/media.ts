import type { CatalogItem } from '../../../shared/capture';
import { request } from '../api';

export type StoryMedia = { url: string; player?: HTMLVideoElement };
type Resource = { controller: AbortController; result: Promise<StoryMedia>; url?: string; player?: HTMLVideoElement };

export function storyMediaPath(slotId: string, mediaId: string) {
  return `/api/catalog/${encodeURIComponent(slotId)}/media/${encodeURIComponent(mediaId)}`;
}

function waitForPlayback(video: HTMLVideoElement, url: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    function finish(error?: unknown) {
      signal.removeEventListener('abort', abort);
      video.oncanplay = video.onerror = null;
      if (error) reject(error); else resolve();
    }
    function abort() { finish(signal.reason); }
    video.controls = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.oncanplay = () => finish();
    video.onerror = () => finish(new Error('Не удалось открыть видеопревью'));
    signal.addEventListener('abort', abort, { once: true });
    video.src = url;
  });
}

async function download(path: string, key: string, signal: AbortSignal, priority: RequestPriority) {
  const response = await request(path, key, { cache: 'force-cache', signal, priority });
  return response.blob();
}

/** Covers and the selected player belong to the carousel. Background previews
 * warm the browser's HTTP cache and release their bytes after each download. */
export function createStoryMedia() {
  const resources = new Map<string, Resource>();
  const warmed = new Set<string>();
  let background: { path: string; controller: AbortController; bytes: Promise<Blob> } | undefined;
  let revision = 0;

  async function warmPreviews(paths: string[], key: string, version: number) {
    if (background) await background.bytes.catch(() => {});
    for (const path of paths) {
      if (version !== revision) return;
      if (warmed.has(path)) continue;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
      const bytes = download(path, key, signal, 'low');
      background = { path, controller, bytes };
      try {
        await bytes;
        if (!signal.aborted) warmed.add(path);
      } catch { /* A failed preview can still be requested when selected. */ }
      finally { if (background?.bytes === bytes) background = undefined; }
    }
  }

  function load(path: string, key: string, video: boolean) {
    const cached = resources.get(path);
    if (cached) return cached.result;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
    const resource: Resource = { controller, result: fetchAndDecode() };
    resources.set(path, resource);
    return resource.result;

    async function fetchAndDecode() {
      try {
        // This URL comes from the current installation-authorized catalog, and
        // the file ID changes on replacement. Reuse authenticated cached bytes.
        const blob = await (background?.path === path ? background.bytes : download(path, key, signal, 'high'));
        signal.throwIfAborted();
        const url = resource.url = URL.createObjectURL(blob);
        if (video) {
          warmed.add(path);
          resource.player = document.createElement('video');
          await waitForPlayback(resource.player, url, signal);
        } else { const image = new Image(); image.src = url; await image.decode(); }
        signal.throwIfAborted();
        return { url, player: resource.player };
      } catch {
        release(resource);
        if (resources.get(path) === resource) resources.delete(path);
        return { url: '' };
      }
    }
  }

  async function prepare(items: CatalogItem[], center: number, key: string, visible: ReadonlyMap<string, StoryMedia>, coversReady?: () => void) {
    const version = ++revision;
    const current = items[center];
    const preview = current?.previewId && storyMediaPath(current.id, current.previewId);
    const videos = items.flatMap(item => item.previewId ? [storyMediaPath(item.id, item.previewId)] : []);
    // Promote the same download, or free the connection for a newly selected video.
    const needsDownload = preview && !resources.has(preview) && !warmed.has(preview);
    if (background && (!videos.includes(background.path) || (needsDownload && preview !== background.path))) {
      background.controller.abort();
      background = undefined;
    }
    const covers = new Set(items.map(item => storyMediaPath(item.id, item.thumbnailId)));
    discardExcept(path => visible.has(path) || covers.has(path) || path === preview);
    const player = preview ? load(preview, key, true) : undefined;
    const ready = new Map(await Promise.all([...covers].map(async path => [path, await load(path, key, false)] as const)));
    if (version === revision) coversReady?.();
    if (preview && player) ready.set(preview, await player);
    if (version === revision) void warmPreviews(videos.filter(path => path !== preview), key, version);
    return ready;
  }

  function release(resource: Resource) {
    if (resource.player) {
      resource.player.removeAttribute('src');
      resource.player.load();
      resource.player = undefined;
    }
    if (resource.url) URL.revokeObjectURL(resource.url);
    resource.url = undefined;
  }

  function discardExcept(keep: (path: string) => boolean) {
    for (const [path, resource] of resources) {
      if (keep(path)) continue;
      resources.delete(path);
      resource.controller.abort();
      release(resource);
    }
  }

  function dispose() {
    revision++;
    background?.controller.abort();
    background = undefined;
    warmed.clear();
    discardExcept(() => false);
  }

  return { prepare, retain: (visible: ReadonlyMap<string, StoryMedia>) => discardExcept(path => visible.has(path)), dispose };
}
