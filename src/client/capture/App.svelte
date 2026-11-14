<script lang="ts">
  import { onMount } from 'svelte';
  import type { CatalogItem, CatalogPage, StartReceipt } from '../../shared/capture';
  import { ApiError, installationKeyStorage, request, startStorage } from './api';
  import ProtectedMedia from './ProtectedMedia.svelte';
  import PhotoSession from './PhotoSession.svelte';
  import './style.css';
  /** Module contract: visitor catalog → durable start → PhotoSession owns capture
   * and transfer. sessionStorage recovers the server receipt; only confirmed
   * completion permits releasing it and returning to the next visitor's catalog. */
  type StartState = { startRequestId: string; slotId: string; receipt?: StartReceipt };
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
  let page = $state(1);
  let loadVersion = 0;
  const title = (item: CatalogItem) => item.description.trim().split(/\s+/).slice(0, 3).join(' ');
  function message(cause: unknown) {
    if (cause instanceof ApiError && [401, 403].includes(cause.status)) return 'Нужна помощь сотрудника: проверьте настройку установки.';
    if (cause instanceof ApiError && cause.status === 404) return 'Этот сюжет больше недоступен. Выберите другой в каталоге.';
    return 'Не удалось связаться с сервером. Проверьте соединение и повторите.';
  }
  async function loadCatalog(targetPage = page) {
    const version = ++loadVersion;
    loading = true; error = ''; selected = undefined;
    try {
      const result: CatalogPage = await (await request(`/api/catalog?page=${targetPage}`, key)).json();
      if (version !== loadVersion) return;
      catalog = result; page = result.page;
    } catch (cause) { if (version === loadVersion) error = message(cause); }
    finally { if (version === loadVersion) loading = false; }
  }
  async function openSlot(id: string) {
    const version = ++loadVersion;
    loading = true; error = ''; selected = undefined;
    try {
      const result: CatalogItem = await (await request(`/api/catalog/${encodeURIComponent(id)}`, key)).json();
      if (version === loadVersion) selected = result;
    } catch (cause) { if (version === loadVersion) error = message(cause); }
    finally { if (version === loadVersion) loading = false; }
  }
  function route() {
    setup = location.hash === '#setup';
    error = ''; enteredKey = ''; setupMessage = '';
    if (setup || !key || start) return;
    const slot = location.hash.match(/^#slot=(.+)$/)?.[1];
    if (slot) void openSlot(slot); else void loadCatalog();
  }
  function back() { if (location.hash) location.hash = ''; else void loadCatalog(); }
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
    return () => window.removeEventListener('hashchange', route);
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
        body:JSON.stringify({ startRequestId:start.startRequestId, slotId:start.slotId }),
      })).json();
      start = { ...start, receipt };
      // If this write fails, the persisted pending key still recovers the same receipt.
      sessionStorage.setItem(startStorage, JSON.stringify(start));
    } catch (cause) {
      if (cause instanceof ApiError && [400, 404, 422].includes(cause.status)) {
        try { sessionStorage.removeItem(startStorage); start = undefined; error = message(cause); }
        catch { error = 'Не удалось обновить данные сессии. Обратитесь к сотруднику.'; }
      } else {
        error = start?.receipt ? 'Сессия создана. Данные не удалось сохранить в браузере; обратитесь к сотруднику.'
          : start ? 'Подтверждение старта не получено. Нажмите «Повторить старт»: мы проверим ту же сессию.'
          : 'Не удалось сохранить начало съёмки. Попросите сотрудника проверить хранилище браузера.';
      }
    } finally { busy = false; }
  }
  function nextVisitor() {
    try { sessionStorage.removeItem(startStorage); }
    catch { error = 'Не удалось завершить сессию в браузере. Обратитесь к сотруднику.'; return; }
    start = undefined; selected = undefined; catalog = undefined; page = 1;
    history.replaceState(null, '', '#catalog');
    void loadCatalog(1);
  }
