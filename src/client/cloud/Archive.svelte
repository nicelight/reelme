<script lang="ts">
  /** Account archive browsing only. The server defines eligible dates and scoped
   * media; this component never invokes receive/opened or other state mutations. */
  import { onMount } from 'svelte';
  import type { ArchiveEvent, ArchiveSession, EventGallery } from '../../shared/events';
  import { api, ApiError } from './api';
  let { onunauthorized }: { onunauthorized: () => void } = $props();
  let events = $state<ArchiveEvent[]>([]);
  let gallery = $state<EventGallery | null>(null);
  let selected = $state<ArchiveSession | null>(null);
  let busy = $state(true);
  let error = $state('');
  const dateLabel = (date: string) => new Date(`${date}T12:00:00+07:00`).toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk', day: 'numeric', month: 'long', year: 'numeric' });
  const bytesLabel = (bytes: number) => `${bytes.toLocaleString('ru-RU')} Б`;
  function fail(value: unknown) {
    error = value instanceof Error ? value.message : 'Не удалось открыть архив.';
    if (value instanceof ApiError && value.status === 401) onunauthorized();
  }
  async function load() {
    busy = true; error = ''; gallery = null; selected = null;
    try { events = await api<ArchiveEvent[]>('/events'); } catch (value) { fail(value); } finally { busy = false; }
  }
  async function open(date: string) {
    busy = true; error = ''; selected = null;
    try { gallery = await api<EventGallery>(`/events/${date}`); } catch (value) { fail(value); } finally { busy = false; }
  }
  onMount(() => { void load(); });
</script>

<main class="archive">
  <div class="archive-heading">
    <div><p class="eyebrow">REELME / МЕРОПРИЯТИЯ</p><h1>{gallery ? dateLabel(gallery.date) : 'Архив мероприятий'}</h1></div>
    {#if gallery}<button class="quiet" onclick={load} disabled={busy}>← Все мероприятия</button>{/if}
  </div>
  <p class="hint">{gallery ? 'Выберите историю, чтобы посмотреть её видео.' : 'Прошедшие дни по Новосибирску. Сегодняшние истории появятся здесь после полуночи.'}</p>
  {#if error}<p class="error" role="alert">{error}</p><button onclick={() => gallery ? open(gallery.date) : load()}>Повторить</button>{/if}
  {#if busy}<p class="archive-empty" role="status">Открываем архив…</p>
  {:else if gallery}
    {#if selected}
      <section class="archive-player" aria-label={`Видео № ${selected.number}`}>
        <div class="archive-heading"><h2>История № {selected.number}</h2><button onclick={() => selected = null}>Закрыть видео</button></div>
        {#key selected.id}<video src={selected.videoUrl!} controls autoplay playsinline onerror={() => error = 'Не удалось загрузить видео. Повторите попытку.'}><track kind="captions" /></video>{/key}
      </section>
    {/if}
    <div class="archive-gallery">
      {#each gallery.sessions as session (session.id)}
        <article class="archive-session" data-session={session.number}>
          <button class="archive-thumbnail" aria-label={`Смотреть видео № ${session.number}`} disabled={!session.videoUrl} onclick={() => { selected = session; error = ''; }}>
            <img src={session.thumbnailUrl} alt={session.description} />
            {#if session.videoUrl}<span class="archive-play" aria-hidden="true">▶</span>{/if}
          </button>
          <div class="archive-caption"><h2>№ {session.number}</h2><p>{session.description}</p>{#if !session.videoUrl}<span class="hint">Готового видео пока нет</span>{/if}</div>
        </article>
      {/each}
    </div>
    {#if gallery.sessions.length === 0}<p class="archive-empty">В этом мероприятии нет фотосессий.</p>{/if}
  {:else}
    <div class="archive-days">
      {#each events as event (event.date)}
        <button class="archive-day" onclick={() => open(event.date)} data-date={event.date}>
          <h2>{dateLabel(event.date)}</h2><span>Фотографии <strong>{bytesLabel(event.photoBytes)}</strong></span><span>Видео <strong>{bytesLabel(event.videoBytes)}</strong></span><span class="archive-link">Открыть мероприятие →</span>
        </button>
      {/each}
    </div>
    {#if events.length === 0 && !error}<p class="archive-empty">Пока нет прошедших мероприятий.</p>{/if}
  {/if}
</main>

<style>
  .archive { max-width:1280px; margin:auto; padding:32px 20px 64px; }
  .archive-heading { display:flex; justify-content:space-between; align-items:center; gap:20px; flex-wrap:wrap; }
  .archive-days,.archive-gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr)); gap:20px; margin-top:32px; }
  .archive-day { text-align:left; padding:26px; display:grid; gap:14px; font-weight:400; }
  .archive-day h2 { font-size:24px; margin-bottom:8px; }
  .archive-day>span:not(.archive-link) { display:flex; justify-content:space-between; gap:12px; font-size:14px; color:var(--muted); }
  .archive-day strong { color:var(--text); white-space:nowrap; }
  .archive-link { color:var(--accent); font-size:14px; margin-top:12px; }
  .archive-session { background:var(--surface); border:1px solid var(--line); border-radius:6px; overflow:hidden; }
  .archive-thumbnail { position:relative; display:block; padding:0; width:100%; border:0; border-radius:0; }
  .archive-thumbnail:disabled { opacity:1; cursor:default; }
  .archive-thumbnail img { display:block; width:100%; aspect-ratio:4/3; object-fit:cover; }
  .archive-play { position:absolute; inset:0; display:grid; place-items:center; font-size:32px; color:white; text-shadow:0 1px 8px #000; }
  .archive-caption { padding:20px; overflow-wrap:anywhere; }
  .archive-caption h2 { font-size:24px; margin-bottom:8px; }
  .archive-caption p { font-size:14px; color:var(--muted); }
  .archive-player { margin-top:28px; padding:20px; border:1px solid var(--line); background:var(--surface); border-radius:6px; }
  .archive-player video { display:block; margin:20px auto 0; width:100%; max-height:65vh; background:#000; }
  .archive-empty { padding:48px 0; color:var(--muted); }
  @media(min-width:640px) { .archive { padding:48px 32px 64px; } }
</style>
