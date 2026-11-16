<script lang="ts">
  /** Module contract: owns one local, ordered JPEG series until explicit Finish.
   * Pause/restart/retake cancel only local sequence waits, never an outstanding
   * shutter. Pending-camera retry gets the same JPEG. No upload before oncomplete;
   * unmount cancels waits and releases URLs/audio. Source: docs/slot-setup/matrix.md. */
  import { onMount } from 'svelte';
  import type { StartReceipt } from '../../shared/capture';
  import { DigiCamControl, pause } from './camera';
  import PoseGuide from './PoseGuide.svelte';
  import type { CapturedPhoto } from './photos';
  let { receipt, installationKey, oncomplete }: { receipt: StartReceipt; installationKey: string; oncomplete: (photos: CapturedPhoto[]) => void } = $props();
  let photos = $state<CapturedPhoto[]>([]);
  let position = $state(0);
  let phase = $state<'ready' | 'countdown' | 'camera' | 'confirmation' | 'paused' | 'error' | 'review' | 'complete'>('ready');
  let countdown = $state(3);
  let error = $state('');
  let pendingCapture = $state(false);
  let preview = $state('');
  let previewEnabled = $state(true);
  let confirmed = $state('');
  let liveView = false;
  let audio: AudioContext | undefined;
  let sequence: AbortController | undefined;
  let running = false;
  const camera = new DigiCamControl();
  const lifecycle = new AbortController();
  const previewLife = new AbortController();
  const pose = $derived(receipt.posePlan[position]);
  const cameraLocked = $derived(phase === 'camera' || pendingCapture);
  function clearConfirmed() { if (confirmed) URL.revokeObjectURL(confirmed); confirmed = ''; }
  function stopPreview() {
    previewEnabled = false; previewLife.abort();
    if (preview) URL.revokeObjectURL(preview);
    preview = '';
  }
  function cancelSequence() { sequence?.abort(); sequence = undefined; running = false; }
  onMount(() => {
    void (async () => {
      try {
        await camera.startLiveView(previewLife.signal); liveView = true;
        while (!previewLife.signal.aborted) {
          const frame = await camera.preview(previewLife.signal);
          previewLife.signal.throwIfAborted();
          const url = URL.createObjectURL(frame);
          if (preview) URL.revokeObjectURL(preview);
          preview = url;
          await pause(200, previewLife.signal);
        }
      } catch { if (!previewLife.signal.aborted) stopPreview(); }
    })();
    return () => { cancelSequence(); lifecycle.abort(); stopPreview(); clearConfirmed(); void audio?.close(); };
  });
  function beep() {
    if (!audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(); const gain = audio.createGain();
    oscillator.frequency.value = 880; gain.gain.setValueAtTime(0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.16);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function advance(paused = false): boolean {
    if (position + 1 === receipt.posePlan.length) { phase = 'review'; return false; }
    const person = pose.participant;
    position++;
    if (paused || pose.participant !== person) { phase = paused ? 'paused' : 'ready'; return false; }
    return true;
  }
  function pauseCapture() {
    if (cameraLocked || !['countdown', 'confirmation'].includes(phase)) return;
    const completed = phase === 'confirmation';
    cancelSequence();
    if (completed) advance(true); else phase = 'paused';
  }
  function restart() {
    if (cameraLocked || camera.hasPendingCapture || phase === 'complete') return;
    cancelSequence(); clearConfirmed(); photos = []; position = 0; error = ''; phase = 'ready';
  }
  function retake() {
    if (cameraLocked || camera.hasPendingCapture || !photos.length || phase === 'complete') return;
    cancelSequence(); clearConfirmed(); position = photos.at(-1)!.poseIndex; error = ''; phase = 'ready';
  }
  async function run() {
    if (running || !['ready', 'paused', 'error'].includes(phase)) return;
    running = true; error = '';
    const current = sequence = new AbortController();
    try {
      try { audio ??= new AudioContext(); await audio.resume(); } catch {}
      current.signal.throwIfAborted();
      while (!current.signal.aborted) {
        clearConfirmed();
        if (!camera.hasPendingCapture) {
          phase = 'countdown';
          for (countdown = 3; countdown > 0; countdown--) { beep(); await pause(1000, current.signal); }
        }
        current.signal.throwIfAborted(); phase = 'camera';
        const target = pose.index;
        const blob = await camera.capture(receipt.sessionId, target, liveView, lifecycle.signal);
        lifecycle.signal.throwIfAborted(); current.signal.throwIfAborted(); pendingCapture = false;
        photos = [...photos.filter(photo => photo.poseIndex !== target), { sessionId: receipt.sessionId, poseIndex: target, blob }].sort((a, b) => a.poseIndex - b.poseIndex);
        confirmed = URL.createObjectURL(blob); phase = 'confirmation';
        await pause(1500, current.signal);
        if (!advance()) return;
      }
    } catch (cause) {
      if (lifecycle.signal.aborted || current.signal.aborted) return;
      pendingCapture = camera.hasPendingCapture;
      error = cause instanceof Error ? cause.message : 'Не удалось получить снимок. Нажмите «Повторить».';
      phase = 'error';
    } finally { if (sequence === current) running = false; }
  }
  function finish() {
    if (phase !== 'review' || photos.length !== receipt.posePlan.length) return;
    cancelSequence(); phase = 'complete'; stopPreview(); oncomplete([...photos]);
  }
</script>
<section class="capture-layout" aria-label="Фотосессия">
  <div class="viewfinder">
    {#if confirmed}<img class="captured-frame" src={confirmed} alt="Снятый кадр" />
    {:else if preview}<img class="live-preview" src={preview} alt="Зеркальное превью камеры" onerror={stopPreview} />
    {:else}<div class="preview-fallback" class:counting={phase === 'countdown'}><span>{previewEnabled ? 'Подключаем превью…' : 'Съёмка без превью'}</span><p>Повторите образец позы</p></div>{/if}
    {#if phase === 'countdown'}<div class="countdown" role="status"><strong>{countdown}</strong><span>Смотри в объектив</span></div>
    {:else if phase === 'camera'}<div class="capture-status" role="status">Получаем снимок…</div>
    {:else if phase === 'confirmation'}<div class="capture-status" role="status">Кадр снят ✓</div>
    {:else if phase === 'review'}<div class="capture-status" role="status">Все кадры сняты. Проверьте последний снимок.</div>{/if}
  </div>
  <aside class="pose-panel">
    <p class="eyebrow">ФОТО {pose.index + 1} ИЗ {receipt.posePlan.length}</p>
    {#if pose.participant}<p class="participant-label">{pose.participant === 'group' ? 'Группа' : `Человек ${pose.participant}`}</p>{/if}
    <h1>{pose.instruction}</h1><PoseGuide {pose} sessionId={receipt.sessionId} {installationKey} />
    <div class="capture-controls">
      {#if phase === 'ready'}<button class="primary" onclick={run}>{photos.length === 0 ? 'Начать съёмку' : 'Продолжить'}</button>{/if}
      {#if phase === 'paused'}<p role="status">Съёмка на паузе</p><button class="primary" onclick={run}>Продолжить</button>{/if}
      {#if phase === 'ready' && pose.participant === 2}<p class="muted">Подготовьте второго человека и продолжите съёмку.</p>{/if}
      {#if phase === 'countdown' || phase === 'confirmation'}<button onclick={pauseCapture}>Пауза</button>{/if}
      {#if phase === 'error'}<div class="error" role="alert"><p>{error}</p>{#if pendingCapture}<p>Ожидается текущий JPEG. Новый спуск и пересъёмки пока недоступны.</p>{/if}<button class="primary" onclick={run}>Повторить</button></div>{/if}
      <button onclick={restart} disabled={cameraLocked || phase === 'complete'}>Restart фотосессия</button>
      <button onclick={retake} disabled={cameraLocked || !photos.length || phase === 'complete'}>Перефоткать последнее</button>
      {#if phase === 'review'}<button class="primary" onclick={finish}>Завершить фотосессию</button>{/if}
    </div>
    {#if previewEnabled}<button class="preview-toggle" onclick={stopPreview}>Продолжить без превью</button>{/if}
    <p class="capture-progress" aria-live="polite">Снято: {photos.length} из {receipt.posePlan.length}</p>
  </aside>
</section>
<style>
  .preview-fallback.counting > * { visibility:hidden; }
  .capture-controls { display:grid; gap:10px; margin-top:20px; }
  .capture-controls button { width:100%; }
  .participant-label { margin-bottom:10px; font-weight:650; color:var(--accent); }
  @media(max-width:899px) { .pose-panel { display:grid; grid-template-columns:minmax(0,1fr) minmax(100px,150px); gap:10px; } .pose-panel .eyebrow,.participant-label,.capture-controls,.capture-progress,.preview-toggle { grid-column:1/-1; } .pose-panel h1 { font-size:24px; } }
</style>
