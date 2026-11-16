<script lang="ts">
  /** Module contract: sequential setup, material selections, prompt text and the
   * in-memory per-slot test-photo cache. Shared matrix owns valid choices/budgets.
   * Lock is local editor state; only explicit save persists configuration. Prompt
   * requests cannot overwrite newer setup or authored text. Test status/result
   * remains mounted across resets. Source: docs/slot-setup/matrix.md. */
  import { onMount, onDestroy } from 'svelte';
  import { models, recastId, slotSchema, type Media, type Mode, type SlotInput } from '../../shared/scenarios';
  import { slotSetupMatrix, selectSlotPrompt } from '../../shared/slot-prompt-selection';
  import { allocatePhotoBudget, buildPosePlan, defaultSlotSetup, getSlotSetup, type Orientation } from '../../shared/slot-setup';
  import type { Pose } from '../../shared/capture';
  import MediaField from './MediaField.svelte';
  import SlotTest from './SlotTest.svelte';
  import { api, mediaUrl } from './api';

  let { draft = $bindable(), videoMedia = $bindable(), canSave = $bindable(false), slotId, draftId, cacheKey, photoCaches, disabled, dirty, sourceProblem, onError, onBusy }: {
    draft: SlotInput; videoMedia?: Media; canSave?: boolean; slotId: string | null; draftId: string;
    cacheKey: string; photoCaches: Map<string, Record<string, string>>; disabled: boolean; dirty: boolean;
    sourceProblem?: string; onError: (value: unknown) => void; onBusy: (value: boolean) => void;
  } = $props();
  // Initial values are intentional: an open-slot key creates a fresh editor.
  // svelte-ignore state_referenced_locally
  let modelChosen = $state(!!slotId);
  // svelte-ignore state_referenced_locally
  let peopleChosen = $state(!!slotId);
  // svelte-ignore state_referenced_locally
  let photosChosen = $state(!!slotId);
  // svelte-ignore state_referenced_locally
  let locked = $state(!!slotId && slotSchema.safeParse(draft).success);
  // svelte-ignore state_referenced_locally
  let everChoseModel = !!slotId;
  let setupError = $state('');
  let testsOpen = $state(false);
  let promptLoading = $state(false);
  let promptError = $state('');
  // A saved prompt is protected until comparison with the matching file completes.
  // svelte-ignore state_referenced_locally
  let manualPrompt = $state(!!slotId);
  let referenceNotice = $state('');
  let sourceLoading = $state(false);
  let sourceError = $state('');
  let requestRevision = 0;
  let controller: AbortController | undefined;
  const currentModel = $derived(models.find(item => item.id === draft.model)!);
  const matrixModel = $derived(slotSetupMatrix.models.find(item => item.id === draft.model)!);
  const capabilities = $derived(matrixModel.capabilities);
  const variant = $derived(matrixModel.captureVariants.find(item => item.participants === draft.participants && item.photosPerParticipant === draft.photosPerParticipant));
  const plan = $derived.by(() => {
    if (!modelChosen || !peopleChosen || !photosChosen || !variant) return [];
    return buildPosePlan({ model: draft.model, mode: draft.mode, participants: draft.participants!, photosPerParticipant: draft.photosPerParticipant! });
  });
  const ratioOptions = $derived(matrixModel.aspectRatios[draft.orientation ?? 'landscape']);
  const photoOptions = $derived(matrixModel.captureVariants.filter(item => item.participants === draft.participants).map(item => item.photosPerParticipant));
  const maxElements = $derived(capabilities.elementLimit ?? capabilities.combinedReferenceLimit);
  // Group positions share guide 5; their ordinal, unlike guide number, is unique.
  function positionKey(pose: Pose) { return pose.participant === 'group' ? `group:${pose.index}` : `${pose.participant}:${pose.guideNumber}`; }
  function initialCache() {
    const saved = { ...(photoCaches.get(cacheKey) ?? {}) };
    if (slotId && draft.participants && draft.photosPerParticipant && variant) {
      const savedPlan = buildPosePlan({ model: draft.model, mode: draft.mode, participants: draft.participants, photosPerParticipant: draft.photosPerParticipant });
      savedPlan.forEach((pose, index) => { if (draft.testPhotoIds?.[index]) saved[positionKey(pose)] = draft.testPhotoIds[index]; });
      // A legacy JPEG fills only the first individual position, never an entire set.
      if (!draft.testPhotoIds?.length && draft.testPhotoId) saved['1:1'] = draft.testPhotoId;
    }
    return saved;
  }
  // svelte-ignore state_referenced_locally
  let photoCache = $state<Record<string, string>>(initialCache());
  const completeTestSet = $derived(plan.length > 0 && plan.every(pose => !!photoCache[positionKey(pose)]));
  $effect(() => { photoCaches.set(cacheKey, { ...photoCache }); });
  $effect(() => { canSave = locked && !promptLoading && !promptError; });

  function cancelPrompt() { requestRevision++; controller?.abort(); controller = undefined; promptLoading = false; }
  function resetLower() {
    cancelPrompt(); draft.referenceIds = []; draft.demoId = undefined; draft.prompt = '';
    draft.simulateGeneration = false; draft.testPhotoIds = undefined; draft.testPhotoId = undefined;
    // The fixed V2V source survives unlocking. Its compatibility is checked on save.
    manualPrompt = false; promptError = ''; referenceNotice = ''; setupError = '';
  }
  function unlock() { locked = false; testsOpen = false; resetLower(); }
  function changeMode(mode: Mode) {
    resetLower(); draft.mode = mode;
    draft.videoId = undefined; videoMedia = undefined;
    draft.model = models.find(item => item.mode === mode)!.id;
    modelChosen = false;
    // Retain selected people/count for reconciliation when the new model is chosen.
  }
  function changeModel(id: string) {
    const previousModel = draft.model;
    const model = models.find(item => item.id === id)!;
    const next = slotSetupMatrix.models.find(item => item.id === id)!;
    const firstChoice = !everChoseModel;
    resetLower(); draft.model = id;
    if (firstChoice) {
      Object.assign(draft, defaultSlotSetup(id, model.mode, draft.orientation));
      draft.resolution = model.defaultResolution;
      draft.duration = model.mode === 'P2V' ? 10 : undefined;
    } else {
      if (!next.captureVariants.some(item => item.participants === draft.participants)) peopleChosen = false;
      if (!peopleChosen || !next.captureVariants.some(item => item.participants === draft.participants && item.photosPerParticipant === draft.photosPerParticipant)) photosChosen = false;
      if (!next.resolutionOptions.includes(draft.resolution ?? '')) draft.resolution = undefined;
      if (next.orientationMode === 'source-video') draft.aspectRatio = undefined;
      else {
        const ratios = next.aspectRatios[draft.orientation ?? 'landscape'];
        if (!ratios.includes(draft.aspectRatio ?? '')) draft.aspectRatio = ratios.length === 1 ? ratios[0] : undefined;
      }
      if (model.mode === 'V2V') draft.duration = undefined;
      else if (draft.duration === undefined) draft.duration = 10;
      else if (draft.duration < model.minSeconds || draft.duration > model.maxSeconds || (id !== 'minimax/h3-max/reference-to-video' && !Number.isInteger(draft.duration))) draft.duration = undefined;
    }
    draft.recastShotsConfirmed = id === recastId ? previousModel === id ? draft.recastShotsConfirmed : false : undefined;
    draft.promptExpansionMode = id === 'minimax/h3-max/reference-to-video' ? 'disabled' : undefined;
    modelChosen = true; everChoseModel = true;
  }
  function changePeople(value: string) {
    resetLower(); draft.participants = value === 'group' ? 'group' : Number(value) as 1 | 2;
    peopleChosen = true;
    if (!matrixModel.captureVariants.some(item => item.participants === draft.participants && item.photosPerParticipant === draft.photosPerParticipant)) photosChosen = false;
  }
  function changePhotos(value: string) { resetLower(); draft.photosPerParticipant = Number(value); photosChosen = true; }
  function changeOrientation(value: Orientation) {
    resetLower(); draft.orientation = value;
    draft.videoId = undefined; videoMedia = undefined; sourceError = '';
    draft.recastShotsConfirmed = draft.model === recastId ? false : undefined;
    draft.aspectRatio = matrixModel.orientationMode === 'aspect-ratio' ? matrixModel.aspectRatios[value][0] : undefined;
  }
  async function importSource() {
    sourceLoading = true; sourceError = ''; onBusy(true);
    try {
      const media = await api<Media>(`/admin/slots/${draftId}/template-video`, { method: 'POST', body: JSON.stringify({ orientation: draft.orientation, model: draft.model }) });
      draft.videoId = media.id; videoMedia = media;
      draft.recastShotsConfirmed = draft.model === recastId ? false : undefined;
    } catch (value) { sourceError = value instanceof Error ? value.message : 'Не удалось подключить исходник'; }
    finally { sourceLoading = false; onBusy(false); }
  }
  function syncTestSet() {
    const ids = plan.map(pose => photoCache[positionKey(pose)]);
    draft.testPhotoIds = ids.length && ids.every(Boolean) ? ids : undefined;
    draft.testPhotoId = undefined;
  }
  function assignPhoto(pose: Pose, id?: string) {
    const cache = { ...photoCache };
    if (id) cache[positionKey(pose)] = id; else delete cache[positionKey(pose)];
    photoCache = cache; syncTestSet();
  }
  function lock() {
    setupError = '';
    if (!modelChosen || !peopleChosen || !photosChosen) { setupError = 'Выберите модель, участников и количество кадров.'; return; }
    try {
      if (matrixModel.referenceStrategy === 'flat') {
        const budget = allocatePhotoBudget(capabilities.ordinaryImageLimit!, draft.participants!, draft.photosPerParticipant!);
        if (budget.error) throw new Error(budget.error);
      }
      getSlotSetup({ model: draft.model, mode: draft.mode, participants: draft.participants!, photosPerParticipant: draft.photosPerParticipant! });
      if (matrixModel.resolutionOptions.length && !matrixModel.resolutionOptions.includes(draft.resolution ?? '')) throw new Error('Выберите допустимое разрешение модели.');
      if (matrixModel.orientationMode === 'aspect-ratio' && !ratioOptions.includes(draft.aspectRatio ?? '')) throw new Error('Выберите соотношение сторон.');
      if (draft.mode === 'P2V' && (draft.duration === undefined || draft.duration < currentModel.minSeconds || draft.duration > currentModel.maxSeconds || (draft.model !== 'minimax/h3-max/reference-to-video' && !Number.isInteger(draft.duration)))) throw new Error(`Длительность: ${currentModel.minSeconds}–${currentModel.maxSeconds} с`);
      locked = true; syncTestSet(); void loadPrompt();
    } catch (value) { setupError = (value as Error).message; }
  }
  async function loadPrompt(compareSaved = false) {
    cancelPrompt();
    const revision = requestRevision;
    const request = controller = new AbortController();
    if (!compareSaved) { manualPrompt = false; promptLoading = true; promptError = ''; referenceNotice = ''; }
    try {
      const { url } = selectSlotPrompt({ model: draft.model, mode: draft.mode, participants: draft.participants!, photosPerParticipant: draft.photosPerParticipant!, additionalReferenceCount: draft.referenceIds.length });
      const response = await fetch(url, { signal: request.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error('Не удалось загрузить готовый промпт. Повторите загрузку или введите свой текст.');
      const text = await response.text();
      if (revision !== requestRevision || request.signal.aborted) return;
      if (compareSaved) manualPrompt = (draft.prompt ?? '').trim() !== text.trim();
      else { draft.prompt = text; manualPrompt = false; }
    } catch (value) {
      if (revision !== requestRevision || request.signal.aborted) return;
      if (!compareSaved) promptError = value instanceof Error ? value.message : 'Не удалось загрузить промпт.';
    } finally { if (revision === requestRevision) promptLoading = false; }
  }
  function editPrompt(text: string) { cancelPrompt(); draft.prompt = text; manualPrompt = true; promptError = ''; }
  function changeReferences(ids: string[]) {
    draft.referenceIds = ids;
    if (manualPrompt) { cancelPrompt(); referenceNotice = 'Референсы изменены. Проверьте ссылки на изображения в вашем промпте; текст сохранён.'; }
    else void loadPrompt();
  }
  onMount(() => { if (slotId && locked) void loadPrompt(true); });
  onDestroy(cancelPrompt);
</script>

<section class="form-section" aria-label="Настройки генерации">
  <div class="section-heading"><span>02</span><h3>Настройки генерации</h3></div>
  <fieldset disabled={locked} aria-label="Выбор модели и съёмки">
    <label for="mode">Режим</label><select id="mode" value={draft.mode} onchange={event => changeMode(event.currentTarget.value as Mode)}><option value="V2V">Video2Video — на основе видео</option><option value="P2V">Photo2Video — на основе фото</option></select>
    <label for="model">Модель</label><select id="model" value={modelChosen ? draft.model : ''} onchange={event => changeModel(event.currentTarget.value)}><option value="" disabled>Выберите модель</option>{#each models.filter(item => item.mode === draft.mode) as model}<option value={model.id}>{model.name}</option>{/each}</select>
    {#if modelChosen}
      <div class="capacity-note" aria-label="Возможности модели">
        <h4>Возможности API</h4>
        {#if capabilities.peopleLimit}<p>До {capabilities.peopleLimit} человек, по {capabilities.photosPerPerson} фото. Здесь доступны 1 или 2 человека.</p>
        {:else}
          {#if capabilities.ordinaryImageLimit}<p>Обычные изображения: до {capabilities.ordinaryImageLimit}.</p>{/if}
          {#if maxElements}<p>Elements: {maxElements > 3 ? `доступно 3 (max ${maxElements})` : `до ${maxElements}`}. В этой съёмке — до двух индивидуальных персонажей.</p>{:else}<p>Elements не используются. Лимит файлов не определяет число людей в группе.</p>{/if}
          {#if capabilities.combinedReferenceLimit}<p>Elements и обычные изображения вместе: не более {capabilities.combinedReferenceLimit}.</p>{/if}
          {#if capabilities.photosPerElement}<p>На один Element: {capabilities.photosPerElement.min}–{capabilities.photosPerElement.max} разных фото одного человека.</p>{/if}
          {#if capabilities.assetLimit}<p>Общий бюджет: Elements + обычные изображения{draft.mode === 'V2V' ? ' + 1 исходный ролик' : ''} ≤ {capabilities.assetLimit}. Ракурсы внутри Element отдельно не вычитаются.</p>{/if}
        {/if}
      </div>
      <label for="participants">Участники</label><select id="participants" value={peopleChosen ? String(draft.participants) : ''} onchange={event => changePeople(event.currentTarget.value)}><option value="" disabled>Выберите участников</option>{#each [1, 2, 'group'] as people}<option value={String(people)} disabled={!matrixModel.captureVariants.some(item => item.participants === people)}>{people === 'group' ? '3+ — группа' : `${people} ${people === 1 ? 'человек' : 'человека'}`}{people === 'group' && matrixModel.referenceStrategy === 'recast' ? ' — недоступно для Recast' : ''}</option>{/each}</select>
    {/if}
    {#if modelChosen && peopleChosen}
      <label for="photos-per-person">{draft.participants === 'group' ? 'Групповых кадров' : 'Кадров на человека'}</label><select id="photos-per-person" value={photosChosen ? String(draft.photosPerParticipant) : ''} onchange={event => changePhotos(event.currentTarget.value)}><option value="" disabled>Выберите количество</option>{#each [1, 2, 3, 4] as count}<option value={String(count)} disabled={!photoOptions.includes(count)}>{count}{!photoOptions.includes(count) ? ' — недоступно для этого набора' : ''}</option>{/each}</select>
    {/if}
    {#if modelChosen && peopleChosen && photosChosen && variant}
      <div class="capacity-note selected-budget" aria-label="Распределение фотографий">
        <h4>{currentModel.name} · {draft.mode}</h4>
        {#if draft.participants === 'group'}<p>Группа: {draft.photosPerParticipant} фото.</p>{:else}<p>Первый человек: {draft.photosPerParticipant} фото.{#if draft.participants === 2}{' '}Второй человек: {draft.photosPerParticipant} фото.{/if}</p>{/if}
        <p>Фото камеры: {variant.cameraPhotos}. Elements: {variant.elementsCount}. Дополнительные фото: {variant.additionalReferenceLimit}{variant.additionalReferenceLimit === 0 ? ' (нет места)' : ''}.</p>
      </div>
      <div class="parameter-grid">
        <div><label for="orientation">Ориентация</label><select id="orientation" value={draft.orientation} onchange={event => changeOrientation(event.currentTarget.value as Orientation)}><option value="landscape">Горизонтальная</option><option value="portrait">Вертикальная</option></select></div>
        {#if matrixModel.orientationMode === 'aspect-ratio'}<div><label for="aspect-ratio">Соотношение сторон</label><select id="aspect-ratio" value={draft.aspectRatio ?? ''} onchange={event => { resetLower(); draft.aspectRatio = event.currentTarget.value; }}><option value="" disabled>Выберите соотношение</option>{#each ratioOptions as ratio}<option value={ratio}>{ratio}</option>{/each}</select></div>{/if}
        {#if matrixModel.resolutionOptions.length}<div><label for="resolution">Разрешение</label><select id="resolution" value={draft.resolution ?? ''} onchange={event => { resetLower(); draft.resolution = event.currentTarget.value; }}><option value="" disabled>Выберите разрешение</option>{#if draft.resolution && !matrixModel.resolutionOptions.includes(draft.resolution)}<option value={draft.resolution} disabled>{draft.resolution} — прежнее, выберите доступное</option>{/if}{#each matrixModel.resolutionOptions as resolution}<option value={resolution}>{resolution}</option>{/each}{#if matrixModel.resolutionOptions.length === 1 && matrixModel.resolutionOptions[0] === '720p'}<option value="1080p" disabled>1080p — недоступно для Flash</option>{/if}</select></div>{:else}<p class="hint resolution-note">Разрешение задаёт модель.</p>{/if}
        {#if draft.mode === 'P2V'}<div><label for="duration">Длительность, с</label><input id="duration" type="number" value={draft.duration} min={currentModel.minSeconds} max={currentModel.maxSeconds} step={draft.model === 'minimax/h3-max/reference-to-video' ? '0.01' : '1'} onchange={event => { resetLower(); draft.duration = event.currentTarget.valueAsNumber; }} /><p class="hint">От {currentModel.minSeconds} до {currentModel.maxSeconds} секунд</p></div>{/if}
      </div>
      {#if matrixModel.orientationMode === 'source-video'}<p class="hint">Направление и соотношение сторон определяются исходным роликом. Для другой ориентации нужен соответствующий исходник.</p>{/if}
    {/if}
  </fieldset>
  <div class="setup-actions">
    {#if locked}<p class="hint">Выбор зафиксирован. Материалы и промпт относятся к этому набору.</p><button type="button" class="quiet" onclick={unlock}>Изменить выбор</button>
    {:else}<button type="button" class="primary" disabled={!modelChosen || !peopleChosen || !photosChosen} onclick={lock}>Зафиксировать выбор</button>{/if}
  </div>
  {#if setupError}<p class="error" role="alert">{setupError}</p>{/if}
  {#if locked}
    <div class="materials">
      {#if draft.mode === 'V2V'}
        <section class="template-video" aria-label="Исходное видео слота">
          <h4>Исходное видео</h4>
          <p class="hint">ID сюжета: <code data-testid="draft-slot-id">{draftId}</code></p>
          <p class="hint">Файл: <code>{draftId}__{draft.orientation}.mp4</code></p>
          <p class="hint">Подготовьте его в папке шаблонных роликов. MP4 · {currentModel.minSeconds}–{currentModel.maxSeconds} с{currentModel.maxVideoMB ? ` · до ${currentModel.maxVideoMB} MB` : ''}.</p>
          {#if draft.videoId}<video src={mediaUrl(draft.videoId)} aria-label="Исходный ролик сюжета" controls playsinline preload="metadata"><track kind="captions" /></video><p class="hint">Подключён этот исходник. Изменения файла применятся после повторного подключения и сохранения.</p>{/if}
          <button type="button" class="quiet" disabled={sourceLoading} onclick={importSource}>{sourceLoading ? 'Проверяем исходник…' : draft.videoId ? 'Обновить исходник из файла' : 'Подключить исходник из файла'}</button>
          {#if sourceError}<p class="error" role="alert">{sourceError}</p>{/if}
        </section>
        {#if !draft.videoId}<p class="hint">Сюжет можно сохранить как черновик. Для запуска нужен исходный ролик.</p>{/if}
        {#if sourceProblem}<p class="error" role="alert">{sourceProblem}</p>{/if}
        {#if draft.model === recastId && draft.videoId}<label class="checkbox-label shot-confirmation"><input type="checkbox" bind:checked={draft.recastShotsConfirmed} />Подтверждаю: каждый непрерывный кадр длится не более 15 секунд</label>{/if}
      {/if}
      {#if variant && variant.additionalReferenceLimit > 0}
        <div class="references-heading"><h4>Дополнительные фото</h4><p class="hint">До {variant.additionalReferenceLimit}. Фото камеры не нужно загружать сюда.</p></div>
        <div class="references">
          {#each Array.from({ length: Math.min(draft.referenceIds.length + 1, variant.additionalReferenceLimit) }, (_, index) => index) as index}
            <MediaField label={`Референс ${index + 1}`} kind="image" id={draft.referenceIds[index]} optional onUploaded={media => { const refs = [...draft.referenceIds]; refs[index] = media.id; changeReferences(refs); }} onRemove={() => changeReferences(draft.referenceIds.filter((_, position) => position !== index))} {onError} {onBusy} />
          {/each}
        </div>
      {:else}<p class="hint">Дополнительные фото для этого набора не передаются.</p>{/if}
      {#if draft.mode === 'P2V'}<MediaField label="Демовидео" kind="video" id={draft.demoId} optional hint="Показывается гостям как пример. В генерацию не передаётся." onUploaded={media => draft.demoId = media.id} onRemove={() => draft.demoId = undefined} {onError} {onBusy} />{/if}
    </div>
    <label for="prompt">Промпт{#if draft.model === recastId}<span class="optional">необязательно</span>{/if}</label>
    {#if draft.model === recastId}<p class="hint recast-warning">РЕКОМЕНДУЕТСЯ ОСТАВИТЬ ПРОМПТ ПУСТЫМ!</p>{/if}
    <textarea id="prompt" rows="7" value={draft.prompt ?? ''} oninput={event => editPrompt(event.currentTarget.value)} required={draft.model !== recastId} maxlength={matrixModel.promptMaxLength} aria-describedby="prompt-hint"></textarea>
    <p class="hint" id="prompt-hint">{manualPrompt ? 'Ваш текст сохраняется при изменении референсов.' : 'Готовый текст для выбранного набора. Его можно редактировать.'}</p>
    {#if promptLoading}<p class="hint" role="status">Загружаем готовый промпт…</p>{/if}
    {#if promptError}<p class="error" role="alert">{promptError}</p>{/if}
    {#if referenceNotice}<p class="hint reference-notice" role="status">{referenceNotice}</p>{/if}
    <button type="button" class="quiet small" onclick={() => loadPrompt()} disabled={promptLoading}>Восстановить готовый промпт</button>
  {/if}
</section>
<section class="form-section" aria-label="Тестирование сюжета">
  {#if locked}
    <div class="section-heading"><span>03</span><h3>Тесты</h3><button type="button" class="quiet small" aria-expanded={testsOpen} onclick={() => testsOpen = !testsOpen}>{testsOpen ? 'Свернуть тесты' : 'Открыть тесты'}</button></div>
    <div hidden={!testsOpen}>
      <label class="checkbox-label"><input type="checkbox" bind:checked={draft.simulateGeneration} />Отправлять на фейковую генерацию</label>
      <p class="hint">Проверяет фотографии и подготовку запроса без обращения к fal. Видео не создаётся.</p>
      <div class="test-photos">
        {#each plan as pose (positionKey(pose))}
          <MediaField label={pose.participant === 'group' ? `Группа — кадр ${pose.index + 1} (JPEG)` : `Человек ${pose.participant} — кадр ${pose.guideNumber} (JPEG)`} kind="image" jpegOnly id={photoCache[positionKey(pose)]} optional hint={pose.instruction} onUploaded={media => assignPhoto(pose, media.id)} onRemove={() => assignPhoto(pose)} {onError} {onBusy} />
        {/each}
      </div>
      <p class="hint">Каждому кадру нужен отдельный JPEG до 20 MiB. Кеш фото сохраняется при смене настроек. Для теста сохраните полный набор: {plan.filter(pose => photoCache[positionKey(pose)]).length} из {plan.length}.</p>
      {#if !completeTestSet}<p class="hint">Неполный набор остаётся в редакторе; сохранённый сюжет пока нельзя тестировать.</p>{/if}
    </div>
  {/if}
  {#key slotId}<SlotTest {slotId} hasPhotos={completeTestSet && !!draft.testPhotoIds?.length} dirty={dirty || !canSave} showControls={locked && testsOpen} {disabled} {onError} />{/key}
</section>

<style>
  .template-video { margin-top:20px; overflow-wrap:anywhere; }
  .template-video video { display:block; width:100%; max-height:360px; margin:16px 0; background:#17251c; }
  .capacity-note { margin-top:20px; padding:16px; border:1px solid var(--line); border-radius:6px; background:var(--bg); font-size:14px; overflow-wrap:anywhere; }
  .capacity-note p { margin-top:6px; }
  .setup-actions { display:flex; gap:16px; align-items:center; flex-wrap:wrap; margin-top:22px; }
  .setup-actions .hint { flex:1; min-width:180px; }
  .references-heading { margin-top:22px; }
  .test-photos { display:grid; gap:24px; margin-top:24px; }
  .reference-notice,.recast-warning { padding:12px; border-left:3px solid var(--accent); background:var(--soft); }
  [hidden] { display:none; }
  @media(min-width:640px) { .test-photos { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
