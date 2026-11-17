<script lang="ts">
  // Isolated, in-memory visual prototype. All captures are illustrative unless a local image is loaded.
  import { onDestroy, onMount, tick } from 'svelte';
  import { ribbonLight } from './motion';
  import { rimWave } from '../../cloud/results-prototype/motion';
  import type { Pose } from '../../../shared/capture';
  import reference from './assets/reference.png';
  import brand from '../story-prototype/assets/reelme-mark.png';
  import portraits from '../story-prototype/assets/portraits.png';
  const paths = ['M410 -60 C650 190 870 70 1080 -60', 'M-80 720 C180 535 340 700 600 890', 'M550 980 C960 670 1110 1030 1670 630'];
  const stories = ['Космическая миссия', 'Королевский бал', 'Герой кино'];
  const positions = ['50% 0%', '100% 0%', '0% 50%'];
  const instructions = ['Повернитесь к камере вполоборота', 'Повернитесь другим плечом к камере', 'Посмотрите прямо в объектив', 'Улыбнитесь и чуть наклоните голову'];
  let count = $state(4);
  let plan = $derived<Pose[]>(Array.from({length:count}, (_,i) => ({index:i, key: 'front', instruction:instructions[i%4]!, guideNumber: (i%4+1) as 1|2|3|4})));
  let photos = $state<string[]>([]);
  let current = $derived(Math.min(photos.length, count-1));
  let pose = $derived(plan[current]!);
  let scene = $state(0);
  let running = $state(false);
  let phase = $state<'ready'|'countdown'|'capture'|'error'|'complete'|'finished'>('ready');
  let countdown = $state(3);
  let toolbar = $state(true);
  let preview = $state(true);
  let failNext = $state(false);
  let slow = $state(false);
  let waveVersion = $state(0);
  let dialogMode = $state<'restart'|'scenario'|'choose'>('restart');
  let dialog = $state<HTMLDialogElement>();
  let isDialog = $state(false);
  let wasRunning = false;
  let trigger: HTMLElement | null = null;
  let localImage = $state('');
  let guides = $state<Record<number,string>>({});
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  let disposed = false;
  const urls = new Set<string>();
  const busy = $derived(phase === 'capture');
  const done = $derived(photos.length === count);
  const status = $derived(phase === 'finished' ? 'Серия завершена' : done ? 'Все кадры готовы' : phase === 'error' ? 'Кадр не получен' : running ? (busy ? 'Сохраняем кадр' : 'Приготовьтесь') : 'На паузе');
  const clear = () => { clearTimeout(timer); timer = undefined; };
  function later(fn: () => void, ms: number) { clear(); const id=revision; timer=setTimeout(()=>{timer=undefined;if(!disposed&&id===revision)fn();},ms); }
  function begin() { if(done || isDialog || disposed)return; phase='countdown';countdown=3;later(step,1000); }
  function step() { if(!running || isDialog)return; if(countdown>1){countdown--;later(step,1000);}else capture(); }
  function capture() {
    phase='capture';
    later(()=>{
      if(failNext){failNext=false;phase='error';running=false;return;}
      photos=[...photos,localImage || reference];
      if(photos.length===count){phase='complete';running=false;return;}
      phase='ready'; if(running)later(begin,1400);
    },slow?2500:500);
  }
  function toggle(){
    if(done || isDialog)return;
    running=!running;
    if(!running){if(!busy){clear();phase='ready';countdown=3;}}
    else if(!busy)begin();
  }
  function retake(){if(busy||!photos.length)return;clear();revision++;photos=photos.slice(0,-1);phase='ready';if(running)begin();}
  function reset(){clear();revision++;photos=[];phase='ready';countdown=3;running=false;}
  async function open(mode:'restart'|'scenario',event:MouseEvent){if(busy)return;trigger=event.currentTarget as HTMLElement;wasRunning=running;running=false;clear();if(phase==='countdown')phase='ready';dialogMode=mode;isDialog=true;await tick();dialog?.showModal();}
  function close(resume=true){dialog?.close();isDialog=false;trigger?.focus();if(resume&&wasRunning&&!done){running=true;begin();}}
  function confirm(){if(dialogMode==='scenario'){dialogMode='choose';return;}reset();close(false);running=true;begin();}
  function choose(index:number){scene=index;reset();close(false);}
  function changeCount(){reset();}
  function file(event:Event,guide=false){const input=event.currentTarget as HTMLInputElement;const f=input.files?.[0];if(!f)return;const url=URL.createObjectURL(f);urls.add(url);if(guide)guides={...guides,[current]:url};else localImage=url;}
  function keyboard(e:KeyboardEvent){if(e.key.toLowerCase()==='h' && !(e.target instanceof HTMLInputElement && e.target.type==='file') && !(e.target instanceof HTMLSelectElement))toolbar=!toolbar;}
  onMount(()=>{const params=new URLSearchParams(location.search);toolbar=params.get('tools')!=='0';if(params.get('autoplay')==='1'){running=true;begin();}});
  onDestroy(()=>{disposed=true;revision++;clear();urls.forEach(url=>URL.revokeObjectURL(url));});
