<script lang="ts">
  /** Receive keeps email acceptance separate from delivery; network uncertainty
   * never triggers another POST or invents a sent/failed server state. */
  import { onMount } from 'svelte';
  import './results-prototype/assets/fonts.css';
  import { api, ApiError } from './api';
  import type { ReceiveStatus } from '../../shared/receive';
  let { token }: { token: string } = $props();
  let view = $state<ReceiveStatus>();
  let email = $state('');
  let busy = $state(false);
  let loading = $state(false);
  let emailUncertain = $state(false);
  let error = $state('');
  let shareFile = $state<File>();
  let shareState = $state<'preparing' | 'ready' | 'link' | 'copy' | 'failed'>('preparing');
  const shareLabels = {
    preparing: 'Подготавливаем видео…', ready: 'Поделиться видео',
    link: 'Поделиться ссылкой на видео', copy: 'Скопировать ссылку на видео', failed: 'Подготовить видео снова',
  };
  let sharing = $state(false);
  let shareMessage = $state('');
  let showLink = $state(false);
  let shareAttempt = $state(0);
  let player = $state<HTMLVideoElement>();
  let playerError = $state(false);
  let active = false;
  let statusVersion = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let statusRequest: Promise<void> | undefined;
  const requests = new Set<AbortController>();
  const path = $derived(`/receive/${encodeURIComponent(token)}`);
  const shareUrl = $derived(view?.downloadUrl);
  const videoLink = $derived(view ? new URL(view.videoUrl, window.location.origin).href : '');
  const shareNumber = $derived(view?.number);
  const messages = {
    not_requested: '',
    pending: 'Email принят. Письмо ожидает отправки.',
    sending: 'Отправляем письмо. Статус обновится автоматически.',
    sent: 'Письмо отправлено. Проверьте входящие и папку «Спам».',
    failed: 'Не удалось подтвердить отправку. Письмо могло уже уйти. Проверьте почту или введите адрес и повторите.',
  };
  // API replies get 15 seconds; the complete MP4 gets 2 minutes on mobile data.
  async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, ms = 15_000, parent?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    requests.add(controller);
    parent?.addEventListener('abort', abort, { once: true });
    if (parent?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
    try { return await operation(controller.signal); }
    finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); requests.delete(controller); }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (active && !busy && view && (emailUncertain || ['pending', 'sending'].includes(view.emailState))) {
      pollTimer = setTimeout(() => { void checkStatus(); }, 3000);
    }
  }
  function refresh() {
    if (statusRequest) return statusRequest;
    const version = statusVersion;
    statusRequest = bounded(signal => api<ReceiveStatus>(path, { signal })).then(next => {
      if (!active || version !== statusVersion) return;
      view = next;
      if (emailUncertain) {
        emailUncertain = false;
        if (!next.canSubmit) { email = ''; error = ''; }
        else error = 'Приём email не подтверждён. Адрес сохранён — можно повторить отправку.';
      } else error = '';
    }).finally(() => { statusRequest = undefined; });
    return statusRequest;
  }
  async function checkStatus() {
    try { await refresh(); }
    catch { if (active) error = emailUncertain ? 'Не удалось проверить приём email. Адрес сохранён. Проверим связь ещё раз.' : 'Не удалось обновить статус. Проверим соединение ещё раз.'; }
    finally { schedulePoll(); }
  }
  async function load() {
    if (loading) return;
    loading = true; error = '';
    const version = ++statusVersion;
    try {
      const next = await bounded(signal => api<ReceiveStatus>(`${path}/opened`, { method: 'POST', signal }));
      if (active && version === statusVersion) view = next;
    } catch (e) {
      if (active && version === statusVersion) error = e instanceof ApiError ? e.message : 'Не удалось открыть историю. Проверьте связь и попробуйте снова.';
    } finally { if (active) { loading = false; schedulePoll(); } }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || emailUncertain || !view?.canSubmit) return;
    busy = true; error = ''; ++statusVersion; clearTimeout(pollTimer);
    try {
      const next = await bounded(signal => api<ReceiveStatus>(`${path}/email`, { method: 'POST', body: JSON.stringify({ email }), signal }));
      if (!active) return;
      view = next; email = '';
    } catch (e) {
      if (!active) return;
      if (e instanceof ApiError && e.status !== 409) error = e.message;
      else {
        emailUncertain = true;
        error = 'Приём email пока не подтверждён. Проверяем статус; адрес сохранён.';
      }
    } finally {
      if (active) {
        busy = false;
        if (emailUncertain) void checkStatus();
        else schedulePoll();
      }
    }
  }
  function offerLink() {
    let canSendLink = false;
    try {
      canSendLink = typeof navigator.share === 'function' && (typeof navigator.canShare !== 'function' || navigator.canShare({ url: videoLink }));
    } catch {}
    shareState = canSendLink ? 'link' : 'copy';
    shareMessage = 'Чтобы отправить сам файл, откройте скачанный MP4 в «Загрузках» и нажмите «Поделиться».';
  }
  $effect(() => {
    const url = shareUrl;
    const number = shareNumber;
    shareAttempt;
    if (!url) return;
    const controller = new AbortController();
    shareFile = undefined; shareMessage = ''; showLink = false;
    const filename = `reelme-${number}.mp4`;
    if (typeof navigator.share !== 'function') {
      offerLink();
      return;
    }
    shareState = 'preparing';
    void (async () => {
      try {
        const file = await bounded(async signal => {
          const response = await fetch(`${url}?purpose=share`, { signal });
          if (!response.ok) throw new Error('Download failed');
          return new File([await response.blob()], filename, { type: 'video/mp4' });
        }, 120_000, controller.signal);
        if (controller.signal.aborted || !active) return;
        if (typeof navigator.canShare === 'function') {
          let supported = false;
          try { supported = navigator.canShare({ files: [file] }); } catch {}
          if (!supported) { offerLink(); return; }
        }
        shareFile = file; shareState = 'ready';
      } catch {
        if (controller.signal.aborted || !active) return;
        shareState = 'failed';
        shareMessage = 'Не удалось подготовить видео. Повторите попытку или скачайте его.';
      }
    })();
    return () => { controller.abort(); shareFile = undefined; };
  });
  function report(action: string, operationId?: string) {
    try {
      const id = operationId ?? crypto.randomUUID();
      void api(`${path}/activity`, { method: 'POST', keepalive: true, body: JSON.stringify({ id, action }) }).catch(() => {});
      return id;
    } catch { return undefined; }
  }
  async function share() {
    if (sharing || shareState === 'preparing') return;
    if (shareState === 'failed') { shareAttempt += 1; return; }
    if (shareState === 'copy') {
      try {
        await navigator.clipboard.writeText(videoLink);
        showLink = false; shareMessage = 'Ссылка на видео скопирована.';
      } catch {
        showLink = true;
        shareMessage = 'Выделите и скопируйте ссылку на видео.';
      }
      return;
    }
    let data: ShareData;
    if (shareState === 'link') data = { url: videoLink };
    else if (shareFile) data = { files: [shareFile] };
    else return;
    sharing = true; shareMessage = '';
    let operationId: string | undefined;
    try {
      const shared = navigator.share(data);
      operationId = report('share_started');
      await shared;
      report('share_returned', operationId);
    } catch (e) {
      report(e instanceof DOMException && e.name === 'AbortError' ? 'share_cancelled' : 'share_failed', operationId);
      if (active && !(e instanceof DOMException && e.name === 'AbortError')) {
        if (data.files) offerLink();
        else { shareState = 'copy'; shareMessage = 'Меню отправки недоступно. Скопируйте ссылку на видео.'; }
      }
    } finally { if (active) sharing = false; }
  }
  function retryPlayer() { playerError = false; player?.load(); }
  onMount(() => {
    active = true; void load();
    return () => {
      active = false; ++statusVersion; clearTimeout(pollTimer);
      for (const controller of requests) controller.abort();
      shareFile = undefined;
    };
  });
