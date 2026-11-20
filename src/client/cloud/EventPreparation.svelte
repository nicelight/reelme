<script lang="ts">
  /** Confirmation uses the server's inclusive date. Polling follows the shared
   * operation while this settings page is open; deletion continues after leaving. */
  import { onMount } from 'svelte';
  import type { EventPreparation, PreparationProgress } from '../../shared/events';
  import { api, ApiError } from './api';

  let { onunauthorized }: { onunauthorized: () => void } = $props();
  const path = '/admin/event-preparation';
  const controller = new AbortController();
  const dateFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' });
  let operation = $state<PreparationProgress | null>(null);
  let busy = $state(true);
  let notice = $state('');
  let error = $state('');
  let timer: ReturnType<typeof setTimeout>;

  function fail(cause: unknown) {
    if (controller.signal.aborted) return;
    error = cause instanceof Error ? cause.message : 'Не удалось проверить состояние очистки.';
    if (cause instanceof ApiError && cause.status === 401) onunauthorized();
  }
  function show(view: EventPreparation) {
    clearTimeout(timer);
    operation = view.operation;
    if (operation?.running) timer = setTimeout(refresh, 1000);
  }
  async function refresh() {
    try {
      show(await api<EventPreparation>(path, { signal: controller.signal }));
      error = '';
    } catch (cause) {
      fail(cause);
      if (!controller.signal.aborted && operation?.running) timer = setTimeout(refresh, 3000);
    } finally { busy = false; }
  }
  onMount(() => {
    void refresh();
    return () => { clearTimeout(timer); controller.abort(); };
  });
  async function prepare() {
    if (busy || operation?.running) return;
    busy = true; error = ''; notice = '';
    try {
      const view = await api<EventPreparation>(path, { signal: controller.signal });
      show(view);
      if (view.operation?.running) return;
      if (!view.eligibleCount) { notice = 'Нет мероприятий для удаления.'; return; }
      const date = dateFormat.format(new Date(view.through));
      if (!window.confirm(`Будут безвозвратно удалены мероприятия за ${date} и раньше вместе с их фото и видео. Продолжить?`)) return;
      const result = await api<EventPreparation>(path, { method: 'POST', body: JSON.stringify({ through: view.through }), signal: controller.signal });
      show(result);
      if (!result.eligibleCount) notice = 'Нет мероприятий для удаления.';
    } catch (cause) { fail(cause); }
    finally { busy = false; }
  }
</script>

<section>
  <h2>Архив мероприятий</h2>
  <div class="preparation-action">
    <button aria-describedby="preparation-hint" disabled={busy || operation?.running} onclick={prepare}>Подготовка к мероприятию</button>
    <p id="preparation-hint" class="hint">После подтверждения из архива навсегда удалятся мероприятия по указанную дату включительно вместе с их фото и видео. Очистка идёт в фоне и может занять от нескольких секунд до нескольких минут, а при большом количестве файлов — дольше.</p>
  </div>
  <div role="status">
    {#if notice}<p>{notice}</p>
    {:else if operation}
      {#if operation.running}
        <p>Идёт очистка. Обработано {operation.deleted + operation.failed} из {operation.total}.</p>
      {:else}
        <p>Очистка завершена. Удалено мероприятий — {operation.deleted}. {#if !operation.failed && !operation.remoteErrors}Без ошибок.{/if}</p>
      {/if}
      {#if operation.failed}<p>Не удалось удалить мероприятий — {operation.failed}.</p>{/if}
      {#if operation.remoteErrors}<p>Не удалось подтвердить удаление копий в fal — {operation.remoteErrors}.</p>{/if}
    {/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .preparation-action { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-top: 16px; }
  .preparation-action .hint { flex: 1 1 32ch; margin: 0; }
  p { margin-top: 12px; }
</style>
