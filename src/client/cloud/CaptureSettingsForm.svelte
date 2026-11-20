<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultCaptureSettings, type CaptureSettings } from '../../shared/capture';
  import { api, ApiError } from './api';
  let { onunauthorized }: { onunauthorized: () => void } = $props();
  let draft = $state({ ...defaultCaptureSettings });
  let saved = $state<CaptureSettings>();
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  const fields = [
    ['countdownSeconds', 'Отсчёт перед кадром, сек.'],
    ['reviewSeconds', 'Показ готовой серии, сек.'],
    ['receiptSeconds', 'Показ номера посетителя, сек.'],
  ] as const;
  function fail(cause: unknown) {
    error = cause instanceof Error ? cause.message : 'Не удалось получить параметры съёмки.';
    if (cause instanceof ApiError && cause.status === 401) onunauthorized();
  }
  onMount(() => {
    const controller = new AbortController();
    void api<CaptureSettings>('/admin/capture-settings', { signal: controller.signal }).then(value => {
      saved = value; draft = { ...value };
    }).catch(cause => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
  });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true; error = ''; notice = '';
    try {
      saved = await api<CaptureSettings>('/admin/capture-settings', { method: 'PUT', body: JSON.stringify(draft) });
      notice = 'Параметры сохранены для новых фотосессий.';
    } catch (cause) { fail(cause); }
    finally { busy = false; }
  }
</script>
<section class="capture-settings">
  <h2>Фотосессия</h2>
  <form onsubmit={save} oninput={() => notice = ''}>
    <fieldset disabled={!saved || busy}>
      <legend>Режим фотосесси</legend>
      <label class="mode-switch">
        <span class:chosen={draft.startMode==='manual'}>Ручной</span>
        <input type="checkbox" role="switch" aria-label="Автоматический запуск фотосессии" checked={draft.startMode==='automatic'} onchange={e => draft.startMode = e.currentTarget.checked ? 'automatic' : 'manual'} />
        <span class:chosen={draft.startMode==='automatic'}>Автоматический</span>
      </label>
      <p class="hint">{draft.startMode==='manual' ? 'Коснитесь Live View, чтобы снять один кадр.' : 'Первый отсчёт начинается при открытии экрана съёмки.'}</p>
      <div class="timings">{#each fields as [field, label]}
        <label>{label}<input type="number" min="1" max="60" step="1" required bind:value={draft[field]} /></label>
      {/each}</div>
      <label for="photo-max-edge">Ужимать фото перед отправкой на сервер</label>
      <select id="photo-max-edge" bind:value={draft.photoMaxEdge}>
        <option value={0}>не ужимать</option>
        <option value={1024}>ужимать до 1024px</option>
        <option value={2048}>ужимать до 2048px</option>
      </select>
      <label class="mode-switch log-switch"><input type="checkbox" role="switch" bind:checked={draft.sendCaptureLogs} />Отправлять на сервер логи захвата кадра</label>
      <button class="primary" disabled={JSON.stringify(draft)===JSON.stringify(saved)}>Сохранить параметры съёмки</button>
    </fieldset>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="success" role="status">{notice}</p>{/if}
  </form>
</section>
<style>
  form { padding:clamp(16px,3vw,28px); margin-top:16px; border:1px solid var(--line); border-radius:16px; background:var(--surface); }
  .mode-switch { display:inline-flex; align-items:center; gap:12px; cursor:pointer; }
  .mode-switch span { color:var(--muted); } .mode-switch .chosen { color:var(--text); font-weight:700; }
  .mode-switch input { appearance:none; cursor:pointer; position:relative; width:48px; min-width:48px; height:28px; min-height:0; margin:0; padding:0; background:var(--line); border-radius:20px; }
  .mode-switch input::after { content:''; position:absolute; width:18px; height:18px; inset:4px auto auto 4px; border-radius:50%; background:var(--text); }
  .mode-switch input:checked::after { transform:translateX(20px); background:var(--accent); }
  .log-switch { display:flex; margin-bottom:20px; }
  .log-switch input { flex-shrink:0; }
  .timings { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr)); gap:16px; margin:16px 0 24px; }
  .timings input { display:block; width:100%; margin-top:8px; }
</style>
