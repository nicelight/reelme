<script lang="ts">
  // Throwaway visual experiment. No API, camera, persistence, or real receive links.
  import { onMount } from 'svelte';
  import egg from './assets/egg.png';
  import portraits from './assets/portraits.png';
  import qrData from './qr.json';
  import './assets/fonts.css';
  import { ribbonLight, rimWave, revealSize } from './motion';
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

  type Variant = 'A' | 'B' | 'C';
  type Phase = 'egg' | 'shake' | 'bloom' | 'reveal' | 'result';
  const variants: { id: Variant; name: string; note: string }[] = [
    { id: 'A', name: 'Световой контур', note: 'Розовый контур и мягкие световые блики — ближе к первому референсу.' },
    { id: 'B', name: 'Тёмное стекло', note: 'Тише свечение, глубже поверхности. Яйцо свободно парит между карточками.' },
    { id: 'C', name: 'Мягкое кино', note: 'Тёплые персиковые блики и более плавное проявление результата.' },
  ];
  const params = new URLSearchParams(location.search);
  let variant = $state<Variant>((['A', 'B', 'C'].includes(params.get('variant') ?? '') ? params.get('variant') : 'A') as Variant);
  let clean = $state(params.get('clean') === '1');
  let reduced = $state(false);
  let glowGain = $state(100);
  let glowPreviewVersion = $state(0);
  let ready = $state(Array.from({ length: 16 }, (_, i) => i + 37));
  let queue = $state<number[]>([53]);
  let nextNumber = $state(54);
  let page = $state(0);
  let cells = $state<number[]>([]);
  let center = $state(53);
  let centerIsNew = $state(true);
  let phase = $state<Phase>('egg');
  let holdEgg = $state(params.get('still') === 'egg');
  let paused = $state(params.get('still') === 'egg');
  let elapsed = $state(0);
  let leaving = $state(false);
  let entering = $state(false);
  let visible = !document.hidden;
  let pageVersion = $state(0);
  type PendingTimer = { fn: () => void; remaining: number; due: number; handle?: ReturnType<typeof setTimeout> };
  let timers: PendingTimer[] = [];
  const qrs = qrData as Record<string, string>;
  const pageCount = $derived(Math.max(1, Math.ceil(ready.length / 8)));
  const selectedVariant = $derived(variants.find(item => item.id === variant)!);
  const number = (n: number) => String(n).padStart(3, '0');
  const imagePosition = (n: number) => `${((n - 37) % 3) * 50}% ${Math.floor(((n - 37) % 9) / 3) * 50}%`;
  function arm(timer: PendingTimer) {
    timer.due = performance.now() + timer.remaining;
    timer.handle = setTimeout(() => { timers = timers.filter(item => item !== timer); timer.fn(); }, timer.remaining);
  }
  function later(fn: () => void, ms: number) { const timer = { fn, remaining: ms, due: 0 }; timers.push(timer); if (visible) arm(timer); }
  function cancelTimers() { timers.forEach(timer => clearTimeout(timer.handle)); timers = []; }
  function finishReveal() {
    phase = 'result';
    if (!ready.includes(center)) ready = [...ready, center];
  }
  function openPage() {
    const pending = queue[0];
    centerIsNew = pending !== undefined;
    if (centerIsNew) { center = pending; queue = queue.slice(1); }
    else center = ready[(page * 8 + 8) % ready.length];
    const pool = ready.filter(n => n !== center);
    const start = (page * 8) % pool.length;
    const surrounding = Array.from({ length: 8 }, (_, i) => pool[(start + i) % pool.length]);
    cells = [...surrounding.slice(0, 4), center, ...surrounding.slice(4)];
    phase = centerIsNew ? 'egg' : 'result';
    elapsed = 0;
    if (centerIsNew && !holdEgg) startReveal();
  }
  function startReveal() {
    holdEgg = false;
    if (phase === 'egg') {
      // These cinematic timings are deliberately slower than a UI control.
      later(() => phase = reduced ? 'reveal' : 'shake', 1400);
      if (reduced) later(finishReveal, 1850);
      else {
        later(() => {
          phase = 'bloom';
          // Opacity releases early while the same scale transition keeps running.
          // 1800ms expansion overlaps 2000ms fade; no full-white gate or hold.
          later(() => phase = 'reveal', 400);
          later(finishReveal, 2400);
        }, 2450);
      }
    }
  }
  function nextPage() {
    if (leaving) return;
    cancelTimers();
    // A manual page turn during reveal still archives the already-ready result.
    if (centerIsNew && !ready.includes(center)) ready = [...ready, center];
    leaving = true;
    later(() => {
      page = (page + 1) % pageCount;
      pageVersion++;
      openPage();
      leaving = false; entering = true;
      later(() => entering = false, 800);
    }, reduced ? 160 : 280);
  }
  function addResults(count: number) {
    const incoming = Array.from({ length: Math.min(count, 90 - nextNumber) }, (_, i) => nextNumber + i);
    queue = [...queue, ...incoming]; nextNumber += incoming.length;
  }
  function replay() {
    cancelTimers(); pageVersion++; ready = Array.from({ length: 16 }, (_, i) => i + 37);
    queue = [53]; nextNumber = 54; page = 0; leaving = false; entering = false; openPage();
  }
  function inspectEgg() { holdEgg = true; paused = true; replay(); }
  function choose(id: Variant) {
    variant = id;
    const url = new URL(location.href); url.searchParams.set('variant', id);
    history.replaceState(null, '', url);
  }
  function cycle(direction: number) { choose(variants[(variants.findIndex(v => v.id === variant) + direction + 3) % 3].id); }
  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'); reduced = media.matches;
    const motionChanged = () => { reduced = media.matches; };
    media.addEventListener('change', motionChanged);
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowRight' ? 1 : -1); }
      if (event.key.toLowerCase() === 'h') clean = !clean;
    };
    const visibility = () => {
      visible = !document.hidden;
      timers.forEach(timer => {
        if (visible) arm(timer);
        else { clearTimeout(timer.handle); timer.remaining = Math.max(0, timer.due - performance.now()); }
      });
      document.querySelectorAll('.screen .bloom,.screen .egg-scene img,.screen .grid').forEach(node => node.getAnimations().forEach(animation => { if (visible) animation.play(); else animation.pause(); }));
    };
    window.addEventListener('keydown', keydown); document.addEventListener('visibilitychange', visibility);
    openPage();
    const ticker = setInterval(() => {
      if (!paused && visible && !leaving) { elapsed++; if (elapsed >= 10) nextPage(); }
    }, 1000);
    return () => {
      cancelTimers(); clearInterval(ticker); media.removeEventListener('change', motionChanged);
      window.removeEventListener('keydown', keydown); document.removeEventListener('visibilitychange', visibility);
    };
  });
