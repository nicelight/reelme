<script lang="ts">
  /** Module contract: fetch protected catalog/pose bytes with installation auth,
   * then expose a short-lived object URL. Changes/unmount cancel requests and URLs.
   * Explicit publicCatalog mode uses only public promo URLs with native Range loading;
   * it never falls back to private endpoints or sends an installation key.
   * Guide reveal waits for decode; a replaced request cannot publish its image.
   * Source: docs/slot-setup/matrix.md. Never sends credentials to camera URLs. */
  import { request } from './api';
  let { slotId, mediaId, installationKey, video = false, alt = '', path: explicitPath, contain = false, active = true, reveal = false, publicCatalog = false }: {
    slotId?: string; mediaId: string; installationKey: string; video?: boolean; alt?: string; path?: string; contain?: boolean; active?: boolean; reveal?: boolean; publicCatalog?: boolean;
  } = $props();
  const revealImage = $derived(reveal && !video);
  let player = $state<HTMLVideoElement>();
  $effect(() => { if (!active) player?.pause(); });
  let url = $state('');
  let failed = $state(false);
  let attempt = $state(0);
  $effect(() => {
    const path = explicitPath ?? `/api/catalog/${slotId}/media/${mediaId}`;
    const key = installationKey;
    const decodeBeforeReveal = revealImage;
    void attempt;
    const controller = new AbortController();
    let objectUrl = '';
    url = ''; failed = false;
    if (publicCatalog) {
      url = `/api/public/catalog/${encodeURIComponent(slotId ?? '')}/media/${encodeURIComponent(mediaId)}`;
      return;
    }
    void request(path, key, { signal: controller.signal }).then(r => r.blob()).then(async blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      if (decodeBeforeReveal) {
        const image = new Image(); image.src = objectUrl; await image.decode();
      }
      if (!controller.signal.aborted) url = objectUrl;
    }).catch(() => { if (!controller.signal.aborted) failed = true; });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  });
</script>
<svelte:document onvisibilitychange={() => { if (document.hidden) player?.pause(); }}/>
<div class:video class:contain class:guide-reveal={revealImage} class:ready={!!url && !failed} class="media">
  {#if failed}
    <div class="fallback" role="status"><span>{video ? 'Видео' : 'Изображение'} не загрузилось.</span><button type="button" onclick={(event) => { event.stopPropagation(); attempt += 1; }}>Повторить загрузку</button></div>
  {:else if url}
    {#if video}<video bind:this={player} src={url} controls playsinline preload="metadata" onerror={() => failed = true}><track kind="captions" /></video>
    {:else}<img src={url} {alt} onerror={() => failed = true} />{/if}
  {:else if revealImage}<div class="guide-loading" role="status" aria-label="Загружаем образец позы"></div>
  {:else}<div class="fallback" role="status">Загружаем {video ? 'видео' : 'изображение'}…</div>{/if}
</div>
<style>
  .media { width:100%; aspect-ratio:4/3; background:var(--surface); overflow:hidden; }
  .guide-reveal { background:transparent; }
  .guide-loading { width:100%; height:100%; }
  .guide-reveal img { opacity:1; transition:opacity 1s cubic-bezier(.23,1,.32,1); }
  @starting-style { .guide-reveal img { opacity:0; } }
  @media(prefers-reduced-motion:reduce) { .guide-reveal img { transition:none; } }
  .video { aspect-ratio:auto; height:48vh; min-height:260px; background:#17251c; }
  img,video { display:block; width:100%; height:100%; object-fit:cover; } video,.contain img { object-fit:contain; }
  .fallback { height:100%; min-height:150px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:16px; box-sizing:border-box; color:var(--muted); text-align:center; font-size:16px; }
  .video .fallback { color:#e0e9e2; }
  button { font:inherit; padding:12px 16px; min-height:44px; cursor:pointer; border:1px solid var(--line); border-radius:8px; background:var(--paper); color:var(--ink); }
</style>
