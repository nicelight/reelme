<script lang="ts">
  /** Account archive browsing displays saved event names alongside server dates;
   * ready videos open the shared staff player in a separate tab.
   * Only admins see deletion, with explicit confirmation.
   * The server owns dates/authorization; viewing never opens visitor forms. */
  import { onMount } from 'svelte';
  import { eventKey, type ArchiveEvent, type EventGallery } from '../../shared/events';
  import { api, ApiError } from './api';
  let { role, onevent, onunauthorized }: { role: 'admin' | 'operator'; onevent: (key?: string) => void; onunauthorized: () => void } = $props();
  let events = $state<ArchiveEvent[]>([]);
  let gallery = $state<EventGallery | null>(null);
  let busy = $state(true);
  let error = $state('');
  let deleting = $state<ArchiveEvent | null>(null);
  let removing = $state(false);
  const dateLabel = (date: string) => new Date(`${date}T12:00:00+07:00`).toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk', day: 'numeric', month: 'long', year: 'numeric' });
  const bytesLabel = (bytes: number) => `${bytes.toLocaleString('ru-RU')} Б`;
  function fail(value: unknown) {
    error = value instanceof Error ? value.message : 'Не удалось открыть архив.';
    if (value instanceof ApiError && value.status === 401) onunauthorized();
  }
  async function load() {
    onevent();
    busy = true; error = ''; gallery = null;
    try { events = await api<ArchiveEvent[]>('/events'); } catch (value) { fail(value); } finally { busy = false; }
  }
  async function open(key: string) {
    onevent(key);
    busy = true; error = '';
    try {
      gallery = await api<EventGallery>(`/events/${encodeURIComponent(key)}`);
    } catch (value) { gallery = null; fail(value); } finally { busy = false; }
  }
  function showConfirmation(dialog: HTMLDialogElement) { dialog.showModal(); }
  async function remove() {
    if (!deleting || removing) return;
    removing = true; error = '';
    try { await api(`/events/${eventKey(deleting.date, deleting.eventNo)}`, { method: 'DELETE' }); deleting = null; await load(); }
    catch (value) { fail(value); } finally { removing = false; }
  }
  onMount(() => {
    const key = new URLSearchParams(location.search).get('archive') ?? history.state?.archive?.event;
    if (key) void open(key);
    else void load();
  });
</script>

<main class="archive">
  <div class="archive-heading">
    <div><p class="eyebrow">REELME / МЕРОПРИЯТИЯ</p><h1>{gallery ? gallery.name : 'Архив мероприятий'}</h1>{#if gallery}<p class="hint">{[dateLabel(gallery.date), gallery.location, gallery.participantRange ? `${gallery.participantRange} участников` : null].filter(Boolean).join(' · ')}</p>{/if}</div>
    {#if gallery}<button class="quiet" onclick={load} disabled={busy}>← Все мероприятия</button>{/if}
  </div>
  <p class="hint">{gallery ? 'Выберите историю, чтобы посмотреть её видео.' : 'Завершённые мероприятия и съёмки за прошлые дни.'}</p>
  {#if error}<p class="error" role="alert">{error}</p><button onclick={() => gallery ? open(eventKey(gallery.date,gallery.eventNo)) : load()}>Повторить</button>{/if}
  {#if busy}<p class="archive-empty" role="status">Открываем архив…</p>
  {:else if gallery}
    <div class="archive-gallery">
      {#each gallery.sessions as session (session.id)}
        <article class="archive-session" data-session={session.number}>
          {#if session.videoUrl}
            <a class="archive-thumbnail" href={`/results?video=${encodeURIComponent(session.id)}&event=${eventKey(gallery.date, gallery.eventNo)}`} target="_blank" rel="noopener" aria-label={`Смотреть видео № ${session.number}`}>
              <img loading="lazy" src={session.thumbnailUrl} alt={session.description} />
              <span class="archive-play" aria-hidden="true">▶</span>
            </a>
          {:else}
            <button class="archive-thumbnail" disabled aria-label={`Смотреть видео № ${session.number}`}>
              <img loading="lazy" src={session.thumbnailUrl} alt={session.description} />
            </button>
          {/if}
          <div class="archive-caption"><h2>№ {session.number}</h2><p>{session.description}</p>{#if session.testVideo}<span class="hint">Тестовое видео · без fal</span>{/if}{#if !session.videoUrl}<span class="hint">Готового видео пока нет</span>{/if}</div>
        </article>
      {/each}
    </div>
    {#if gallery.sessions.length === 0}<p class="archive-empty">В этом мероприятии нет фотосессий.</p>{/if}
  {:else}
    <div class="archive-days">
      {#each events as event (eventKey(event.date,event.eventNo))}
        <article class="archive-event">
        <button class="archive-day" onclick={() => open(eventKey(event.date,event.eventNo))} data-date={event.date}>
          <h2>{event.name}</h2><p class="hint">{dateLabel(event.date)} · {event.location}</p><span>Фотографии <strong>{bytesLabel(event.photoBytes)}</strong></span><span>Видео <strong>{bytesLabel(event.videoBytes)}</strong></span><span class="archive-link">Открыть мероприятие →</span>
        </button>
        {#if role === 'admin' && !event.closedToday}<button class="archive-delete" aria-label={`Удалить мероприятие ${dateLabel(event.date)}`} onclick={() => deleting = event}>Удалить мероприятие</button>{/if}
        </article>
      {/each}
    </div>
    {#if events.length === 0 && !error}<p class="archive-empty">Пока нет прошедших мероприятий.</p>{/if}
  {/if}
  {#if deleting}
    <dialog class="confirmation" use:showConfirmation aria-labelledby="delete-title" oncancel={(event) => { if (removing) event.preventDefault(); else deleting = null; }}>
        <h2 id="delete-title">Удалить мероприятие?</h2>
        <p>«{deleting.name}», {dateLabel(deleting.date)}. Фотографии, видео и ссылки посетителей будут удалены. Отменить удаление нельзя.</p>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="confirmation-actions"><button disabled={removing} onclick={() => deleting = null}>Отмена</button><button class="danger" disabled={removing} onclick={remove}>{removing ? 'Удаляем…' : 'Удалить'}</button></div>
    </dialog>
  {/if}
</main>

<style>
  .archive { max-width:1280px; margin:auto; padding:32px 20px 64px; }
  .archive-heading { display:flex; justify-content:space-between; align-items:center; gap:20px; flex-wrap:wrap; }
  .archive-days,.archive-gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr)); gap:20px; margin-top:32px; }
  .archive-event { display:grid; align-content:start; gap:8px; }
  .archive-delete { font-size:14px; color:var(--muted); }
  .confirmation::backdrop { background:#0009; }
  .confirmation { margin:auto; width:calc(100% - 40px); max-width:480px; padding:28px; background:var(--surface); color:var(--text); border:1px solid var(--line); border-radius:6px; }
  .confirmation p { margin:20px 0; }
  .confirmation-actions { display:flex; justify-content:flex-end; gap:12px; }
  .danger { color:#c54c3d; }
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
  .archive-empty { padding:48px 0; color:var(--muted); }
  @media(min-width:640px) { .archive { padding:48px 32px 64px; } }
</style>