</script>

<svelte:window onkeydown={keyboard}/>
<svelte:document onvisibilitychange={()=>{if(document.hidden&&running){running=false;if(!busy){clear();phase='ready';}}}}/>
{#snippet icon(name:string)}
<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
{#if name==='back'}<path d="M25 16H7m9-9-9 9 9 9"/>{:else if name==='restart'}<path d="M26 12a11 11 0 0 0-19-4L4 12m0-7v7h7M6 20a11 11 0 0 0 19 4l3-4m0 7v-7h-7"/>{:else if name==='person'}<circle cx="16" cy="9" r="6"/><path d="M5 29c0-12 22-12 22 0"/>{:else if name==='frames'}<rect x="5" y="9" width="19" height="18" rx="2"/><rect x="10" y="4" width="18" height="19" rx="2" transform="rotate(8 19 14)"/>{:else if name==='plus'}<path d="M16 6v20M6 16h20"/>{:else if name==='play'}<path d="m12 7 14 9-14 9Z" fill="currentColor" stroke="none"/>{:else if name==='pause'}<path d="M11 8v16M21 8v16" stroke-width="5"/>{:else if name==='check'}<path d="m7 16 6 6L26 9"/>{:else}<circle cx="16" cy="10" r="4"/><circle cx="6" cy="12" r="3"/><circle cx="26" cy="12" r="3"/><path d="M9 27v-3c0-9 14-9 14 0v3H9M2 25v-3c0-5 4-6 7-5m14 0c4-1 7 1 7 5v3"/>{/if}
</svg>
{/snippet}
{#snippet rim()}
<div class="rim-decoration" aria-hidden="true"><div class="rim-light"><i class="rim-halo"></i><i class="rim-hotspot"></i></div><div class="rim-light rim-breath"><i class="rim-halo"></i><i class="rim-hotspot"></i></div></div>
{/snippet}
{#snippet corners()}<div class="corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>{/snippet}
{#snippet counter()}{#if phase==='countdown'}{#key countdown}<div class="countdown" aria-label={`Снимок через ${countdown}`}><span>{countdown}</span></div>{/key}{/if}{/snippet}
<div class="page">
<div class="stage" style={`--reference:url('${reference}')`}>
  <svg class="light-lines" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true"><defs>
    <linearGradient id="line"><stop stop-color="#d36aaa" stop-opacity="0"/><stop offset=".25" stop-color="#ec85bc"/><stop offset=".43" stop-color="#ffe5c4"/><stop offset=".56" stop-color="#ef9ac4"/><stop offset="1" stop-color="#d76ab5" stop-opacity="0"/></linearGradient>
    <radialGradient id="halo"><stop stop-color="#fff3f3" stop-opacity=".9"/><stop offset=".18" stop-color="#ffb0da" stop-opacity=".8"/><stop offset=".5" stop-color="#ed63bb" stop-opacity=".4"/><stop offset="1" stop-color="#d348a1" stop-opacity="0"/></radialGradient>
    <radialGradient id="core"><stop stop-color="#fffaf5"/><stop offset=".4" stop-color="#fff2f2"/><stop offset=".72" stop-color="#ffbbdf" stop-opacity=".8"/><stop offset="1" stop-color="#ff8bcd" stop-opacity="0"/></radialGradient>
    <filter id="bloom" x="-30%" y="-150%" width="160%" height="400%"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>{#each paths as path}<g fill="none" stroke="url(#line)"><path class="glow" d={path}/><path class="ribbon" d={path}/></g><g use:ribbonLight={{path,from:5,to:95}}><ellipse rx="120" ry="36" fill="url(#halo)"/><ellipse rx="62" ry="6" fill="url(#halo)"/><ellipse rx="40" ry="2.5" fill="url(#core)"/></g>{/each}</svg>
  <header><div class="brand"><img src={brand} alt=""/><span>REELME</span></div><div class="event">{@render icon('people')}<span>Сессия мероприятия TechParty 2026</span></div></header>
  <div class="composition" use:rimWave={{pageVersion:0,gain:1,previewVersion:waveVersion}}>
    <button class="story framed" disabled={busy} onclick={(e)=>open('scenario',e)} aria-label="Выбрать другой сценарий">
      <div class="story-media"><div class="story-image" style={`background-image:url('${portraits}');background-position:${positions[scene]}`}></div></div><div class="story-shade"></div><h1>{stories[scene]}</h1>{@render rim()}
    </button>
    <section class="pose framed" aria-label={`Образец позы ${pose.guideNumber}`}>
      <div class="pose-picture" class:alternate={current%4===1 && !guides[current]} style={guides[current]?`background-image:url('${guides[current]}');background-size:cover;background-position:center`:current%4>=2?`background-image:url('${portraits}');background-size:auto 300%;background-position:${current%4===2?'13% 0%':'50% 100%'}`:''}></div>
      <div class="pose-shade"></div>{#if guides[current] || current%4>=2}{@render corners()}{/if}
      <div class="pose-copy">{@render icon('person')}<p>Встаньте<br/>в такую позу</p><small>{pose.instruction}</small></div>
      {@render counter()}{@render rim()}
    </section>
    <section class="live framed" aria-label="Предпросмотр камеры" aria-busy={busy}>
      <div class="live-surface">
        {#if preview}<div class="live-image" style={localImage?`background-image:url('${localImage}');background-size:cover;background-position:center`:''}></div>{:else}<div class="fallback">{@render icon('person')}<h2>Превью недоступно</h2><p>Повторите позу слева и смотрите в камеру</p></div>{/if}
        {#if localImage || !preview}{@render corners()}{/if}
        {#if phase==='ready' && !running && !done}<div class="live-note">Когда будете готовы, нажмите Play</div>{/if}
        {#if phase==='error'}<div class="notice"><h2>Не удалось получить кадр</h2><p>Сделанные фотографии сохранены</p><button onclick={()=>{running=true;begin();}}>Повторить</button></div>{/if}
        {#if done}<div class="notice complete">{@render icon('check')}<h2>{phase==='finished'?'Фотосессия завершена':'Отлично! Все кадры готовы'}</h2><p>{phase==='finished'?'Это демо — фотографии никуда не отправлены':'Можно переснять последний кадр или завершить серию'}</p>{#if phase!=='finished'}<button onclick={()=>phase='finished'}>Завершить фотосессию</button>{/if}</div>{/if}
        {@render counter()}
        {#if busy}<div class="flash" aria-hidden="true"></div>{/if}
      </div>{@render rim()}
    </section>
  </div>
  <footer>
    <div class="thumbnails" class:many={count>4} aria-label="Сделанные фотографии">{#each plan as item}<div class="thumbnail" class:filled={!!photos[item.index]} class:current={item.index===current&&!done} aria-label={`Кадр ${item.index+1}: ${photos[item.index]?'снят':'ожидается'}`}>{#if photos[item.index]}<div class="thumb-image" style={photos[item.index]!==reference?`background-image:url('${photos[item.index]}');background-size:cover;background-position:center`:''}></div><span>{item.index+1}</span>{:else}{@render icon('plus')}{/if}</div>{/each}</div>
    <div class="controls"><button class="round" disabled={!photos.length||busy} onclick={retake} aria-label="Переснять предыдущий кадр" title="Переснять предыдущий кадр">{@render icon('back')}</button><button class="round" disabled={busy} onclick={e=>open('restart',e)} aria-label="Начать заново" title="Начать заново">{@render icon('restart')}</button><div class="progress" aria-live="polite">{@render icon('frames')}<div><span>{done?'Снято':'Кадр'}</span><strong>{done?count:current+1} из {count}</strong></div><div class="dots">{#each plan as item}<i class:done={item.index<photos.length} class:active={item.index===current&&!done}></i>{/each}</div></div><button class="play" class:paused={!running} disabled={done} onclick={toggle} aria-label={running?'Пауза':'Продолжить съёмку'} title={running?'Пауза':'Продолжить съёмку'}>{@render icon(running?'pause':'play')}</button></div>
  </footer>
</div>
{#if toolbar}<aside class="toolbar" aria-label="Настройки демонстрации"><b>ПРОТОТИП · камера не подключена</b><span class="state">{status} · {photos.length}/{count}</span><label>Кадров <select aria-label="Число кадров" bind:value={count} onchange={changeCount} disabled={busy}><option value={1}>1</option><option value={4}>4</option><option value={8}>8</option></select></label><label><input type="checkbox" bind:checked={preview}/> Превью</label><label><input type="checkbox" bind:checked={slow}/> Задержка</label><label><input type="checkbox" bind:checked={failNext}/> Ошибка кадра</label><button onclick={()=>waveVersion++}>Волна света</button><label class="file">Своя фотография<input type="file" accept="image/*" onchange={e=>file(e)}/></label><label class="file">Поза {current+1}<input type="file" accept="image/*" onchange={e=>file(e,true)}/></label><button onclick={()=>toolbar=false}>Скрыть · H</button><small>Изображения иллюстративные. Для каждой позы можно загрузить свой образец.</small></aside>{/if}
</div>
<dialog bind:this={dialog} oncancel={e=>{e.preventDefault();close();}} aria-labelledby="dialog-title">
{#if dialogMode==='choose'}<h2 id="dialog-title">Выберите другой сюжет</h2><div class="choices">{#each stories as story,index}<button onclick={()=>choose(index)}><div style={`background-image:url('${portraits}');background-position:${positions[index]}`}></div><span>{story}</span></button>{/each}</div><button class="cancel" onclick={()=>close()}>Остаться в фотосессии</button>
{:else}<h2 id="dialog-title">{dialogMode==='restart'?'Начать фотосессию заново?':'Выбрать другой сценарий?'}</h2><p>{photos.length?'Сделанные кадры будут сброшены.':'Текущая серия начнётся заново.'}</p><div class="dialog-actions"><button class="cancel" onclick={()=>close()}>Отмена</button><button class="confirm" onclick={confirm}>{dialogMode==='restart'?'Начать заново':'Выбрать сценарий'}</button></div>{/if}
</dialog>

<style>
:global(*){box-sizing:border-box}:global(body){margin:0;background:#08060d;color:#fff4fb;font-family:Manrope,sans-serif}:global(button),:global(select),:global(input){font:inherit}:global(button){color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}:global(button:disabled){cursor:default}:global(button:focus-visible),:global(select:focus-visible),:global(input:focus-visible){outline:3px solid #ffe6c8;outline-offset:5px}:global(::selection){background:#f5a4df;color:#281324}:global(svg){display:block}:global(input){accent-color:#ed9ecf}:global(select){color:#fff4fb;background:#301c30}:global(::-webkit-scrollbar){width:8px}:global(::-webkit-scrollbar-thumb){background:#80536e;border-radius:8px}
.page{min-height:100svh;display:flex;flex-direction:column;justify-content:center}.stage{width:100%;aspect-ratio:16/9;position:relative;isolation:isolate;overflow:hidden;container-type:inline-size;background:radial-gradient(ellipse 24% 18% at 70% 3%,#9d5a7a44,transparent 80%),radial-gradient(ellipse 28% 18% at 7% 87%,#ce79ab38,transparent 75%),radial-gradient(ellipse 32% 17% at 74% 99%,#995d7555,transparent 80%),radial-gradient(ellipse at 63% 28%,#30203460,transparent 55%),#0d0a13;padding:1.4cqw 2.7cqw 2.4cqw}.light-lines{position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none}.ribbon{stroke-width:2.8;opacity:.85}.glow{stroke-width:22;filter:url(#bloom);opacity:.7}header{height:6.3cqw}.brand{display:flex;align-items:center;gap:1.05cqw;font-size:2.05cqw;font-weight:800;letter-spacing:.23em}.brand img{width:2.7cqw;height:2.7cqw;object-fit:contain;filter:drop-shadow(0 0 .6cqw #c4915440)}.event{display:flex;gap:1.1cqw;align-items:center;margin-top:.3cqw;font-size:1.26cqw}.event svg{width:2.5cqw;height:1.8cqw}.composition{height:35.7cqw;display:grid;grid-template-columns:16.5fr 12.5fr 64fr;gap:1.65cqw;align-items:center}.framed{position:relative;border-radius:2.2cqw;background:linear-gradient(135deg,#2e1b2b,#170f1b);box-shadow:0 1cqw 2.5cqw #0005}.story{border:0;padding:0;height:26.7cqw;text-align:left;align-self:center;transform:translateY(-1.6cqw)}.story-media{position:absolute;inset:0;border-radius:inherit;overflow:hidden}.story-image{position:absolute;top:0;left:50%;width:40.05cqw;height:26.7cqw;transform:translateX(-50%);background-size:300% 300%}.story-shade{position:absolute;inset:0;border-radius:inherit;background:linear-gradient(transparent 47%,#140d14e6 91%)}h1{position:absolute;bottom:2.1cqw;left:2cqw;right:1.2cqw;font-size:1.85cqw;line-height:1.15;margin:0;letter-spacing:-.025em}.pose{height:30cqw;transform:translateY(-.3cqw);overflow:visible}.pose-picture{position:absolute;inset:0 0 5.3cqw;background-image:var(--reference);background-size:883% 272%;background-position:24.4% 28.7%;border-radius:inherit}.pose-picture.alternate{transform:scaleX(-1)}.pose-shade{position:absolute;inset:0;border-radius:inherit;background:linear-gradient(transparent 43%,#211223f5 77%)}.pose-copy{position:absolute;bottom:1.35cqw;inset-inline:.8cqw;text-align:center}.pose-copy>svg{width:3.3cqw;height:3.3cqw;margin:0 auto .5cqw;filter:drop-shadow(0 0 .35cqw #ff8dcd)}.pose-copy p{font-size:1.32cqw;line-height:1.35;margin:0}.pose-copy small{display:block;font-size:.67cqw;line-height:1.35;color:#efd5e6;margin:.6cqw auto 0;max-width:10cqw}.live{height:35.7cqw;transform:translateY(-2.05cqw);border-radius:2.7cqw}.live-surface{position:absolute;inset:0;overflow:hidden;border-radius:inherit;background:#241a26}.live-image,.thumb-image{position:absolute;inset:0;background-image:var(--reference);background-size:157.1% 157%;background-position:95.4% 28.2%}.live-image{transform:scaleX(-1)}.corners{position:absolute;inset:2.65cqw;pointer-events:none}.corners i{position:absolute;width:2.9cqw;height:2.9cqw;border:solid #fff4ee;border-width:0;filter:drop-shadow(0 0 .35cqw #ffb0da)}.corners i:nth-child(1){top:0;left:0;border-top-width:.2cqw;border-left-width:.2cqw;border-radius:1.15cqw 0 0}.corners i:nth-child(2){top:0;right:0;border-top-width:.2cqw;border-right-width:.2cqw;border-radius:0 1.15cqw 0 0}.corners i:nth-child(3){bottom:0;left:0;border-bottom-width:.2cqw;border-left-width:.2cqw;border-radius:0 0 0 1.15cqw}.corners i:nth-child(4){bottom:0;right:0;border-bottom-width:.2cqw;border-right-width:.2cqw;border-radius:0 0 1.15cqw}.pose .corners{inset:2.5cqw 1.5cqw 12.5cqw}.pose .corners i{width:1.65cqw;height:1.65cqw;border-radius:.8cqw 0 0}.pose .corners i:nth-child(2){border-radius:0 .8cqw 0 0}.pose .corners i:nth-child(3){border-radius:0 0 0 .8cqw}.pose .corners i:nth-child(4){border-radius:0 0 .8cqw}.live-note{position:absolute;bottom:1.3cqw;left:50%;transform:translateX(-50%);padding:.6cqw 1.2cqw;border-radius:99px;background:#201323cc;font-size:.85cqw;white-space:nowrap}.countdown{position:absolute;inset:0;display:grid;place-items:center;background:#180c2140;z-index:2}.countdown span{font-size:10cqw;line-height:1;font-weight:700;text-shadow:0 .25cqw 1.5cqw #311126a0;animation:count .8s cubic-bezier(.23,1,.32,1) both}.pose .countdown{border-radius:inherit}.pose .countdown span{font-size:6cqw}@keyframes count{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}.flash{position:absolute;inset:0;background:#fff;z-index:4}.fallback,.notice{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:3cqw}.fallback>svg{width:8cqw;color:#dcbad1;margin-bottom:1cqw}.fallback h2,.notice h2{font-size:2cqw;margin:0}.fallback p,.notice p{font-size:1cqw;color:#eedce9}.notice{background:#1b1024df;z-index:3}.notice>svg{width:5cqw;height:5cqw;margin-bottom:1cqw;color:#f5b8d9}.notice button{margin-top:1cqw;border:0;border-radius:99px;padding:1cqw 2cqw;background:#f5b0d8;color:#281324;font-size:1cqw;font-weight:700}
footer{display:grid;grid-template-columns:29.8fr 64fr;gap:1.65cqw;height:9.2cqw;align-items:center}.thumbnails{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.8cqw;align-content:center}.thumbnail{height:6.8cqw;position:relative;border:1px dashed #c08da9;border-radius:1.25cqw;background:linear-gradient(130deg,#39273955,#281b2c99);display:grid;place-items:center;overflow:hidden}.thumbnails:has(.thumbnail:only-child){grid-template-columns:6.6cqw}.thumbnail>svg{width:2cqw;height:2cqw;stroke-width:1}.thumbnail.filled{border:1px solid #ffd1e3}.thumbnail span{position:absolute;bottom:.3cqw;right:.4cqw;background:#271425c9;border-radius:50%;width:1.2cqw;height:1.2cqw;display:grid;place-items:center;font-size:.65cqw}.thumb-image{background-size:auto 157%;background-position:78% 28.2%}.many{grid-template-columns:repeat(8,minmax(0,1fr));gap:.4cqw}.many .thumbnail{height:5.4cqw;border-radius:.75cqw}.controls{display:flex;align-items:center;gap:1.4cqw;padding-left:2cqw}.round{width:4.6cqw;height:4.6cqw;border-radius:50%;border:1px solid #9f4f7b66;background:radial-gradient(ellipse at 35% 20%,#5c304b65,#281828);display:grid;place-items:center;padding:1.2cqw}.round svg{width:100%;height:100%}.round:disabled{opacity:.35}.progress{margin-left:1cqw;display:flex;align-items:center;gap:1.4cqw;min-height:4.7cqw;padding:.6cqw 1.8cqw;border-radius:99px;border:1px solid #ba6b9690;background:linear-gradient(115deg,#3c273d95,#241822d9);flex:1}.progress>svg{width:2.3cqw;height:2.3cqw}.progress>div:not(.dots){display:grid;gap:.1cqw;font-size:1.1cqw;white-space:nowrap}.progress span{color:#e4cddd}.progress strong{font-weight:600;font-variant-numeric:tabular-nums}.dots{display:flex;gap:.55cqw;margin-left:auto}.dots i{width:.8cqw;height:.8cqw;background:#68475e;border-radius:50%}.dots i.done{background:#dda0c4}.dots i.active{background:#fff2fb;box-shadow:0 0 .8cqw #ff89cd}.play{flex:none;margin-left:2.5cqw;width:8.8cqw;height:8.8cqw;padding:2.3cqw;border-radius:50%;border:2px solid #fff0e5;background:radial-gradient(ellipse at 25% 20%,#fff8da,#ffc7cf 35%,#ed89ce 69%,#d77ce7);color:#3f1832;box-shadow:0 0 1cqw #f6a2d4a0,inset 0 0 .65cqw #fff3df;transition:transform 160ms cubic-bezier(.23,1,.32,1)}.play svg{width:100%;height:100%}.play:active{transform:scale(.97)}.play:disabled{opacity:.4}.rim-decoration{position:absolute;inset:-1px;pointer-events:none;border-radius:inherit;z-index:5}.rim-light{--corner-light:radial-gradient(ellipse 38% 85% at 8% 0%,#ffbbe0 0%,#fb7dbf 24%,#e969bda8 43%,transparent 78%),radial-gradient(ellipse 22% 58% at 100% 100%,#ffe5ef 0%,#ff9cd0 20%,#ed71bfab 45%,transparent 88%);position:absolute;inset:0;border-radius:inherit}.rim-light:before,.rim-halo:before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--corner-light);padding:1.15px;mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude}.rim-halo{position:absolute;inset:0;border-radius:inherit;filter:blur(.36cqw);opacity:.95}.rim-halo:before{padding:.42cqw}.rim-hotspot{position:absolute;top:-.025cqw;left:8%;width:14%;height:.12cqw;background:linear-gradient(90deg,transparent,#ffb0da 18%,#fffaf4 38%,#fffaf4 57%,#ffc3e3 72%,transparent);filter:drop-shadow(0 0 .15cqw #ffe5f2) drop-shadow(0 0 .32cqw #ff7fcaa6)}.rim-breath{opacity:0}.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 18px;padding:12px 24px;background:#201721;border-top:1px solid #61445c;color:#ead6e5;font-size:12px}.toolbar b{font-size:11px;color:#f5b0d8}.toolbar label{display:flex;gap:5px;align-items:center}.toolbar button,.file{padding:5px 9px;border:1px solid #86607a;border-radius:6px;background:#392639;color:#fff4fb;cursor:pointer}.toolbar select{border:1px solid #86607a;border-radius:4px;padding:3px}.toolbar small{flex-basis:100%;text-align:center;color:#d7bbcf}.file input{max-width:140px;font-size:10px}.state{min-width:110px}.toolbar .file{max-width:220px}dialog{max-width:640px;width:calc(100% - 40px);padding:36px;border:1px solid #ad7195;border-radius:24px;background:linear-gradient(135deg,#392238,#1c1322);color:#fff4fb;box-shadow:0 24px 80px #0009}dialog::backdrop{background:#09050dbb;backdrop-filter:blur(8px)}dialog h2{font-size:28px;line-height:1.2;margin:0 0 16px;letter-spacing:-.025em}dialog p{color:#e5ccdd;margin:0 0 30px;font-size:16px}.dialog-actions{display:flex;justify-content:flex-end;gap:14px}dialog button{padding:12px 20px;border:1px solid #a16d8b;border-radius:99px;background:#42263d;font-size:15px}dialog .confirm{background:#f5b0d8;border-color:#f5b0d8;color:#281324;font-weight:700}.choices{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:25px 0}.choices button{border-radius:16px;padding:0;overflow:hidden;font-size:13px}.choices button>div{height:170px;background-size:auto 300%}.choices span{display:block;padding:12px 8px}.choices+.cancel{display:block;margin-left:auto}
@media(hover:hover) and (pointer:fine){.round:not(:disabled):hover{background:#63354f}.play:not(:disabled):hover{transform:scale(1.025)}.story:not(:disabled):hover h1{color:#ffcee9}}
@media(prefers-reduced-motion:reduce){.countdown span{animation:none}.flash{display:none}.play{transition:none}}
@media(max-width:700px){.page{justify-content:flex-start;padding-top:10svh}.toolbar{font-size:11px;padding:15px 10px;gap:10px}.toolbar b,.toolbar small{flex-basis:100%;text-align:center}.toolbar .file{display:none}dialog{padding:24px}dialog h2{font-size:24px}.choices{gap:7px}.choices button>div{height:130px}.dialog-actions{flex-wrap:wrap}}
</style>
