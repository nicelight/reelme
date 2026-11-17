<script lang="ts">
  import { onMount } from 'svelte';
  import type { CatalogItem, CatalogPage, StartReceipt } from '../../shared/capture';
  import type { EventSetup as EventSetupAction } from '../../shared/events';
  import { ApiError, installationKeyStorage, request, startStorage } from './api';
  import StoryCatalog from './story/StoryCatalog.svelte';
  import PhotoSession from './PhotoSession.svelte';
  import EventSetup from './EventSetup.svelte';
  import './story/assets/fonts.css';
  import mark from './story/assets/reelme-mark.png';
  import './style.css';
  /** Module contract: visitor catalog → durable start → PhotoSession owns capture
   * and transfer. sessionStorage recovers the server receipt; only confirmed
   * completion or confirmed abandonment (including lost local JPEGs) permits returning to
   * the catalog. Start timeout retains the same request ID for manual recovery.
   * The server requests event setup before the first visitor; setup action and
   * receipt share the durable start key. Source: docs/slot-setup/matrix.md.
   * Last browsed/chosen story persists in localStorage for catalog return/reload.
   * Server photos are never erased here. */
  type StartState = { startRequestId: string; slotId: string; receipt?: StartReceipt; eventSetupRequired?: boolean; eventSetup?: EventSetupAction };
  let key = $state('');
  let setup = $state(false);
  let enteredKey = $state('');
  let setupMessage = $state('');
  let storageReady = $state(true);
  let catalog = $state<CatalogPage>();
  let selected = $state<CatalogItem>();
  let start = $state<StartState>();
  let busy = $state(false);
  let loading = $state(false);
  let error = $state('');
  let catalogAbort: AbortController | undefined;
  let loadVersion = 0;
  const lifecycle = new AbortController();
  const lastStoryStorage = 'reelme.lastStory';
  function lastStory() {
    try { return localStorage.getItem(lastStoryStorage) ?? undefined; } catch { return undefined; }
  }
  function rememberStory(item: CatalogItem) {
    selected = item;
    try { localStorage.setItem(lastStoryStorage, item.id); } catch { /* Catalog stays usable without preference storage. */ }
  }

  function message(cause: unknown) {
    if (cause instanceof ApiError && [401, 403].includes(cause.status)) return 'Нужна помощь сотрудника: проверьте настройку установки.';
    if (cause instanceof ApiError && cause.status === 404) return 'Этот сюжет больше недоступен. Выберите другой в каталоге.';
    return 'Не удалось связаться с сервером. Проверьте соединение и повторите.';
  }
  async function loadCatalog(preferredId = selected?.id) {
    const version = ++loadVersion;
    catalogAbort?.abort();
    const controller = new AbortController(); catalogAbort = controller;
    loading = true; error = '';
    try {
      const first: CatalogPage = await (await request('/api/catalog?page=1', key, { signal: controller.signal })).json();
      const rest = await Promise.all(Array.from({ length: Math.max(0, first.totalPages - 1) }, async (_, index): Promise<CatalogPage> =>
        (await request(`/api/catalog?page=${index + 2}`, key, { signal: controller.signal })).json()));
      if (version !== loadVersion) return;
      // API pages are transport only: the visitor browses every currently eligible slot.
      const items = Array.from(new Map([first, ...rest].flatMap(result => result.items).map(item => [item.id, item])).values());
      catalog = { ...first, items };
      selected = items.find(item => item.id === (preferredId ?? lastStory()));
      if (preferredId && !selected) {
        history.replaceState(null, '', '#catalog');
        if (items.length) error = 'Этот сюжет больше недоступен. Выберите другой в каталоге.';
      }
    } catch (cause) {
      if (version === loadVersion && !controller.signal.aborted) {
        catalog = undefined; selected = undefined; error = message(cause);
      }
    } finally { if (version === loadVersion) loading = false; }
  }
  function browse(item: CatalogItem) {
    rememberStory(item);
    const hash = `#slot=${encodeURIComponent(item.id)}`;
    if (location.hash.startsWith('#slot=')) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
  }
  function route() {
    setup = location.hash === '#setup';
    error = ''; enteredKey = ''; setupMessage = '';
    if (setup || !key || start) return;
    const slot = location.hash.match(/^#slot=(.+)$/)?.[1];
    void loadCatalog(slot ? decodeURIComponent(slot) : undefined);
  }
  function back() { selected = undefined; history.replaceState(null, '', '#catalog'); void loadCatalog(); }
  function refresh() { if (storageReady && key && !setup && !start && !loading) void loadCatalog(); }
  onMount(() => {
    try {
      key = localStorage.getItem(installationKeyStorage) || '';
      const raw = sessionStorage.getItem(startStorage);
      if (raw) {
        const saved: StartState = JSON.parse(raw);
        if (!saved.startRequestId || !saved.slotId) throw new Error('Invalid stored start');
        start = saved;
      }
    } catch { storageReady = false; error = 'Не удалось прочитать данные установки. Попросите сотрудника проверить профиль браузера.'; }
    if (storageReady) route();
    window.addEventListener('hashchange', route);
    window.addEventListener('focus', refresh);
    return () => { lifecycle.abort(); catalogAbort?.abort(); loadVersion++; window.removeEventListener('hashchange', route); window.removeEventListener('focus', refresh); };
  });
  async function saveKey(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = ''; setupMessage = '';
    const candidate = enteredKey.trim();
    try {
      await request('/api/catalog?page=1', candidate);
      localStorage.setItem(installationKeyStorage, candidate);
      key = candidate; enteredKey = ''; setupMessage = 'Ключ проверен и сохранён. Установка готова.';
    } catch (cause) { error = cause instanceof ApiError ? message(cause) : 'Не удалось проверить или сохранить ключ. Проверьте соединение и доступ к хранилищу браузера.'; }
    finally { busy = false; }
  }
  async function begin() {
    if (busy || start?.receipt || !storageReady) return;
    if (!start && !selected) return;
    busy = true; error = '';
    try {
      if (!start) {
        const pending = { startRequestId: crypto.randomUUID(), slotId: selected!.id };
        sessionStorage.setItem(startStorage, JSON.stringify(pending));
        start = pending;
      }
      const receipt: StartReceipt = await (await request('/api/capture/sessions', key, {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15_000)]),
        body:JSON.stringify({ startRequestId:start.startRequestId, slotId:start.slotId, eventSetup:start.eventSetup ?? { action: 'check' } }),
      })).json();
      start = { ...start, receipt };
      // If this write fails, the persisted pending key still recovers the same receipt.
      sessionStorage.setItem(startStorage, JSON.stringify(start));
    } catch (cause) {
      if (lifecycle.signal.aborted) return;
      if (cause instanceof ApiError && cause.code === 'EVENT_SETUP_REQUIRED' && start) {
        start = { ...start, eventSetupRequired: true };
        try { sessionStorage.setItem(startStorage, JSON.stringify(start)); }
        catch { error = 'Не удалось сохранить начало съёмки. Попросите сотрудника проверить хранилище браузера.'; }
      } else if (start?.eventSetupRequired && cause instanceof ApiError && cause.status === 400) {
        error = 'Проверьте название, количество участников и локацию, затем сохраните ещё раз.';
      } else if (cause instanceof ApiError && [400, 404, 422].includes(cause.status)) {
        try { sessionStorage.removeItem(startStorage); start = undefined; error = message(cause); }
        catch { error = 'Не удалось обновить данные сессии. Обратитесь к сотруднику.'; }
      } else {
        error = start?.receipt ? 'Сессия создана. Данные не удалось сохранить в браузере; обратитесь к сотруднику.'
          : start?.eventSetupRequired ? 'Не удалось подтвердить создание мероприятия. Повторите действие — новая фотосессия не появится дважды.'
          : start ? 'Подтверждение старта не получено. Нажмите «Повторить старт»: мы проверим ту же сессию.'
          : 'Не удалось сохранить начало съёмки. Попросите сотрудника проверить хранилище браузера.';
      }
    } finally { busy = false; }
  }
  function setUpEvent(eventSetup: EventSetupAction) {
    if (!start || busy) return;
    const pending = { ...start, eventSetup };
    try { sessionStorage.setItem(startStorage, JSON.stringify(pending)); start = pending; }
    catch { error = 'Не удалось сохранить начало съёмки. Попросите сотрудника проверить хранилище браузера.'; return; }
    void begin();
  }
  function nextVisitor() {
    try { sessionStorage.removeItem(startStorage); }
    catch { error = 'Не удалось завершить сессию в браузере. Обратитесь к сотруднику.'; return; }
    start = undefined; selected = undefined; catalog = undefined;
    history.replaceState(null, '', '#catalog');
    void loadCatalog();
  }