</script>

<svelte:head><title>ReelMe — прототип экрана результатов</title></svelte:head>
<div class="prototype" class:clean>
  <section class="screen" class:quiet={variant === 'B'} class:cinema={variant === 'C'} data-variant={variant} aria-label="Экран результатов ReelMe">
    <svg class="light-lines" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ed94df" stop-opacity="0"/><stop offset=".28" stop-color="#ff8fd0"/><stop offset=".42" stop-color="#fff1d8"/><stop offset=".52" stop-color="#ff8acd"/><stop offset="1" stop-color="#d15fee" stop-opacity="0"/></linearGradient>
        <radialGradient id="hotspot-halo"><stop stop-color="#fff3f3" stop-opacity=".9"/><stop offset=".18" stop-color="#ffb0da" stop-opacity=".8"/><stop offset=".5" stop-color="#ed63bb" stop-opacity=".4"/><stop offset="1" stop-color="#d348a1" stop-opacity="0"/></radialGradient>
        <radialGradient id="hotspot-core"><stop stop-color="#fffaf5"/><stop offset=".4" stop-color="#fff2f2"/><stop offset=".72" stop-color="#ffbbdf" stop-opacity=".8"/><stop offset="1" stop-color="#ff8bcd" stop-opacity="0"/></radialGradient>
        <filter id="ribbon-glow" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="12"/></filter>
      </defs>
      {#each ribbons as path}
        <g fill="none" stroke="url(#ribbon)"><path d={path} stroke-width="18" opacity=".58" filter="url(#ribbon-glow)"/><path d={path} stroke-width="2.8" opacity=".85"/></g>
      {/each}
      {#each ribbonRoutes as route}
        <g class="ribbon-hotspot" use:ribbonLight={route}><ellipse rx="105" ry="30" fill="url(#hotspot-halo)"/><ellipse rx="58" ry="5" fill="url(#hotspot-halo)"/><ellipse rx="38" ry="2.3" fill="url(#hotspot-core)"/></g>
      {/each}
    </svg>
    <header>
      <div class="brand"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 2C22 18 18 22 2 24c16 2 20 6 22 22 2-16 6-20 22-22C30 22 26 18 24 2Z"/></svg><span>REELME</span></div>
      <div class="heading"><h1>Ваши <span>видео</span></h1><p>Найдите свой номер и отсканируйте QR-код</p></div>
      <div class="event"><i></i>Ваши истории</div>
    </header>
    <div class="grid" use:rimWave={{pageVersion, gain: glowGain / 100, previewVersion: glowPreviewVersion}} class:leaving class:entering data-page={page} data-page-version={pageVersion} data-phase={phase} data-center={center}>
      {#each cells as item, index (index)}
        <article class="card" class:center={index === 4} class:incubating={index === 4 && phase !== 'result'} class:revealing={index === 4 && phase === 'reveal'} data-number={item} aria-label={`История № ${number(item)}`}>
          <div class="rim-decoration" aria-hidden="true">
            <div class="rim-light"><i class="rim-halo"></i><i class="rim-hotspot"></i></div>
            <div class="rim-light rim-breath"><i class="rim-halo"></i><i class="rim-hotspot"></i></div>
          </div>
          <div class="result" class:concealed={index === 4 && !['reveal', 'result'].includes(phase)}>
            <div class="portrait" role="img" aria-label={`Демонстрационный кадр истории ${number(item)}`} style:background-image={`url('${portraits}')`} style:background-position={imagePosition(item)}></div>
            <div class="receive"><h2><span>№</span> {number(item)}</h2><img class="qr" src={qrs[item]} alt={`Демонстрационный QR истории ${number(item)}`} /></div>
          </div>
          {#if index === 4 && phase !== 'result'}
            <div class="egg-scene" class:shaking={phase === 'shake' || phase === 'bloom' || phase === 'reveal'} class:gone={phase === 'reveal'} aria-hidden="true"><div class="egg-floor"></div><div class="egg-art"><img src={egg} alt="" /></div></div>
            {#if !reduced}<div class="reveal-clip" use:revealSize aria-hidden="true"><div class="bloom" class:expanding={phase === 'bloom' || phase === 'reveal'} class:fading={phase === 'reveal'}></div></div>{/if}
          {/if}
        </article>
      {/each}
    </div>
    <footer aria-label={`Страница ${page + 1} из ${pageCount}`}>
      {#each Array.from({ length: pageCount }) as _, index}<span class:active={index === page}></span>{/each}
    </footer>
  </section>
  {#if !clean}
    <aside class="workbench" aria-label="Инструменты прототипа">
      <div class="toolbar">
        <div class="variants" aria-label="Варианты оформления">
          <button class="arrow" onclick={() => cycle(-1)} aria-label="Предыдущий вариант">←</button>
          {#each variants as item}<button class:selected={variant === item.id} onclick={() => choose(item.id)} aria-pressed={variant === item.id}><b>{item.id}</b> {item.name}</button>{/each}
          <button class="arrow" onclick={() => cycle(1)} aria-label="Следующий вариант">→</button>
        </div>
        <div class="glow-controls">
          <label for="glow-gain">Усиление блика <output for="glow-gain">{glowGain}%</output></label>
          <input id="glow-gain" type="range" min="0" max="100" step="5" bind:value={glowGain} aria-describedby="glow-help" />
          <button onclick={() => glowPreviewVersion++} disabled={reduced}>Проверить волну</button>
          <span id="glow-help">Добавочный свет поверх базового свечения. Фото и QR не меняются.</span>
        </div>
        <div class="actions"><button onclick={inspectEgg}>Рассмотреть яйцо</button>{#if holdEgg && phase === 'egg'}<button onclick={startReveal}>Показать появление</button>{/if}<button onclick={() => addResults(1)} disabled={nextNumber >= 90}>+ 1 видео</button><button onclick={() => addResults(3)} disabled={nextNumber >= 90}>+ 3 в очередь</button><button onclick={nextPage} disabled={leaving}>Следующая страница</button><button onclick={() => paused = !paused}>{paused ? 'Продолжить' : 'Пауза страниц'}</button><button onclick={replay}>Повторить демо</button><button onclick={() => clean = true} title="Вернуть панель — H">Скрыть · H</button></div>
      </div>
      <div class="state"><span>{selectedVariant.note}</span><span>Центр: № {number(center)} · {phase === 'result' ? 'карточка' : 'появление'}</span><span>Очередь: {queue.length ? queue.map(number).join(', ') : 'пуста'}</span><span>{paused ? 'Страницы на паузе' : `Смена через ${10 - elapsed} с`}</span></div>
      <p class="demo-note">Прототип · портреты иллюстративные; QR содержит демонстрационный номер, без выдачи видео. Экран рассчитан на большой горизонтальный монитор. ← → варианты · H скрывает панель.</p>
    </aside>
  {/if}
</div>

<style>
  :global(html) { background:#08060d; color-scheme:dark; }
  :global(body) { margin:0; }
  :global(*) { box-sizing:border-box; }
  .prototype { min-height:100svh; font-family:Manrope,sans-serif; color:#fff4fb; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:12px; gap:14px; background:#08060d; }
  .screen { --rim:#fa80d0; --halo:rgba(250,92,190,.22); --glass:rgba(46,23,48,.8); width:min(100%,calc((100svh - 225px) * 16 / 9)); aspect-ratio:16/9; position:relative; overflow:hidden; container-type:inline-size; background:radial-gradient(ellipse at 2% 0%,#3d1b39 0%,transparent 31%),radial-gradient(ellipse at 99% 94%,#27112f 0%,transparent 40%),#0d0a13; isolation:isolate; }
  .clean .screen { width:min(100%,calc((100svh - 24px) * 16 / 9)); }
  .light-lines { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:-1; }
  header { position:absolute; top:2.5cqw; left:3.5cqw; right:3.5cqw; display:flex; align-items:flex-start; justify-content:space-between; }
  .brand { display:flex; align-items:center; gap:1cqw; font-size:1.8cqw; letter-spacing:.3cqw; font-weight:800; padding-top:.1cqw; }
  .brand svg { width:2.65cqw; height:2.65cqw; fill:#fff6ff; filter:drop-shadow(0 0 7px #ff90d4); }
  .heading { position:absolute; left:50%; transform:translateX(-50%); top:-1.1cqw; text-align:center; white-space:nowrap; }
  h1 { font-size:3.45cqw; font-weight:700; letter-spacing:-.035em; line-height:1.2; margin:0; }
  h1 span { color:#f5a4df; }
  .heading p { margin:.35cqw 0 0; color:#ede0ec; font-size:1.24cqw; font-weight:400; }
  .event { font-size:.96cqw; display:flex; align-items:center; gap:.65cqw; padding:.65cqw 1.05cqw; border-radius:99px; background:linear-gradient(110deg,#341a32bb,#271d2faa); border:1px solid #9b50814d; }
  .event i { width:.6cqw; height:.6cqw; border-radius:100%; background:#ffe9fa; box-shadow:0 0 .65cqw #fd6cd3; }
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

  .result { height:100%; display:grid; grid-template-columns:minmax(0,1.66fr) minmax(0,1fr); gap:1.15cqw; opacity:1; }
  .result.concealed { opacity:0; }
  .card.center .result { transition:opacity 300ms ease-out; }
  .portrait { background-size:300% 300%; background-repeat:no-repeat; border-radius:1.1cqw; min-width:0; height:100%; box-shadow:inset 0 0 0 1px #ffa8e026; }
  .receive { display:flex; flex-direction:column; justify-content:center; align-items:center; min-width:0; gap:.55cqw; }
  h2 { margin:0; font-size:1.95cqw; font-weight:800; line-height:1.15; letter-spacing:-.025em; font-variant-numeric:tabular-nums; white-space:nowrap; }
  h2 span { font-size:1.5cqw; font-weight:600; }
  .qr { display:block; width:7.2cqw; height:7.2cqw; padding:0; background:#fff; border-radius:.65cqw; box-shadow:0 0 .6cqw #ffd2f126; }
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
  .quiet { --rim:#bd72ac; --halo:rgba(229,111,192,.06); --glass:rgba(34,23,39,.88); }
  .quiet .card { box-shadow:0 .5cqw 1.5cqw #0006,inset 0 .1cqw .8cqw #e288cd0d; }
  .quiet .rim-decoration { opacity:.4; }
  .quiet .card:not(.incubating) { padding:0; }
  .quiet .card:not(.incubating) .result { gap:0; grid-template-columns:minmax(0,1.66fr) minmax(0,1fr); }
  .quiet .card:not(.incubating) .portrait { border-radius:1.6cqw 0 0 1.6cqw; mask-image:linear-gradient(90deg,#000 78%,transparent); }
  .quiet .incubating { background:transparent; border-color:transparent; box-shadow:none; }
  .quiet .incubating .rim-decoration { display:none; }
  .quiet .light-lines { opacity:.65; }
  .cinema { --rim:#ef9ebb; --halo:rgba(255,166,188,.16); --glass:rgba(47,27,42,.84); }
  .cinema .grid.entering { animation-name:cinema-arrival; }
  .workbench { width:min(1600px,100%); padding:0 8px; font-size:12px; }
  .toolbar { display:flex; align-items:center; justify-content:center; gap:12px; flex-wrap:wrap; }
  .glow-controls { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:8px 12px; flex-basis:100%; }
  .glow-controls label { white-space:nowrap; }
  .glow-controls output { display:inline-block; min-width:3.5ch; margin-left:5px; color:#ffc3e9; font-variant-numeric:tabular-nums; }
  .glow-controls input { width:170px; height:28px; margin:0; accent-color:#e995cb; cursor:pointer; }
  .glow-controls input:focus-visible { outline:2px solid #fba7da; outline-offset:3px; border-radius:4px; }
  .glow-controls span { font-size:10px; color:#c1a8bb; }
  .variants,.actions { display:flex; gap:5px; flex-wrap:wrap; justify-content:center; }
  button { font:inherit; color:#e7d3e3; background:#1b1420; border:1px solid #453449; border-radius:8px; padding:8px 10px; cursor:pointer; min-height:36px; }
  button.selected { background:#3b2037; border-color:#d885bc; color:#fff3fc; }
  button b { color:#efb5da; margin-right:4px; }
  button:disabled { opacity:.4; cursor:default; }
  button:focus-visible { outline:2px solid #fba7da; outline-offset:3px; }
  .arrow { font-size:18px; line-height:1; }
  .state { display:flex; gap:10px 24px; justify-content:center; flex-wrap:wrap; color:#d0afc6; margin:10px 0 0; font-size:11px; }
  .demo-note { color:#af98ac; font-size:10px; text-align:center; margin:8px 0 0; }
  ::selection { background:#854569; color:#fff; }
  @keyframes egg-awake { 0%,100% { transform:rotate(0); } 8% { transform:rotate(-1deg); } 16% { transform:rotate(1.1deg); } 24% { transform:rotate(-1.25deg); } 32% { transform:rotate(1.4deg); } 40% { transform:rotate(-1.6deg); } 48% { transform:rotate(1.8deg); } 56% { transform:rotate(-2deg); } 64% { transform:rotate(2.2deg); } 72% { transform:rotate(-2.4deg); } 80% { transform:rotate(2.6deg); } 88% { transform:rotate(-2.8deg); } 96% { transform:rotate(3deg); } }

  @keyframes result-reveal { from { opacity:0; transform:scale(.97); } to { opacity:1; transform:scale(1); } }
  @keyframes page-arrival { from { opacity:0; transform:translateY(.5cqw); } to { opacity:1; transform:translateY(0); } }
  @keyframes cinema-arrival { from { opacity:0; transform:translateY(.7cqw) scale(.99); } to { opacity:1; transform:translateY(0) scale(1); } }
  @media(hover:hover) and (pointer:fine) { button:hover:not(:disabled) { background:#382239; border-color:#b577a3; } }
  @media(max-width:900px) { .prototype { padding:8px; justify-content:flex-start; gap:22px; } .screen,.clean .screen { width:100%; flex-shrink:0; } .workbench { max-width:650px; } .toolbar { gap:10px; } .state { gap:8px 14px; } .demo-note { line-height:1.7; } }
  @media(prefers-reduced-motion:reduce) { .grid { transition:opacity 160ms ease; } .grid.leaving { transform:none; } .grid.entering,.cinema .grid.entering { animation:result-reveal 200ms ease both; } .egg-scene.shaking img { animation:none; } .bloom { display:none; } @keyframes result-reveal { from { opacity:0; } to { opacity:1; } } }
</style>
