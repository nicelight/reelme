<script module lang="ts">
  /** Presentation-only state names and URL handles; original JPEG Blobs remain owned by Capture. */
  export type CapturePhase = 'ready' | 'countdown' | 'camera' | 'confirmation' | 'paused' | 'error' | 'review' | 'complete';
  export interface PhotoThumbnail { poseIndex: number; url: string }
</script>
<script lang="ts">
  /** Module contract: render the approved photo-session surface from controller state.
   * Dialogs pause local sequencing before opening. Only explicit confirmation may
   * restart or leave; camera/transfer locks are never bypassed. No camera, API writes,
   * persistence, demo images or JPEG ownership here. Source: FT-002-AC-006. */
  import { tick } from 'svelte';
  import type { StartReceipt } from '../../../shared/capture';
  import PoseGuide from '../PoseGuide.svelte';
  import ProtectedMedia from '../ProtectedMedia.svelte';
  import { ribbonLight } from '../story/motion';
  import { rimWave } from '../../cloud/results/motion';
  import brand from '../story/assets/reelme-mark.png';
  import '../story/assets/fonts.css';
  import './session.css';
  let { receipt, installationKey, position, phase, countdown, preview, previewEnabled, confirmed, thumbnails,
    error, pendingCapture, cameraLocked, pauseAfterCapture, onrun, onpause, onretake, onrestart, onfinish, onscenario, onstoppreview }: {
    receipt: StartReceipt; installationKey: string; position: number; phase: CapturePhase;
    countdown: number; preview: string; previewEnabled: boolean; confirmed: string; thumbnails: PhotoThumbnail[];
    error: string; pendingCapture: boolean; cameraLocked: boolean; pauseAfterCapture: boolean;
    onrun: () => void; onpause: () => void; onretake: () => void; onrestart: () => void; onfinish: () => void;
    onscenario: () => void; onstoppreview: () => void;
  } = $props();
  const paths = ['M410 -60 C650 190 870 70 1080 -60', 'M-80 720 C180 535 340 700 600 890', 'M550 980 C960 670 1110 1030 1670 630'];
  const pose = $derived(receipt.posePlan[position]!);
  const count = $derived(receipt.posePlan.length);
  const story = $derived(receipt.story);
  const title = $derived(story?.description.trim().split(/\s+/).slice(0,3).join(' ') || 'Выбранный сюжет');
  const active = $derived(phase === 'countdown' || phase === 'confirmation' || (phase === 'camera' && !pauseAfterCapture));
  const playLabel = $derived(active ? 'Пауза' : phase === 'ready' && thumbnails.length === 0 ? 'Начать съёмку' : 'Продолжить');
  const date = $derived(new Date(`${receipt.date}T12:00:00`).toLocaleDateString('ru-RU', {day:'numeric',month:'long',year:'numeric'}));
  let dialog = $state<HTMLDialogElement>();
  let dialogMode = $state<'restart'|'scenario'>('restart');
  let resumeOnCancel = false;
  let trigger: HTMLElement | null = null;
  async function open(mode:'restart'|'scenario', event:MouseEvent) {
    if(cameraLocked || phase === 'complete')return;
    trigger=event.currentTarget as HTMLElement;resumeOnCancel=active;dialogMode=mode;
    const participantBeforePause=pose.participant;
    if(active)onpause();
    await tick();
    // Cancelling must not skip the explicit readiness boundary for another person.
    if(pose.participant!==participantBeforePause)resumeOnCancel=false;
    dialog?.showModal();
  }
  function close(resume=true) { dialog?.close();trigger?.focus();if(resume&&resumeOnCancel)onrun(); }
  function confirm() {
    if(cameraLocked)return;
    close(false);
    if(dialogMode==='restart')onrestart();else onscenario();
  }
