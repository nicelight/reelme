<script lang="ts">
  import { api, ApiError } from './api';
  import { onMount } from 'svelte';
  import { balanceIntervalMs, type FalBalance, type SessionHistory, type StatusPage } from '../../shared/statuses';

  let { onunauthorized }: { onunauthorized: () => void } = $props();
  let date = $state('');
  let number = $state('');
  let issuesOnly = $state(false);
  let pages = $state<(number | null)[]>([null]);
  let opened = $state('');
  let page = $state<StatusPage>();
  let history = $state<SessionHistory>();
  let historyPages = $state(1);
  let listError = $state('');
  let detailError = $state('');
  let copied = $state('');
  let copying = $state(false);
  const usd = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 9 });
  const clock = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const reason = (e: unknown) => e instanceof Error ? e.message : 'Ошибка запроса';
  function denied(e: unknown) {
    if (e instanceof ApiError && [401,403].includes(e.status)) { onunauthorized(); return true; }
    return false;
  }
  let balance = $state<FalBalance>({ credits: null, error: null });
  const amount = $derived(balance.credits && new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: balance.credits.currency, currencyDisplay: 'code',
  }).format(balance.credits.amount));

  onMount(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let due = 0;
    async function refresh() {
      clearTimeout(timer);
      if (document.hidden || controller.signal.aborted) return;
      const remaining = due - Date.now();
      if (remaining > 0) {
        timer = setTimeout(refresh, remaining);
        return;
      }
      due = Date.now() + balanceIntervalMs;
      timer = setTimeout(refresh, balanceIntervalMs);
      try {
        const result = await api<FalBalance>('/statuses/fal-balance', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        });
        if (!controller.signal.aborted) balance = result;
      } catch (error) {
        if (!controller.signal.aborted && !denied(error)) balance = { ...balance, error: 'Не удалось обновить баланс' };
      }
    }
    void refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); };
  });
  function reset() { pages = [null]; opened = ''; page = undefined; }
  function toggleIssues() { issuesOnly = !issuesOnly; number = ''; reset(); }
  function expand(id: string) { opened = opened === id ? '' : id; historyPages = 1; copied = ''; detailError = ''; history = undefined; }
  async function readHistory(id: string, count: number, signal?: AbortSignal) {
    const path = '/statuses/' + encodeURIComponent(id);
    const data = await api<SessionHistory>(path, { signal });
    for (let i = 1; i < count && data.nextAfter !== null; i++) {
      const next = await api<SessionHistory>(path + '?after=' + data.nextAfter, { signal });
      data.entries.push(...next.entries);
      data.nextAfter = next.nextAfter;
    }
    return data;
  }
  async function copy(id: string) {
    copying = true; copied = '';
    try {
      const text = readHistory(id, Infinity, AbortSignal.timeout(20000)).then(data => JSON.stringify(data, null, 2));
      // Safari requires clipboard.write during the original button gesture.
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(value => new Blob([value], { type: 'text/plain' })) })]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      if (opened !== id) return;
      copied = 'История скопирована';
    } catch (e) { if (!denied(e) && opened === id) copied = 'Не удалось скопировать историю. ' + reason(e); }
    finally { copying = false; }
  }
  // Each filter or page starts a new request scope. Late replies cannot replace a newer view.
  $effect(() => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (number) params.set('number', number);
    if (issuesOnly) params.set('issues','1');
    const before = pages.at(-1);
    if (before) params.set('before', String(before));
    const id = opened, count = historyPages;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout>, busy = false;
    async function refresh() {
      if (busy || signal.aborted || document.hidden) return;
      busy = true;
      try {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        const data = await api<StatusPage>('/statuses?' + params, { signal: requestSignal });
        if (signal.aborted) return;
        page = data; listError = '';
        if (id) {
          try {
            const details = await readHistory(id, count, requestSignal);
            if (!signal.aborted) {
              if (details.session.date !== data.date || (params.has('issues') && !details.session.issue)) { opened = ''; return; }
              if (!data.sessions.some(row => row.id === id)) page = { ...data, sessions: [...data.sessions, details.session] };
              history = details; detailError = '';
            }
          } catch (e) { if (!signal.aborted && !denied(e)) { if (e instanceof ApiError && e.status === 404) opened = ''; else detailError = reason(e); } }
        }
      } catch (e) {
        if (!signal.aborted && !denied(e)) listError = 'Нет свежих данных';
      } finally {
        busy = false;
        if (!signal.aborted) { clearTimeout(timer); timer = setTimeout(refresh, 4000); }
      }
    }
    void refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  });
