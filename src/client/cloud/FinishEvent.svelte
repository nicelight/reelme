<script lang="ts">
  import type { CurrentEvent } from '../../shared/events';
  import { api, ApiError } from './api';
  let { onfinished, onunauthorized }: { onfinished: () => void; onunauthorized: () => void } = $props();
  let opened = $state(false);
  let busy = $state(false);
  let current = $state<CurrentEvent | null>(null);
  let error = $state('');

  function fail(cause: unknown) {
    if (cause instanceof ApiError && [401,403].includes(cause.status)) onunauthorized();
    else error = cause instanceof Error ? cause.message : 'Не удалось связаться с сервером';
  }
  async function open() {
    if (busy) return;
    current = null; error = ''; busy = true; opened = true;
    try { current = (await api<{ event: CurrentEvent | null }>('/events/current', { signal: AbortSignal.timeout(12000) })).event; }
    catch (cause) { fail(cause); }
    finally { busy = false; }
  }
  async function finish() {
    if (!current || busy) return;
    busy = true; error = '';
    try {
      await api('/events/' + current.key + '/finish', { method: 'POST', signal: AbortSignal.timeout(12000) });
      opened = false; onfinished();
    } catch (cause) { fail(cause); }
    finally { busy = false; }
  }
  function show(dialog: HTMLDialogElement) { dialog.showModal(); }
</script>

<button class="quiet finish" onclick={open}>Завершить текущее мероприятие</button>
{#if opened}
  <dialog use:show aria-labelledby="finish-event-title" oncancel={e => { if (busy) e.preventDefault(); else opened = false; }}>
    <h2 id="finish-event-title">{current ? 'Завершить мероприятие «' + current.name + '»?' : 'Текущее мероприятие'}</h2>
    {#if current}
      <p>Мероприятие появится в архиве. Следующая фотосессия начнёт новое мероприятие и продолжит нумерацию дня.</p>
    {:else if !error}
      <p>{busy ? 'Проверяем текущее мероприятие…' : 'Сейчас нет открытого мероприятия. Начните фотосессию на установке, чтобы создать новое.'}</p>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button class="quiet" disabled={busy} onclick={() => opened = false}>{current ? 'Отмена' : 'Закрыть'}</button>
      {#if current}<button class="primary" disabled={busy} onclick={finish}>{busy ? 'Завершаем…' : 'Завершить мероприятие'}</button>{/if}
    </div>
  </dialog>
{/if}

<style>
  button.finish {
    margin-inline-start:auto; background:#302328; border-color:#3c2c32;
    color:#ae939b; font-weight:500;
  }
  button.finish:hover:not(:disabled), button.finish:focus-visible {
    background:#3a282f; border-color:#523840; color:#c3a7af;
  }
  dialog { margin:auto; width:min(480px,calc(100% - 32px)); padding:24px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--text); }
  dialog::backdrop { background:#0009; }
  h2 { overflow-wrap:anywhere; } p { margin:16px 0; }
  .actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
</style>
