<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from './api';
  import type { HistoryDetail, SessionHistory, StatusPage } from '../../shared/statuses';

  let { onunauthorized }: { onunauthorized: () => void } = $props();
  const params = new URLSearchParams(location.search);
  const session = params.get('session');
  const listParams = new URLSearchParams(params);
  listParams.delete('session');
  if (!listParams.get('number')) listParams.delete('number');
  const listHref = '/requests?' + listParams;
  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  let page = $state<StatusPage>();
  let history = $state<SessionHistory>();
  let error = $state('');
  let copied = $state('');

  function href(key: string, value: string) {
    const query = new URLSearchParams(listParams);
    if (!query.has('date') && page) query.set('date', page.date);
    query.set(key, value);
    return '/requests?' + query;
  }
  onMount(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    async function load() {
      try {
        if (session) {
          const path = '/statuses/' + encodeURIComponent(session) + '?requests=1';
          const data = await api<SessionHistory>(path, { signal });
          while (data.nextAfter !== null) {
            const next = await api<SessionHistory>(path + '&after=' + data.nextAfter, { signal });
            data.entries.push(...next.entries);
            data.nextAfter = next.nextAfter;
          }
          history = data;
        } else {
          const query = new URLSearchParams(listParams);
          query.set('requests', '1');
          page = await api<StatusPage>('/statuses?' + query, { signal });
        }
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof ApiError && [401,403].includes(e.status)) onunauthorized();
        else error = e instanceof Error ? e.message : 'Не удалось загрузить запросы.';
      }
    }
    void load();
    return () => controller.abort();
  });
  type RequestBody = NonNullable<HistoryDetail['providerRequest']>;
  async function copy(request: RequestBody, key: string) {
    try {
      const links = new Set(history?.media.map(file => file.href));
      const json = JSON.stringify(request, (_key, value) =>
        links.has(value) ? new URL(value, location.origin).href : value, 2);
      await navigator.clipboard.writeText(json);
      copied = key;
    } catch { copied = 'error-' + key; }
  }
  const mediaLinks = $derived(new Map(history?.media.map(file => [JSON.stringify(file.href), file])));
</script>

{#snippet body(request: RequestBody, key: string)}
  <div class="json-bar"><strong>JSON запроса</strong><button onclick={() => copy(request, key)}>
    {copied === key ? 'Скопировано' : 'Скопировать JSON'}
  </button></div>
  {#if copied === 'error-' + key}<small role="status">Буфер обмена недоступен. Выделите текст запроса.</small>{/if}
  <pre><code>{#each JSON.stringify(request, null, 2).split(/("(?:[^"\\]|\\.)*")/g) as part}{@const file = mediaLinks.get(part)}{#if file}"<a href={file.href} target="_blank" rel="noreferrer" title={file.label}>{file.href}</a>"{:else}{part}{/if}{/each}</code></pre>
{/snippet}

<main>
  <nav><a href={session ? listHref : '/operator'}>{session ? '← Все запросы' : '← Рабочий экран'}</a></nav>
  {#if !session}
    <h1>Запросы к fal</h1>
    <form method="get" action="/requests">
      <label>Дата мероприятия<input type="date" name="date" value={params.get('date') || page?.date || ''} required /></label>
      <label>Номер посетителя<input type="number" name="number" min="1" placeholder="Все номера" value={params.get('number') || ''} /></label>
      <button type="submit">Найти</button>
    </form>
    {#if page}
      {#each page.sessions as row}
        <a class="row" href={href('session', row.id)}>
          <strong>№ {row.number}</strong><span>{row.story || row.eventName || 'Генерация'}<small>{row.mode || 'Фотосессия'} · {row.label}</small></span><span aria-hidden="true">→</span>
        </a>
      {:else}<p>За выбранную дату и номер запросов к fal нет.</p>{/each}
      {#if page.nextBefore !== null}<a class="next" href={href('before', String(page.nextBefore))}>Предыдущие генерации →</a>{/if}
    {/if}
  {:else if history}
    <h1>Генерация № {history.session.number}</h1>
    <p>{history.session.story} · {history.session.date} · {history.session.mode || 'Фотосессия'}</p>
    <p class="model">{history.facts.model}</p>
    {#if history.facts.requestId}<p>Request ID <code>{history.facts.requestId}</code></p>{/if}
    {#if history.media.length}
      <section><h2>Материалы сессии</h2>
        <div class="gallery">{#each history.media as file}
          {#if file.kind === 'image'}<a href={file.href} target="_blank" rel="noreferrer"><img src={file.href} alt={file.label} loading="lazy" /><small>{file.label}</small></a>{/if}
        {/each}</div>
        {#each history.media as file}{#if file.kind === 'video'}<a href={file.href} target="_blank" rel="noreferrer">{file.label} ↗</a>{/if}{/each}
      </section>
    {/if}
    <section><h2>Отправки</h2>
      <p class="hint">В JSON ссылки на медиа открывают исходные файлы через ваш аккаунт ReelMe.</p>
      {#each history.entries as entry (entry.id)}
        <div class="event"><time datetime={entry.at}>{time.format(new Date(entry.at))} НСК</time>
          <strong>{entry.label}</strong>{#if entry.detail.attempt} · попытка {entry.detail.attempt}{/if}
          {#if entry.detail.requestId}<small>Request ID {entry.detail.requestId}</small>{/if}
          {#if entry.detail.providerReason}<small>{entry.detail.providerReason}</small>{/if}
          {#if entry.detail.providerRequest}{@render body(entry.detail.providerRequest, String(entry.id))}{/if}
        </div>
      {/each}
      {#if !history.entries.some(entry => entry.detail.providerRequest)}
        <p>В истории этой сессии нет записанного тела запроса.</p>
        {#if history.reconstructed}<h3>Реконструкция по материалам сессии</h3>
          <p>Структура собрана по сохранённым настройкам и текущей версии приложения.</p>
          {@render body(history.reconstructed, 'reconstructed')}
        {/if}
      {/if}
    </section>
  {/if}
  {#if error}<p class="error" role="alert">{error} <a href={location.href}>Повторить</a></p>
  {:else if !page && !history}<p role="status">Загрузка…</p>{/if}
</main>

<style>
  main {max-width:960px;margin:auto;padding:24px clamp(16px,4vw,36px) 64px;overflow-wrap:anywhere}
  nav, small, time, .model {color:var(--muted)}
  nav {margin-bottom:16px}
  h1 {margin-bottom:8px} h2 {font-size:1.3rem;margin-bottom:12px} h3 {font-size:1.1rem;margin-top:16px}
  form {display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:20px 0}
  label {margin:0;flex:1 1 150px;min-width:0} input {margin-top:4px}
  .row {display:grid;grid-template-columns:5em 1fr auto;gap:12px;align-items:center;border-top:1px solid var(--line);padding:13px 8px;text-decoration:none}
  .row:hover {background:var(--soft)} small {display:block} .next {display:inline-block;margin-top:16px}
  section {border-top:1px solid var(--line);margin-top:24px;padding-top:20px}
  .gallery {display:grid;grid-template-columns:repeat(auto-fill,minmax(126px,1fr));gap:12px;margin-bottom:10px}
  img {width:100%;height:120px;object-fit:contain;background:var(--input);display:block}
  .event {padding:10px 0;border-bottom:1px solid var(--line)} time {font-size:.83rem;margin-right:.6em;font-variant-numeric:tabular-nums}
  .json-bar {display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}
  .json-bar button {font-size:.85rem}
  pre {margin:8px 0;padding:14px;background:var(--input);border:1px solid var(--line);border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}
  pre a {color:var(--accent)}
</style>
