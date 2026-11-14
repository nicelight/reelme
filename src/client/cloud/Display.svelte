<script lang="ts">
  /** Module contract: read-only operator screen. The server clock/deadline controls
   * both progress and QR visibility, including while offline. Paging never opens
   * receive forms. Polls refresh stages without reordering the server's list. */
  import { onMount } from 'svelte';
  import { api, ApiError } from './api';
  import type { TodayDisplay } from '../../shared/display';
  let { onunauthorized }: { onunauthorized: () => void } = $props();
  let display = $state<TodayDisplay | null>(null);
  let time = $state(0);
  let page = $state(0);
  let pageSize = $state(1);
  let error = $state('');
  let paused = $state(false);
  const sessions = $derived(display?.sessions.filter(item => item.hideAt === null || item.hideAt > time) ?? []);
  const pages = $derived(Math.max(1, Math.ceil(sessions.length / pageSize)));
  const currentPage = $derived(Math.min(page, pages - 1));
  const visible = $derived(sessions.slice(currentPage * pageSize, (currentPage + 1) * pageSize));
  const date = $derived(display ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(display.date + 'T00:00:00Z')) : 'Сегодня');

  onMount(() => {
    let stopped = false;
    let anchor = 0;
    let clockStart = 0;
    let polling: ReturnType<typeof setTimeout>;
    let expiry: ReturnType<typeof setTimeout>;
    function resize() {
      pageSize = innerWidth >= 1200 && innerHeight >= 1300 ? 6 : innerWidth >= 1200 ? 3 : innerWidth >= 720 ? 2 : 1;
      page = 0;
    }
    function updateTime() {
      time = anchor + (performance.now() - clockStart);
      clearTimeout(expiry);
      const deadline = display?.sessions.map(item => item.hideAt).filter((value): value is number => value !== null && value > time).sort((a, b) => a - b)[0];
      if (deadline !== undefined) expiry = setTimeout(updateTime, Math.max(0, deadline - time));
    }
    async function refresh() {
      const started = performance.now();
      try {
        const next = await api<TodayDisplay>('/display/today');
        if (stopped) return;
        if (display && next.date !== display.date) page = 0;
        display = next; anchor = next.serverNow; clockStart = started; error = ''; updateTime();
      } catch (value) {
        if (stopped) return;
        if (value instanceof ApiError && (value.status === 401 || value.status === 403)) {
          display = null; onunauthorized(); return;
        }
        error = 'Нет связи с сервером. Повторяем подключение…';
      } finally { if (!stopped) polling = setTimeout(refresh, 2000); }
    }
    resize(); window.addEventListener('resize', resize); void refresh();
    const paging = setInterval(() => { if (!paused) page = (currentPage + 1) % pages; }, 10_000);
    return () => { stopped = true; clearTimeout(polling); clearTimeout(expiry); clearInterval(paging); window.removeEventListener('resize', resize); };
  });
</script>