</script>
<svelte:head><title>ReelMe — {setup ? 'Настройка установки' : 'Выберите сюжет'}</title></svelte:head>
<header><div class="brand">Reel<span>Me</span></div><span class="header-note">{setup ? 'Настройка установки' : 'Ваша история в кадре'}</span></header>
<main>
  {#if setup}
    <section class="narrow"><p class="eyebrow">ДЛЯ СОТРУДНИКА</p><h1>Подключение установки</h1><p class="intro">Ключ сохраняется в этом профиле браузера. Посетителям вводить его не нужно.</p>
      <form onsubmit={saveKey}><label for="installation-key">{key ? 'Новый ключ установки' : 'Ключ установки'}</label><input id="installation-key" type="password" bind:value={enteredKey} autocomplete="off" required disabled={busy} /><button class="primary" disabled={busy || !enteredKey.trim()}>{busy ? 'Проверяем…' : 'Проверить и сохранить'}</button></form>
      {#if setupMessage}<p role="status">{setupMessage}</p>{/if}
      {#if key}<p class="muted">Ключ установки сохранён.</p><a class="button" href="#catalog">Открыть каталог</a>{/if}
    </section>
  {:else if !storageReady || !key}
    <section class="narrow"><p class="eyebrow">СКОРО НАЧНЁМ</p><h1>Нужна настройка установки</h1><p class="intro">Пожалуйста, позовите сотрудника — он подготовит всё для съёмки.</p></section>
  {:else if start}
    {#if start.receipt}
      {#key start.receipt.sessionId}<PhotoSession receipt={start.receipt} installationKey={key} onnext={nextVisitor} />{/key}
    {:else}
      <section class="narrow handoff" aria-live="polite"><p class="eyebrow">ВАШ СЮЖЕТ ВЫБРАН</p><h1>Готовимся к съёмке</h1><p class="intro">{busy ? 'Создаём сессию…' : 'Нужно подтвердить начало вашей сессии.'}</p><button class="primary" onclick={begin} disabled={busy}>{busy ? 'Подождите…' : 'Повторить старт'}</button></section>
    {/if}
  {:else if loading}
    <section class="narrow" role="status"><h1>Загружаем сюжеты…</h1></section>
  {:else if selected}
    <button class="back" onclick={back}>← Назад в каталог</button>
    <section class="detail"><div><p class="eyebrow">ВАШ БУДУЩИЙ РОЛИК</p><h1 class="description">{selected.description}</h1><button class="primary like" onclick={begin} disabled={busy}>Мне нравится</button></div>
      <div class="preview">{#if selected.previewId}<ProtectedMedia slotId={selected.id} mediaId={selected.previewId} installationKey={key} video />{:else}<div class="no-preview"><p>У этого сюжета пока нет демовидео.</p><span>Вы можете выбрать его и перейти к съёмке.</span></div>{/if}<p class="caption">{selected.mode === 'V2V' ? 'Исходное видео сюжета' : 'Демонстрация сюжета'}</p></div>
    </section>
  {:else}
    <section class="catalog-heading"><p class="eyebrow">НАЧНИТЕ С ИДЕИ</p><h1>Какую историю снимем?</h1><p class="intro">Выберите сюжет, который вам нравится.</p></section>
    {#if catalog?.items.length}<div class="catalog">{#each catalog.items as item (item.id)}<article class="card"><ProtectedMedia slotId={item.id} mediaId={item.thumbnailId} installationKey={key} alt={title(item)} /><a href={`#slot=${item.id}`} aria-label={`Выбрать сюжет: ${title(item)}`}><h2>{title(item)}</h2><span aria-hidden="true">↗</span></a></article>{/each}</div>
      {#if catalog.totalPages > 1}<nav class="pagination" aria-label="Страницы каталога"><button onclick={() => loadCatalog(page - 1)} disabled={page <= 1}>← Назад</button><span aria-live="polite">{page} / {catalog.totalPages}</span><button onclick={() => loadCatalog(page + 1)} disabled={page >= catalog.totalPages}>Далее →</button></nav>{/if}
    {:else if !error}<p class="empty">Сюжеты скоро появятся. Сотрудник поможет вам начать.</p>{/if}
  {/if}
  {#if error}<div class="error" role="alert"><p>{error}</p>{#if key && !setup && !start && storageReady}<button onclick={() => { location.hash = ''; void loadCatalog(); }}>Вернуться к каталогу</button>{/if}</div>{/if}
</main>
