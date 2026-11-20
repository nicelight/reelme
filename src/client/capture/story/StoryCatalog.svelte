<script lang="ts">
  /** Shared story carousel. Capture mode may begin a session through its callback;
   * Capture opens after the covers and selected player are ready. Unchanged cards
   * stay mounted during a refresh; previewOnly uses native public media. */
  import { onDestroy, tick, untrack } from 'svelte';
  import type { CatalogItem } from '../../../shared/capture';
  import ProtectedMedia from '../ProtectedMedia.svelte';
  import { createStoryMedia, storyMediaPath, type StoryMedia } from './media';
  import { ribbonLight } from './motion';
  import brandMark from './assets/reelme-mark.webp';
  import './assets/fonts.css';
  let { items: incoming, activeId, installationKey, loading, error, busy, onbrowse, onbegin, onback, onrefresh, previewOnly = false }: {
    items: CatalogItem[]; activeId?: string; installationKey: string; loading: boolean; error: string; busy: boolean; previewOnly?: boolean;
    onbrowse: (item: CatalogItem) => void; onbegin: (item: CatalogItem) => void; onback: () => void; onrefresh: () => void;
  } = $props();
  const ribbons = [
    'M-80 300 C100 265 220 170 420 145', 'M1150 140 C1370 160 1500 255 1690 370',
    'M-70 860 C130 710 260 820 485 940', 'M1160 960 C1410 710 1450 1000 1690 705',
  ];
  const title = (item: CatalogItem) => item.description.trim().split(/\s+/).slice(0, 3).join(' ');
  let selected = $state(0);
  let requested = 0;
  let movement = 0;
  let wrapped = $state<string[]>([]);
  let previousId = $state<string>();
  let teleported = $state(false);
  let transitioning = $state(false);
  let gallery = $state<HTMLElement>();
  let disposed = false;
  let identity = '';
  const media = createStoryMedia();
  let installationItems = $state.raw<CatalogItem[]>([]);
  let items = $derived(previewOnly ? incoming : installationItems);
  let prepared = $state.raw<ReadonlyMap<string, StoryMedia>>(new Map());
  const unavailable: StoryMedia = { url: '' };
  let catalogPreparing = $state(false);
  let loadingCovers = $state(false);
  let staged: CatalogItem[] | undefined;
  let stagedKey: string | undefined;
  onDestroy(() => { disposed = true; movement++; media.dispose(); });
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const source = (item: CatalogItem, id: string) => previewOnly ? undefined : prepared.get(storyMediaPath(item.id, id)) ?? unavailable;
  function relative(index: number, center = selected) {
    const count = items.length;
    if (!count) return 0;
    const distance = (index - center + count) % count;
    return distance > count / 2 ? distance - count : distance;
  }
  $effect(() => {
    const next = incoming;
    const key = installationKey;
    const wanted = activeId;
    if (!previewOnly) {
      untrack(() => {
        if (next !== staged || key !== stagedKey) void replaceCatalog(next, wanted, key);
        else if (wanted && !catalogPreparing) {
          const index = items.findIndex(item => item.id === wanted);
          if (index >= 0 && index !== selected && index !== requested) void select(index, false);
        }
      });
      return;
    }
    const nextIdentity = items.map(item => item.id).join(',');
    const index = items.findIndex(item => item.id === activeId);
    if (nextIdentity !== identity) {
      identity = nextIdentity; movement++; transitioning = false; wrapped = []; teleported = false; previousId = undefined;
      selected = Math.max(0, index); requested = selected;
    } else if (index >= 0 && index !== selected && index !== requested) {
      void select(index, false);
    }
  });
  async function retireExcept(next: ReadonlyMap<string, StoryMedia>, revision: number) {
    prepared = next;
    await tick();
    if (!disposed && revision === movement) media.retain(next);
  }
  async function replaceCatalog(next: CatalogItem[], wanted: string | undefined, key: string) {
    if (stagedKey !== undefined && stagedKey !== key) {
      media.dispose(); installationItems = []; prepared = new Map();
    }
    staged = next; stagedKey = key;
    const revision = ++movement;
    const center = Math.max(0, next.findIndex(item => item.id === wanted));
    catalogPreparing = next.length > 0;
    loadingCovers = catalogPreparing;
    const resources = await media.prepare(next, center, key, prepared, () => { loadingCovers = false; });
    if (disposed || revision !== movement) return;
    installationItems = next;
    selected = center; requested = center;
    wrapped = []; teleported = false; previousId = undefined; transitioning = false; catalogPreparing = false;
    void retireExcept(resources, revision);
  }
  function pauseVideos() { gallery?.querySelectorAll('video').forEach(video => video.pause()); }
  async function select(index: number, notify = true) {
    if (!items.length || loading || busy || catalogPreparing) return;
    const next = (index + items.length) % items.length;
    requested = next;
    const revision = ++movement;
    if (next === selected && previewOnly) { transitioning = false; wrapped = []; teleported = false; if (notify) onbrowse(items[next]!); return; }
    pauseVideos(); transitioning = true;
    const nextMedia = previewOnly ? undefined : await media.prepare(items, next, installationKey, prepared);
    if (disposed || revision !== movement) return;
    if (next === selected || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      wrapped = []; teleported = false; selected = next; previousId = undefined; transitioning = false;
      if (nextMedia) void retireExcept(nextMedia, revision);
      if (notify) onbrowse(items[next]!);
      return;
    }
    if (nextMedia) prepared = new Map([...prepared, ...nextMedia]);
    wrapped = items.flatMap((item, i) => Math.abs(relative(i) - relative(i, next)) > 2 ? [item.id] : []);
    teleported = false;
    await wait(140);
    if (disposed || revision !== movement) return;
    previousId = items[selected]?.id;
    teleported = true; selected = next;
    if (notify) onbrowse(items[next]!);
    await wait(600);
    if (disposed || revision !== movement) return;
    wrapped = []; teleported = false; previousId = undefined; transitioning = false;
    if (nextMedia) void retireExcept(nextMedia, revision);
  }
  function choose(item: CatalogItem) { if (previewOnly || transitioning || busy || loading || catalogPreparing) return; pauseVideos(); onbegin(item); }
  function keyboard(event: KeyboardEvent) {
    if (loading || busy || event.target instanceof HTMLVideoElement || !(event.target instanceof HTMLElement)) return;
    if (event.target.closest('input,textarea,select,video')) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); void select(requested + (event.key === 'ArrowLeft' ? -1 : 1)); }
  }
