<script lang="ts">
  /** Module contract: admin page for the five named pose examples. Uploads create
   * immutable images; selecting a replacement changes only future snapshots.
   * Source: docs/slot-setup/matrix.md. */
  import { onMount } from 'svelte';
  import { captureGuides, type CaptureGuide } from '../../shared/slot-setup';
  import { api, ApiError } from './api';
  import MediaField from './MediaField.svelte';
  let { onunauthorized, onBusy }: { onunauthorized: () => void; onBusy: (busy: boolean) => void } = $props();
  let guides = $state<CaptureGuide[]>(captureGuides.map(guide => ({ ...guide })));
  let ready = $state(false);
  let busy = $state(false);
  let error = $state('');
  function fail(value: unknown) {
    error = value instanceof Error ? value.message : 'Не удалось сохранить образец';
    if (value instanceof ApiError && value.status === 401) onunauthorized();
  }
  async function assign(number: number, mediaId: string | null) {
    busy = true; onBusy(true); error = '';
    try {
      const guide = await api<CaptureGuide>(`/admin/capture-guides/${number}`, { method: 'PUT', body: JSON.stringify({ mediaId }) });
      guides = guides.map(item => item.number === number ? guide : item);
    } catch (value) { fail(value); }
    finally { busy = false; onBusy(false); }
  }
  onMount(async () => {
    try { guides = await api<CaptureGuide[]>('/admin/capture-guides'); ready = true; }
    catch (value) { fail(value); }
  });
</script>
<main class="guides-page">
  <p class="eyebrow">ПОДГОТОВКА СЪЁМКИ</p><h1>Образцы ракурсов</h1>
  <p class="hint">Изображения помогают гостям повторить позу. Замены применяются к новым фотосессиям; начатые сохраняют свои образцы.</p>
  <p class="hint">Во время съёмки образец показывается целиком, без обрезки; при других пропорциях останутся свободные поля.</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <fieldset disabled={!ready || busy}>
    <div class="guides-grid">
      {#each guides as guide (guide.number)}
        <section class="guide-card" aria-label={`Ракурс ${guide.number}`}>
          <MediaField label={`Образец ${guide.number}: ${guide.instruction}`} kind="image" id={guide.mediaId} optional hint="Рекомендуем вертикальное изображение 3:5, 600 × 1000 px (ширина × высота)." onUploaded={media => { void assign(guide.number, media.id); }} onRemove={() => { void assign(guide.number, null); }} onError={fail} {onBusy} />
          {#if !guide.mediaId}<p class="hint">Образец не загружен. Во время съёмки будет показана инструкция.</p>{/if}
        </section>
      {/each}
    </div>
  </fieldset>
</main>
<style>
  .guides-page { max-width:1100px; margin:0 auto; padding:40px 24px; }
  .guides-page h1 { margin:8px 0 16px; }
  .guides-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px; margin-top:24px; }
  .guide-card { padding:20px; border:1px solid var(--line); border-radius:6px; min-width:0; }
  @media(max-width:640px) { .guides-grid { grid-template-columns:1fr; } .guides-page { padding:24px 16px; } }
</style>
