<script lang="ts">
  import { onMount } from 'svelte';
  import { pageDurationOptions, type DisplaySettings, type PageDurationSeconds } from '../../shared/display';
  import { api, ApiError } from './api';
  let { onunauthorized }: { onunauthorized: () => void } = $props();
  let value = $state<PageDurationSeconds>(10);
  let saved = $state<PageDurationSeconds>(10);
  let loaded = $state(false);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  function fail(cause: unknown) {
    error = cause instanceof Error ? cause.message : 'Не удалось сохранить настройку.';
    if (cause instanceof ApiError && cause.status === 401) onunauthorized();
  }
  onMount(() => {
    let active = true;
    void api<DisplaySettings>('/admin/display-settings').then(settings => {
      if (active) { value = saved = settings.pageDurationSeconds; loaded = true; }
    }).catch(cause => { if (active) fail(cause); });
    return () => { active = false; };
  });
  async function save(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = ''; notice = '';
    try {
      const settings = await api<DisplaySettings>('/admin/display-settings', { method: 'PUT', body: JSON.stringify({ pageDurationSeconds: value }) });
      value = saved = settings.pageDurationSeconds;
      notice = 'Длительность показа сохранена. Она применяется со следующей страницы.';
    } catch (cause) { fail(cause); }
    finally { busy = false; }
  }
</script>

<section class="display-settings">
  <h2>Экран результатов</h2>
  <form onsubmit={save}>
    <label for="page-duration">Длительность показа страницы</label>
    <select id="page-duration" bind:value disabled={!loaded || busy} onchange={() => notice = ''}>
      {#each pageDurationOptions as seconds}<option value={seconds}>{seconds} секунд</option>{/each}
    </select>
    <p class="hint">После заполнения первой сетки страницы автоматически сменяются с выбранным интервалом.</p>
    <button class="primary" disabled={!loaded || busy || value === saved}>{busy ? 'Сохраняем…' : 'Сохранить настройку'}</button>
    {#if !loaded && !error}<p role="status">Загружаем настройку…</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="success" role="status">{notice}</p>{/if}
  </form>
</section>
<style>
  .display-settings { max-width:720px; margin:40px auto; padding:0 24px; }
  form { margin-top:32px; }
  select { max-width:320px; }
  button { margin:24px 0 12px; }
</style>
