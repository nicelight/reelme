<script lang="ts">
  import type { TemplateUploadStatus } from '../../shared/template-upload';
  import { api, ApiError } from './api';

  let { saving, onunauthorized }: { saving: boolean; onunauthorized: () => void } = $props();
  let dialog: HTMLDialogElement;
  let status = $state<TemplateUploadStatus | null>(null);
  let checking = $state(true);
  let unavailable = $state(false);
  let dismissed = $state(sessionStorage.getItem('reelme.uploadError') ?? '');
  const problem = $derived(unavailable ? 'Не удалось получить состояние загрузки. Проверьте соединение с сервером.' : status?.error);
  const problemId = $derived(unavailable ? 'connection' : status?.batch ?? '');
  const blocked = $derived(saving || checking || (problem ? dismissed !== problemId : status?.pending));
  const percent = $derived(status?.totalBytes ? Math.floor(100 * status.sentBytes / status.totalBytes) : 0);

  const heading = $derived(saving ? 'Сохраняем сюжет' : problem ? 'Ошибка загрузки' : 'Загрузка в fal CDN');

  $effect(() => {
    if (saving) {
      checking = true;
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await api<{ status: TemplateUploadStatus | null }>('/admin/template-uploads', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (controller.signal.aborted) return;
        status = response.status;
        unavailable = false;
        if (dismissed === 'connection') dismiss('');
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) { onunauthorized(); return; }
        unavailable = true;
      }
      checking = false;
      timer = setTimeout(poll, status?.pending ? 450 : 1500);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  });
  $effect(() => {
    if (blocked && !dialog.open) dialog.showModal();
    else if (!blocked && dialog.open) dialog.close();
  });
  function dismiss(id: string) {
    dismissed = id;
    sessionStorage.setItem('reelme.uploadError', id);
  }
</script>

<dialog bind:this={dialog} aria-labelledby="upload-title" oncancel={event => event.preventDefault()}>
  <h2 id="upload-title">{heading}</h2>
  {#if !unavailable && status?.pending && !saving}
    <div class="summary"><span>Файлов готово: {status.readyFiles} из {status.totalFiles}</span><strong>{percent}%</strong></div>
    <progress max="100" value={percent} aria-label="Загрузка материалов в fal CDN"></progress>
    {#if !problem}<p>{percent === 100 ? 'Ожидаем подтверждения от fal CDN.' : 'Когда материалы загрузятся, панель откроется автоматически.'}</p>{/if}
  {:else if !problem}
    <progress aria-label="Проверяем состояние загрузки"></progress>
  {/if}
  {#if problem && !saving}
    <p role="alert">{problem}</p>
    <button class="primary" onclick={() => dismiss(problemId)}>Вернуться в админку</button>
  {/if}
</dialog>

<style>
  dialog { width:min(28rem,calc(100% - 2rem)); margin:auto; padding:1.75rem; color:var(--text); background:var(--surface); border:1px solid var(--line); border-radius:16px; }
  dialog::backdrop { background:rgb(12 8 15 / .76); }
  h2 { font-size:1.375rem; }
  .summary { display:flex; justify-content:space-between; gap:1rem; align-items:baseline; margin-top:1.5rem; font-variant-numeric:tabular-nums; }
  strong { color:var(--accent); }
  progress { display:block; width:100%; height:.65rem; margin:1rem 0; accent-color:var(--accent); }
  p { color:var(--muted); font-size:.9rem; margin-top:1rem; }
  p[role=alert] { color:var(--error); }
  button { margin-top:1.25rem; }
</style>
