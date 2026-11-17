<script lang="ts">
  /** Module contract: owns one local, ordered JPEG series until explicit Finish.
   * Pause/restart/retake cancel only local sequence waits, never an outstanding
   * shutter. Pending-camera retry gets the same JPEG. No upload before oncomplete;
   * preview is aborted before shutter and stays stopped through photo confirmation.
   * Automatic countdowns take five seconds after the one-second confirmation;
   * Pause→Play shortens only the next new countdown to three seconds.
   * Pause/Play preserves the photo's original confirmation deadline.
   * Hidden/unmounted views cannot publish a late preview frame.
   * Unmount cancels waits and releases URLs/audio. Source: docs/slot-setup/matrix.md. */
  import { onMount } from 'svelte';
  import type { StartReceipt } from '../../shared/capture';
  import { DigiCamControl, pause } from './camera';
  import PhotoSessionView, { type CapturePhase, type PhotoThumbnail } from './session/PhotoSessionView.svelte';
  import type { CapturedPhoto } from './photos';
  let { receipt, installationKey, oncomplete, onscenario }: { receipt: StartReceipt; installationKey: string; oncomplete: (photos: CapturedPhoto[]) => void; onscenario: () => void } = $props();
  let photos = $state<CapturedPhoto[]>([]);
  let position = $state(0);
  let phase = $state<CapturePhase>('ready');
  let thumbnails = $state<PhotoThumbnail[]>([]);
  let pauseAfterCapture = $state(false);
  let countdown = $state(5);
  let error = $state('');
  let pendingCapture = $state(false);
  let preview = $state('');
  let previewEnabled = $state(true);
  let confirmed = $state('');
  let confirming = $state(false);
  let confirmationUntil = 0;
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
  let liveView = $state(false);
  let hidden = $state(document.hidden);
  let audio: AudioContext | undefined;
  let sequence: AbortController | undefined;
  let running = false;
  let resumeCountdown = false;
  const camera = new DigiCamControl();
  const lifecycle = new AbortController();
  let previewRun: AbortController | undefined;
  const pose = $derived(receipt.posePlan[position]);
  const cameraLocked = $derived(phase === 'camera' || pendingCapture);
  const shouldPreview = $derived(previewEnabled && liveView && !hidden && !confirming && !['camera', 'confirmation', 'complete'].includes(phase));
  function clearConfirmed() {
    clearTimeout(confirmationTimer); confirming = false; confirmationUntil = 0;
    if (confirmed) URL.revokeObjectURL(confirmed); confirmed = '';
  }
  function pausePreview() {
    previewRun?.abort();
    if (preview) URL.revokeObjectURL(preview);
    preview = '';
  }
  function stopPreview() { previewEnabled = false; pausePreview(); }
  function cancelSequence() { sequence?.abort(); sequence = undefined; running = false; pauseAfterCapture = false; }
  function clearThumbnails() { thumbnails.forEach(photo => URL.revokeObjectURL(photo.url)); thumbnails = []; }
  $effect(() => {
    if (!shouldPreview) return;
    const controller = previewRun = new AbortController();
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const frame = await camera.preview(controller.signal);
          controller.signal.throwIfAborted();
          const url = URL.createObjectURL(frame);
          if (preview) URL.revokeObjectURL(preview);
          preview = url;
          await pause(200, controller.signal);
        }
      } catch { if (!controller.signal.aborted) stopPreview(); }
    })();
    return () => { controller.abort(); if (previewRun === controller) { pausePreview(); previewRun = undefined; } };
  });
  onMount(() => {
    void camera.startLiveView(lifecycle.signal).then(() => { if (!lifecycle.signal.aborted) liveView = true; })
      .catch(() => { if (!lifecycle.signal.aborted) stopPreview(); });
    const visibility = () => { hidden = document.hidden; if (hidden) pausePreview(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); cancelSequence(); lifecycle.abort(); stopPreview(); clearConfirmed(); clearThumbnails(); void audio?.close(); };
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
    // Pausing an exposure stops only the next step; the pending JPEG must survive.
    if (phase === 'camera') { resumeCountdown = true; pauseAfterCapture = true; return; }
    if (cameraLocked || !['countdown', 'confirmation'].includes(phase)) return;
    resumeCountdown = true;
    const completed = phase === 'confirmation';
    cancelSequence();
    if (completed) advance(true); else phase = 'paused';
  }
  function restart() {
    if (cameraLocked || camera.hasPendingCapture || phase === 'complete') return;
    cancelSequence(); resumeCountdown = false; clearConfirmed(); clearThumbnails(); photos = []; position = 0; error = ''; phase = 'ready';
    void run();
  }
  function retake() {
    if (cameraLocked || camera.hasPendingCapture || !photos.length || phase === 'complete') return;
    cancelSequence(); resumeCountdown = false; clearConfirmed(); position = photos.at(-1)!.poseIndex;
    photos = photos.filter(photo => photo.poseIndex !== position);
    thumbnails.filter(photo => photo.poseIndex === position).forEach(photo => URL.revokeObjectURL(photo.url));
    thumbnails = thumbnails.filter(photo => photo.poseIndex !== position);
    error = ''; phase = 'paused';
  }
  async function run() {
    if ((phase === 'camera' || phase === 'confirmation') && pauseAfterCapture) { pauseAfterCapture = false; return; }
    if (running || !['ready', 'paused', 'error'].includes(phase)) return;
    running = true; error = '';
    const current = sequence = new AbortController();
    try {
      try { audio ??= new AudioContext(); await audio.resume(); } catch {}
      current.signal.throwIfAborted();
      const remaining = confirmationUntil - performance.now();
      if (remaining > 0) await pause(remaining, current.signal);
      if (hidden) return;
      while (!current.signal.aborted) {
        clearConfirmed();
        if (!camera.hasPendingCapture) {
          phase = 'countdown';
          const seconds = resumeCountdown ? 3 : 5; resumeCountdown = false;
          for (countdown = seconds; countdown > 0; countdown--) { beep(); await pause(1000, current.signal); }
        }
        current.signal.throwIfAborted(); phase = 'camera'; pausePreview();
        const target = pose.index;
        const blob = await camera.capture(receipt.sessionId, target, liveView, lifecycle.signal);
        lifecycle.signal.throwIfAborted(); current.signal.throwIfAborted(); pendingCapture = false;
        photos = [...photos.filter(photo => photo.poseIndex !== target), { sessionId: receipt.sessionId, poseIndex: target, blob }].sort((a, b) => a.poseIndex - b.poseIndex);
        confirmed = URL.createObjectURL(blob);
        confirming = true; confirmationUntil = performance.now() + 1000;
        confirmationTimer = setTimeout(() => { confirming = false; }, 1000);
        thumbnails.filter(photo => photo.poseIndex === target).forEach(photo => URL.revokeObjectURL(photo.url));
        thumbnails = [...thumbnails.filter(photo => photo.poseIndex !== target), { poseIndex: target, url: URL.createObjectURL(blob) }].sort((a, b) => a.poseIndex - b.poseIndex);
        phase = 'confirmation';
        await pause(1000, current.signal);
        const paused = pauseAfterCapture; pauseAfterCapture = false;
        if (!advance(paused)) return;
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
<PhotoSessionView {receipt} {installationKey} {position} {phase} {countdown} {preview} {previewEnabled} {confirmed} {confirming} {thumbnails}
  {error} {pendingCapture} {cameraLocked} {pauseAfterCapture} onrun={() => void run()} onpause={pauseCapture}
  onretake={retake} onrestart={restart} onfinish={finish} {onscenario} onstoppreview={stopPreview}/>