</script>
<svelte:document onvisibilitychange={()=>{if(document.hidden&&active)onpause();}}/>
{#snippet icon(name:string)}
<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
{#if name==='back'}<path d="M25 16H7m9-9-9 9 9 9"/>{:else if name==='restart'}<path d="M26 12a11 11 0 0 0-19-4L4 12m0-7v7h7M6 20a11 11 0 0 0 19 4l3-4m0 7v-7h-7"/>{:else if name==='person'}<circle cx="16" cy="9" r="6"/><path d="M5 29c0-12 22-12 22 0"/>{:else if name==='frames'}<rect x="5" y="9" width="19" height="18" rx="2"/><rect x="10" y="4" width="18" height="19" rx="2" transform="rotate(8 19 14)"/>{:else if name==='plus'}<path d="M16 6v20M6 16h20"/>{:else if name==='play'}<path d="m12 7 14 9-14 9Z" fill="currentColor" stroke="none"/>{:else if name==='pause'}<path d="M11 8v16M21 8v16" stroke-width="5"/>{:else if name==='check'}<path d="m7 16 6 6L26 9"/>{:else}<circle cx="16" cy="10" r="4"/><circle cx="6" cy="12" r="3"/><circle cx="26" cy="12" r="3"/><path d="M9 27v-3c0-9 14-9 14 0v3H9M2 25v-3c0-5 4-6 7-5m14 0c4-1 7 1 7 5v3"/>{/if}
</svg>
{/snippet}
{#snippet rim()}
<div class="rim-decoration" aria-hidden="true"><div class="rim-light"><i class="rim-halo"></i><i class="rim-hotspot"></i></div><div class="rim-light rim-breath"><i class="rim-halo"></i><i class="rim-hotspot"></i></div></div>
{/snippet}
{#snippet corners()}<div class="corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>{/snippet}
{#snippet counter(live=false)}{#if phase==='countdown'}{#key countdown}<div class="countdown" aria-hidden={!live} role={live?'status':undefined}><strong>{countdown}</strong>{#if live}<span class="sr-only">Смотрите в объектив</span>{/if}</div>{/key}{/if}{/snippet}
<div class="photo-session-view">
<main class="page"><div class="stage" aria-label="Фотосессия">
  <svg class="light-lines" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true"><defs>
    <linearGradient id="session-line"><stop stop-color="#d36aaa" stop-opacity="0"/><stop offset=".25" stop-color="#ec85bc"/><stop offset=".43" stop-color="#ffe5c4"/><stop offset=".56" stop-color="#ef9ac4"/><stop offset="1" stop-color="#d76ab5" stop-opacity="0"/></linearGradient>
    <radialGradient id="session-halo"><stop stop-color="#fff3f3" stop-opacity=".9"/><stop offset=".18" stop-color="#ffb0da" stop-opacity=".8"/><stop offset=".5" stop-color="#ed63bb" stop-opacity=".4"/><stop offset="1" stop-color="#d348a1" stop-opacity="0"/></radialGradient>
    <radialGradient id="session-core"><stop stop-color="#fffaf5"/><stop offset=".4" stop-color="#fff2f2"/><stop offset=".72" stop-color="#ffbbdf" stop-opacity=".8"/><stop offset="1" stop-color="#ff8bcd" stop-opacity="0"/></radialGradient>
    <filter id="session-bloom" x="-30%" y="-150%" width="160%" height="400%"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>{#each paths as path}<g fill="none" stroke="url(#session-line)"><path class="glow" d={path}/><path class="ribbon" d={path}/></g><g use:ribbonLight={{path,from:5,to:95}}><ellipse rx="120" ry="36" fill="url(#session-halo)"/><ellipse rx="62" ry="6" fill="url(#session-halo)"/><ellipse rx="40" ry="2.5" fill="url(#session-core)"/></g>{/each}</svg>
  <header><div class="brand"><img src={brand} alt=""/><span>REELME</span></div><div class="event">{@render icon('people')}<span>Фотосессия · {date}</span></div></header>
  <div class="composition" use:rimWave={{pageVersion:0,gain:1,previewVersion:0}}>
    <article class="story framed">
      <div class="story-media">{#if story?.thumbnailId}<ProtectedMedia mediaId={story.thumbnailId} path={`/api/capture/sessions/${encodeURIComponent(receipt.sessionId)}/thumbnail`} {installationKey} alt={title}/>{:else}<div class="story-missing">Сюжет этой фотосессии</div>{/if}</div>
      <div class="story-shade"></div><h1>{title}</h1><button class="story-trigger" disabled={cameraLocked || phase==='complete'} onclick={e=>open('scenario',e)} aria-label="Выбрать другой сценарий" title={story?.description || title}></button>{@render rim()}
    </article>
    <section class="pose framed pose-panel" aria-label={`Образец позы ${pose.guideNumber ?? pose.index+1}`}>
      <div class="pose-picture"><PoseGuide {pose} sessionId={receipt.sessionId} {installationKey}/></div><div class="pose-shade"></div>{@render corners()}
      <div class="pose-copy">{@render icon('person')}<p>Встаньте<br/>в такую позу</p><h2 class="pose-instruction">{pose.instruction}</h2>{#if pose.participant}<small class="participant-label">{pose.participant==='group'?'Группа':`Человек ${pose.participant}`}</small>{/if}</div>
      {@render counter()}{@render rim()}
    </section>
    <section class="live framed viewfinder" aria-label="Предпросмотр камеры" aria-busy={phase==='camera'}>
      <div class="live-surface">
        {#if confirmed && (phase==='confirmation' || phase==='review')}<img class="captured-frame" src={confirmed} alt="Снятый кадр"/>
        {:else if preview}<img class="live-preview" src={preview} alt="Зеркальное превью камеры" onerror={onstoppreview}/>
        {:else}<div class="fallback preview-fallback">{@render icon('person')}<h2>{previewEnabled?'Подключаем превью…':'Съёмка без превью'}</h2><p>Повторите образец позы и смотрите в камеру</p></div>{/if}
        {@render corners()}
        {#if phase==='ready' || phase==='paused'}<div class="live-note" role="status">{phase==='paused'?'Съёмка на паузе':pose.participant===2?'Подготовьте второго человека и продолжите съёмку.':'Когда будете готовы, нажмите Play'}</div>{/if}
        {#if phase==='error'}<div class="notice error" role="alert"><h2>Не удалось получить кадр</h2><p>{error}</p>{#if pendingCapture}<p>Ожидается текущий JPEG. Новый спуск и пересъёмки пока недоступны.</p>{/if}<button onclick={onrun}>Повторить</button></div>{/if}
        {#if phase==='review'}<div class="notice complete">{@render icon('check')}<h2>Отлично! Все кадры готовы</h2><p>Можно переснять последний кадр или завершить серию</p><button onclick={onfinish}>Завершить фотосессию</button></div>{/if}
        {@render counter(true)}
        {#if phase==='camera'}<div class="flash" aria-hidden="true"></div><div class="capture-status" role="status">{pauseAfterCapture?'Получаем снимок… Затем — пауза.':'Получаем снимок…'}</div>{:else if phase==='confirmation'}<div class="capture-status" role="status">Кадр снят ✓</div>{/if}
        {#if previewEnabled && phase!=='camera' && !['error','review','complete'].includes(phase)}<button class="preview-toggle" onclick={onstoppreview}>Продолжить без превью</button>{/if}
      </div>{@render rim()}
    </section>
  </div>
  <footer>
    <div class="thumbnails" class:many={count>4} aria-label="Сделанные фотографии">{#each receipt.posePlan as item}{@const thumb=thumbnails.find(photo=>photo.poseIndex===item.index)}<div class="thumbnail" class:filled={!!thumb} class:current={item.index===position&&phase!=='review'} aria-label={`Кадр ${item.index+1}: ${thumb?'снят':'ожидается'}`}>{#if thumb}<img class="thumb-image" src={thumb.url} alt={`Снятый кадр ${item.index+1}`}/><span>{item.index+1}</span>{:else}{@render icon('plus')}{/if}</div>{/each}</div>
    <div class="controls"><button class="round" disabled={!thumbnails.length||cameraLocked||phase==='complete'} onclick={onretake} aria-label="Переснять предыдущий кадр" title="Переснять предыдущий кадр">{@render icon('back')}</button><button class="round" disabled={cameraLocked||phase==='complete'} onclick={e=>open('restart',e)} aria-label="Начать заново" title="Начать заново">{@render icon('restart')}</button><div class="progress" aria-live="polite">{@render icon('frames')}<div><span>{phase==='review'?'Снято':'Кадр'}</span><strong>{phase==='review'?count:position+1} из {count}</strong></div><div class="dots">{#each receipt.posePlan as item}<i class:done={thumbnails.some(photo=>photo.poseIndex===item.index)} class:active={item.index===position&&phase!=='review'}></i>{/each}</div><span class="capture-progress sr-only">Снято: {thumbnails.length} из {count}</span></div><button class="play" disabled={['review','complete','error'].includes(phase)} onclick={()=>active?onpause():onrun()} aria-label={playLabel} title={playLabel}>{@render icon(active?'pause':'play')}</button></div>
  </footer>
</div></main>
<dialog bind:this={dialog} oncancel={e=>{e.preventDefault();close();}} aria-labelledby="session-dialog-title"><h2 id="session-dialog-title">{dialogMode==='restart'?'Начать фотосессию заново?':'Выбрать другой сценарий?'}</h2><p>{thumbnails.length?'Сделанные кадры этой серии будут сброшены.':'Текущая серия начнётся заново.'}</p><div class="dialog-actions"><button class="cancel" onclick={()=>close()}>Отмена</button><button class="confirm" onclick={confirm}>{dialogMode==='restart'?'Начать заново':'Выбрать сценарий'}</button></div></dialog>
</div>