<main class="display">
  <div class="display-heading">
    <div><p class="eyebrow">REELME / {date} / НОВОСИБИРСК</p><h1>Ваша история — здесь.</h1><p class="display-instruction">Найдите свой номер. Когда видео готово, наведите камеру телефона на QR.</p></div>
    <div class="display-count"><strong>{sessions.length}</strong><span>на экране</span></div>
  </div>
  {#if error}<p class="error connection" role="alert">{error}</p>{/if}
  {#if !display}<p class="display-empty" role="status">{error ? 'Ждём подключения, чтобы показать ваши видео.' : 'Загружаем ваши истории…'}</p>
  {:else if sessions.length === 0}
    <div class="display-empty"><span class="empty-mark" aria-hidden="true">↗</span><h2>Здесь появится ваше видео.</h2><p>Выберите сюжет и сделайте фото на съёмочной установке.<br />После съёмки запомните свой номер.</p></div>
  {:else}
    <div class="display-grid">
      {#each visible as session (session.id)}
        <article class="result-card" aria-label={`История № ${session.number}`} data-session={session.number}>
          <div class="result-progress" data-stage={session.stage}>
            <div class="result-topline"><span class="eyebrow">ВАША ИСТОРИЯ</span><span class="stage-count">{session.stage ? `Этап ${session.stage} из 6` : session.error ? 'Нужна помощь' : 'Идёт съёмка'}</span></div>
            <div class="result-title"><h2>№ {session.number}</h2><p>{session.label}</p></div>
            <div class="stage-bar" role="img" aria-label={session.stage ? `Этап ${session.stage} из 6: ${session.label}` : session.label}>
              {#each [1, 2, 3, 4, 5, 6] as step}<span class:filled={step <= session.stage}></span>{/each}
            </div>
            {#if session.error}<p class="error result-error">{session.error}</p>{/if}
          </div>
          {#if session.card}
            <div class="result-images">
              <figure><img src={session.card.photoUrl} alt={`Исходное фото посетителя № ${session.number}`} /><figcaption>Ваше фото</figcaption></figure>
              <figure><img src={session.card.frameUrl} alt={`Кадр видео № ${session.number}`} /><figcaption>Ваше видео</figcaption></figure>
            </div>
            <div class="result-receive">
              <img class="result-qr" src={session.card.qrUrl} alt={`QR формы получения видео № ${session.number}`} />
              <div><span class="qr-number">№ {session.number}</span><p>Получите видео<br />по email</p><span class="qr-hint">Наведите камеру на QR</span></div>
            </div>
          {:else}
            <div class="result-waiting"><span aria-hidden="true">{session.error ? '!' : '↗'}</span><p>{session.error ? 'Сотрудник поможет вам' : 'У каждой истории свой ритм'}</p><small>{session.error ? 'Покажите ему свой номер.' : 'Фото и QR появятся здесь, когда видео будет готово.'}</small></div>
          {/if}
        </article>
      {/each}
    </div>
    <footer class="display-footer">
      <p>После подтверждения email история остаётся на экране ещё 3 минуты.</p>
      {#if pages > 1}
        <nav class="display-pages" aria-label="Страницы историй">
          <button class="quiet" aria-label="Предыдущая страница" onclick={() => page = (currentPage - 1 + pages) % pages}>←</button>
          <span aria-live="polite">{currentPage + 1} / {pages}</span>
          <button class="quiet" aria-label="Следующая страница" onclick={() => page = (currentPage + 1) % pages}>→</button>
          <button class="quiet" aria-label={paused ? 'Продолжить смену страниц' : 'Приостановить смену страниц'} aria-pressed={paused} onclick={() => paused = !paused}>{paused ? 'Продолжить' : 'Пауза'}</button>
        </nav>
      {/if}
    </footer>
  {/if}
</main>

<style>
  .display { max-width:1800px; margin:auto; padding:28px 20px; }
  .display-heading { display:flex; align-items:center; justify-content:space-between; gap:24px; margin-bottom:28px; }
  .display-heading h1 { font-size:clamp(30px,3.1vw,48px); }
  .display-instruction { color:var(--muted); margin-top:12px; max-width:65ch; }
  .display-count { display:none; text-align:right; flex-shrink:0; }
  .display-count strong { display:block; font-size:40px; line-height:1.2; font-weight:550; }
  .display-count span { color:var(--muted); font-size:13px; }
  .display-grid { display:grid; gap:20px; }
  .result-card { min-width:0; background:var(--surface); border:1px solid var(--line); border-radius:10px; overflow:hidden; display:flex; flex-direction:column; }
  .result-progress { padding:20px; --stage:#db779e; }
  [data-stage='2'] { --stage:#9862c5; } [data-stage='3'] { --stage:#7dc6df; } [data-stage='4'] { --stage:#afd88c; } [data-stage='5'] { --stage:#4b9c5f; } [data-stage='6'] { --stage:#4d6238; }
  .result-topline { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
  .result-topline .eyebrow { margin:0; }
  .stage-count { font-size:12px; color:var(--muted); }
  .result-title { margin:14px 0 18px; min-height:66px; display:flex; align-items:center; gap:20px; }
  .result-title h2 { font-size:40px; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .result-title p { font-size:15px; line-height:1.4; overflow-wrap:anywhere; }
  .stage-bar { display:grid; grid-template-columns:repeat(6,1fr); gap:5px; }
  .stage-bar span { height:8px; background:var(--line); border-radius:2px; }
  .stage-bar .filled { background:var(--stage); }
  .result-error { margin-bottom:0; }
  .result-images { display:grid; grid-template-columns:1fr 1fr; gap:3px; }
  figure { margin:0; position:relative; min-width:0; }
  figure img { display:block; width:100%; height:clamp(140px,15vw,180px); object-fit:contain; background:var(--bg); }
  figcaption { position:absolute; bottom:8px; left:8px; font-size:11px; background:#202822e6; color:#fff; padding:2px 7px; border-radius:3px; }
  .result-receive { display:flex; align-items:center; gap:16px; padding:16px; }
  .result-qr { width:140px; height:140px; object-fit:contain; background:white; flex-shrink:0; border-radius:3px; }
  .qr-number { font-size:40px; font-weight:650; line-height:1.2; letter-spacing:-.04em; }
  .result-receive p { margin-top:6px; line-height:1.3; font-size:15px; }
  .qr-hint { display:block; margin-top:8px; font-size:11px; color:var(--muted); }
  .result-waiting { flex:1; min-height:290px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:30px; text-align:center; color:var(--muted); background:var(--input); border-top:1px solid var(--line); }
  .result-waiting>span { font-size:56px; color:var(--accent); margin-bottom:20px; }
  .result-waiting small { max-width:24ch; margin-top:10px; }
  .display-footer { display:flex; flex-wrap:wrap; gap:16px; justify-content:space-between; align-items:center; padding-top:20px; }
  .display-footer>p { color:var(--muted); font-size:13px; max-width:50ch; }
  .display-pages { display:flex; align-items:center; gap:6px; font-variant-numeric:tabular-nums; }
  .display-pages>span { min-width:52px; text-align:center; }
  .display-pages button { padding:8px 12px; }
  .display-empty { text-align:center; padding:80px 16px; border-top:1px solid var(--line); }
  .display-empty p { color:var(--muted); margin-top:20px; }
  .empty-mark { display:block; font-size:70px; color:var(--accent); margin-bottom:28px; }
  .connection { padding:12px 16px; background:var(--surface); border:1px solid var(--line); border-radius:6px; }
  @media(min-width:720px) { .display { padding:36px 32px; } .display-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .display-count { display:block; } }
  @media(min-width:1200px) { .display { padding:32px 40px; } .display-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .result-title p { font-size:16px; } .result-qr { width:154px; height:154px; } }
  /* Reserve room for the account header/navigation and full-size QR on short screens. */
  @media(min-width:720px) and (max-height:850px) {
    .display { padding-top:12px; padding-bottom:12px; }
    .display-heading { margin-bottom:12px; }
    .display-heading .eyebrow { margin-bottom:4px; }
    .display-heading h1 { font-size:28px; }
    .display-instruction { margin-top:4px; font-size:14px; }
    .result-progress { padding:12px 16px; }
    .result-title { min-height:40px; margin:8px 0; gap:12px; }
    .result-title h2 { font-size:32px; }
    figure img { height:clamp(88px,calc(100dvh - 620px),140px); }
    .result-receive { padding:10px 16px; }
    .result-waiting { min-height:0; padding:16px; }
    .display-footer { padding-top:12px; }
  }
  @media(min-width:1200px) and (min-height:1300px) { figure img { height:140px; } .result-title { min-height:44px; margin:10px 0 14px; } .result-progress { padding:16px 20px; } .result-qr { width:128px; height:128px; } .result-receive { padding:10px 16px; } .result-waiting { min-height:290px; } }
</style>
