<script lang="ts">
  import { request } from './api';
  /** Fetch protected bytes with installation auth, then give the media element
   * a short-lived blob URL. Each change/unmount releases its URL and request. */
  let { slotId, mediaId, installationKey, video = false, alt = '' }: {
    slotId: string; mediaId: string; installationKey: string; video?: boolean; alt?: string;
  } = $props();
  let url = $state('');
  let failed = $state(false);
  let attempt = $state(0);
  $effect(() => {
    const path = `/api/catalog/${slotId}/media/${mediaId}`;
    const key = installationKey;
    void attempt;
    const controller = new AbortController();
    let objectUrl = '';
    url = ''; failed = false;
    void request(path, key, { signal: controller.signal }).then(r => r.blob()).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); url = objectUrl;
    }).catch(() => { if (!controller.signal.aborted) failed = true; });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  });
</script>
<div class:video class="media">
  {#if failed}
    <div class="fallback" role="status"><span>{video ? 'Видео' : 'Изображение'} не загрузилось.</span><button type="button" onclick={(event) => { event.stopPropagation(); attempt += 1; }}>Повторить загрузку</button></div>
  {:else if url}
    {#if video}<video src={url} controls playsinline preload="metadata" onerror={() => failed = true}><track kind="captions" /></video>
    {:else}<img src={url} {alt} onerror={() => failed = true} />{/if}
  {:else}<div class="fallback" role="status">Загружаем {video ? 'видео' : 'изображение'}…</div>{/if}
</div>
<style>
  .media { width:100%; aspect-ratio:4/3; background:var(--surface); overflow:hidden; }
  .video { aspect-ratio:auto; height:48vh; min-height:260px; background:#17251c; }
  img,video { display:block; width:100%; height:100%; object-fit:cover; } video { object-fit:contain; }
  .fallback { height:100%; min-height:150px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:16px; box-sizing:border-box; color:var(--muted); text-align:center; font-size:16px; }
  .video .fallback { color:#e0e9e2; }
  button { font:inherit; padding:12px 16px; min-height:44px; cursor:pointer; border:1px solid var(--line); border-radius:8px; background:var(--paper); color:var(--ink); }
</style>
