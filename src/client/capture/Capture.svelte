<script lang="ts">
  /** Module contract: owns one local, ordered JPEG series until manual or timed Finish.
   * Pause/restart/retake cancel only local sequence waits, never an outstanding
   * shutter. Pending-camera retry gets the same JPEG. No upload before oncomplete;
   * preview is aborted before shutter and stays stopped through photo confirmation.
   * The session snapshot sets initial mode and timers. A manual tap takes one
   * photo. Switching modes never issues a second shutter for a pending JPEG.
   * Pause/Play preserves the photo's original confirmation deadline.
   * Hidden/unmounted views cannot publish a late preview frame.
   * Unmount cancels waits and releases URLs/audio. Source: docs/slot-setup/matrix.md. */
  import { onMount, untrack } from 'svelte';
  import { defaultCaptureSettings, type StartReceipt } from '../../shared/capture';
  import { enqueueReport } from './report-queue';
  import { boothCamera } from './camera-context';
  import { CameraError, pause } from './camera-frame';
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
  let liveView = false; // A successful Show selects the Live View shutter, even if preview reads fail.
  let needsLiveViewOpen = true;
  let previewRetryAt = $state(0);
  let hidden = $state(document.hidden);
  let audio: AudioContext | undefined;
  let sequence: AbortController | undefined;
  let running = false;
  const settings = $derived(receipt.captureSettings ?? defaultCaptureSettings);
  let automatic = $state(untrack(() => settings.startMode === 'automatic'));
  let caseCode = $state('');
  const transport = boothCamera()!;
  const usb = transport.usb;
  const diagnostics = untrack(() => settings.sendCaptureLogs && transport.Diagnostics ? new transport.Diagnostics(report => {
    if (report.kind === 'attempt' && report.outcome === 'error') caseCode = report.caseId.slice(0,8);
    enqueueReport(receipt.sessionId, report);
  }) : undefined);
  const camera = transport.session(diagnostics);
  const lifecycle = new AbortController();
  let previewRun: AbortController | undefined;
  const pose = $derived(receipt.posePlan[position]);
  const cameraLocked = $derived(phase === 'camera' || pendingCapture);
  const shouldPreview = $derived((!usb || (usb.state === 'ready' && phase !== 'review')) && previewEnabled && !hidden && !confirming && !['camera', 'confirmation', 'complete'].includes(phase));
  function clearConfirmed() {
    clearTimeout(confirmationTimer); confirming = false; confirmationUntil = 0;
    if (confirmed) URL.revokeObjectURL(confirmed); confirmed = '';
  }
  function pausePreview() {
    previewRun?.abort();
    if (preview) URL.revokeObjectURL(preview);
    preview = '';
  }
  function stopPreview() { diagnostics?.stopPreview('operator'); previewEnabled = false; pausePreview(); }
  function previewFailed(error: unknown) {
    if (usb) {
      if (usb.state === 'ready') void usb.release(error instanceof Error ? error.message : 'Проверьте камеру.');
      return;
    }
    diagnostics?.stopPreview('error', error, error instanceof CameraError ? error.status : undefined);
    needsLiveViewOpen = true;
    previewRetryAt = performance.now() + 1000;
  }
  function previewImageFailed(url: string) {
    if (url === preview && previewRun && !previewRun.signal.aborted) {
      previewFailed(new CameraError('Не удалось отобразить кадр Live View.'));
    }
  }
  function cancelSequence() { sequence?.abort(); sequence = undefined; running = false; pauseAfterCapture = false; }
  function clearThumbnails() { thumbnails.forEach(photo => URL.revokeObjectURL(photo.url)); thumbnails = []; }
  $effect(() => {
    if (!shouldPreview || (pendingCapture && needsLiveViewOpen)) return;
    if (previewRetryAt) {
      const timer = setTimeout(() => { previewRetryAt = 0; }, Math.max(0, previewRetryAt - performance.now()));
      return () => clearTimeout(timer);
    }
    const controller = previewRun = new AbortController();
    void (async () => {
      try {
        if (needsLiveViewOpen) {
          await camera.startLiveView(controller.signal);
          controller.signal.throwIfAborted();
          liveView = true;
          needsLiveViewOpen = false;
        }
        while (!controller.signal.aborted) {
          const frame = await camera.preview(controller.signal);
          controller.signal.throwIfAborted();
          diagnostics?.frame();
          const url = URL.createObjectURL(frame);
          if (preview) URL.revokeObjectURL(preview);
          preview = url;
          await pause(200, controller.signal);
        }
      } catch (error) {
        if (!controller.signal.aborted) previewFailed(error);
      }
    })();
    return () => { controller.abort(); if (previewRun === controller) { pausePreview(); previewRun = undefined; } };
  });
  onMount(() => {
    if (usb) usb.sendCaptureLogs = settings.sendCaptureLogs;
    diagnostics?.start();
    if (automatic && !document.hidden) void run();
    else if (document.hidden) automatic = false;
    const visibility = () => { hidden = document.hidden; diagnostics?.visibilityChanged(); if (hidden) { diagnostics?.stopPreview('hidden'); automatic = false; pauseCapture(); pausePreview(); usb?.park(); } };
    const pageHide = () => diagnostics?.pageHidden(camera.hasPendingCapture);
    window.addEventListener('pagehide', pageHide);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('pagehide', pageHide); diagnostics?.stopProbe(); document.removeEventListener('visibilitychange', visibility); cancelSequence(); lifecycle.abort(); stopPreview(); clearConfirmed(); clearThumbnails(); usb?.park(); void audio?.close(); };
  });
  $effect(() => {
    if (!usb || usb.state === 'ready') return;
    untrack(() => {
      automatic = false;
      if (phase === 'countdown' || (running && ['ready','paused'].includes(phase))) {
        cancelSequence(); phase = 'error'; error = 'Проверьте камеру.';
      } else if (phase === 'camera') pauseAfterCapture = true;
    });
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
    if (pose.participant !== person) { automatic = false; phase = 'ready'; return false; }
    if (paused || !automatic) { phase = 'paused'; return false; }
    return true;
  }
  function pauseCapture() {
    // Pausing an exposure stops only the next step; the pending JPEG must survive.
    if (phase === 'camera') { pauseAfterCapture = true; return; }
    if (running && (phase === 'paused' || phase === 'ready')) { cancelSequence(); return; }
    if (cameraLocked || !['countdown', 'confirmation'].includes(phase)) return;
    const completed = phase === 'confirmation';
    cancelSequence();
    if (completed) advance(true); else phase = 'paused';
  }
  function restart() {
    if (cameraLocked || camera.hasPendingCapture || phase === 'complete') return;
    cancelSequence(); clearConfirmed(); clearThumbnails(); photos = []; position = 0; error = ''; phase = 'ready';
    if (automatic) void run();
  }
  function retake() {
    if (cameraLocked || camera.hasPendingCapture || !photos.length || phase === 'complete') return;
    cancelSequence(); clearConfirmed(); position = photos.at(-1)!.poseIndex;
    photos = photos.filter(photo => photo.poseIndex !== position);
    thumbnails.filter(photo => photo.poseIndex === position).forEach(photo => URL.revokeObjectURL(photo.url));
    thumbnails = thumbnails.filter(photo => photo.poseIndex !== position);
    automatic = false; error = ''; phase = 'paused';
  }
  function toggleMode() {
    automatic = !automatic;
    if (automatic) { pauseAfterCapture = false; void run(); }
    else pauseCapture();
  }
  async function run() {
    if ((phase === 'camera' || phase === 'confirmation') && pauseAfterCapture) { pauseAfterCapture = false; return; }
    if (running || !['ready', 'paused', 'error'].includes(phase)) return;
    if (usb && usb.state !== 'ready') {
      error = 'Проверьте камеру.'; phase = 'error'; automatic = false; return;
    }
    let retry = phase === 'error';
    if (retry) diagnostics?.retryRequested();
    running = true; error = ''; caseCode = '';
    const current = sequence = new AbortController();
    try {
      try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch {}
      current.signal.throwIfAborted();
      const remaining = confirmationUntil - performance.now();
      if (remaining > 0) await pause(remaining, current.signal);
      if (hidden) return;
      while (!current.signal.aborted) {
        clearConfirmed();
        if (usb && automatic) {
          phase = 'ready';
          while (!preview && usb.state === 'ready') await pause(30, current.signal);
          if (usb.state !== 'ready') throw new Error('Проверьте камеру.');
        }
        if (!camera.hasPendingCapture && (!usb || automatic)) {
          diagnostics?.countdown();
          phase = 'countdown';
          const seconds = settings.countdownSeconds;
          for (countdown = seconds; countdown > 0; countdown--) { beep(); await pause(usb && countdown === 1 ? 700 : 1000, current.signal); }
        }
        current.signal.throwIfAborted();
        const wasPreviewing = previewRun && !previewRun.signal.aborted;
        phase = 'camera'; diagnostics?.stopPreview('shutter'); pausePreview();
        // Give digiCamControl time to finish serving Live View before reading the file list.
        if (!usb && wasPreviewing) await pause(200, current.signal);
        const target = pose.index;
        const blob = await camera.capture(receipt.sessionId, target, liveView, lifecycle.signal, automatic, retry);
        retry = false;
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
      if (usb) automatic = false;
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
<PhotoSessionView {receipt} {installationKey} {position} {phase} {countdown} {preview} {previewEnabled} previewRetrying={!!previewRetryAt} {confirmed} {confirming} {thumbnails}
  webUsb={!!usb} uncertain={usb?.uncertain ?? false} {error} {caseCode} {pendingCapture} {cameraLocked} {pauseAfterCapture} {automatic} {settings} ontoggle={toggleMode} onrun={() => void run()} onpause={pauseCapture}
  onretake={retake} onrestart={restart} onfinish={finish} {onscenario} onstoppreview={stopPreview} onpreviewerror={previewImageFailed}/>
