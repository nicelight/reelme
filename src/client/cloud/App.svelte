<script lang="ts">
  /** Module contract: account entry, shared archive, operator display and admin-only scenario editor. Model
   * changes remove incompatible fields; API remains the authority for access,
   * validation and persistence. Manual tests call Sessions; camera and generation
   * processing remain outside this editor. Source: docs/slot-setup/matrix.md. */
  import { onMount } from 'svelte';
  import { models, blankSlot, slotSchema, titleFrom, videoProblem } from '../../shared/scenarios';
  import type { Media, Slot, SlotInput } from '../../shared/scenarios';
  import { api, ApiError, mediaUrl } from './api';
  import Archive from './Archive.svelte';
  import Display from './Display.svelte';
  import MediaField from './MediaField.svelte';
  import SlotEditor from './SlotEditor.svelte';

  let archive = $state(false);
  let ready = $state(false);
  let role = $state<'admin' | 'operator' | null>(null);
  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let uploads = $state(0);
  let error = $state('');
  let notice = $state('');
  let slots = $state<Slot[]>([]);
  let selectedId = $state<string | null>(null);
  let slotSelection = $state(0);
  let draft = $state<SlotInput>(blankSlot());
  let baseline = $state(JSON.stringify(blankSlot()));
  let videoMedia = $state<Media | undefined>();
  let editorCanSave = $state(false);
  const photoCaches = new Map<string, Record<string, string>>();
  let theme = $state<'light' | 'dark'>('light');
  const currentModel = $derived(models.find(model => model.id === draft.model)!);
  const dirty = $derived(JSON.stringify(draft) !== baseline);
  const sourceProblem = $derived(videoMedia && draft.mode === 'V2V' ? videoProblem(currentModel, videoMedia) : undefined);
  const formDisabled = $derived(busy || uploads > 0);

  function fail(value: unknown) {
    error = value instanceof Error ? value.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
    notice = '';
    if (value instanceof ApiError && value.status === 401) role = null;
  }
  function uploadBusy(value: boolean) { uploads += value ? 1 : -1; }
  async function loadSlots() { slots = await api<Slot[]>('/admin/slots'); }
  onMount(async () => {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    try {
      role = (await api<{ role: 'admin' | 'operator' }>('/auth/session')).role;
      if (role === 'admin') await loadSlots();
    } catch (value) { if (!(value instanceof ApiError && value.status === 401)) fail(value); }
    finally { ready = true; }
  });
  $effect(() => { document.documentElement.dataset.theme = theme; });
  async function login(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = '';
    try {
      role = (await api<{ role: 'admin' | 'operator' }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })).role;
      password = '';
      if (role === 'admin') await loadSlots();
    } catch (value) { fail(value); }
    finally { busy = false; }
  }
  function canLeave() { return !dirty || confirm('Есть несохранённые изменения. Продолжить без сохранения?'); }
  async function logout() {
    if (role === 'admin' && !canLeave()) return;
    busy = true;
    try {
      await api('/auth/logout', { method: 'POST' });
      role = null; archive = false; slots = []; selectedId = null; slotSelection++; photoCaches.clear(); draft = blankSlot(); baseline = JSON.stringify(draft); notice = ''; error = ''; videoMedia = undefined;
    } catch (value) { fail(value); }
    finally { busy = false; }
  }
  function fresh() {
    if (!canLeave()) return;
    selectedId = null; slotSelection++; draft = blankSlot(); baseline = JSON.stringify(draft); videoMedia = undefined; error = ''; notice = '';
  }
  async function openSlot(id: string) {
    if (!canLeave()) return;
    busy = true; error = ''; notice = '';
    try {
      const { id: slotId, ...config } = await api<Slot>(`/admin/slots/${id}`);
      const metadata = config.videoId ? await api<Media>(`/admin/slot-media/${config.videoId}/info`) : undefined;
      selectedId = slotId; slotSelection++; draft = config; videoMedia = metadata; baseline = JSON.stringify(config);
    } catch (value) { fail(value); }
    finally { busy = false; }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); error = ''; notice = '';
    if (!editorCanSave) { error = 'Зафиксируйте настройки и дождитесь готового промпта.'; return; }
    if (!draft.thumbnailId) { error = 'Добавьте изображение сюжета.'; return; }
    const result = slotSchema.safeParse(draft);
    if (!result.success) { error = result.error.issues.map(issue => issue.message).join('. '); return; }
    if (sourceProblem) { error = sourceProblem; return; }
    busy = true;
    try {
      const saved = await api<Slot>(selectedId ? `/admin/slots/${selectedId}` : '/admin/slots', { method: selectedId ? 'PUT' : 'POST', body: JSON.stringify(result.data) });
      const { id, ...config } = saved;
      selectedId = id; draft = config; baseline = JSON.stringify(config);
      await loadSlots(); notice = 'Сюжет сохранён.';
    } catch (value) { fail(value); }
    finally { busy = false; }
  }
  async function toggleVisibility(slot: Slot, visible: boolean) {
    busy = true; error = ''; notice = '';
    try {
      const { id, ...config } = slot;
      await api<Slot>(`/admin/slots/${id}`, { method: 'PUT', body: JSON.stringify({ ...config, visible }) });
      if (selectedId === id) {
        draft.visible = visible;
        const original = JSON.parse(baseline) as SlotInput; original.visible = visible; baseline = JSON.stringify(original);
      }
      await loadSlots(); notice = visible ? 'Сюжет будет отображаться клиенту.' : 'Сюжет скрыт от клиента.';
    } catch (value) { fail(value); }
    finally { busy = false; }
  }
  function beforeUnload(event: BeforeUnloadEvent) { if (role === 'admin' && dirty) event.preventDefault(); }
