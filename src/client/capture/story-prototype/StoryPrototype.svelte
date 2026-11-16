<script lang="ts">
  import { tick } from 'svelte';
  import portraits from './assets/portraits.png';
  import film from '../../../../docs/video templates/1794213414058-yjz13u263xc.mp4?url';
  const stories = [
    { name: 'Космическая миссия', description: 'Отправьтесь навстречу звёздам и новым мирам', position: '0% 0%' },
    { name: 'Королевский бал', description: 'Ваша история, достойная королевского портрета', position: '50% 0%' },
    { name: 'Герой кино', description: 'Станьте главным героем захватывающего фильма', position: '100% 0%' },
    { name: 'Арт-реальность', description: 'Посмотрите на себя как на произведение искусства', position: '0% 50%' },
    { name: 'Путешествие во времени', description: 'Шагните в другую эпоху и создайте свою легенду', position: '100% 100%' },
  ];
  let selected = $state(2);
  let preparing = $state(false);
  let toolbar = $state(true);
  let player = $state<HTMLVideoElement>();
  let back = $state<HTMLButtonElement>();
  let choose = $state<HTMLButtonElement>();
  const current = $derived(stories[selected]!);
  function relative(index: number) { return (index - selected + 7) % 5 - 2; }
  function select(index: number) { player?.pause(); selected = (index + 5) % 5; }
  async function prepare() { player?.pause(); preparing = true; await tick(); back?.focus(); }
  async function restore() { preparing = false; await tick(); choose?.focus(); }
  function keyboard(event: KeyboardEvent) {
    if (event.key.toLowerCase() === 'h' && !event.ctrlKey && !event.metaKey) toolbar = !toolbar;
    if (event.target instanceof HTMLVideoElement) return;
    if (event.key === 'Escape' && preparing) void restore();
    if (!preparing && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); select(selected + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  }
</script>

<svelte:window onkeydown={keyboard}/>
<svelte:document onvisibilitychange={() => { if (document.hidden) player?.pause(); }}/>
<div class="stage" class:preparing>
  <svg class="light-lines" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="light"><stop stop-color="#cc4aaf" stop-opacity="0"/><stop offset=".3" stop-color="#ef96bc"/><stop offset=".48" stop-color="#ffe3be"/><stop offset=".7" stop-color="#df74b9"/><stop offset="1" stop-color="#df74b9" stop-opacity="0"/></linearGradient><filter id="bloom"><feGaussianBlur stdDeviation="15"/></filter></defs>
    <g fill="none" stroke="url(#light)"><path class="glow" d="M-80 300 Q160 230 420 145 M1150 140 Q1400 180 1690 370 M-70 860 Q170 700 485 940 M1160 960 C1410 710 1450 1000 1690 705"/><path d="M-80 300 Q160 230 420 145 M1150 140 Q1400 180 1690 370 M-70 860 Q170 700 485 940 M1160 960 C1410 710 1450 1000 1690 705"/></g>
  </svg>
  <header>
    <a class="brand" href="./index.html" aria-label="ReelMe — начало"><svg viewBox="0 0 42 48" aria-hidden="true"><defs><linearGradient id="logo" x2="1" y2="1"><stop stop-color="#f28acb"/><stop offset="1" stop-color="#ffe1b8"/></linearGradient></defs><path fill="url(#logo)" d="M4 7Q4 0 11 3L35 16Q44 22 35 28L14 42Q4 48 4 38V7Z"/><path fill="#291524" d="m16 15 12 8-12 8z"/></svg><span>REELME<small>AI VIDEO BOOTH</small></span></a>
    <ol class="steps" aria-label="Этапы создания"><li class:active={!preparing}><span></span>Сюжет</li><li class:active={preparing}><span></span>Фото</li><li><span></span>Видео</li></ol>
    <div class="event">Ваша киноистория</div>
  </header>
  {#if !preparing}
    <main>
      <div class="intro"><h1>Выберите историю</h1><p>Сделайте фото, а мы превратим его в эффектное видео</p></div>
      <section class="gallery" aria-label="Галерея сюжетов">
        <button class="arrow previous" onclick={() => select(selected - 1)} aria-label="Предыдущий сюжет"><svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></svg></button>
        {#each stories as story, index (story.name)}
          {@const offset = relative(index)}
          <article class="story" class:center={offset === 0} class:side={offset !== 0} style={`--offset:${offset};--portrait:url('${portraits}');--position:${story.position}`}>
            {#if offset === 0}
              <div class="story-heading"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 13h23v15H5zM4 8l22-5 2 6-23 5zM10 7l5 5m4-7 5 5M11 18l8 4-8 4z"/></svg><div><h2>{story.name}</h2><p>{story.description}</p></div></div>
              <div class="preview">
                {#if selected === 2}<video bind:this={player} src={film} controls playsinline preload="metadata" aria-label="Пример сюжета Герой кино"><track kind="captions" /></video>
                {:else}<div class="portrait selected-portrait" role="img" aria-label={story.name}></div><span class="preview-label">Образ вашего сюжета</span>{/if}
              </div>
              <div class="qualities"><span>Кинематографично</span><span>Ваш новый образ</span><span>Высокое качество</span></div>
              <button bind:this={choose} class="choose" onclick={prepare}>Выбрать этот сюжет <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg></button>
            {:else}
              <button class="side-button" onclick={() => select(index)} aria-label={`Посмотреть сюжет «${story.name}»`}><div class="portrait"></div><div class="side-copy"><h2>{story.name}</h2><span class="template"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 4 10 6-10 6z"/></svg>Шаблон</span></div></button>
            {/if}
          </article>
        {/each}
        <button class="arrow next" onclick={() => select(selected + 1)} aria-label="Следующий сюжет"><svg viewBox="0 0 24 24"><path d="m10 5 7 7-7 7"/></svg></button>
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
  .stage{position:relative;isolation:isolate;overflow:hidden;width:100%;min-height:100svh;background:radial-gradient(ellipse at 76% 26%,#3b233b70,transparent 35%),radial-gradient(ellipse at 30% 100%,#4a26375c,transparent 36%),#0d0a13;padding:1.5vw 3.3vw 2vw;container-type:inline-size}
  .light-lines{position:absolute;inset:0;width:100%;height:100%;z-index:-1;opacity:.75;pointer-events:none}.light-lines path{stroke-width:3}.light-lines .glow{stroke-width:21;filter:url(#bloom)}
  header{display:flex;align-items:center;justify-content:space-between;position:relative;height:4vw}.brand{display:flex;align-items:center;gap:1vw;text-decoration:none;color:#fff4fb;font-size:1.5vw;font-weight:800;letter-spacing:.3em}.brand svg{width:3vw;height:3.5vw;filter:drop-shadow(0 0 12px #ee8bc650)}.brand small{display:block;font-size:.52vw;letter-spacing:.45em;font-weight:500;margin-top:.25vw}.event{font-size:.85vw;color:#d3bdce;border:1px solid #75536c;padding:.6vw 1.3vw;border-radius:99px}.steps{position:absolute;left:50%;transform:translateX(-50%);display:flex;list-style:none;gap:5.8vw;padding:0;margin:0}.steps li{font-size:1vw;color:#af9fac;display:grid;justify-items:center;gap:.45vw;position:relative}.steps li+li:before{content:'';position:absolute;top:.7vw;right:calc(50% + .7vw);height:2px;width:7.2vw;background:#5f4c5e}.steps span{width:1.5vw;height:1.5vw;display:block;border:3px solid #6a5669;border-radius:50%;background:#211722;z-index:1}.steps .active{color:#fff4fb;font-weight:700}.steps .active span{background:#fff4fb;border-color:#f5b2d4;box-shadow:0 0 16px #eb8abd}
  .intro{text-align:center;margin:2.1vw 0 2.2vw}h1{font-size:3.7vw;line-height:1.15;letter-spacing:-.035em;margin:0;font-weight:700}.intro p{font-size:1.43vw;color:#c0adbe;margin:.75vw 0 0}
  .gallery{height:35.8vw;position:relative;margin:0 1.2vw}.story{position:absolute;top:3vw;left:50%;width:12.5vw;height:28.5vw;border-radius:1.8vw;overflow:hidden;background:#261723;border:1px solid #dba4c780;box-shadow:0 1.5vw 3vw #0005;transition:transform 280ms cubic-bezier(.23,1,.32,1),opacity 220ms ease-out;transform:translateX(calc(-50% + var(--offset)*13.2vw + clamp(-1,var(--offset),1)*13.7vw))}.story.center{top:0;width:40vw;height:35.7vw;padding:1.5vw 2vw;transform:translateX(-50%);border:1px solid #ffcdbb;background:radial-gradient(ellipse at 2% 0,#b0527655,transparent 38%),radial-gradient(ellipse at 100% 100%,#aa54806b,transparent 40%),linear-gradient(130deg,#291c29ef,#16121cee);box-shadow:inset 0 0 1vw #e38caa45,0 0 1.4vw #e38caa40,0 2vw 3vw #0007;z-index:2}.story-heading{display:flex;gap:1.2vw;align-items:flex-start;height:6.1vw}.story-heading>svg{width:2.7vw;height:2.7vw;flex:none;border:1px solid #df99bc;border-radius:50%;padding:.5vw;stroke:#f2b4d2;fill:none;stroke-width:1.4}.story h2{font-size:1.9vw;margin:0 0 .2vw;font-weight:800;letter-spacing:-.025em}.story-heading p{font-size:.98vw;margin:0;max-width:24vw;line-height:1.4;color:#e8dce6}.preview{height:17.6vw;position:relative;border-radius:1.1vw;overflow:hidden;background:#130e17}.preview video{width:100%;height:100%;object-fit:cover;display:block}.portrait{position:absolute;inset:0;background-image:var(--portrait);background-size:300% 300%;background-position:var(--position)}.selected-portrait{background-size:300% 300%;opacity:.85}.preview-label{position:absolute;bottom:1vw;left:1vw;font-size:.85vw;padding:.35vw .7vw;border-radius:99px;background:#160d19bb}.qualities{display:flex;justify-content:space-between;font-size:.76vw;gap:.5vw;color:#e9d4e3;margin:1.25vw 0 1.65vw}.qualities span:before{content:'';display:inline-block;width:.35vw;height:.35vw;background:#f0a2d0;border-radius:50%;vertical-align:middle;margin-right:.45vw}.choose{display:flex;justify-content:center;align-items:center;gap:1vw;width:27vw;margin:auto;border:1px solid #ffe2d4;border-radius:99px;background:linear-gradient(110deg,#ffe5bf,#f58cca 65%,#dc8ee2);color:#241120;min-height:4.2vw;font-size:1.35vw;font-weight:800;box-shadow:0 .4vw 1.5vw #ed89c64a;transition:transform 160ms cubic-bezier(.23,1,.32,1)}.choose svg{width:1.8vw;height:1.8vw;fill:none;stroke:currentColor;stroke-width:1.8}.choose:active{transform:scale(.98)}.side-button{display:block;width:100%;height:100%;background:transparent;border:0;padding:0;text-align:left}.side-copy{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:1.6vw 1.3vw;background:linear-gradient(transparent 40%,#1b1019a0 70%,#1a111bef)}.side-copy h2{font-size:1.32vw;line-height:1.25;margin-bottom:1.15vw}.template{font-size:.9vw;display:flex;align-items:center;justify-content:center;gap:.4vw;border:1px solid #bb809c60;border-radius:99px;padding:.5vw .5vw;background:#51304465;color:#ffe0e1}.template svg{width:1vw;height:1vw;fill:#ffcfc9}.arrow{position:absolute;top:14.5vw;z-index:3;width:2.8vw;height:2.8vw;padding:.6vw;border-radius:50%;border:1px solid #ffd0cf;background:#3e2536aa;box-shadow:0 0 .8vw #eeb0b840}.arrow svg{fill:none;stroke:currentColor;stroke-width:2;width:100%;height:100%}.previous{left:-3.2vw}.next{right:-3.2vw}.dots{display:flex;justify-content:center;gap:.85vw;margin-top:2vw}.dots button{padding:0;border:0;background:#65505e;width:.8vw;height:.8vw;border-radius:50%}.dots button.active{background:#fff0f8;box-shadow:0 0 .7vw #ff8cd2}
  .preparation{text-align:center;padding:3vw 0}.preparation>p{color:#d3bdce;font-size:1.2vw}.preparation .chosen{color:#f5a4df}.camera-frame{width:25vw;height:23vw;margin:1.6vw auto;border:1px solid #d6a0bd;border-radius:2vw;background:#2a1a2a80;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1vw}.camera-frame svg{width:12vw;fill:none;stroke:#a37e98;stroke-width:1}.camera-frame span{font-size:.85vw;color:#d3bdce}.preparation .demo-note{font-size:.85vw}.demo-toolbar{position:fixed;bottom:.6rem;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:1rem;padding:.4rem .7rem;border:1px solid #6c4b65;background:#201721ed;border-radius:8px;font-size:11px;color:#d7c1d2;z-index:5;white-space:nowrap}.demo-toolbar>span:first-child{color:#f5a4df;font-size:9px;letter-spacing:.1em}.demo-toolbar button{border:0;background:none;font-size:18px;padding:0 .3rem}
  @media(hover:hover) and (pointer:fine){.choose:hover{transform:translateY(-2px)}.side-button:hover .template{background:#75405c99}.arrow:hover{background:#76435f}}
  @media(prefers-reduced-motion:reduce){.story{transition:opacity 120ms ease-out}.choose{transition:none}}
  @media(max-aspect-ratio:4/3){.stage{min-height:100svh;display:flex;flex-direction:column;justify-content:center;padding-bottom:8vw}header{margin-bottom:2vw}.demo-toolbar{max-width:95vw;gap:.5rem;font-size:9px}.demo-toolbar span:nth-child(3){display:none}}
</style>
