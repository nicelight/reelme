<script lang="ts">
  /** First-visitor event form. The parent persists the chosen action with the
   * start request; the server owns the date, automatic name and one-time setup. */
  import { participantRanges, type EventSetup, type ParticipantRange } from '../../shared/events';
  import { untrack } from 'svelte';
  import './story/assets/fonts.css';
  import mark from './story/assets/reelme-mark.webp';
  let { busy, error, initial, onsave, onskip }: {
    busy: boolean; error: string;
    initial?: Extract<EventSetup, { action: 'save' }>;
    onsave: (details: Extract<EventSetup, { action: 'save' }>) => void;
    onskip: () => void;
  } = $props();
  let name = $state(untrack(() => initial?.name ?? ''));
  let participantRange = $state<ParticipantRange | ''>(untrack(() => initial?.participantRange ?? ''));
  let location = $state(untrack(() => initial?.location ?? 'Новосибирск'));
  let validationError = $state('');
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    validationError = '';
    if (!name.trim() || !participantRange || !location.trim()) {
      validationError = 'Введите название и локацию, выберите количество участников.';
      return;
    }
    onsave({ action: 'save', name: name.trim(), participantRange, location: location.trim() });
  }
</script>

<main class="event-page">
  <div class="event-content">
    <div class="event-brand"><img src={mark} alt="" />ReelMe</div>
    <h1>Новое мероприятие</h1>
    <p class="event-intro">Заполните один раз перед первой съёмкой. Название поможет найти фотографии и видео в архиве.</p>
    <form onsubmit={submit} aria-label="Создание мероприятия">
      <label for="event-name">Название</label>
      <input id="event-name" name="event-name" bind:value={name} maxlength="120" required disabled={busy} autocomplete="off" />
      <label for="event-participants">Количество участников</label>
      <select id="event-participants" name="event-participants" bind:value={participantRange} required disabled={busy}>
        <option value="" disabled>Выберите диапазон</option>
        {#each participantRanges as range}<option value={range}>{range}</option>{/each}
      </select>
      <label for="event-location">Локация</label>
      <input id="event-location" name="event-location" bind:value={location} maxlength="160" required disabled={busy} autocomplete="address-level2" />
      {#if validationError || error}<p class="event-error" role="alert">{validationError || error}</p>{/if}
      <div class="event-actions">
        <button class="event-save" type="submit" disabled={busy}>{busy ? 'Продолжаем…' : 'Сохранить'}</button>
        <button class="event-skip" type="button" disabled={busy} onclick={onskip}>Пропустить</button>
      </div>
      <p class="event-hint">Если пропустить, мероприятие получит название Session_N.</p>
    </form>
  </div>
</main>

<style>
  .event-page { --accent:#f5a4df; color-scheme:dark; min-height:100svh; max-width:none; display:grid; place-items:center; padding:40px 24px; font-family:Manrope,sans-serif; color:#fff4fb; background:radial-gradient(ellipse at 6% 0%,#3d1b39 0%,transparent 40%),radial-gradient(ellipse at 97% 100%,#27112f 0%,transparent 43%),#0d0a13; }
  .event-content { width:min(100%,560px); }
  .event-brand { display:flex; align-items:center; gap:12px; margin-bottom:40px; font-size:24px; font-weight:800; letter-spacing:-.025em; }
  .event-brand img { width:40px; height:40px; object-fit:contain; }
  h1 { font-size:clamp(30px,5vw,40px); font-weight:700; line-height:1.15; letter-spacing:-.035em; }
  .event-intro { margin:16px 0 32px; color:#ede0ec; line-height:1.6; max-width:46ch; }
  label { margin:0 0 8px; font-size:15px; font-weight:600; }
  input,select { display:block; width:100%; min-height:52px; margin:0 0 24px; padding:12px 14px; border:1px solid #75566f; border-radius:10px; background:#1d1423; color:#fff4fb; font:inherit; caret-color:#f5a4df; }
  input:hover,select:hover { border-color:#b58ca7; }
  input:disabled,select:disabled { opacity:.6; }
  :is(input,select,button):focus-visible { outline:3px solid #f5a4df; outline-offset:4px; }
  .event-actions { display:flex; gap:12px; margin-top:32px; }
  .event-actions button { min-height:52px; font:inherit; font-weight:700; border-radius:10px; padding:12px 24px; }
  .event-save { flex:1; background:#f5a4df; color:#261121; border-color:#f5a4df; }
  .event-save:hover:not(:disabled) { background:#ffb0da; }
  .event-skip { background:transparent; color:#fff4fb; border-color:#75566f; }
  .event-skip:hover:not(:disabled) { background:#2e1730; }
  .event-hint { margin-top:16px; color:#d2bdd0; font-size:14px; line-height:1.5; }
  .event-error { margin:0 0 24px; color:#ffc1ca; }
  .event-content ::selection { color:#261121; background:#f5a4df; }
  @media(max-width:400px) { .event-page { padding:28px 20px; } .event-brand { margin-bottom:28px; } .event-actions { flex-direction:column; } }
</style>