</script>
<svelte:window onkeydown={keyboard}/>
<svelte:document onvisibilitychange={() => { if (document.hidden) pauseVideos(); }}/>
<div class="stage story-stage">
  <svg class="light-lines" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="light"><stop stop-color="#d36aaa" stop-opacity="0"/><stop offset=".25" stop-color="#ec85bc"/><stop offset=".43" stop-color="#ffe5c4"/><stop offset=".56" stop-color="#ef9ac4"/><stop offset="1" stop-color="#d76ab5" stop-opacity="0"/></linearGradient>
      <radialGradient id="hotspot-halo"><stop stop-color="#fff3f3" stop-opacity=".9"/><stop offset=".18" stop-color="#ffb0da" stop-opacity=".8"/><stop offset=".5" stop-color="#ed63bb" stop-opacity=".4"/><stop offset="1" stop-color="#d348a1" stop-opacity="0"/></radialGradient>
      <radialGradient id="hotspot-core"><stop stop-color="#fffaf5"/><stop offset=".4" stop-color="#fff2f2"/><stop offset=".72" stop-color="#ffbbdf" stop-opacity=".8"/><stop offset="1" stop-color="#ff8bcd" stop-opacity="0"/></radialGradient>
      <filter id="bloom" x="-30%" y="-150%" width="160%" height="400%"><feGaussianBlur stdDeviation="12"/></filter>
    </defs>
    {#each ribbons as path}
      <g fill="none" stroke="url(#light)"><path class="glow" d={path}/><path class="ribbon" d={path}/></g>
      <g class="ribbon-hotspot" use:ribbonLight={{path, from: 8, to: 92}}><ellipse rx="120" ry="36" fill="url(#hotspot-halo)"/><ellipse rx="62" ry="6" fill="url(#hotspot-halo)"/><ellipse rx="40" ry="2.5" fill="url(#hotspot-core)"/></g>
    {/each}
  </svg>
  <header>
    <a class="story-brand" href="#catalog" onclick={(event) => { event.preventDefault(); onback(); }} aria-label="ReelMe — начало"><img src={brandMark} alt="" class="brand-mark"/><span>REELME<small>AI VIDEO BOOTH</small></span></a>
    <ol class="steps" aria-label="Этапы создания"><li class="active"><span></span>Сюжет</li><li ><span></span>Фото</li><li><span></span>Видео</li></ol>
    <div class="event">Ваша киноистория</div>
  </header>
  <main>
    <div class="story-intro"><h1>{previewOnly ? 'Ваша киноистория' : 'Выберите историю'}</h1><p>{previewOnly ? 'Посмотрите, каким может стать ваше фото' : 'Сделайте фото, а мы превратим его в эффектное видео'}</p></div>
    {#if (loading || catalogPreparing) && !items.length}
      <div class="catalog-state" role="status">
        {#if loadingCovers}
          <label class="cover-progress">Подгрузка обложек<progress></progress></label>
        {:else}Загружаем сюжеты…{/if}
      </div>
    {:else if !items.length}<div class="catalog-state"><h2>Сюжеты скоро появятся</h2>{#if !previewOnly}<p>Сотрудник поможет вам начать.</p>{/if}<button onclick={onrefresh}>Обновить каталог</button></div>
    {:else}
      <section bind:this={gallery} class="gallery" aria-label="Галерея сюжетов" aria-roledescription="карусель">
        {#if items.length > 1}<button class="arrow previous" onclick={() => select(requested - 1)} aria-label="Предыдущий сюжет"><svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></svg></button>{/if}
        {#each items as item, index (item.id)}
          {@const offset = relative(index)}
          {@const visible = Math.abs(offset) <= 2}
          <article class="story" class:center={offset === 0} class:side={offset !== 0} class:offstage={!visible} class:wrapping={wrapped.includes(item.id)} class:teleported={teleported && wrapped.includes(item.id)} inert={!visible} aria-hidden={!visible} style={`--offset:${offset}`}>
            <div class="rim-decoration" aria-hidden="true"><div class="rim-light"><i class="rim-halo"></i><i class="rim-hotspot"></i></div></div>
            <div class="card-surface">
              <div class="center-content" inert={offset !== 0} aria-hidden={offset !== 0}>
                <div class="story-heading"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 13h23v15H5zM4 8l22-5 2 6-23 5zM10 7l5 5m4-7 5 5M11 18l8 4-8 4z"/></svg><div><h2>{title(item)}</h2></div></div>
                <div class="story-preview" class:portrait={item.previewOrientation === 'portrait'}>
                  {#if item.previewId && item.previewOrientation === 'portrait' && (offset === 0 || previousId === item.id)}<div class="preview-backdrop" aria-hidden="true" inert><ProtectedMedia slotId={item.id} mediaId={item.thumbnailId} {installationKey} publicCatalog={previewOnly} prepared={source(item,item.thumbnailId)} /></div>{/if}
                  {#if offset === 0 || previousId === item.id}
                    {#if item.previewId}<ProtectedMedia slotId={item.id} mediaId={item.previewId} {installationKey} publicCatalog={previewOnly} prepared={source(item,item.previewId)} video active={offset === 0}/>
                    {:else}<ProtectedMedia slotId={item.id} mediaId={item.thumbnailId} {installationKey} publicCatalog={previewOnly} prepared={source(item,item.thumbnailId)} alt={title(item)}/>{/if}
                  {/if}
                </div>
                <button class="choose" class:preview-only={previewOnly} onclick={() => choose(item)} disabled={previewOnly || busy || transitioning} title={previewOnly ? 'Выбор сюжета доступен в фотобудке' : undefined}>{previewOnly ? 'Выбор доступен в фотобудке' : 'Выбрать этот сюжет'}{#if !previewOnly} <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>{/if}</button>
              </div>
              <div class="side-button" inert={offset === 0} aria-hidden={offset === 0}>
                <div class="side-media">{#if visible}<ProtectedMedia slotId={item.id} mediaId={item.thumbnailId} {installationKey} publicCatalog={previewOnly} prepared={source(item,item.thumbnailId)} alt={title(item)}/>{/if}</div>
                <a class="side-copy" href={`#slot=${encodeURIComponent(item.id)}`} onclick={(event) => { event.preventDefault(); void select(index); }} aria-label={`Выбрать сюжет: ${title(item)}`}><h2>{title(item)}</h2><span class="template"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 4 10 6-10 6z"/></svg>Шаблон</span></a>
              </div>
            </div>
          </article>
        {/each}
        {#if items.length > 1}<button class="arrow next" onclick={() => select(requested + 1)} aria-label="Следующий сюжет"><svg viewBox="0 0 24 24"><path d="m10 5 7 7-7 7"/></svg></button>{/if}
      </section>
      <div class="catalog-controls">
        {#if !previewOnly}<button class="catalog-back" onclick={onback}>← Назад в каталог</button>{/if}
        <nav class="dots" aria-label="Выбор сюжета">{#each items as item, index}<button class:active={selected === index} aria-label={`Сюжет ${index + 1}: ${title(item)}`} aria-current={selected === index ? 'true' : undefined} onclick={() => select(index)}></button>{/each}</nav>
        <span class="catalog-count" aria-live="polite">{selected + 1} / {items.length}</span>
        <button class="catalog-refresh" onclick={onrefresh}>Обновить каталог</button>
      </div>
    {/if}
    {#if error}<div class="catalog-error" role="alert"><p>{error}</p><button onclick={onrefresh}>Повторить загрузку</button></div>{/if}
  </main>
</div>
<style>
  .cover-progress { display:grid; justify-items:center; gap:14px; }
  .cover-progress progress { width:min(220px,70vw); height:8px; accent-color:#f5a4df; }
  button,a{-webkit-tap-highlight-color:transparent}button{font:inherit;color:inherit;cursor:pointer;min-height:0;padding:0}button:focus-visible,a:focus-visible{outline:3px solid #fff3dd;outline-offset:5px}main{max-width:none;padding:0;margin:0}.stage{--surface:#211421;--paper:#1e1420;--ink:#fff4fb;--muted:#d8bfd2;--line:#865b79;--accent:#f5a4df;color:#fff4fb;font-family:Manrope,sans-serif;line-height:1.4;color-scheme:dark}
  .stage{position:relative;isolation:isolate;overflow:hidden;width:100%;min-height:100svh;background:radial-gradient(ellipse 24% 18% at 81% 21%,#9d5a7a5c,transparent 80%),radial-gradient(ellipse 23% 14% at 7% 87%,#ce79ab66,transparent 75%),radial-gradient(ellipse 32% 17% at 74% 99%,#995d7555,transparent 80%),radial-gradient(ellipse 45% 25% at 50% 83%,#71394d55,transparent 78%),radial-gradient(ellipse at 63% 28%,#30203490,transparent 55%),#0d0a13;padding:1.5vw 3.3vw .4vw;container-type:inline-size}
  .light-lines{position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none}.light-lines .ribbon{stroke-width:2.8;opacity:.85}.light-lines .glow{stroke-width:22;filter:url(#bloom);opacity:.7}.ribbon-hotspot{opacity:.85}
  header{padding:0;border:0;display:flex;align-items:center;justify-content:space-between;position:relative;height:4vw}.story-brand{line-height:1.2;display:flex;align-items:center;gap:1vw;text-decoration:none;color:#fff4fb;font-size:1.5vw;font-weight:800;letter-spacing:.3em}.brand-mark{width:3.5vw;height:3.5vw;object-fit:contain;filter:drop-shadow(0 0 10px #c4915440)}.story-brand span{color:inherit}.story-brand small{display:block;font-size:.52vw;letter-spacing:.45em;font-weight:500;margin-top:.25vw}.event{font-size:.85vw;color:#d3bdce;border:1px solid #75536c;padding:.6vw 1.3vw;border-radius:99px}.steps{position:absolute;left:50%;transform:translateX(-50%);display:flex;list-style:none;gap:5.8vw;padding:0;margin:0}.steps li{font-size:1vw;color:#af9fac;display:grid;justify-items:center;gap:.45vw;position:relative}.steps li+li:before{content:'';position:absolute;top:.7vw;right:calc(50% + .7vw);height:2px;width:7.2vw;background:#5f4c5e}.steps span{width:1.5vw;height:1.5vw;display:block;border:3px solid #6a5669;border-radius:50%;background:#211722;z-index:1}.steps .active{color:#fff4fb;font-weight:700}.steps .active span{background:#fff4fb;border-color:#f5b2d4;box-shadow:0 0 16px #eb8abd}
  .story-intro{text-align:center;margin:2.1vw 0 2.2vw}h1{font-size:3.7vw;line-height:1.15;letter-spacing:-.035em;margin:0;font-weight:700}.story-intro p{font-size:1.43vw;color:#c0adbe;margin:.75vw 0 0}
  .gallery{height:35.8vw;position:relative;margin:0 1.2vw}.story{position:absolute;top:3vw;left:calc(50% + var(--offset)*13.2vw + clamp(-1,var(--offset),1)*13.7vw);width:12.5vw;height:28.5vw;border-radius:1.8vw;transform:translateX(-50%);background:radial-gradient(ellipse at 2% 0,#8b425c80,transparent 48%),radial-gradient(ellipse at 100% 100%,#944b7480,transparent 45%),linear-gradient(130deg,#291c29,#16121c);box-shadow:0 1.5vw 3vw #0006;transition:left 600ms cubic-bezier(.22,.75,.18,1),top 600ms cubic-bezier(.22,.75,.18,1),width 600ms cubic-bezier(.22,.75,.18,1),height 600ms cubic-bezier(.22,.75,.18,1),opacity 200ms ease;}
  .story.center{top:0;width:40vw;height:35.7vw;z-index:2;box-shadow:0 2vw 3vw #0007,0 1vw 3vw #d367a226}
  .story.wrapping{opacity:0;pointer-events:none;transition-duration:600ms,600ms,600ms,600ms,140ms}
  .story.teleported{transition:none}
  .card-surface{position:absolute;inset:0;overflow:hidden;border-radius:inherit;border:1px solid #d89bb966}
  .center-content{position:absolute;top:1.5vw;left:50%;transform:translateX(-50%);width:36vw;opacity:0;pointer-events:none;transition:opacity 150ms ease}
  .center .center-content{opacity:1;pointer-events:auto;transition:opacity 280ms ease 190ms}
  .rim-decoration{position:absolute;inset:-1px;pointer-events:none;border-radius:inherit;z-index:3}
  .rim-light{--corner-light:radial-gradient(ellipse 38% 85% at 8% 0%,#ffdfd3 0%,#fb9ac5 24%,#e969bda8 43%,transparent 78%),radial-gradient(ellipse 22% 58% at 100% 100%,#ffe5ef 0%,#ff9cd0 20%,#ed71bfab 45%,transparent 88%);position:absolute;inset:0;border-radius:inherit}
  .rim-light:before,.rim-halo:before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--corner-light);padding:1.3px;mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude}
  .rim-halo{position:absolute;inset:0;border-radius:inherit;filter:blur(.36vw);opacity:.95}
  .rim-halo:before{padding:.42vw}
  .rim-hotspot{position:absolute;top:-.025vw;left:8%;width:14%;height:.12vw;background:linear-gradient(90deg,transparent,#ffb0da 18%,#fffaf4 38%,#fffaf4 57%,#ffc3e3 72%,transparent);filter:drop-shadow(0 0 .15vw #ffe5f2) drop-shadow(0 0 .32vw #ff7fcaa6)}
  .story-heading{display:flex;gap:1.2vw;align-items:flex-start;height:6.1vw}.story-heading>svg{width:2.7vw;height:2.7vw;flex:none;border:1px solid #df99bc;border-radius:50%;padding:.5vw;stroke:#f2b4d2;fill:none;stroke-width:1.4}.story h2{font-size:1.9vw;margin:0 0 .2vw;font-weight:800;letter-spacing:-.025em}.story-preview{height:17.6vw;position:relative;border-radius:1.1vw;overflow:hidden;background:#130e17}.choose{display:flex;justify-content:center;align-items:center;gap:1vw;width:27vw;margin:auto;border:1px solid #ffe2d4;border-radius:99px;background:linear-gradient(110deg,#ffe5bf,#f58cca 65%,#dc8ee2);color:#241120;min-height:4.2vw;font-size:1.35vw;font-weight:800;box-shadow:0 .4vw 1.5vw #ed89c64a;transition:transform 160ms cubic-bezier(.23,1,.32,1)}.choose svg{width:1.8vw;height:1.8vw;fill:none;stroke:currentColor;stroke-width:1.8}.choose:active{transform:scale(.98)}.side-button{position:absolute;inset:0;display:block;width:100%;height:100%;background:transparent;border:0;padding:0;text-align:left;opacity:1;transition:opacity 260ms ease 170ms}.center .side-button{opacity:0;pointer-events:none;transition:opacity 150ms ease}.side-copy{text-decoration:none;color:inherit;position:absolute;top:0;bottom:0;left:50%;width:12.5vw;transform:translateX(-50%);display:flex;flex-direction:column;justify-content:flex-end;padding:1.6vw 1.3vw;background:linear-gradient(transparent 40%,#1b1019a0 70%,#1a111bef)}.side-copy h2{font-size:1.32vw;line-height:1.25;margin-bottom:1.15vw}.template{font-size:.9vw;display:flex;align-items:center;justify-content:center;gap:.4vw;border:1px solid #bb809c60;border-radius:99px;padding:.5vw .5vw;background:#51304465;color:#ffe0e1}.template svg{width:1vw;height:1vw;fill:#ffcfc9}.arrow{position:absolute;top:14.5vw;z-index:3;width:2.8vw;height:2.8vw;padding:.6vw;border-radius:50%;border:1px solid #ffd0cf;background:#3e2536aa;box-shadow:0 0 .8vw #eeb0b840}.arrow svg{fill:none;stroke:currentColor;stroke-width:2;width:100%;height:100%}.previous{left:-3.2vw}.next{right:-3.2vw}.dots{display:flex;justify-content:center;flex-wrap:wrap;gap:.65vw;max-width:45vw;margin:0}.dots button{padding:0;border:0;background:#65505e;width:.8vw;height:.8vw;border-radius:50%}.dots button.active{background:#fff0f8;box-shadow:0 0 .7vw #ff8cd2}
  @media(hover:hover) and (pointer:fine){.choose:hover:not(:disabled){transform:translateY(-2px)}.side-copy:hover .template{background:#75405c99}.arrow:hover{background:#76435f}}
  .choose:disabled{cursor:default}
  .choose.preview-only:disabled{background:#352030;border-color:#785367;color:#dcb9cc;box-shadow:none}
  .center-content{height:32.7vw;display:flex;flex-direction:column;gap:1vw}
  .story-heading{height:auto;flex:none;min-height:2.7vw}
  .story-preview{height:auto;flex:1;min-height:0}
  .choose{flex:none;min-height:3.6vw}
  .preview-backdrop{position:absolute;inset:-20px;filter:blur(18px);opacity:.4;pointer-events:none}
  .portrait :global(.media.video){position:relative;background:transparent}
  @media(prefers-reduced-motion:reduce){.story,.story.wrapping,.center-content,.center .center-content,.side-button,.center .side-button{transition:none}.choose{transition:none}}
  @media(max-aspect-ratio:4/3){.stage{min-height:100svh;display:flex;flex-direction:column;justify-content:center;padding-bottom:8vw}header{margin-bottom:2vw}}
  .offstage{opacity:0;pointer-events:none}
  .side-media{position:absolute;inset:0}.side-media :global(.media){height:100%;aspect-ratio:auto;background:#211421}.side-media :global(img){object-fit:cover}.side-media :global(.fallback){font-size:.8vw;padding:.8vw}.side-media :global(button){position:relative;z-index:4}
  .story-preview :global(.media){height:100%;min-height:0;aspect-ratio:auto;background:#100b14}.story-preview :global(.fallback){min-height:0;font-size:1vw}.story-preview :global(video){object-fit:contain}.story-preview :global(img){object-fit:cover}
  .catalog-controls{display:flex;gap:1.4vw;align-items:center;justify-content:center;margin-top:1.5vw;min-height:1.4vw}.catalog-back,.catalog-refresh{background:transparent;border:0;font-size:.78vw;color:#d9bfd1;padding:.35vw}.catalog-count{font-size:.8vw;color:#d9bfd1;font-variant-numeric:tabular-nums}.catalog-state{min-height:32vw;display:flex;flex-direction:column;gap:1.2rem;align-items:center;justify-content:center;text-align:center;color:#e2ccdc}.catalog-state h2{font-size:2vw}.catalog-state button,.catalog-error button{padding:.6rem 1rem;background:#44253b;border:1px solid #bb80a2;border-radius:99px}.catalog-error{padding:1rem;margin:1rem auto;max-width:680px;color:#ffd5da;text-align:center}.catalog-error button{margin-top:.75rem}
  @media(max-width:700px){
    .stage{display:block;padding:16px 16px 28px;min-height:100svh}.stage header{height:54px;margin:0}.story-brand{font-size:15px;gap:7px;letter-spacing:.2em}.brand-mark{width:38px;height:38px}.story-brand small{font-size:5px;margin-top:4px}.event{display:none}.steps{left:auto;right:0;transform:none;gap:20px}.steps li{font-size:10px;gap:4px}.steps span{width:13px;height:13px;border-width:2px}.steps li+li:before{top:6px;right:calc(50% + 6px);width:44px}.story-intro{margin:24px 0}.story-intro h1{font-size:32px}.story-intro p{font-size:14px;line-height:1.5;margin:10px auto;max-width:30ch}.gallery{height:530px;margin:0 8px}.story{display:none;transition:opacity 180ms ease}.story.center{display:block;left:50%;top:0;width:100%;height:500px;border-radius:25px}.center-content{width:calc(100% - 32px);top:20px;height:460px;gap:14px}.story-heading{height:auto;gap:12px}.story-heading>svg{width:34px;height:34px;padding:7px}.story h2{font-size:23px;margin-bottom:7px}.story-preview{height:auto;border-radius:14px}.story-preview :global(.fallback){font-size:13px}.choose{width:100%;min-height:54px;font-size:16px;gap:12px}.choose svg{width:22px;height:22px}.arrow{width:36px;height:36px;top:510px;padding:8px}.previous{left:0}.next{right:0}.catalog-controls{gap:12px;flex-wrap:wrap;margin-top:24px}.catalog-back,.catalog-refresh{font-size:12px;padding:7px}.catalog-count{font-size:12px}.dots{order:3;max-width:100%;width:100%;gap:13px;padding-top:10px}.dots button{width:9px;height:9px}.catalog-state{min-height:350px}.catalog-state h2{font-size:25px}.rim-halo{filter:blur(5px)}.rim-halo:before{padding:5px}.rim-hotspot{height:2px}
  }
</style>