</script>


<svelte:head><title>ReelMe — получить видео</title></svelte:head>
<main class="receive-page">
  <div class="receive-shell">
    <div class="receive-brand" aria-label="ReelMe">Reel<span>Me</span></div>
    <section class="receive-card" class:has-photo={!!view} aria-labelledby="receive-title">
      <div class="receive-light" aria-hidden="true"><i class="receive-halo"></i><i class="receive-hotspot"></i></div>
      {#if view}
        <div class="receive-photo">
          <!-- Generated clips have no caption track; playback is user initiated. -->
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={player} onerror={() => { playerError = true; }} onloadeddata={() => { playerError = false; }} src={view.videoUrl} poster={view.photoUrl} controls playsinline preload="metadata" aria-label={`Видео истории № ${view.number}`}></video>
          {#if playerError}<div class="receive-player-error" role="status"><p>Не удалось загрузить видео.</p><button class="receive-submit receive-email-submit" onclick={retryPlayer}>Загрузить снова</button></div>{/if}
        </div>
        <div class="receive-content">
          <h1 id="receive-title">История № {view.number}</h1>
          <button class="receive-submit" onclick={share} disabled={shareState === 'preparing' || sharing}>
            {sharing ? 'Открываем отправку…' : shareLabels[shareState]}
          </button>
          {#if shareState === 'ready'}<p class="receive-hint">можно поделиться сразу в инсте, телеге, etc</p>{/if}
          {#if shareMessage}<p class="receive-hint" role="status">{shareMessage}</p>{/if}
          {#if showLink}<input readonly aria-label="Ссылка на видео" value={videoLink} onfocus={event => event.currentTarget.select()} />{/if}
          <a class="receive-submit receive-download" href={view.downloadUrl} onclick={() => { report('download_clicked'); }} download={`reelme-${view.number}.mp4`}>Скачать видео</a>
          <p class="receive-hint receive-retention-note">видео будет доступно для скачивания 1-2 дня, рекомендую отправить его на почту</p>
          {#if view.emailState !== 'not_requested'}<p class:receive-failed={view.emailState === 'failed'} class:receive-sent={view.emailState === 'sent'} class="receive-status" role="status">{#if view.emailState === 'sent'}<span class="receive-sent-light" aria-hidden="true"></span><span class="receive-check" aria-hidden="true">✓</span>{/if}{messages[view.emailState]}</p>{/if}
          {#if view.canSubmit}
            <form onsubmit={submit} aria-busy={busy}>
              <label for="receive-email">email для получения видео</label>
              <input id="receive-email" name="email" type="email" bind:value={email} autocomplete="email" inputmode="email" enterkeyhint="send" autocapitalize="none" autocorrect="off" spellcheck={false} required maxlength="254" placeholder="you@example.com" disabled={busy} aria-describedby="email-hint" />
              <p class="receive-hint" id="email-hint">Проверьте адрес перед отправкой.</p>
              <button class="receive-submit receive-email-submit" type="submit" disabled={busy || emailUncertain}>{busy ? 'Сохраняем…' : view.emailState === 'failed' ? 'Повторить отправку' : 'Получить видео по email'}</button>
            </form>
          {/if}
          {#if error}<p class="receive-error" role="alert">{error}</p>{/if}
          {#if emailUncertain}<button class="receive-submit receive-email-submit" onclick={checkStatus}>Проверить статус</button>{/if}
        </div>
      {:else}
        <div class="receive-content">
          <h1 id="receive-title">Получить видео</h1>
          {#if error}
            <p class="receive-error" role="alert">{error}</p>
            <button class="receive-submit" onclick={load} disabled={loading}>{loading ? 'Открываем…' : 'Попробовать снова'}</button>
          {:else}<p class="receive-status" role="status">Открываем вашу историю…</p>{/if}
        </div>
      {/if}
    </section>
  </div>
</main>

<style>
  :global(body) { margin:0; }
  .receive-page,.receive-page :global(*) { box-sizing:border-box; }
  .receive-page { font-synthesis:none; -webkit-tap-highlight-color:transparent; }
  .receive-player-error p { margin:0; }
  .receive-page { color-scheme:dark; min-height:100svh; display:grid; place-items:center; padding:max(40px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left)); --ease-out:cubic-bezier(0.23,1,0.32,1); font:400 16px/1.55 Manrope,sans-serif; color:#fff4fb; background:radial-gradient(ellipse at 6% 0%,#3d1b39 0%,transparent 40%),radial-gradient(ellipse at 97% 100%,#27112f 0%,transparent 43%),#0d0a13; }
  .receive-shell { width:min(100%,840px); }
  .receive-brand { margin:0 0 32px; text-align:center; color:#fff4fb; font-size:44px; font-weight:800; line-height:1.1; letter-spacing:-.035em; }
  .receive-brand span { color:#f5a4df; }
  .receive-card { animation:receive-enter 250ms var(--ease-out) both; position:relative; isolation:isolate; display:grid; width:min(100%,440px); margin:auto; padding:32px; border:1px solid transparent; border-radius:26px; background:linear-gradient(125deg,rgba(46,23,48,.8),#130e1bea 68%) padding-box,linear-gradient(145deg,#ac59967d,#7b406b70) border-box; box-shadow:0 10px 36px #0005,0 0 12px #f573c014,inset 0 6px 24px #ed65be16; }
  .receive-card.has-photo { width:100%; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:32px; padding:20px; }
  .receive-light { --corner-light:radial-gradient(ellipse 38% 85% at 8% 0%,#ffbbe0 0%,#fb7dbf 24%,#e969bda8 43%,transparent 78%),radial-gradient(ellipse 22% 58% at 100% 100%,#ffe5ef 0%,#ff9cd0 20%,#ed71bfab 45%,transparent 88%); position:absolute; inset:-1px; border-radius:inherit; pointer-events:none; }
  .receive-light::before,.receive-halo::before { content:''; position:absolute; inset:0; border-radius:inherit; background:var(--corner-light); padding:1.15px; mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0); mask-composite:exclude; }
  .receive-halo { position:absolute; inset:0; border-radius:inherit; filter:blur(6px); opacity:.95; }
  .receive-halo::before { padding:7px; }
  .receive-hotspot { position:absolute; top:-.4px; left:8%; width:14%; height:2px; background:linear-gradient(90deg,transparent,#ffb0da 18%,#fffaf4 38%,#fffaf4 57%,#ffc3e3 72%,transparent); filter:drop-shadow(0 0 2.5px #ffe5f2) drop-shadow(0 0 5px #ff7fcaa6); }
  .receive-photo { position:relative; min-width:0; min-height:0; display:grid; place-items:center; background:#0d0a13; border-radius:16px; overflow:hidden; }
  .receive-photo video { display:block; width:100%; height:100%; max-height:440px; object-fit:contain; }
  .receive-content { position:relative; align-self:center; min-width:0; }
  .has-photo .receive-content { padding:20px 12px 20px 0; }
  .receive-content h1 { margin:0; color:#fff4fb; font:800 clamp(26px,3vw,32px)/1.2 Manrope,sans-serif; letter-spacing:-.025em; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
  .receive-status { margin:16px 0 0; color:#ede0ec; max-width:42ch; overflow-wrap:anywhere; }
  .receive-status.receive-failed,.receive-error { color:#ffb6ca; }
  .receive-content label { display:block; margin:28px 0 8px; font-size:13px; font-weight:600; color:#ede0ec; }
  .receive-page .receive-content input { width:100%; min-height:50px; margin:0; padding:12px 14px; border:1px solid #78506d; border-radius:10px; background:#140e1bd9; color:#fff4fb; font:500 16px/1.4 Manrope,sans-serif; caret-color:#f5a4df; scroll-margin-block:24px; }
  .receive-content input::placeholder { color:#bda6bb; opacity:1; }
  .receive-content input:disabled { opacity:.6; }
  .receive-content input:focus-visible { outline:2px solid #f5a4df; outline-offset:3px; border-color:#f5a4df; }
  .receive-hint { color:#cdbbca; font-size:12px; line-height:1.5; margin:10px 0 0; }
  .receive-retention-note { font-size:16px; line-height:1.5; color:#ede0ec; }
  .receive-submit { display:block; width:100%; min-height:50px; margin:24px 0 0; padding:12px 16px; border:1px solid #f1a9d5; border-radius:12px; background:#f5a4df; color:#231122; font:800 15px/1.4 Manrope,sans-serif; cursor:pointer; touch-action:manipulation; transition:background 150ms ease,transform 160ms var(--ease-out); }
  .receive-download { text-align:center; text-decoration:none; }
  .receive-email-submit,.receive-download { background:#211324; color:#fff4fb; border-color:#956080; }
  .receive-submit:disabled { opacity:.6; cursor:wait; }
  .receive-submit:focus-visible { outline:2px solid #fff4fb; outline-offset:4px; }
  .receive-error { margin:16px 0 0; font-size:13px; line-height:1.5; overflow-wrap:anywhere; }
  .receive-submit:active:not(:disabled) { transform:scale(.97); }
  .receive-player-error { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:16px; background:#130e1bf2; text-align:center; }
  .receive-player-error .receive-submit { margin-top:12px; }
  .receive-sent { position:relative; isolation:isolate; }
  .receive-check { display:inline-block; margin-right:8px; color:#f5a4df; animation:receive-check 250ms var(--ease-out) both; }
  .receive-sent-light { position:absolute; z-index:-1; inset:-10px; pointer-events:none; border-radius:12px; background:radial-gradient(ellipse at 20% 50%,#f5a4df40,transparent 75%); opacity:0; animation:receive-confirm 300ms var(--ease-out); }
  @keyframes receive-enter { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  @keyframes receive-check { from { opacity:0; transform:scale(.95); } to { opacity:1; transform:scale(1); } }
  @keyframes receive-confirm { 0% { opacity:0; } 35% { opacity:1; } 100% { opacity:0; } }
  ::selection { background:#854569; color:#fff; }
  .receive-submit:hover:not(:disabled) { background:#f5a4df; border-color:#f1a9d5; }
  .receive-email-submit:hover:not(:disabled),.receive-download:hover { background:#211324; border-color:#956080; }
  @media(hover:hover) and (pointer:fine) { .receive-submit:hover:not(:disabled) { background:#ffd0ee; border-color:#ffd0ee; color:#231122; } }
  @media(max-width:640px) {
    .receive-page { min-height:100dvh; place-items:start center; padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); }
    .receive-brand { font-size:36px; margin-bottom:24px; }
    .receive-card { padding:28px 24px; }
    .receive-card.has-photo { grid-template-columns:minmax(0,1fr); gap:22px; padding:16px; }
    .receive-photo video { height:auto; max-height:min(220px,25svh); }
    .has-photo .receive-content { padding:0 8px 12px; }
    .receive-content label { margin-top:22px; }
    .receive-content .receive-submit { min-height:52px; }
  }
  @media(max-width:640px) and (max-height:640px) {
    .receive-page { padding-top:max(16px,env(safe-area-inset-top)); padding-bottom:max(16px,env(safe-area-inset-bottom)); }
    .receive-brand { font-size:32px; margin-bottom:20px; }
    .receive-card.has-photo { gap:18px; padding:14px; }
    .receive-photo video { max-height:120px; }
    .receive-status { margin-top:12px; }
    .receive-content label { margin-top:18px; }
    .receive-submit { margin-top:20px; }
  }
  @media(prefers-reduced-motion:reduce) { .receive-submit { transition:none; } .receive-submit:active:not(:disabled) { transform:none; } .receive-card,.receive-check,.receive-sent-light { animation:none; } }
</style>
