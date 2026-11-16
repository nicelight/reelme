<script lang="ts">
  /** Module contract: coordinates one server-issued session through local capture,
   * JPEG upload and finalize. Retries retain original Blobs/positions and never
   * call the camera again. Server status is authoritative, including after reload
   * or a lost acknowledgement. Only finalized=true permits the number and release.
   * Finish records only a session marker, never JPEG bytes. Reload with missing
   * local Blobs stops explicitly; accepted server positions are never recaptured.
   * Source: docs/slot-setup/matrix.md. SQLite/files remain owned by the server. */
  import { onMount } from 'svelte';
  import type { CaptureStatus, StartReceipt } from '../../shared/capture';
  import type { CapturedPhoto } from './photos';
  import Capture from './Capture.svelte';
  import { ApiError, request } from './api';
  let { receipt, installationKey, onnext }: { receipt: StartReceipt; installationKey: string; onnext: () => void } = $props();
  let status = $state<CaptureStatus>();
  let phase = $state<'loading' | 'capture' | 'transfer' | 'done' | 'error' | 'lost'>('loading');
  let error = $state('');
  let busy = false;
  let photos: CapturedPhoto[] = [];
  const lifecycle = new AbortController();
  const transferStorage = 'reelme.captureTransfer';
  function clearTransferMarker() { if (sessionStorage.getItem(transferStorage) === receipt.sessionId) sessionStorage.removeItem(transferStorage); }
  function next() { clearTransferMarker(); onnext(); }
  const path = () => `/api/capture/sessions/${encodeURIComponent(receipt.sessionId)}`;
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
      status = await readResponse(await request(path(), installationKey, { signal: lifecycle.signal }));
      if (status.finalized) { clearTransferMarker(); photos = []; phase = 'done'; return; }
      if (!status.complete && photos.length === 0 && status.acceptedPoseIndices.length === 0 && sessionStorage.getItem(transferStorage) !== receipt.sessionId) { phase = 'capture'; return; }
      const missing = status.posePlan.filter(pose => !status!.acceptedPoseIndices.includes(pose.index));
      if (missing.some(pose => !photos.some(photo => photo.sessionId === receipt.sessionId && photo.poseIndex === pose.index))) {
        phase = 'lost'; return;
      }
      phase = 'transfer';
      for (const pose of status.posePlan) {
        if (status.acceptedPoseIndices.includes(pose.index)) continue;
        const photo = photos.find(photo => photo.sessionId === receipt.sessionId && photo.poseIndex === pose.index);
        if (!photo) throw new Error('Не найден снятый кадр');
        const body = new FormData(); body.set('file', photo.blob, `pose-${pose.index}.jpg`);
        status = await readResponse(await request(`${path()}/photos/${pose.index}`, installationKey, { method: 'PUT', body, signal: lifecycle.signal }));
      }
      status = await readResponse(await request(`${path()}/finalize`, installationKey, { method: 'POST', signal: lifecycle.signal }));
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
{#if phase === 'done' && status?.complete && status.finalized}
  <section class="narrow receipt" aria-live="polite">
    <p class="eyebrow">ФОТОГРАФИИ ПРИНЯТЫ</p>
    <h1>Ищи свое видео под номером <span class="visitor-number">{String(status.number).padStart(3, '0')}</span> на промо экране</h1>
    <button class="primary" onclick={next}>Следующий посетитель</button>
  </section>
{:else if phase === 'capture' && status}
  <Capture receipt={status} {installationKey} oncomplete={captured} />
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