</script>

<main class="monitor">
  <div class="heading"><a href="/operator">← Рабочий экран</a><div class="title-line"><h1>Статусы видео</h1>
    <div class="balance"><span>Баланс fal</span> <strong>{amount ?? (balance.error ? '—' : '…')}</strong>
      {#if balance.error}<small class="stale">{balance.error}</small>{/if}
      {#if balance.credits}<small>Обновлено в {clock.format(balance.credits.checkedAt)} НСК</small>{/if}
    </div></div></div>
  <div class="filters">
    <label>Дата мероприятия<input type="date" value={date || page?.date || ''} onchange={e => { date = e.currentTarget.value; reset(); }} /></label>
    <label>Номер посетителя<input placeholder="Все номера" type="search" inputmode="numeric" value={number} oninput={e => { number = e.currentTarget.value.replace(/\D/g,''); e.currentTarget.value = number; reset(); }} /></label>
  </div>
  {#if page?.eventName}<h2>{page.eventName}</h2>{/if}
  <div class="summary">
    <button class:alarm={!!page?.issues} aria-pressed={issuesOnly} onclick={toggleIssues}>{issuesOnly ? 'Все сессии' : 'Проблемы'}{page ? ' · ' + page.issues : ''}</button>
    <small role="status" class:stale={!!listError}>{listError || 'Обновление'}{page ? ' · ' + clock.format(page.serverNow) + ' НСК' : '…'}</small>
  </div>
  {#if page}
    {#each page.sessions as row (row.id)}
      <article>
        <button class="row" class:problem={!!row.issue} data-stage={row.stage} aria-expanded={opened === row.id} onclick={() => expand(row.id)}>
          <span class="num">№ {row.number}{#if !page.eventName && row.eventName}<small>{row.eventName}</small>{/if}</span><span class="when">{clock.format(row.updatedAt)}</span>
          <span class="track" aria-hidden="true"><i style:width={(row.issue ? 100 : Math.min(100,(row.stage+1)*16)) + '%'}></i></span>
          <span class="step">{#if row.issue}<b>{row.issue === 'retry' ? 'Сбой · повторяем' : 'Ошибка'}</b>{row.issue === 'retry' ? ' · ' : ': '}{/if}{row.label}{#if row.mode} · {row.mode}{/if}
            {#if row.costUsd !== undefined}{' · '}<span title="Стоимость генерации в USD">{row.costUsd === null ? '..$' : usd.format(row.costUsd) + ' $'}</span>{/if}
          </span>
          <span class="chevron" aria-hidden="true">{opened === row.id ? '−' : '+'}</span>
        </button>
        {#if opened === row.id}
          <section class="history" aria-label={'История № ' + row.number}>
            {#if detailError}<p role="status">{detailError}</p>{/if}
            {#if history && history.session.id === row.id}
              {#if history.partial}<p>История частичная. Доступны сохранённые сведения.</p>{/if}
              <p>Номер присвоен в {clock.format(new Date(history.facts.createdAt))} НСК{history.facts.model ? ' · ' + history.facts.model : ''}</p>
              {#if history.facts.requestId}<p>Request ID <code>{history.facts.requestId}</code></p>{/if}
              {#if history.facts.errorCode}<p>Код ошибки <code>{history.facts.errorCode}</code></p>{/if}
              <ol>{#each history.entries as entry (entry.id)}
                <li><time datetime={entry.at}>{clock.format(new Date(entry.at))}</time><span>{entry.label}
                  {#if entry.repeats > 1} · ×{entry.repeats}, до {clock.format(new Date(entry.lastAt))}{/if}
                  {#if entry.detail.profile}<small>Профиль {entry.detail.profile}</small>{/if}
                  {#if entry.detail.code}<small>{entry.detail.code}</small>{/if}
                  {#if entry.detail.httpStatus}<small>HTTP {entry.detail.httpStatus}</small>{/if}
                  {#if entry.detail.providerReason}<small>Ответ fal{entry.detail.providerField ? ` · ${entry.detail.providerField}` : ''} — {entry.detail.providerReason}</small>{/if}
                  {#if entry.detail.attempt}<small>Попытка {entry.detail.attempt}</small>{/if}
                </span></li>
              {/each}</ol>
              {#if history.nextAfter !== null}<button onclick={() => historyPages++}>Ещё события</button>{/if}
              <button disabled={copying} onclick={() => copy(row.id)}>Скопировать JSON</button>
              {#if copied}<small role="status">{copied}</small>{/if}
            {:else if !detailError}<p>Загружаем историю…</p>{/if}
          </section>
        {/if}
      </article>
    {:else}
      <p class="empty">{#if issuesOnly}Активных проблем нет{:else if !date && !number && pages.length === 1}Сегодня сессий пока нет. Здесь появится первая съёмка или тест из редактора.{:else}Сессий не найдено{/if}</p>
    {/each}
    <div class="paging">
      {#if pages.length > 1}<button onclick={() => { pages = pages.slice(0,-1); opened = ''; }}>← Новее</button>{/if}
      {#if page.nextBefore !== null}<button onclick={() => { pages = [...pages, page!.nextBefore]; opened = ''; }}>Старее →</button>{/if}
    </div>
  {/if}
</main>

<style>
  .monitor {max-width:850px;margin:0 auto;padding:24px clamp(14px,4vw,36px) 64px}
  .heading a,small,.when,time {font-size:.81rem;color:var(--muted)}
  .title-line {display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px 16px;margin:10px 0 18px}
  h1 {margin:0}
  h2 {font-size:1.15rem;margin:16px 0 0;overflow-wrap:anywhere}
  .balance {font-variant-numeric:tabular-nums}
  .balance span {color:var(--muted);font-size:.84rem}
  .filters {display:grid;grid-template-columns:1fr 1fr;gap:12px}
  label {min-width:0;margin:0;font-size:.84rem}
  input {margin-top:4px;min-width:0}
  .summary,.paging {display:flex;align-items:center;justify-content:space-between;gap:8px}
  .summary {position:sticky;top:0;z-index:1;background:var(--bg);padding:12px 0;border-bottom:1px solid var(--line)}
  .summary small {text-align:right}
  .alarm,.alarm:hover:not(:disabled) {background:#b31831;color:white;border-color:#b31831}
  .stale,.problem b {color:var(--error)}
  article {border-bottom:1px solid var(--line);background:var(--surface)}
  .row {width:100%;display:grid;grid-template-columns:1fr auto auto;gap:6px 12px;align-items:center;text-align:left;border:0;border-radius:0;padding:13px 14px;background:transparent;--stage:#db779e}
  .row[data-stage='2'] {--stage:#9862c5}.row[data-stage='3'] {--stage:#7dc6df}
  .row[data-stage='4'],.row[data-stage='5'],.row[data-stage='6'] {--stage:#afd88c}
  .num {font-size:1.2rem;font-variant-numeric:tabular-nums}
  .track {grid-area:2 / 1 / 3 / 4;height:4px;background:var(--line);border-radius:6px;overflow:hidden}
  .track i {display:block;height:100%;background:var(--stage);border-radius:inherit}
  .problem .track {height:11px}.problem .track i {background:#ff233e}
  .step {grid-column:1 / -1;font-size:.92rem;font-weight:500;overflow-wrap:anywhere}
  .chevron {grid-area:1 / 3;color:var(--muted);font-size:1.15rem}
  .history {padding:12px 14px 18px;border-top:1px solid var(--line);overflow-wrap:anywhere}
  ol {padding:0;list-style:none} li {display:grid;grid-template-columns:auto 1fr;gap:10px;padding:4px 0}
  small {display:block} time,.when {font-variant-numeric:tabular-nums}
  .empty,.paging {padding:16px 0}
</style>
