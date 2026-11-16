<script lang="ts">
  /** Module contract: manual admin test control. Source: docs/slot-setup/matrix.md. Only an explicit click starts work. Keep an
   * uncertain request ID across retry/reload; polling reads a known session and
   * never generates. One sequential polling loop refreshes test status and the last
   * retained real video; it stops at the terminal test. The server owns preparation. */
  import { onMount } from 'svelte';
  import type { LastSlotVideo } from '../../shared/scenarios';
  import type { CaptureStatus, SessionState } from '../../shared/capture';
  import { api, ApiError } from './api';
  let { slotId, hasPhotos, dirty, disabled, showControls = true, onError }: {
    slotId: string | null; hasPhotos: boolean; dirty: boolean; disabled: boolean; showControls?: boolean; onError: (error: unknown) => void;
  } = $props();
  let posting = $state(false);
  let requestId = $state<string | null>(null);
  let sessionId = $state<string | null>(null);
  let status = $state<CaptureStatus | null>(null);
  let error = $state('');
  let lastVideo = $state<LastSlotVideo | null>(null);
  let videoError = $state('');
  let videoLoaded = $state(false);
  const dateFormat = new Intl.DateTimeFormat('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Novosibirsk', timeZoneName: 'shortOffset' });
  function elapsed(ms: number) {
    return ms >= 60_000 ? `${Math.floor(ms / 60_000)} мин ${Math.floor(ms % 60_000 / 1000)} с` : `${(ms / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} с`;
  }
  const labels: Record<SessionState, string> = {
    capturing: 'Подготовка тестовых фотографий', submit_pending: 'Ожидает обработки', observing: 'Генерация видео',
    preparing: 'Подготовка видео', ready: 'Видео готово', failed: 'Тест не завершён', simulated: 'Эмуляция успешна, но fal не отвечает',
  };
  function remember() {
    if (!slotId) return;
    sessionStorage.setItem(`reelme.slotTest.${slotId}`, JSON.stringify({ requestId, sessionId }));
  }
  onMount(() => {
    if (!slotId) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`reelme.slotTest.${slotId}`) ?? 'null');
      if (saved) { requestId = saved.requestId ?? null; sessionId = saved.sessionId ?? null; }
    } catch { /* No saved request; a click can start a new test. */ }
  });
  $effect(() => {
    const currentSlot = slotId; const currentSession = sessionId;
    if (!currentSlot) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let keepPolling = !!currentSession;
      if (currentSession) {
        try {
          const value = await api<CaptureStatus>(`/admin/slots/${currentSlot}/sessions/${currentSession}`);
          if (stopped) return;
          status = value; error = ''; keepPolling = !['ready', 'simulated', 'failed'].includes(value.state);
        } catch (value) {
          if (stopped) return;
          error = value instanceof Error ? value.message : 'Не удалось прочитать состояние теста.';
          if (value instanceof ApiError && [401, 403, 404].includes(value.status)) { keepPolling = false; if (value.status === 401) onError(value); }
        }
      }
      try {
        const result = await api<{ video: LastSlotVideo | null }>(`/admin/slots/${currentSlot}/latest-video`);
        if (stopped) return;
        lastVideo = result.video; videoError = ''; videoLoaded = true;
      } catch (value) {
        if (stopped) return;
        videoLoaded = true; videoError = value instanceof Error ? value.message : 'Не удалось прочитать последнее видео.';
        if (value instanceof ApiError && [401, 403, 404].includes(value.status)) { lastVideo = null; keepPolling = false; if (value.status === 401) onError(value); }
      }
      if (!stopped && keepPolling) timer = setTimeout(refresh, 2000);
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  });
  async function send() {
    if (!slotId || disabled || dirty || !hasPhotos || posting) return;
    posting = true; error = '';
    requestId ??= crypto.randomUUID(); remember();
    try {
      const value = await api<CaptureStatus>(`/admin/slots/${slotId}/test-generations`, { method: 'POST', body: JSON.stringify({ startRequestId: requestId }) });
      status = value; sessionId = value.sessionId; requestId = null; remember();
    } catch (value) {
      error = value instanceof ApiError ? value.message : 'Ответ не получен. Повторите запрос.';
      // An uncertain HTTP outcome keeps its ID. A retry must not charge again.
      if (value instanceof ApiError && value.status === 400) { requestId = null; remember(); }
      if (value instanceof ApiError && value.status === 401) onError(value);
    } finally { posting = false; }
  }
</script>

<div class="slot-test">
  <div hidden={!showControls}>
  <button type="button" class="quiet" disabled={disabled || posting || !slotId || dirty || !hasPhotos} onclick={send}>{posting ? 'Подготавливаем тест…' : requestId ? 'Повторить запрос тестовой генерации' : 'Отправить тестовую генерацию'}</button>
  {#if !slotId || dirty}<p class="hint">Сначала сохраните сюжет и полный набор тестовых фотографий.</p>
  {:else if !hasPhotos}<p class="hint">Добавьте и сохраните отдельный JPEG для каждого кадра.</p>{/if}
  {#if requestId && !posting}<p class="hint">Ответ на прошлый запуск не подтверждён. Повтор использует тот же запрос.</p>{/if}
  </div>
  {#if status}
    <div aria-live="polite" class="test-result">
      <strong>Тест № {status.number} · {labels[status.state]}</strong>
      {#if status.state === 'simulated'}<p>Тестовый режим: fal не вызывался</p>{/if}
      {#if status.error}<p class="error">{status.error.message}</p>{/if}
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <section class="last-video" aria-label="Последнее реальное видео">
    <h4>Последнее реальное видео</h4>
    {#if lastVideo}
      <video src={lastVideo.videoUrl} aria-label="Последнее реальное видео сюжета" controls preload="metadata" onerror={() => videoError = 'Не удалось открыть видео. Возможно, мероприятие уже удалено.'}><track kind="captions" /></video>
      <dl>
        <div><dt>Отправлено в fal</dt><dd>{lastVideo.submittedAt === null ? 'Нет данных' : `${dateFormat.format(new Date(lastVideo.submittedAt))} · Новосибирск`}</dd></div>
        <div><dt>До готового видео</dt><dd>{lastVideo.elapsedMs === null ? 'Нет данных' : elapsed(lastVideo.elapsedMs)}</dd></div>
      </dl>
      <p class="hint">Время включает очередь fal, скачивание и проверку видео.</p>
    {:else if slotId && !videoLoaded}<p class="hint">Загружаем последний результат…</p>
    {:else if !videoError}<p class="hint">Пока нет готового реального видео.</p>{/if}
    {#if videoError}<p class="error" role="alert">{videoError}</p>{/if}
  </section>
</div>
<style>
  [hidden] { display:none; }
  .slot-test { margin-top:20px; }
  .test-result { margin-top:16px; padding:16px; background:var(--surface); border:1px solid var(--line); border-radius:8px; }
  .test-result p { margin-top:8px; }
  .last-video { margin-top:24px; padding-top:24px; border-top:1px solid var(--line); }
  .last-video video { display:block; width:100%; max-height:480px; margin-top:16px; background:#111; border-radius:8px; }
  dl { display:grid; gap:12px; margin:16px 0; }
  dt { color:var(--muted); font-size:14px; }
  dd { margin:4px 0 0; overflow-wrap:anywhere; }
</style>