</script>

<svelte:window onbeforeunload={beforeUnload} />
<svelte:head><title>ReelMe — {archive ? 'Архив' : role === 'admin' ? 'Сюжеты' : role === 'operator' ? 'Ваши видео' : 'Вход'}</title></svelte:head>

<header class="app-header">
  <a class="brand" href="/" aria-label="ReelMe — главная">Reel<span>Me</span><span class="brand-caption">STUDIO</span></a>
  <div class="header-actions">
    <button class="quiet theme-toggle" onclick={() => theme = theme === 'light' ? 'dark' : 'light'} aria-label={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}>{theme === 'light' ? '◐' : '◑'}</button>
    {#if role}<span class="role-label">{role === 'admin' ? 'Администратор' : 'Оператор'}</span><button class="quiet" onclick={logout} disabled={formDisabled}>Выйти</button>{/if}
  </div>
</header>

{#if ready && role}
  <nav class="surface-nav" aria-label="Разделы">
    <button class="quiet" aria-current={!archive ? 'page' : undefined} onclick={() => archive = false}>{role === 'admin' ? 'Сюжеты' : 'Сегодня'}</button>
    <button class="quiet" aria-current={archive ? 'page' : undefined} disabled={formDisabled} onclick={() => { if (role !== 'admin' || canLeave()) archive = true; }}>Архив</button>
  </nav>
{/if}

{#if !ready}
  <main class="centered"><p role="status">Открываем ReelMe…</p></main>
{:else if !role}
  <main class="login-layout">
    <section class="login-intro"><p class="eyebrow">REELME / УПРАВЛЕНИЕ</p><h1>История начинается<br />с сюжета.</h1><p>Подготовьте образы, выберите модель<br class="desktop-break" /> и задайте настроение будущего видео.</p></section>
    <form class="login-form" onsubmit={login}>
      <p class="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p><h2>Войти в аккаунт</h2>
      <label for="username">Логин</label><input id="username" name="username" autocomplete="username" bind:value={username} required disabled={busy} />
      <label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" bind:value={password} required disabled={busy} />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
      <p class="hint">Используйте аккаунт администратора или оператора, созданный при настройке.</p>
    </form>
  </main>
{:else if archive}
  <Archive {role} onunauthorized={() => role = null} />
{:else if role === 'operator'}
  <Display onunauthorized={() => role = null} />
{:else}
  <main class="workspace">
    <aside class="library" aria-label="Список сюжетов">
      <div class="library-heading"><div><p class="eyebrow">ВАША КОЛЛЕКЦИЯ</p><h1>Сюжеты <span class="count">{slots.length}</span></h1></div><button class="add-button" onclick={fresh} disabled={formDisabled} aria-label="Новый сюжет">+</button></div>
      <p class="library-description">Образы, которые смогут выбрать ваши гости.</p>
      {#if slots.length === 0}<div class="empty-library"><span class="empty-mark">01</span><h2>Первый сюжет</h2><p>Начните с изображения и описания. Затем добавьте материалы для генерации.</p></div>{/if}
      <ul class="slot-list">
        {#each slots as slot (slot.id)}
          <li class:selected={selectedId === slot.id}>
            <button class="slot-open" onclick={() => openSlot(slot.id)} disabled={formDisabled} aria-pressed={selectedId === slot.id}>
              <img src={mediaUrl(slot.thumbnailId)} alt="" /><span><strong>{titleFrom(slot.description)}</strong><small>{slot.mode} · {models.find(model => model.id === slot.model)?.name}</small></span>
            </button>
            <label class="visibility-toggle"><input type="checkbox" checked={slot.visible} disabled={formDisabled} onchange={event => toggleVisibility(slot, event.currentTarget.checked)} /><span>Отображать клиенту</span></label>
          </li>
        {/each}
      </ul>
    </aside>

    <section class="editor" aria-label="Редактор сюжета">
      <div class="editor-heading"><div><p class="eyebrow">РЕДАКТОР СЮЖЕТА</p><h2>{selectedId ? 'Настройка сюжета' : 'Новый сюжет'}</h2></div><span class="save-status">{dirty ? 'Есть изменения' : selectedId ? 'Сохранено' : 'Черновик'}</span></div>
      <form onsubmit={save} novalidate>
        <fieldset disabled={formDisabled}>
          <section class="form-section">
            <div class="section-heading"><span>01</span><h3>Карточка сюжета</h3></div>
            <MediaField label="Изображение сюжета" kind="image" id={draft.thumbnailId} hint="JPEG, PNG или WebP. Это изображение гости увидят при выборе." onUploaded={media => draft.thumbnailId = media.id} onError={fail} onBusy={uploadBusy} />
            <label for="description">Описание</label><textarea id="description" rows="3" maxlength="5000" bind:value={draft.description} placeholder="Например: Прогулка по ночному Токио" required></textarea>
            <p class="hint">Первые три слова станут названием карточки.{#if draft.description.trim()} <span class="title-preview">«{titleFrom(draft.description)}»</span>{/if}</p>
            <label class="checkbox-label"><input type="checkbox" bind:checked={draft.visible} />Отображать клиенту</label>
          </section>

          {#key slotSelection}
            <SlotEditor bind:draft bind:videoMedia bind:canSave={editorCanSave} slotId={selectedId} cacheKey={selectedId ?? `draft:${slotSelection}`} {photoCaches} disabled={formDisabled} {dirty} {sourceProblem} onError={fail} onBusy={uploadBusy} />
          {/key}
        </fieldset>
        <div class="editor-footer">
          <div aria-live="polite">{#if error}<p class="error" role="alert">{error}</p>{:else if notice}<p class="success" role="status">{notice}</p>{:else}<p class="hint">{uploads ? 'Проверяем материалы…' : 'Изменения применятся после сохранения.'}</p>{/if}</div>
          <button class="primary" type="submit" disabled={formDisabled || !editorCanSave}>{busy ? 'Сохраняем…' : 'Сохранить сюжет'}</button>
        </div>
      </form>
    </section>
  </main>
{/if}
