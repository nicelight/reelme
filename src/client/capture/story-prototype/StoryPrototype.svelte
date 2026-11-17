<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { ribbonLight } from './motion';
  import portraits from './assets/portraits.png';
  import brandMark from './assets/reelme-mark.png';
  import film from '../../../../docs/video templates/1794213414058-yjz13u263xc.mp4?url';
  const ribbons = [
    'M-80 300 C100 265 220 170 420 145',
    'M1150 140 C1370 160 1500 255 1690 370',
    'M-70 860 C130 710 260 820 485 940',
    'M1160 960 C1410 710 1450 1000 1690 705',
  ];
  const stories = [
    { name: 'Космическая миссия', description: 'Отправьтесь навстречу звёздам и новым мирам', position: '50% 0%' },
    { name: 'Королевский бал', description: 'Ваша история, достойная королевского портрета', position: '100% 0%' },
    { name: 'Герой кино', description: 'Станьте главным героем захватывающего фильма', position: '0% 50%' },
    { name: 'Арт-реальность', description: 'Посмотрите на себя как на произведение искусства', position: '0% 100%' },
    { name: 'Путешествие во времени', description: 'Шагните в другую эпоху и создайте свою легенду', position: '50% 50%' },
  ];
  let selected = $state(2);
  let preparing = $state(false);
  let toolbar = $state(true);
  let player = $state<HTMLVideoElement>();
  let gallery = $state<HTMLElement>();
  let movement = 0;
  let requested = 2;
  let wrapped = $state<number[]>([]);
  let teleported = $state(false);
  let disposed = false;
  onDestroy(() => { disposed = true; movement++; });
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let back = $state<HTMLButtonElement>();
  
  const current = $derived(stories[selected]!);
  function relative(index: number) { return (index - selected + 7) % 5 - 2; }
  async function select(index: number) {
    const next = (index + 5) % 5;
    requested = next;
    const revision = ++movement;
    if (next === selected) { wrapped = []; teleported = false; return; }
    player?.pause();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      wrapped = []; selected = next; return;
    }
    // Fade only the cards crossing the loop seam, before changing their position.
    wrapped = stories.flatMap((_, i) => Math.abs(relative(i) - ((i - next + 7) % 5 - 2)) > 2 ? [i] : []);
    teleported = false;
    await wait(140);
    if (disposed || revision !== movement) return;
    teleported = true;
    selected = next;
    await wait(600);
    if (disposed || revision !== movement) return;
    wrapped = [];
    teleported = false;
  }
  async function prepare() { player?.pause(); preparing = true; await tick(); back?.focus(); }
  async function restore() { preparing = false; await tick(); gallery?.querySelector<HTMLButtonElement>('.center .choose')?.focus(); }
  function keyboard(event: KeyboardEvent) {
    if (event.key.toLowerCase() === 'h' && !event.ctrlKey && !event.metaKey) toolbar = !toolbar;
    if (event.target instanceof HTMLVideoElement) return;
    if (event.key === 'Escape' && preparing) void restore();
    if (!preparing && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); select(requested + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  }
</script>

<svelte:window onkeydown={keyboard}/>
<svelte:document onvisibilitychange={() => { if (document.hidden) player?.pause(); }}/>
<div class="stage" class:preparing>
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
    <a class="brand" href="./index.html" aria-label="ReelMe — начало"><img src={brandMark} alt="" class="brand-mark"/><span>REELME<small>AI VIDEO BOOTH</small></span></a>
    <ol class="steps" aria-label="Этапы создания"><li class:active={!preparing}><span></span>Сюжет</li><li class:active={preparing}><span></span>Фото</li><li><span></span>Видео</li></ol>
    <div class="event">Ваша киноистория</div>
  </header>
  {#if !preparing}
    <main>
      <div class="intro"><h1>Выберите историю</h1><p>Сделайте фото, а мы превратим его в эффектное видео</p></div>
      <section bind:this={gallery} class="gallery" aria-label="Галерея сюжетов">
        <button class="arrow previous" onclick={() => select(requested - 1)} aria-label="Предыдущий сюжет"><svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></svg></button>
        {#each stories as story, index (story.name)}
          {@const offset = relative(index)}
          <article class="story" class:center={offset === 0} class:side={offset !== 0} class:wrapping={wrapped.includes(index)} class:teleported={teleported && wrapped.includes(index)} style={`--offset:${offset};--portrait:url('${portraits}');--position:${story.position}`}>
            <div class="rim-decoration" aria-hidden="true"><div class="rim-light"><i class="rim-halo"></i><i class="rim-hotspot"></i></div></div>
            <div class="card-surface">
            <div class="center-content" inert={offset !== 0} aria-hidden={offset !== 0}>
              <div class="story-heading"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 13h23v15H5zM4 8l22-5 2 6-23 5zM10 7l5 5m4-7 5 5M11 18l8 4-8 4z"/></svg><div><h2>{story.name}</h2><p>{story.description}</p></div></div>
              <div class="preview">
                {#if index === 2}<video bind:this={player} src={film} controls playsinline preload="metadata" aria-label="Пример сюжета Герой кино"><track kind="captions" /></video>
                {:else}<div class="portrait selected-portrait" role="img" aria-label={story.name}></div><span class="preview-label">Образ вашего сюжета</span>{/if}
              </div>
              <div class="qualities"><span>Кинематографично</span><span>Ваш новый образ</span><span>Видео с вами</span></div>
              <button class="choose" onclick={prepare}>Выбрать этот сюжет <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg></button>
            </div>
              <button class="side-button" inert={offset === 0} aria-hidden={offset === 0} onclick={() => select(index)} aria-label={`Посмотреть сюжет «${story.name}»`}><div class="portrait"></div><div class="side-copy"><h2>{story.name}</h2><span class="template"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 4 10 6-10 6z"/></svg>Шаблон</span></div></button>
            </div>
          </article>
        {/each}
        <button class="arrow next" onclick={() => select(requested + 1)} aria-label="Следующий сюжет"><svg viewBox="0 0 24 24"><path d="m10 5 7 7-7 7"/></svg></button>
      </section>
      <nav class="dots" aria-label="Выбор сюжета">{#each stories as story, index}<button class:active={selected === index} aria-label={story.name} aria-current={selected === index ? 'true' : undefined} onclick={() => select(index)}></button>{/each}</nav>
    </main>
  {:else}
    <main class="preparation"><p class="chosen">Вы выбрали «{current.name}»</p><h1>Теперь — ваша роль</h1><p>Встаньте перед камерой. В кадре — только вы.</p><div class="camera-frame"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="32" r="15"/><path d="M20 87V76c0-27 60-27 60 0v11"/></svg><span>Здесь появится изображение с камеры</span></div><p class="demo-note">Демо следующего шага · камера не подключена</p><button bind:this={back} class="choose" onclick={restore}>Вернуться к сюжетам</button></main>
  {/if}
</div>
{#if toolbar}<aside class="demo-toolbar"><span>ДЕМО</span><span>{preparing ? 'Подготовка к фото' : current.name}</span><span>← → сюжеты · H скрыть панель</span><button onclick={() => toolbar = false} aria-label="Скрыть демо-панель">×</button></aside>{/if}

<style>
  :global(*){box-sizing:border-box} :global(body){margin:0;background:#08060d;color:#fff4fb;font-family:Manrope,sans-serif} :global(button),:global(a){-webkit-tap-highlight-color:transparent} :global(button){font:inherit;color:inherit;cursor:pointer} :global(button:focus-visible),:global(a:focus-visible){outline:3px solid #fff3dd;outline-offset:5px} :global(::selection){background:#f5a4df;color:#281324}
  .stage{position:relative;isolation:isolate;overflow:hidden;width:100%;min-height:100svh;background:radial-gradient(ellipse 24% 18% at 81% 21%,#9d5a7a5c,transparent 80%),radial-gradient(ellipse 23% 14% at 7% 87%,#ce79ab66,transparent 75%),radial-gradient(ellipse 32% 17% at 74% 99%,#995d7555,transparent 80%),radial-gradient(ellipse 45% 25% at 50% 83%,#71394d55,transparent 78%),radial-gradient(ellipse at 63% 28%,#30203490,transparent 55%),#0d0a13;padding:1.5vw 3.3vw .75vw;container-type:inline-size}
  .light-lines{position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none}.light-lines .ribbon{stroke-width:2.8;opacity:.85}.light-lines .glow{stroke-width:22;filter:url(#bloom);opacity:.7}.ribbon-hotspot{opacity:.85}
  header{display:flex;align-items:center;justify-content:space-between;position:relative;height:4vw}.brand{display:flex;align-items:center;gap:1vw;text-decoration:none;color:#fff4fb;font-size:1.5vw;font-weight:800;letter-spacing:.3em}.brand-mark{width:3.5vw;height:3.5vw;object-fit:contain;filter:drop-shadow(0 0 10px #c4915440)}.brand small{display:block;font-size:.52vw;letter-spacing:.45em;font-weight:500;margin-top:.25vw}.event{font-size:.85vw;color:#d3bdce;border:1px solid #75536c;padding:.6vw 1.3vw;border-radius:99px}.steps{position:absolute;left:50%;transform:translateX(-50%);display:flex;list-style:none;gap:5.8vw;padding:0;margin:0}.steps li{font-size:1vw;color:#af9fac;display:grid;justify-items:center;gap:.45vw;position:relative}.steps li+li:before{content:'';position:absolute;top:.7vw;right:calc(50% + .7vw);height:2px;width:7.2vw;background:#5f4c5e}.steps span{width:1.5vw;height:1.5vw;display:block;border:3px solid #6a5669;border-radius:50%;background:#211722;z-index:1}.steps .active{color:#fff4fb;font-weight:700}.steps .active span{background:#fff4fb;border-color:#f5b2d4;box-shadow:0 0 16px #eb8abd}
  .intro{text-align:center;margin:2.1vw 0 2.2vw}h1{font-size:3.7vw;line-height:1.15;letter-spacing:-.035em;margin:0;font-weight:700}.intro p{font-size:1.43vw;color:#c0adbe;margin:.75vw 0 0}
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
  .story-heading{display:flex;gap:1.2vw;align-items:flex-start;height:6.1vw}.story-heading>svg{width:2.7vw;height:2.7vw;flex:none;border:1px solid #df99bc;border-radius:50%;padding:.5vw;stroke:#f2b4d2;fill:none;stroke-width:1.4}.story h2{font-size:1.9vw;margin:0 0 .2vw;font-weight:800;letter-spacing:-.025em}.story-heading p{font-size:.98vw;margin:0;max-width:24vw;line-height:1.4;color:#e8dce6}.preview{height:17.6vw;position:relative;border-radius:1.1vw;overflow:hidden;background:#130e17}.preview video{width:100%;height:100%;object-fit:cover;display:block}.portrait{position:absolute;inset:0;background-image:var(--portrait);background-size:300% 300%;background-position:var(--position)}.side-button .portrait{inset:0 auto auto 50%;width:42.75vw;height:28.5vw;transform:translateX(-50%)}.selected-portrait{inset:50% 0 auto;height:auto;aspect-ratio:3/2;transform:translateY(-50%);background-size:300% 300%;opacity:.85}.preview-label{position:absolute;bottom:1vw;left:1vw;font-size:.85vw;padding:.35vw .7vw;border-radius:99px;background:#160d19bb}.qualities{display:flex;justify-content:space-between;font-size:.76vw;gap:.5vw;color:#e9d4e3;margin:1.25vw 0 1.65vw}.qualities span:before{content:'';display:inline-block;width:.35vw;height:.35vw;background:#f0a2d0;border-radius:50%;vertical-align:middle;margin-right:.45vw}.choose{display:flex;justify-content:center;align-items:center;gap:1vw;width:27vw;margin:auto;border:1px solid #ffe2d4;border-radius:99px;background:linear-gradient(110deg,#ffe5bf,#f58cca 65%,#dc8ee2);color:#241120;min-height:4.2vw;font-size:1.35vw;font-weight:800;box-shadow:0 .4vw 1.5vw #ed89c64a;transition:transform 160ms cubic-bezier(.23,1,.32,1)}.choose svg{width:1.8vw;height:1.8vw;fill:none;stroke:currentColor;stroke-width:1.8}.choose:active{transform:scale(.98)}.side-button{position:absolute;inset:0;display:block;width:100%;height:100%;background:transparent;border:0;padding:0;text-align:left;opacity:1;transition:opacity 260ms ease 170ms}.center .side-button{opacity:0;pointer-events:none;transition:opacity 150ms ease}.side-copy{position:absolute;top:0;bottom:0;left:50%;width:12.5vw;transform:translateX(-50%);display:flex;flex-direction:column;justify-content:flex-end;padding:1.6vw 1.3vw;background:linear-gradient(transparent 40%,#1b1019a0 70%,#1a111bef)}.side-copy h2{font-size:1.32vw;line-height:1.25;margin-bottom:1.15vw}.template{font-size:.9vw;display:flex;align-items:center;justify-content:center;gap:.4vw;border:1px solid #bb809c60;border-radius:99px;padding:.5vw .5vw;background:#51304465;color:#ffe0e1}.template svg{width:1vw;height:1vw;fill:#ffcfc9}.arrow{position:absolute;top:14.5vw;z-index:3;width:2.8vw;height:2.8vw;padding:.6vw;border-radius:50%;border:1px solid #ffd0cf;background:#3e2536aa;box-shadow:0 0 .8vw #eeb0b840}.arrow svg{fill:none;stroke:currentColor;stroke-width:2;width:100%;height:100%}.previous{left:-3.2vw}.next{right:-3.2vw}.dots{display:flex;justify-content:center;gap:.85vw;margin-top:2vw}.dots button{padding:0;border:0;background:#65505e;width:.8vw;height:.8vw;border-radius:50%}.dots button.active{background:#fff0f8;box-shadow:0 0 .7vw #ff8cd2}
  .preparation{text-align:center;padding:3vw 0}.preparation>p{color:#d3bdce;font-size:1.2vw}.preparation .chosen{color:#f5a4df}.camera-frame{width:25vw;height:23vw;margin:1.6vw auto;border:1px solid #d6a0bd;border-radius:2vw;background:#2a1a2a80;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1vw}.camera-frame svg{width:12vw;fill:none;stroke:#a37e98;stroke-width:1}.camera-frame span{font-size:.85vw;color:#d3bdce}.preparation .demo-note{font-size:.85vw}.demo-toolbar{position:fixed;bottom:.6rem;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:1rem;padding:.4rem .7rem;border:1px solid #6c4b65;background:#201721ed;border-radius:8px;font-size:11px;color:#d7c1d2;z-index:5;white-space:nowrap}.demo-toolbar>span:first-child{color:#f5a4df;font-size:9px;letter-spacing:.1em}.demo-toolbar button{border:0;background:none;font-size:18px;padding:0 .3rem}
  @media(hover:hover) and (pointer:fine){.choose:hover{transform:translateY(-2px)}.side-button:hover .template{background:#75405c99}.arrow:hover{background:#76435f}}
  @media(prefers-reduced-motion:reduce){.story,.story.wrapping,.center-content,.center .center-content,.side-button,.center .side-button{transition:none}.choose{transition:none}}
  @media(max-aspect-ratio:4/3){.stage{min-height:100svh;display:flex;flex-direction:column;justify-content:center;padding-bottom:8vw}header{margin-bottom:2vw}.demo-toolbar{max-width:95vw;gap:.5rem;font-size:9px}.demo-toolbar span:nth-child(3){display:none}}
</style>
