<script lang="ts">
  /** Module contract: admin page for the five named pose examples. Uploads create
   * immutable images; selecting a replacement changes only future snapshots.
   * Source: docs/slot-setup/matrix.md. */
  import { onMount } from 'svelte';
  import { captureGuides, maxGuideCaptionLength, type CaptureGuide } from '../../shared/slot-setup';
  import { api, ApiError } from './api';
  import MediaField from './MediaField.svelte';
  let { onunauthorized, onBusy }: { onunauthorized: () => void; onBusy: (busy: boolean) => void } = $props();
  let guides = $state<CaptureGuide[]>(captureGuides.map(guide => ({ ...guide })));
  let captions = $state<Record<number, string>>({});
  let ready = $state(false);
  let busy = $state(false);
  let error = $state('');
  function fail(value: unknown) {
    error = value instanceof Error ? value.message : 'Не удалось сохранить образец';
    if (value instanceof ApiError && value.status === 401) onunauthorized();
  }
  async function save(number: number, changes: { mediaId: string | null } | { caption: string }) {
    busy = true; onBusy(true); error = '';
    try {
      const guide = await api<CaptureGuide>(`/admin/capture-guides/${number}`, { method: 'PUT', body: JSON.stringify(changes) });
      guides = guides.map(item => item.number === number ? guide : item);
      if ('caption' in changes) delete captions[number];
    } catch (value) { fail(value); }
    finally { busy = false; onBusy(false); }
  }
  onMount(async () => {
    try { guides = await api<CaptureGuide[]>('/admin/capture-guides'); ready = true; }
    catch (value) { fail(value); }
  });
</script>
<section class="guides-page">
  <h2>Образцы ракурсов</h2>
  <p class="hint">Изображения и подписи помогают гостям повторить позу. Изменения появятся в новых фотосессиях.</p>
  <p class="hint">Во время съёмки образец показывается целиком, без обрезки; при других пропорциях останутся свободные поля.</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <fieldset disabled={!ready || busy}>
    <div class="guides-grid">
      {#each guides as guide (guide.number)}
        <section class="guide-card" aria-label={`Ракурс ${guide.number}`}>
          <MediaField label={`Образец ${guide.number}: ${guide.instruction}`} kind="image" id={guide.mediaId} optional hint="Рекомендуем вертикальное изображение 3:5, 300 × 500 px (ширина × высота)." onUploaded={media => { void save(guide.number, { mediaId: media.id }); }} onRemove={() => { void save(guide.number, { mediaId: null }); }} onError={fail} {onBusy} />
          {#if !guide.mediaId}<p class="hint">Образец не загружен. Во время съёмки будет показана инструкция.</p>{/if}
          <form class="caption-form" onsubmit={event => { event.preventDefault(); void save(guide.number, { caption: captions[guide.number] ?? '' }); }}>
            <label for={`guide-caption-${guide.number}`}>Подпись под образцом <span class="optional">необязательно</span></label>
            <input id={`guide-caption-${guide.number}`} type="text" maxlength={maxGuideCaptionLength}
              value={captions[guide.number] ?? guide.caption ?? ''} oninput={event => captions[guide.number] = event.currentTarget.value} />
            <button type="submit" class="quiet small" disabled={(captions[guide.number] ?? guide.caption ?? '').trim() === (guide.caption ?? '')}>Сохранить подпись</button>
          </form>
        </section>
      {/each}
    </div>
  </fieldset>
</section>
<style>
  .guides-page { max-width:1100px; margin:0 auto; padding:40px 24px; }
  .guides-page h2 { margin:8px 0 16px; }
  .guides-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px; margin-top:24px; }
  .guide-card { padding:20px; border:1px solid var(--line); border-radius:6px; min-width:0; }
  .caption-form { display:grid; gap:8px; margin-top:18px; }
  .caption-form input { width:100%; min-width:0; }
  .caption-form button { justify-self:start; }
  @media(max-width:640px) { .guides-grid { grid-template-columns:1fr; } .guides-page { padding:24px 16px; } }
</style>