</script>
<svelte:head><title>ReelMe — {setup ? 'Настройка установки' : start?.receipt ? 'Фотосессия' : start?.eventSetupRequired ? 'Новое мероприятие' : 'Выберите сюжет'}</title></svelte:head>
{#if !setup && storageReady && key && start?.eventSetupRequired && !start.receipt}
  <EventSetup {busy} {error} initial={start.eventSetup?.action === 'save' ? start.eventSetup : undefined} onsave={setUpEvent} onskip={() => setUpEvent({ action: 'skip' })} />
{:else if !setup && storageReady && key && !start}
  <StoryCatalog items={catalog?.items ?? []} activeId={selected?.id} installationKey={key} {loading} {error} {busy} onbrowse={browse} onbegin={(item) => { rememberStory(item); void begin(); }} onback={back} onrefresh={() => loadCatalog()}/>
{:else if !setup && storageReady && key && start?.receipt}
  {#key start.receipt.sessionId}<PhotoSession receipt={start.receipt} installationKey={key} onnext={nextVisitor} />{/key}
  {#if error}<div class="session-storage-error error" role="alert"><p>{error}</p></div>{/if}
{:else}
<div class="installation-page">
<main class="installation-content">
  <header class="installation-brand"><img src={mark} alt="" /><span>ReelMe</span></header>
  {#if setup}
    <section class="narrow"><h1>Подключение установки</h1><p class="intro">Ключ сохраняется в этом профиле браузера. Посетителям вводить его не нужно.</p>
      <form onsubmit={saveKey}><label for="installation-key">{key ? 'Новый ключ установки' : 'Ключ установки'}</label><input id="installation-key" type="password" bind:value={enteredKey} autocomplete="off" required disabled={busy} /><button class="primary" disabled={busy || !enteredKey.trim()}>{busy ? 'Проверяем…' : 'Проверить и сохранить'}</button></form>
      {#if setupMessage}<p role="status">{setupMessage}</p>{/if}
      {#if key}<p class="muted">Ключ установки сохранён.</p><a class="button" href="#catalog">Открыть каталог</a>{/if}
    </section>
  {:else if !storageReady || !key}
    <section class="narrow"><h1>Нужна настройка установки</h1><p class="intro">Пожалуйста, позовите сотрудника — он подготовит всё для съёмки.</p></section>
  {:else if start}
    {#if start.receipt}
      {#key start.receipt.sessionId}<PhotoSession receipt={start.receipt} installationKey={key} onnext={nextVisitor} />{/key}
    {:else}
      <section class="narrow handoff" aria-live="polite"><h1>Готовимся к съёмке</h1><p class="intro">{busy ? 'Создаём сессию…' : 'Нужно подтвердить начало вашей сессии.'}</p><button class="primary" onclick={begin} disabled={busy}>{busy ? 'Подождите…' : 'Повторить старт'}</button></section>
    {/if}
  {/if}
  {#if error}<div class="error" role="alert"><p>{error}</p>{#if key && !setup && !start && storageReady}<button onclick={() => { location.hash = ''; void loadCatalog(); }}>Вернуться к каталогу</button>{/if}</div>{/if}
</main>
</div>
{/if}

<style>
  .installation-page { --paper:#0d0a13; --surface:#1d1423; --ink:#fff4fb; --muted:#d2bdd0; --line:#75566f; --accent:#f5a4df; --accent-ink:#261121; --error:#ffc1ca; color-scheme:dark; min-height:100svh; display:grid; place-items:center; padding:40px 24px; font-family:Manrope,sans-serif; color:var(--ink); background:radial-gradient(ellipse at 6% 0%,#3d1b39 0%,transparent 40%),radial-gradient(ellipse at 97% 100%,#27112f 0%,transparent 43%),var(--paper); }
  .installation-content { width:min(100%,560px); max-width:none; margin:0; padding:0; }
  .installation-brand { display:flex; align-items:center; justify-content:flex-start; gap:12px; margin:0 0 40px; padding:0; border:0; font-size:24px; font-weight:800; letter-spacing:-.025em; }
  .installation-brand img { width:40px; height:40px; object-fit:contain; }
  .narrow { max-width:none; margin:0; }
  h1 { font-size:clamp(30px,5vw,40px); font-weight:700; line-height:1.15; letter-spacing:-.035em; text-wrap:balance; }
  .intro { margin-top:16px; color:#ede0ec; font-size:18px; line-height:1.6; max-width:46ch; }
  .narrow form { margin:32px 0 24px; }
  label { margin-bottom:8px; font-size:15px; font-weight:600; }
  input { min-height:52px; margin-bottom:24px; padding:12px 14px; border-radius:10px; background:var(--surface); caret-color:var(--accent); }
  input:hover { border-color:#b58ca7; }
  button,.button { min-height:52px; border-radius:10px; }
  form .primary { width:100%; }
  .muted { margin:16px 0; }
  .installation-content .error { margin:24px 0 0; padding:0; border:0; line-height:1.6; }
  .installation-page ::selection { color:var(--accent-ink); background:var(--accent); }
  @media(hover:hover) and (pointer:fine) { .primary:hover:not(:disabled) { background:#ffb0da; } .button:hover { background:#2e1730; } }
  @media(max-width:400px) { .installation-page { padding:28px 20px; } .installation-brand { margin-bottom:28px; } }
  .session-storage-error { position:fixed; bottom:16px; left:16px; right:16px; z-index:30; margin:auto; background:#351f30; color:#fff1f5; }
</style>
