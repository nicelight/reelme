<script lang="ts">
  /** Module contract: coordinates one server-issued session through local capture,
   * JPEG upload and finalize. Retries retain original Blobs/positions and never
   * call the camera again. Server status is authoritative, including after reload
   * or a lost acknowledgement. Only finalized=true permits the number and release.
   * Heartbeats belong to the mounted capture page, including camera waits and uploads.
   * Request deadlines include response bodies; timeout preserves manual recovery.
   * Finish records only a session marker, never JPEG bytes. Reload with missing
   * local Blobs stops explicitly; accepted server positions are never recaptured.
   * Source: docs/slot-setup/matrix.md. SQLite/files remain owned by the server. */
  import { onMount } from 'svelte';
  import { captureHeartbeatIntervalMs, defaultCaptureSettings, type CaptureStatus, type StartReceipt } from '../../shared/capture';
  import { prepareUploadPhoto, type CapturedPhoto } from './photos';
  import Capture from './Capture.svelte';
  import { ApiError, request } from './api';
  let { receipt, installationKey, onnext, onrepeat }: { receipt: StartReceipt; installationKey: string; onnext: () => void; onrepeat: () => void } = $props();
  let status = $state<CaptureStatus>();
  let phase = $state<'loading' | 'capture' | 'transfer' | 'done' | 'error' | 'lost'>('loading');
  let error = $state('');
  let busy = false;
  let photos: (CapturedPhoto & { uploadBlob?: Blob })[] = [];
  const lifecycle = new AbortController();
  const transferStorage = 'reelme.captureTransfer';
  function clearTransferMarker() { if (sessionStorage.getItem(transferStorage) === receipt.sessionId) sessionStorage.removeItem(transferStorage); }
  function next() { clearTransferMarker(); onnext(); }
  $effect(() => {
    if (phase !== 'done' || !status?.finalized || !status.complete) return;
    const timer = setTimeout(next, (status.captureSettings ?? defaultCaptureSettings).receiptSeconds * 1000);
    return () => clearTimeout(timer);
  });
  const path = () => `/api/capture/sessions/${encodeURIComponent(receipt.sessionId)}`;
  const capturing = $derived((status?.state ?? receipt.state) === 'capturing');
  $effect(() => {
    if (!capturing) return;
    const controller = new AbortController();
    const url = path() + '/heartbeat', key = installationKey;
    let pending = false;
    async function heartbeat() {
      if (pending) return;
      pending = true;
      try {
        await request(url, key, { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
      } catch { /* The next heartbeat retries independently of camera and upload operations. */ }
      finally { pending = false; }
    }
    void heartbeat();
    const timer = setInterval(heartbeat, captureHeartbeatIntervalMs);
    window.addEventListener('online', heartbeat);
    window.addEventListener('pageshow', heartbeat);
    return () => {
      controller.abort(); clearInterval(timer);
      window.removeEventListener('online', heartbeat);
      window.removeEventListener('pageshow', heartbeat);
    };
  });
  async function readResponse(response: Response): Promise<CaptureStatus> {
    const value: CaptureStatus = await response.json();
    if (value.sessionId !== receipt.sessionId) throw new Error('Неверное подтверждение сессии');
    return value;
  }
  async function proceed() {
    if (busy) return;
    busy = true; error = ''; phase = 'loading';
    try {
      if (photos.length) sessionStorage.setItem(transferStorage, receipt.sessionId);
      status = await readResponse(await request(path(), installationKey, { signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15_000)]) }));
      if (status.finalized) { clearTransferMarker(); photos = []; phase = 'done'; return; }
      if (!status.complete && photos.length === 0 && status.acceptedPoseIndices.length === 0 && sessionStorage.getItem(transferStorage) !== receipt.sessionId) { phase = 'capture'; return; }
      const missing = status.posePlan.filter(pose => !status!.acceptedPoseIndices.includes(pose.index));
      if (missing.some(pose => !photos.some(photo => photo.sessionId === receipt.sessionId && photo.poseIndex === pose.index))) {
        phase = 'lost'; return;
      }
      phase = 'transfer';
      const maxEdge = status.captureSettings?.photoMaxEdge ?? defaultCaptureSettings.photoMaxEdge;
      for (const pose of status.posePlan) {
        if (status.acceptedPoseIndices.includes(pose.index)) continue;
        const photo = photos.find(photo => photo.sessionId === receipt.sessionId && photo.poseIndex === pose.index);
        if (!photo) throw new Error('Не найден снятый кадр');
        photo.uploadBlob ??= await prepareUploadPhoto(photo.blob, maxEdge);
        const body = new FormData(); body.set('file', photo.uploadBlob, `pose-${pose.index}.jpg`);
        // A JPEG can be up to 20 MiB; allow a slower uplink than for status JSON.
        status = await readResponse(await request(`${path()}/photos/${pose.index}`, installationKey, { method: 'PUT', body, signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(120_000)]) }));
        delete photo.uploadBlob;
      }
      status = await readResponse(await request(`${path()}/finalize`, installationKey, { method: 'POST', signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15_000)]) }));
      if (!status.complete || !status.finalized) throw new Error('Приём фотографий не подтверждён');
      clearTransferMarker(); photos = []; phase = 'done';
    } catch (cause) {
      if (lifecycle.signal.aborted) return;
      error = cause instanceof ApiError && [401, 403].includes(cause.status)
        ? 'Нужна помощь сотрудника: проверьте настройку установки.'
        : photos.length > 0
          ? 'Не удалось подтвердить передачу фотографий. Нажмите «Повторить»: снятые кадры сохранены, новая съёмка не нужна.'
          : 'Не удалось получить состояние сессии. Проверьте соединение и нажмите «Повторить».';
      phase = 'error';
    } finally { busy = false; }
  }
  function captured(value: CapturedPhoto[]) { photos = value; void proceed(); }
  onMount(() => { void proceed(); return () => lifecycle.abort(); });
