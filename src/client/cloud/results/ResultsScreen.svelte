<script lang="ts">
  /** Renders fixed page snapshots and eight status slots. Actions belong to the
   * selected history. The QR holds its decoded image through page changes. */
  import { tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import egg from '../results-prototype/assets/egg.png';
  import '../results-prototype/assets/fonts.css';
  import { ribbonLight, rimWave, revealSize } from './motion';
  import type { DisplaySession } from '../../../shared/display';
  import type { ResultPhase } from './state';
  let { cells, phase, page, pageCount, pageVersion, moving, leaving, entering, canAdvance, reduced, resourcesReady, error, sessions, progress, completedIds, loadStates = {}, displayEventKey, hiddenIds, onhide, getQr, onqrchange, onnextpage } : {
    cells: (string | null)[]; phase: ResultPhase; page: number; pageCount: number; pageVersion: number;
    moving: boolean; leaving: boolean; entering: boolean; canAdvance: boolean; reduced: boolean; resourcesReady: boolean;
    error: string; sessions: Record<string, DisplaySession>; progress: (DisplaySession | null)[]; completedIds: string[];
    loadStates?: Record<string, 'delayed' | 'deprecated'>;
    displayEventKey: string; hiddenIds: string[]; onhide: (id: string) => Promise<void>; getQr: (id: string) => HTMLImageElement | undefined;
    onqrchange: (open: boolean) => void;
    onnextpage: () => void;
  } = $props();
  let showProgress = $state(true);
  const completed = $derived(new Set(completedIds));
  const number = (n: number) => String(n).padStart(3, '0');
  const compact = new MediaQuery('(max-width: 720px), (max-height: 440px)');
  let menu = $state<{ id: string; index: number; version: number } | null>(null);
  let dialog = $state<HTMLDialogElement>();
  let selected = $state.raw<{ id: string; number: number; eventKey: string; qr?: HTMLImageElement } | null>(null);
  let hiding = $state(false);
  let hideError = $state('');

  function actionable(index: number) {
    return !leaving && !entering && (index !== 4 || phase === 'result' && !moving);
  }
  function openMenu(id: string, index: number) {
    if (!selected && actionable(index) && (menu?.id !== id || menu.index !== index)) {
      menu = { id, index, version: pageVersion };
    }
  }
  function outside(event: PointerEvent) {
    if (menu && event.target instanceof Element && !event.target.closest('.card, [data-card-menu], dialog')) menu = null;
  }
  $effect(() => {
    if (menu && (menu.version !== pageVersion || cells[menu.index] !== menu.id || !actionable(menu.index))) menu = null;
  });
  function select(item: DisplaySession, qr?: HTMLImageElement) {
    hideError = ''; hiding = false;
    selected = { id: item.id, number: item.number, eventKey: displayEventKey, qr };
  }
  function bigQr(item: DisplaySession) {
    const image = getQr(item.id);
    if (image) select(item, image);
  }
  function attachQr(node: HTMLElement, image: HTMLImageElement) {
    image.alt = 'QR для получения видео';
    node.append(image);
    return { destroy() { image.remove(); } };
  }
  $effect(() => {
    const target = selected;
    if (target && (hiddenIds.includes(target.id) || target.eventKey !== displayEventKey)) {
      selected = null;
    }
  });
  $effect(() => {
    const modal = dialog;
    if (!modal) return;
    modal.showModal();
    // The predecoded image mounts with the dialog. Polls and page changes must
    // not extend its five-second lifetime.
    return () => modal.close();
  });
  $effect(() => {
    if (!selected?.qr) return;
    untrack(() => onqrchange(true));
    const timer = setTimeout(() => { selected = null; }, 5000);
    return () => { clearTimeout(timer); untrack(() => onqrchange(false)); };
  });
  async function confirmHide() {
    const target = selected;
    if (!target || target.qr || hiding) return;
    hiding = true; hideError = '';
    try {
      await onhide(target.id);
      if (selected === target) selected = null;
    } catch {
      if (selected === target) hideError = 'Не удалось подтвердить скрытие. Повторите попытку.';
    } finally {
      if (selected === target) hiding = false;
    }
  }
  async function activateMenu(event: MouseEvent, id: string, index: number) {
    openMenu(id, index);
    if (event.detail === 0) {
      await tick();
      document.querySelector<HTMLElement>('[data-card-menu] a')?.focus();
    }
  }
  function dismissMenu() {
    if (menu && document.activeElement?.closest('[data-card-menu]')) {
      document.querySelector<HTMLElement>(`.card[data-position="${menu.index}"] .card-trigger`)?.focus();
    }
    menu = null;
  }
  const ribbons = [
    'M-200 208 C140 175 172 122 388 2 S735 -74 780 -126',
    'M920 -88 C1190 198 1452 -30 1715 -100',
    'M-140 768 C150 1000 348 770 584 890 S1180 1096 1730 700',
  ];

  // Arc-length percentages at the exact viewport crossings of the unchanged Béziers.
  // The lower curve leaves the viewport: each visible segment gets its own 7–15s pass.
  const ribbonRoutes = [
    { path: ribbons[0], from: 19.283612, to: 60.648040 },
    { path: ribbons[1], from: 16.086591, to: 66.707479 },
    { path: ribbons[2], from: 8.199690, to: 39.238033 },
    { path: ribbons[2], from: 79.893676, to: 92.126053 },
  ];

</script>

<svelte:window onpointerdown={outside} onkeydown={event => {
  if (event.key === 'Escape' && !selected) dismissMenu();
}} />
{#snippet actions(item: DisplaySession)}
  <a href={`/results?video=${encodeURIComponent(item.id)}`} target="_blank" rel="noopener">Посмотреть</a>
  <button type="button" onclick={() => bigQr(item)}>Большой QR</button>
  <button type="button" class="hide-action" onclick={() => select(item)}>Убрать с экрана</button>
{/snippet}
<svelte:head><title>ReelMe — ваши видео</title><link rel="preload" as="image" href={egg}/></svelte:head>
<div class="results-shell">
  <section class="screen" aria-label="Экран результатов ReelMe">
    <svg class="light-lines" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="results-ribbon" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ed94df" stop-opacity="0"/><stop offset=".28" stop-color="#ff8fd0"/><stop offset=".42" stop-color="#fff1d8"/><stop offset=".52" stop-color="#ff8acd"/><stop offset="1" stop-color="#d15fee" stop-opacity="0"/></linearGradient>
        <radialGradient id="results-hotspot-halo"><stop stop-color="#fff3f3" stop-opacity=".9"/><stop offset=".18" stop-color="#ffb0da" stop-opacity=".8"/><stop offset=".5" stop-color="#ed63bb" stop-opacity=".4"/><stop offset="1" stop-color="#d348a1" stop-opacity="0"/></radialGradient>
        <radialGradient id="results-hotspot-core"><stop stop-color="#fffaf5"/><stop offset=".4" stop-color="#fff2f2"/><stop offset=".72" stop-color="#ffbbdf" stop-opacity=".8"/><stop offset="1" stop-color="#ff8bcd" stop-opacity="0"/></radialGradient>
        <filter id="results-ribbon-glow" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="12"/></filter>
      </defs>
      {#each ribbons as path}
        <g fill="none" stroke="url(#results-ribbon)"><path d={path} stroke-width="18" opacity=".58" filter="url(#results-ribbon-glow)"/><path d={path} stroke-width="2.8" opacity=".85"/></g>
      {/each}
      {#each ribbonRoutes as route}
        <g class="ribbon-hotspot" use:ribbonLight={route}><ellipse rx="105" ry="30" fill="url(#results-hotspot-halo)"/><ellipse rx="58" ry="5" fill="url(#results-hotspot-halo)"/><ellipse rx="38" ry="2.3" fill="url(#results-hotspot-core)"/></g>
      {/each}
    </svg>
    <header>
      <div class="brand"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 2C22 18 18 22 2 24c16 2 20 6 22 22 2-16 6-20 22-22C30 22 26 18 24 2Z"/></svg><button type="button" aria-label="Следующая страница результатов" title="Следующая страница результатов" disabled={!canAdvance || !!selected?.qr} onclick={onnextpage}>REELME</button></div>
      {#if showProgress}
        <div class="progress-panel" aria-label="Готовящиеся видео">
          {#each Array.from({ length: 8 }) as _, index}
            {@const item = progress[index]}
            {#if item}
              <button class="progress-slot" data-progress-session={item.number} data-progress-position={index} data-stage={item.stage} onclick={() => showProgress = false} title="Скрыть статусы">
                <span class="progress-number">№ {number(item.number)}</span><span class="progress-label">{loadStates[item.id] === 'deprecated' ? 'пройдите фотосессию снова' : loadStates[item.id] === 'delayed' ? 'загрузка задерживается' : item.card ? completed.has(item.id) ? 'готово' : 'вот вот вылупится :)' : item.simulation?.message ?? item.label}</span>
                <span class="progress-track" aria-hidden="true"><span style:width={`${Math.max(1, Math.min(3, item.stage)) / 3 * 100}%`}></span></span>
              </button>
            {:else}<div class="progress-placeholder" aria-hidden="true"></div>{/if}
          {/each}
        </div>
      {:else}<button class="status-show" onclick={() => showProgress = true}>StatusShow</button>{/if}
    </header>
    <div class="grid" use:rimWave={{ pageVersion, gain: 1, previewVersion: 0 }} class:leaving class:entering data-phase={phase} data-page-version={pageVersion}>
      {#each cells as id, index (index)}
        {@const item = id ? sessions[id] : undefined}
        {#if item?.card}
        <article class="card" class:center={index === 4} class:incubating={index === 4 && phase !== 'result'} class:moving={index === 4 && moving} data-position={index} data-session={item.number} aria-label={`История № ${number(item.number)}`}
          onpointermove={event => { if (event.pointerType === 'mouse') openMenu(item.id, index); }}
          onpointerleave={event => { if (event.pointerType === 'mouse' && !compact.current && !event.currentTarget.contains(document.activeElement) && menu?.id === item.id) menu = null; }}
          onfocusout={event => { if (!compact.current && !selected && menu?.id === item.id && !event.currentTarget.contains(event.relatedTarget as Node)) menu = null; }}>
          <div class="rim-decoration" aria-hidden="true"><div class="rim-light"><i class="rim-halo"></i><i class="rim-hotspot"></i></div><div class="rim-light rim-breath"><i class="rim-halo"></i><i class="rim-hotspot"></i></div></div>
          <div class="result" class:concealed={index === 4 && !['reveal','result'].includes(phase)}>
            {#if actionable(index)}
              <button class="card-trigger" type="button" aria-label={`Действия истории № ${number(item.number)}`}
                onkeydown={event => {
                  if (compact.current && menu?.id === item.id && event.key === 'Tab' && !event.shiftKey) {
                    event.preventDefault();
                    document.querySelector<HTMLElement>('[data-card-menu] a')?.focus();
                  }
                }}
                aria-expanded={menu?.id === item.id} onfocus={() => openMenu(item.id, index)} onclick={event => activateMenu(event, item.id, index)}></button>
            {/if}
            <div class="card-photo">
              <img class="portrait" src={item.card.frameUrl} alt={`Первый снимок фотосессии № ${item.number}`} loading="eager" />
              {#if menu?.id === item.id && menu.index === index && !compact.current}
                <div class="card-actions" data-card-menu role="group" aria-label={`Действия истории № ${number(item.number)}`}>
                  {@render actions(item)}
                </div>
              {/if}
            </div>
            <div class="receive"><h2><span>№</span> {number(item.number)}</h2><img class="qr" src={item.card.qrUrl} alt={`QR формы получения видео № ${item.number}`} loading="eager" /></div>
          </div>
          {#if index === 4 && phase !== 'result'}
            <div class="egg-scene" class:shaking={phase === 'shake' || phase === 'bloom' || phase === 'reveal'} class:gone={phase === 'reveal'} aria-hidden="true"><div class="egg-floor"></div><div class="egg-art"><img src={egg} alt="" loading="eager" /></div></div>
            {#if !reduced}<div class="reveal-clip" use:revealSize aria-hidden="true"><div class="bloom" class:expanding={phase === 'bloom' || phase === 'reveal'} class:fading={phase === 'reveal'}></div></div>{/if}
          {/if}
        </article>
        {:else}<div class="empty-cell" aria-hidden="true"></div>{/if}
      {/each}
    </div>
    {#if error}<p class="connection" role="status">{error}</p>{:else if !resourcesReady}<p class="connection" role="status">Подготавливаем экран…</p>{/if}
    <footer aria-label={`Страница ${page + 1} из ${pageCount}`}>
      {#each Array.from({ length: pageCount }) as _, index}<span class:active={index === page}></span>{/each}
    </footer>
  </section>
  {#if compact.current && menu && sessions[menu.id]?.card}
    {@const item = sessions[menu.id]}
    <div class="compact-actions" data-card-menu role="group" aria-label={`Действия истории № ${number(item.number)}`}>
      <strong>№ {number(item.number)}</strong>
      {@render actions(item)}
    </div>
  {/if}
  {#if selected}
    <dialog bind:this={dialog} class:qr-dialog={!!selected.qr} class="action-dialog"
      aria-label={selected.qr ? `Большой QR истории № ${number(selected.number)}` : `Убрать № ${number(selected.number)} с экрана?`}
      oncancel={event => { event.preventDefault(); selected = null; }}>
      {#if selected.qr}
        <button class="large-qr" type="button" aria-label="Закрыть большой QR" onclick={() => selected = null}>
          <span>История № {number(selected.number)}</span>
          <span class="qr-image" use:attachQr={selected.qr}></span>
        </button>
      {:else}
        <h2>Убрать № {number(selected.number)} с экрана?</h2>
        {#if hideError}<p role="alert">{hideError}</p>{/if}
        <div class="confirm-buttons">
          <button type="button" onclick={() => selected = null}>Отмена</button>
          <button type="button" disabled={hiding} onclick={confirmHide}>{hiding ? 'Убираем…' : 'Убрать'}</button>
        </div>
      {/if}
    </dialog>
  {/if}
</div>
<style>
  .results-shell,.results-shell :global(*) { box-sizing:border-box; }
  .results-shell { min-height:calc(100svh - var(--operator-chrome-height,0px)); font-family:Manrope,sans-serif; color:#fff4fb; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:12px; gap:14px; background:#08060d; }
  .screen { --rim:#fa80d0; --halo:rgba(250,92,190,.22); --glass:rgba(46,23,48,.8); width:min(100%,calc((100svh - var(--operator-chrome-height,0px) - 24px) * 16 / 9)); aspect-ratio:16/9; position:relative; overflow:hidden; container-type:inline-size; background:radial-gradient(ellipse at 2% 0%,#3d1b39 0%,transparent 31%),radial-gradient(ellipse at 99% 94%,#27112f 0%,transparent 40%),#0d0a13; isolation:isolate; }
  .light-lines { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:-1; }
  header { position:absolute; top:2.5cqw; left:3.5cqw; right:3.5cqw; display:flex; align-items:flex-start; justify-content:space-between; }
  .brand { display:flex; align-items:center; gap:1cqw; font-size:1.8cqw; letter-spacing:.3cqw; font-weight:800; padding-top:.1cqw; }
  .brand svg { width:2.65cqw; height:2.65cqw; fill:#fff6ff; filter:drop-shadow(0 0 7px #ff90d4); }
  .grid { position:absolute; inset:9cqw 3.5cqw 5.5cqw; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); grid-template-rows:repeat(3,minmax(0,1fr)); gap:1.4cqw 2.3cqw; opacity:1; transition:opacity 280ms ease,transform 280ms cubic-bezier(.23,1,.32,1); }
  .grid.leaving { opacity:0; transform:translateY(-.5cqw); }
  .grid.entering { animation:page-arrival 700ms cubic-bezier(.23,1,.32,1) both; }
  .card { min-width:0; min-height:0; position:relative; border:1px solid transparent; border-radius:1.65cqw; padding:.8cqw; background:linear-gradient(125deg,var(--glass),#130e1bea 68%) padding-box,linear-gradient(145deg,#ac59967d,#7b406b70) border-box; box-shadow:0 .35cqw 1.2cqw #0005,0 0 .65cqw #f573c014,inset 0 .35cqw 1.4cqw #ed65be16; }
  .rim-decoration { position:absolute; inset:-1px; pointer-events:none; border-radius:inherit; z-index:3; }
  .rim-light { --corner-light:radial-gradient(ellipse 38% 85% at 8% 0%,#ffbbe0 0%,#fb7dbf 24%,#e969bda8 43%,transparent 78%),radial-gradient(ellipse 22% 58% at 100% 100%,#ffe5ef 0%,#ff9cd0 20%,#ed71bfab 45%,transparent 88%); position:absolute; inset:0; border-radius:inherit; }
  .rim-light::before,.rim-halo::before { content:''; position:absolute; inset:0; border-radius:inherit; background:var(--corner-light); padding:1.15px; mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0); mask-composite:exclude; }
  .rim-halo { position:absolute; inset:0; border-radius:inherit; filter:blur(.36cqw); opacity:.95; }
  .rim-halo::before { padding:.42cqw; }
  .rim-hotspot { position:absolute; top:-.025cqw; left:8%; width:14%; height:.12cqw; background:linear-gradient(90deg,transparent,#ffb0da 18%,#fffaf4 38%,#fffaf4 57%,#ffc3e3 72%,transparent); filter:drop-shadow(0 0 .15cqw #ffe5f2) drop-shadow(0 0 .32cqw #ff7fcaa6); }
  .rim-breath { opacity:0; }

  .result { position:relative; height:100%; display:grid; grid-template-rows:minmax(0,1fr); grid-template-columns:minmax(0,1.66fr) minmax(0,1fr); gap:1.15cqw; opacity:1; }
  .card-photo { min-width:0; min-height:0; position:relative; }
  .card-trigger { position:absolute; inset:0; z-index:1; width:100%; height:100%; min-height:0; padding:0; border:0; border-radius:1.1cqw; background:transparent; box-shadow:none; cursor:pointer; }
  .card-trigger:hover,.card-trigger:active { background:transparent; }
  .card-trigger:focus-visible { outline:2px solid #f5a4df; outline-offset:2px; }
  .card-actions {
    position:absolute; inset:0; z-index:2; display:grid; align-content:center; gap:.2cqw; padding:.4cqw;
    border-radius:1.1cqw; background:rgba(24,12,29,.83); color:#fff4fb;
  }
  [data-card-menu] a,[data-card-menu] button {
    display:flex; align-items:center; justify-content:center; min-height:0; padding:.35em .4em; border:0;
    border-radius:.4em; background:transparent; color:inherit; text-align:center; text-decoration:none;
    font:650 clamp(11px,1.13cqw,22px)/1.25 Manrope,sans-serif; cursor:pointer;
  }
  [data-card-menu] .hide-action { color:#ffc7d2; }
  [data-card-menu] :is(button,a):focus-visible,.action-dialog button:focus-visible { outline:2px solid #f5a4df; outline-offset:-2px; }
  @media(hover:hover) and (pointer:fine) { [data-card-menu] :is(button,a):hover { background:#ffffff24; } }
  .compact-actions { position:fixed; inset:auto max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); z-index:10; display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:4px; padding:8px; border:1px solid #885573; border-radius:12px; background:#241329f5; color:#fff4fb; }
  .compact-actions strong { padding:0 8px; font:700 14px Manrope,sans-serif; }
  .compact-actions :is(a,button) { min-height:44px; padding:6px 10px; font:650 14px Manrope,sans-serif; }
  .action-dialog { width:min(90vw,380px); margin:auto; padding:24px; border:1px solid #885573; border-radius:16px; background:#241329; color:#fff4fb; font-family:Manrope,sans-serif; }
  .action-dialog::backdrop { background:#100b14bf; }
  .action-dialog h2 { width:auto; white-space:normal; font:750 20px/1.35 Manrope,sans-serif; }
  .action-dialog p { color:#ffc7d2; font-size:14px; }
  .confirm-buttons { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; }
  .confirm-buttons button { min-height:40px; padding:8px 14px; border:1px solid #885573; border-radius:8px; background:transparent; color:#fff4fb; font:650 14px Manrope,sans-serif; cursor:pointer; }
  .confirm-buttons button:last-child { background:#f5a4df; color:#231122; }
  .action-dialog.qr-dialog { inset:0; width:100%; height:100%; max-width:none; max-height:none; margin:0; padding:0; border:0; border-radius:0; background:#000; }
  .large-qr { width:100%; height:100%; display:grid; place-content:center; justify-items:center; gap:8px; margin:0; padding:0; border:0; border-radius:0; background:#000; color:#fff; font:750 clamp(18px,3vmin,34px)/1.25 Manrope,sans-serif; cursor:pointer; }
  .large-qr:hover:not(:disabled) { background:#000; }
  .qr-image { display:block; width:min(60vw,60dvh); aspect-ratio:1; }
  .qr-image :global(img) { display:block; width:100%; height:100%; image-rendering:pixelated; }
  .result.concealed { opacity:0; }
  .card.center .result { transition:opacity 300ms ease-out; }
  .portrait { display:block; width:100%; min-height:0; object-fit:cover; border-radius:1.1cqw; min-width:0; height:100%; box-shadow:inset 0 0 0 1px #ffa8e026; }
  .receive { display:flex; flex-direction:column; justify-content:flex-end; align-items:flex-end; min-width:0; gap:.2cqw; }
  h2 { margin:0; width:8.8cqw; text-align:center; font-size:1.6cqw; font-weight:800; line-height:1.15; letter-spacing:-.025em; font-variant-numeric:tabular-nums; white-space:nowrap; }
  h2 span { font-size:1.2cqw; font-weight:600; }
  .qr { display:block; width:8.8cqw; height:8.8cqw; flex-shrink:0; padding:0; background:#fff; border-radius:.65cqw; box-shadow:0 0 .6cqw #ffd2f126; }
  .egg-scene { position:absolute; inset:0; opacity:1; transition:opacity 250ms ease; }
  .egg-art { position:absolute; top:50%; left:62%; height:116%; aspect-ratio:1; transform:translate(-49.8%,-51.4%); }
  .egg-art img { display:block; width:100%; height:100%; object-fit:contain; transform:rotate(0); }
  .egg-floor { position:absolute; left:62%; width:52%; height:8%; transform:translateX(-50%); border-radius:50%; bottom:0; background:#f58ace55; filter:blur(.7cqw); }
  .egg-scene.shaking img { animation:egg-awake 2850ms ease-in-out both; }
  .egg-scene.gone { opacity:0; }
  .reveal-clip { position:absolute; inset:0; overflow:hidden; border-radius:inherit; pointer-events:none; z-index:4; }
  .bloom { position:absolute; left:62%; top:50%; width:var(--bloom-diameter); aspect-ratio:1; border-radius:50%; background:radial-gradient(circle closest-side,#fff 0%,#fff var(--bloom-core),#fff0 100%); opacity:0; transform:translate(-50%,-50%) scale(.025); transition:transform 1800ms cubic-bezier(.23,1,.32,1),opacity 250ms ease; }
  .bloom.expanding { transform:translate(-50%,-50%) scale(1); opacity:1; }
  .bloom.fading { opacity:0; transition:transform 1800ms cubic-bezier(.23,1,.32,1),opacity 2000ms cubic-bezier(.23,1,.32,1); }
  footer { position:absolute; bottom:2.35cqw; left:0; right:0; display:flex; justify-content:center; gap:.8cqw; }
  footer span { display:block; width:1.7cqw; height:.65cqw; border-radius:99px; background:#6e46676b; }
  footer span.active { background:#ffc6ee; box-shadow:0 0 .9cqw .15cqw #f850bd8c; }
  ::selection { background:#854569; color:#fff; }
  @keyframes egg-awake { 0%,100% { transform:rotate(0); } 8% { transform:rotate(-1deg); } 16% { transform:rotate(1.1deg); } 24% { transform:rotate(-1.25deg); } 32% { transform:rotate(1.4deg); } 40% { transform:rotate(-1.6deg); } 48% { transform:rotate(1.8deg); } 56% { transform:rotate(-2deg); } 64% { transform:rotate(2.2deg); } 72% { transform:rotate(-2.4deg); } 80% { transform:rotate(2.6deg); } 88% { transform:rotate(-2.8deg); } 96% { transform:rotate(3deg); } }

  @keyframes result-reveal { from { opacity:0; transform:scale(.97); } to { opacity:1; transform:scale(1); } }
  @keyframes page-arrival { from { opacity:0; transform:translateY(.5cqw); } to { opacity:1; transform:translateY(0); } }
  @media(prefers-reduced-motion:reduce) { .grid { transition:opacity 160ms ease; } .grid.leaving { transform:none; } .grid.entering { animation:result-reveal 200ms ease both; } .egg-scene.shaking img { animation:none; } .bloom { display:none; } @keyframes result-reveal { from { opacity:0; } to { opacity:1; } } }
  .card { transition:opacity 280ms ease; }
  .card.moving { opacity:0; }
  .empty-cell { min-width:0; min-height:0; }
  .connection { position:absolute; bottom:.35cqw; left:3.5cqw; right:3.5cqw; text-align:center; font-size:.9cqw; color:#fff4fb; margin:0; }
  .brand button { min-height:0; padding:0; border:0; box-shadow:none; background:transparent; color:#fff4fb; font:inherit; letter-spacing:inherit; cursor:pointer; }
  .brand button:hover:not(:disabled) { background:transparent; }
  .brand button:disabled { opacity:1; cursor:default; }
  .brand button:focus-visible { outline:2px solid #f5a4df; outline-offset:3px; }
  .portrait { max-width:none; }
  @media(prefers-reduced-motion:reduce) { .card { transition:opacity 160ms ease; } }
  .progress-panel { position:absolute; top:-1.1cqw; left:23cqw; width:50cqw; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:repeat(4,1.3cqw); gap:.24cqw 1.8cqw; }
  .progress-slot { position:relative; min-width:0; min-height:0; display:flex; align-items:flex-start; justify-content:flex-start; gap:.6cqw; padding:0 0 .2cqw; border:0; border-radius:0; box-shadow:none; background:transparent; color:#ede0ec; font:500 .72cqw/1.2 Manrope,sans-serif; text-align:left; cursor:pointer; --stage:#db779e; }
  .progress-slot[data-stage='2'] { --stage:#9862c5; }
  .progress-slot[data-stage='3'] { --stage:#7dc6df; }
  .progress-slot[data-stage='4'],.progress-slot[data-stage='5'],.progress-slot[data-stage='6'] { --stage:#afd88c; }
  .progress-number { flex:none; color:#fff4fb; font-weight:700; font-variant-numeric:tabular-nums; }
  .progress-label { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .progress-track { position:absolute; left:0; right:0; bottom:0; height:2px; background:#4f334c; border-radius:3px; overflow:hidden; }
  .progress-track span { display:block; height:100%; background:var(--stage); }
  .progress-placeholder { border-bottom:1px solid #60344a2b; }
  .status-show { margin-left:auto; min-height:0; font:500 .96cqw/1.3 Manrope,sans-serif; color:#fff4fb; padding:.65cqw 1.05cqw; border-radius:99px; background:linear-gradient(110deg,#341a32bb,#271d2faa); border:1px solid #9b50814d; cursor:pointer; }
  .progress-slot:focus-visible,.status-show:focus-visible { outline:2px solid #f5a4df; outline-offset:3px; }
  @media(hover:hover) and (pointer:fine) { .progress-slot:hover,.status-show:hover { color:#fff; background:#ffffff08; } }
</style>
