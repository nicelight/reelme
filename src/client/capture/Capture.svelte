<script lang="ts">
  /** Module contract: owns sequential camera work and in-memory JPEGs for one
   * server-issued session/pose plan, skipping positions already stored on server.
   * oncomplete hands newly captured original Blobs to the owner;
   * no upload, finalize, numbering or generation success is implied here.
   * Unmount aborts local waits and releases preview/audio resources. */
  import { onMount } from 'svelte';
  import type { StartReceipt } from '../../shared/capture';
  import { DigiCamControl, pause } from './camera';
  import PoseGuide from './PoseGuide.svelte';
  import type { CapturedPhoto } from './photos';
  let { receipt, acceptedPoseIndices = [], oncomplete }: { receipt: StartReceipt; acceptedPoseIndices?: number[]; oncomplete: (photos: CapturedPhoto[]) => void } = $props();
  let photos = $state<CapturedPhoto[]>([]);
  let position = $state(0);
  let phase = $state<'idle' | 'countdown' | 'camera' | 'confirmation' | 'error' | 'complete'>('idle');
  let countdown = $state(3);
  let error = $state('');
  let preview = $state('');
  let previewEnabled = $state(true);
  let liveView = false;
  let confirmed = $state('');
  let audio: AudioContext | undefined;
  const camera = new DigiCamControl();
  const lifecycle = new AbortController();
  const previewLife = new AbortController();
  const remainingPlan = $derived(receipt.posePlan.filter(pose => !acceptedPoseIndices.includes(pose.index)));
  const pose = $derived(remainingPlan[position]);
  function stopPreview() {
    previewEnabled = false; previewLife.abort();
    if (preview) URL.revokeObjectURL(preview);
    preview = '';
    // Live View may still be active in the camera; keep its shutter command.
  }
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
    return () => {
      lifecycle.abort(); stopPreview();
      if (confirmed) URL.revokeObjectURL(confirmed);
      void audio?.close();
    };
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
  async function run() {
    if (!['idle', 'error'].includes(phase)) return;
    countdown = 3; phase = 'countdown'; error = '';
    try {
      // User gesture unlocks audio; unavailable audio never prevents the visual cue.
      try { audio ??= new AudioContext(); await audio.resume(); } catch {}
      while (position < remainingPlan.length) {
        phase = 'countdown';
        for (countdown = 3; countdown > 0; countdown--) { beep(); await pause(1000, lifecycle.signal); }
        phase = 'camera';
        const blob = await camera.capture(receipt.sessionId, pose.index, liveView, lifecycle.signal);
        lifecycle.signal.throwIfAborted();
        photos = [...photos, { sessionId: receipt.sessionId, poseIndex: pose.index, blob }];
        confirmed = URL.createObjectURL(blob); phase = 'confirmation';
        await pause(1500, lifecycle.signal);
        URL.revokeObjectURL(confirmed); confirmed = '';
        if (position + 1 === remainingPlan.length) {
          phase = 'complete'; stopPreview(); oncomplete(photos); return;
        }
        position++;
        // Let the visitor see and take the next pose before its countdown.
        phase = 'idle'; await pause(2000, lifecycle.signal); phase = 'countdown';
      }
    } catch (cause) {
      if (lifecycle.signal.aborted) return;
      error = cause instanceof Error ? cause.message : 'Не удалось получить снимок. Нажмите «Повторить».';
      phase = 'error';
    }
  }
</script>
{#if phase === 'complete'}
  <section class="narrow" aria-live="polite"><p class="eyebrow">ВСЕ КАДРЫ СНЯТЫ</p><h1>Съёмка завершена</h1><p class="intro">Спасибо! Пожалуйста, дождитесь дальнейших указаний сотрудника.</p></section>
{:else}
  <section class="capture-layout" aria-label="Фотосессия">
    <div class="viewfinder">
      {#if confirmed}<img class="captured-frame" src={confirmed} alt="Снятый кадр" />
      {:else if preview}<img class="live-preview" src={preview} alt="Зеркальное превью камеры" onerror={stopPreview} />
      {:else}<div class="preview-fallback"><span>{previewEnabled ? 'Подключаем превью…' : 'Съёмка без превью'}</span><p>Смотрите на образец позы справа или ниже</p></div>{/if}
      {#if phase === 'countdown'}<div class="countdown" role="status"><strong>{countdown}</strong><span>Смотри в объектив</span></div>
      {:else if phase === 'camera'}<div class="capture-status" role="status">Смотри в объектив · Получаем снимок…</div>
      {:else if phase === 'confirmation'}<div class="capture-status" role="status">Кадр снят ✓</div>{/if}
    </div>
    <aside class="pose-panel">
      <p class="eyebrow">ФОТО {pose.index + 1} ИЗ {receipt.posePlan.length}</p>
      <h1>{pose.instruction}</h1><PoseGuide {pose} />
      <p class="muted">Повторите позу. Направления — ваши лево и право.</p>
      {#if phase === 'idle' && photos.length === 0}<button class="primary" onclick={run}>Начать съёмку</button>{/if}
      {#if phase === 'error'}<div class="error" role="alert"><p>{error}</p><button class="primary" onclick={run}>Повторить</button></div>{/if}
      {#if previewEnabled}<button class="preview-toggle" onclick={stopPreview}>Продолжить без превью</button>{/if}
      <p class="capture-progress" aria-live="polite">Снято: {acceptedPoseIndices.length + photos.length} из {receipt.posePlan.length}</p>
    </aside>
  </section>
{/if}