</script>
<svelte:element this={phase === 'capture' ? 'div' : 'main'} class:session-state={phase !== 'capture'} class:receipt-state={phase === 'done'}>
{#if phase === 'done' && status?.complete && status.finalized}
  <section class="narrow receipt" aria-live="polite">
    <div>
      <p class="eyebrow">ФОТОГРАФИИ ПРИНЯТЫ</p>
      <h1>Ищите видео под номером <span class="visitor-number">{String(status.number).padStart(3, '0')}</span> на промоэкране</h1>
    </div>
    <button class="primary receipt-repeat" onclick={onrepeat}>Еще фотосессия сюжета</button>
    <button class="receipt-next" onclick={next} aria-label="Следующий посетитель"></button>
  </section>
{:else if phase === 'capture' && status}
  <Capture receipt={status} {installationKey} oncomplete={captured} onscenario={() => { if (phase === 'capture') next(); }} />
{:else if phase === 'lost'}
  <section class="narrow" aria-live="polite">
    <p class="eyebrow">ПЕРЕДАЧА ОСТАНОВЛЕНА</p><h1>Недостающие кадры потеряны после перезагрузки</h1>
    <p class="intro">Уже принятые фотографии сохранены на сервере. Оставшихся JPEG больше нет в памяти этой вкладки, поэтому завершить эту фотосессию нельзя.</p>
    <button class="primary" onclick={next}>Начать новую фотосессию</button>
  </section>
{:else}
  <section class="narrow" aria-live="polite">
    <p class="eyebrow">ВАША ФОТОСЕССИЯ</p>
    <h1>{phase === 'error' ? 'Нужен повтор передачи' : phase === 'transfer' ? 'Передаём фотографии…' : 'Проверяем сессию…'}</h1>
    {#if phase === 'error'}<div class="error" role="alert"><p>{error}</p><button class="primary" onclick={proceed}>Повторить</button></div>
    {:else if phase === 'transfer' && status}<p class="intro" role="status">Принято фотографий: {status.acceptedPoseIndices.length} из {status.posePlan.length}. Дождитесь подтверждения.</p>{/if}
  </section>
{/if}

</svelte:element>
<style>
  .session-state { max-width:none; width:100%; margin:0; min-height:100svh; padding:6vh 24px; display:grid; place-items:center; background:radial-gradient(ellipse at 50% 10%,#402139,#0d0a13 65%); color:#fff4fb; font-family:Manrope,sans-serif; --paper:#241827; --ink:#fff4fb; --surface:#2f2133; --muted:#e1c9d9; --accent:#f5b0d8; --accent-ink:#281324; --line:#a57594; --error:#ffd0df; }
  .session-state :global(.narrow) { width:100%; margin:0 auto; }
  .receipt-state { padding-block:clamp(16px,4svh,48px); }
  .session-state .receipt { max-width:1360px; align-self:stretch; display:grid; grid-template-rows:1fr auto; align-items:center; justify-items:center; gap:clamp(20px,4svh,48px); }
  .receipt .eyebrow { font-size:22px; margin-bottom:32px; }
  .receipt h1 { font-size:clamp(40px,6vw,80px); }
  .receipt .visitor-number { color:#f5b0d8; font-size:clamp(160px,32vw,360px); margin:40px 0; }
  .receipt-next { position:fixed; inset:0; z-index:1; width:100%; height:100%; padding:0; border:0; border-radius:0; background:transparent; }
  .receipt-next:focus-visible { outline:3px solid #f5b0d8; outline-offset:-8px; }
  .receipt > .receipt-repeat { position:relative; z-index:2; width:min(100%,440px); min-height:clamp(56px,9svh,80px); margin:0; border-radius:12px; font-size:clamp(20px,2.5vw,30px); font-weight:700; }
  @media(hover:hover) and (pointer:fine) { .receipt-repeat:hover { background:#ffc8e7; } }
  @media(max-height:800px) and (min-width:601px) {
    .receipt h1 { font-size:min(6vw,8svh); }
    .receipt .visitor-number { font-size:min(32vw,40svh); margin:24px 0; }
    .receipt .eyebrow { margin-bottom:24px; }
  }
  @media(max-width:600px) {
    .receipt .eyebrow { font-size:18px; }
    .receipt .visitor-number { margin:24px 0; }
  }
</style>
