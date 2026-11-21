<script lang="ts">
  /** Module contract: account entry at /admin, /operator and /results.
   * Both accounts use the operator workspace and fullscreen results;
   * only admin at /admin loads the scenario editor. Model
   * changes remove incompatible fields; API remains the authority for access,
   * validation and persistence. Manual tests call Sessions; camera and generation
   * processing remain outside this editor. Source: docs/slot-setup/matrix.md. */
  import { onMount } from 'svelte';
  import { compactStoryTitle } from '../../shared/capture';
  import { models, blankSlot, slotSchema, videoProblem } from '../../shared/scenarios';
  import type { Media, Slot, SlotInput } from '../../shared/scenarios';
  import { api, ApiError, mediaUrl } from './api';
  import FinishEvent from './FinishEvent.svelte';
  import Archive from './Archive.svelte';
  import Statuses from './Statuses.svelte';
  import ResultVideo from './results/ResultVideo.svelte';
  import Display from './Display.svelte';
  import MediaField from './MediaField.svelte';
  import TemplateUploadDialog from './TemplateUploadDialog.svelte';
  import SlotEditor from './SlotEditor.svelte';
  import CaptureGuides from './CaptureGuides.svelte';
  import CaptureSettingsForm from './CaptureSettingsForm.svelte';
  import EventPreparation from './EventPreparation.svelte';
  import EmailSettings from './EmailSettings.svelte';
  import DisplaySettings from './DisplaySettings.svelte';
  import Photobooth from './Photobooth.svelte';
  import Login from './Login.svelte';
  import brandMark from '../capture/story/assets/reelme-mark.webp';
  import './admin.css';

  let archive = $state(false);
  let archiveVersion = $state(0);
  let parameters = $state(false);
  let photobooth = $state(false);
  const statusRoute = location.pathname === '/statuses';
  const dedicatedScreen = location.pathname === '/results';
  const videoId = dedicatedScreen ? new URLSearchParams(location.search).get('video') : null;
  let ready = $state(false);
  let role = $state<'admin' | 'operator' | null>(null);
  const adminRoute = location.pathname === '/admin';
  const adminWorkspace = $derived(role === 'admin' && adminRoute);
  const publicScreen = $derived(ready && !!role && dedicatedScreen);
  const adminDenied = $derived(ready && role === 'operator' && adminRoute && !dedicatedScreen);
  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let saving = $state(false);
  let uploads = $state(0);
  let error = $state('');
  let notice = $state('');
  let slots = $state<Slot[]>([]);
  let selectedId = $state<string | null>(null);
  let draftId = $state<string>(crypto.randomUUID());
  let slotSelection = $state(0);
  let slotSaveVersion = $state(0);
  let draft = $state<SlotInput>(blankSlot());
  let baseline = $state(JSON.stringify(blankSlot()));
  let videoMedia = $state<Media | undefined>();
  let editorCanSave = $state(false);
  const photoCaches = new Map<string, Record<string, string>>();
  let theme = $state<'light' | 'dark'>('dark');
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
    try {
      role = (await api<{ role: 'admin' | 'operator' }>('/auth/session')).role;
      if (role === 'operator') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      if (adminWorkspace) await loadSlots();
    } catch (value) { if (!(value instanceof ApiError && value.status === 401)) fail(value); }
    finally { ready = true; }
  });
  $effect(() => { document.documentElement.dataset.theme = theme; });
  async function login(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = '';
    try {
      role = (await api<{ role: 'admin' | 'operator' }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })).role;
      theme = role === 'admin' || matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      password = '';
      if (adminWorkspace) await loadSlots();
    } catch (value) { fail(value); }
    finally { busy = false; }
  }
  function canLeave() { return !dirty || confirm('Есть несохранённые изменения. Продолжить без сохранения?'); }
  async function logout() {
    if (adminWorkspace && !canLeave()) return;
    busy = true;
    try {
      await api('/auth/logout', { method: 'POST' });
      role = null; archive = false; parameters = false; photobooth = false; slots = []; selectedId = null; draftId = crypto.randomUUID(); slotSelection++; photoCaches.clear(); draft = blankSlot(); baseline = JSON.stringify(draft); notice = ''; error = ''; videoMedia = undefined;
    } catch (value) { fail(value); }
    finally { busy = false; }
  }
  function fresh() { if (canLeave()) resetDraft(); }
  function resetDraft() {
    selectedId = null; draftId = crypto.randomUUID(); slotSelection++; draft = blankSlot(); baseline = JSON.stringify(draft); videoMedia = undefined; error = ''; notice = '';
  }
  async function openSlot(id: string) {
    if (!canLeave()) return;
    busy = true; error = ''; notice = '';
    try {
      const { id: slotId, ...config } = await api<Slot>(`/admin/slots/${id}`);
      const metadata = config.videoId ? await api<Media>(`/admin/slot-media/${config.videoId}/info`) : undefined;
      selectedId = slotId; draftId = slotId; slotSelection++; draft = config; videoMedia = metadata; baseline = JSON.stringify(config);
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
    saving = true; busy = true;
    try {
      const saved = await api<Slot>(selectedId ? `/admin/slots/${selectedId}` : '/admin/slots', { method: selectedId ? 'PUT' : 'POST', body: JSON.stringify(selectedId ? result.data : { ...result.data, id: draftId }) });
      const { id, ...config } = saved;
      selectedId = id; draft = config; baseline = JSON.stringify(config);
      slotSaveVersion++;
      await loadSlots(); notice = 'Сюжет сохранён.';
    } catch (value) { fail(value); }
    finally { busy = false; saving = false; }
  }
  async function deleteSlot(slot: Slot) {
    if (!confirm(`Удалить сюжет «${slot.description}»? Он исчезнет из списка и каталога гостей. Уже начатые сессии сохранятся.`)) return;
    busy = true; error = '';
    try {
      await api<void>(`/admin/slots/${slot.id}`, { method: 'DELETE' });
      slots = slots.filter(item => item.id !== slot.id);
      photoCaches.delete(slot.id);
      if (selectedId === slot.id) resetDraft();
      notice = 'Сюжет удалён.';
    } catch (value) { fail(value); }
    finally { busy = false; }
  }
  async function toggleVisibility(slot: Slot, input: HTMLInputElement) {
    const visible = input.checked;
    busy = true; error = ''; notice = '';
    try {
      await api<void>(`/admin/slots/${slot.id}/visibility`, { method: 'PATCH', body: JSON.stringify({ visible }) });
      slot.visible = visible;
      if (selectedId === slot.id) {
        draft.visible = visible;
        const original = JSON.parse(baseline) as SlotInput; original.visible = visible; baseline = JSON.stringify(original);
      }
      await loadSlots(); notice = visible ? 'Сюжет будет отображаться клиенту.' : 'Сюжет скрыт от клиента.';
    } catch (value) { input.checked = slot.visible; fail(value); }
    finally { busy = false; }
  }
  function beforeUnload(event: BeforeUnloadEvent) { if (adminWorkspace && dirty) event.preventDefault(); }
</script>

<svelte:window onbeforeunload={beforeUnload} />
<svelte:head><title>ReelMe — {statusRoute ? 'Статусы видео' : photobooth ? 'Фотобудка' : videoId ? 'Просмотр генерации' : dedicatedScreen ? 'Экран результатов' : parameters ? 'Параметры' : archive ? 'Архив' : adminWorkspace ? 'Сюжеты' : role ? 'Ваши видео' : 'Вход'}</title></svelte:head>

<div class:admin-shell={adminWorkspace} data-admin-theme={theme}>
{#if adminWorkspace}<TemplateUploadDialog {saving} onunauthorized={() => role = null} />{/if}
{#if role && !publicScreen}
<header class="app-header">
  <a class="brand" href="/" aria-label="ReelMe — главная">{#if adminWorkspace}<img src={brandMark} alt="" /><span class="admin-wordmark">REELME</span>{:else}Reel<span>Me</span><span class="brand-caption">STUDIO</span>{/if}</a>
  <div class="header-actions">
    <button class="quiet theme-toggle" onclick={() => theme = theme === 'light' ? 'dark' : 'light'} aria-label={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg></button>
    {#if role}<span class="role-label">{role === 'admin' ? 'Администратор' : 'Оператор'}</span><button class="quiet" onclick={logout} disabled={formDisabled}>Выйти</button>{/if}
  </div>
</header>

{#if ready && role && !adminDenied && !statusRoute}
  <nav style="flex-wrap:wrap" class="surface-nav" aria-label="Разделы">
    <button class="quiet" aria-current={!archive && !parameters && !photobooth ? 'page' : undefined} disabled={formDisabled} onclick={() => { archive = false; parameters = false; photobooth = false; }}>{adminWorkspace ? 'Сюжеты' : 'Сегодня'}</button>
    {#if adminWorkspace}<button class="quiet" aria-current={parameters ? 'page' : undefined} disabled={formDisabled} onclick={() => { if (canLeave()) { parameters = true; photobooth = false; archive = false; } }}>Параметры</button>{/if}
    {#if adminWorkspace}<button class="quiet" aria-current={photobooth ? 'page' : undefined} disabled={formDisabled} onclick={() => { if (canLeave()) { photobooth = true; archive = false; parameters = false; } }}>Фотобудка</button>{/if}
    {#if adminWorkspace}<a class="button" href="/operator">Сегодня / Архив</a>{:else}<button class="quiet" aria-current={archive ? 'page' : undefined} disabled={formDisabled} onclick={() => { archive = true; parameters = false; photobooth = false; }}>Архив</button>{/if}
    <a class="button" href="/statuses" target="_blank" rel="noopener">Статусы видео</a>
    <a class="button" href="/results" target="_blank" rel="noopener">Открыть экран</a>
    {#if !adminWorkspace}<FinishEvent onfinished={() => { archiveVersion++; archive = true; }} onunauthorized={() => role = null} />{/if}
  </nav>
{/if}
{/if}

{#if !ready}
  <main class="centered"><p role="status">Открываем ReelMe…</p></main>
{:else if !role}
  <Login bind:username bind:password {busy} {error} onsubmit={login} />
{:else if statusRoute}
  <Statuses onunauthorized={() => role = null} />
{:else if publicScreen && videoId}
  <ResultVideo id={videoId} onunauthorized={() => role = null} />
{:else if publicScreen}
  <Display onunauthorized={() => role = null} />
{:else if adminDenied}
  <main class="centered"><h1>Админка доступна администратору</h1><p>Вы вошли как оператор.</p><a class="button" href="/operator">Перейти к рабочему экрану</a></main>
{:else if photobooth && adminWorkspace}
  <Photobooth />
{:else if parameters && adminWorkspace}
  <main class="parameters-page">
    <h1>Параметры</h1>
    <EventPreparation onunauthorized={() => role = null} />
    <CaptureSettingsForm onunauthorized={() => role = null} />
    <DisplaySettings onunauthorized={() => role = null} />
    <EmailSettings onunauthorized={() => role = null} />
    <CaptureGuides onunauthorized={() => role = null} onBusy={uploadBusy} />
  </main>
{:else if archive}
  {#key archiveVersion}<Archive {role} onunauthorized={() => role = null} />{/key}
{:else if !adminWorkspace}
  <Display onunauthorized={() => role = null} />
{:else}
  <main class="workspace">
    <aside class="library" aria-label="Список сюжетов">
      <div class="library-heading"><div><h1>Сюжеты <span class="count">{slots.length}</span></h1></div><button class="add-button" onclick={fresh} disabled={formDisabled} aria-label="Новый сюжет"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
      <p class="library-description">Образы, которые смогут выбрать ваши гости.</p>
      {#if slots.length === 0}<div class="empty-library"><h2>Первый сюжет</h2><p>Начните с изображения и описания. Затем добавьте материалы для генерации.</p></div>{/if}
      <ul class="slot-list">
        {#each slots as slot (slot.id)}
          <li class:selected={selectedId === slot.id}>
            <button class="slot-open" onclick={() => openSlot(slot.id)} disabled={formDisabled} aria-pressed={selectedId === slot.id}>
              <img src={mediaUrl(slot.thumbnailId)} alt="" /><span><strong>{slot.description}</strong><small>{slot.mode} · {models.find(model => model.id === slot.model)?.name}</small></span>
            </button>
            <div class="slot-actions"><label class="visibility-toggle"><input type="checkbox" checked={slot.visible} disabled={formDisabled} onchange={event => toggleVisibility(slot, event.currentTarget)} /><span>Отображать клиенту</span></label>
              <button type="button" class="delete-slot quiet" aria-label="Удалить сюжет" title={`Удалить сюжет «${slot.description}»`} disabled={formDisabled} onclick={() => deleteSlot(slot)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>
              </button>
            </div>
          </li>
        {/each}
      </ul>
    </aside>

    <section class="editor" aria-label="Редактор сюжета">
      <div class="editor-heading"><div class="editor-title"><h2>{selectedId ? 'Настройка сюжета' : 'Новый сюжет'}</h2>{#if draft.simulateGeneration}<div class="testing-warning" role="status"><strong>Тестирование!</strong><p>отключите тесты чтобы слот заработал</p></div>{/if}</div><span class="save-status">{dirty ? 'Есть изменения' : selectedId ? 'Сохранено' : 'Черновик'}</span></div>
      <form onsubmit={save} novalidate>
        <fieldset disabled={formDisabled}>
          <section class="form-section">
            <div class="section-heading"><span>01</span><h3>Карточка сюжета</h3></div>
            <MediaField label="Изображение сюжета" kind="image" id={draft.thumbnailId} hint="Рекомендуем вертикальную обложку 2:3, 600 × 900 px (ширина × высота). Главный объект держите в центре: в карточках края изображения обрезаются." onUploaded={media => draft.thumbnailId = media.id} onError={fail} onBusy={uploadBusy} />
            <label for="description">Описание</label><textarea id="description" rows="3" maxlength="5000" bind:value={draft.description} placeholder="Например: Прогулка по ночному Токио" required></textarea>
            <p class="hint">В раскрытой карточке гости увидят весь текст. В узкой — первые два слова.{#if draft.description.trim()} <span class="title-preview">«{compactStoryTitle(draft.description)}»</span>{/if}</p>
            <label class="checkbox-label"><input type="checkbox" bind:checked={draft.visible} />Отображать клиенту</label>
          </section>

          {#key slotSelection}
            <SlotEditor bind:draft bind:videoMedia bind:canSave={editorCanSave} slotId={selectedId} {slotSaveVersion} {draftId} cacheKey={selectedId ?? `draft:${slotSelection}`} {photoCaches} disabled={formDisabled} {dirty} {sourceProblem} onError={fail} onBusy={uploadBusy} />
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

</div>
