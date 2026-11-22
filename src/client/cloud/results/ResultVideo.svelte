<script lang="ts">
  /** Staff playback uses the display video. Billing can arrive while it is playing. */
  import { onMount } from 'svelte';
  import { api, ApiError } from '../api';
  import { formatUsd } from '../money';
  import { modelName } from '../../../shared/scenarios';
  import type { ResultVideoDetails } from '../../../shared/display';
  import '../results-prototype/assets/fonts.css';

  let { id, onunauthorized }: { id: string; onunauthorized: () => void } = $props();
  let details = $state<ResultVideoDetails>();
  let error = $state('');
  let mediaError = $state(false);
  let detailsOpen = $state(false);
  const base = $derived('/display/' + encodeURIComponent(id));
  const model = $derived(details?.model ? modelName(details.model) : 'Не указана');

  onMount(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        details = await api<ResultVideoDetails>(base + '/video-details', { signal: controller.signal });
        if (details.costUsd !== null) return;
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) { onunauthorized(); return; }
        if (!details || (cause instanceof ApiError && cause.status === 404)) {
          details = undefined;
          error = cause instanceof Error ? cause.message : 'Не удалось открыть видео.';
          return;
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(load, 10_000);
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  });
</script>

<main class="cinema">
  <div class="wrap">
    <div class="masthead">
      <span class="wordmark"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 2C22 18 18 22 2 24c16 2 20 6 22 22 2-16 6-20 22-22C30 22 26 18 24 2Z"/></svg>REELME</span>
      <a href="/results">К результатам <span aria-hidden="true">↗</span></a>
    </div>
    {#if details}
      <article class="film">
        <div class="screening">
          <video src={'/api' + base + '/video'} aria-label={`Видео генерации № ${details.number}`} controls playsinline autoplay preload="metadata" onerror={() => mediaError = true}>
            <track kind="captions" />
          </video>
          {#if mediaError}<p class="notice" role="alert">Не удалось воспроизвести видео. <a href={location.href}>Попробовать снова</a></p>{/if}
        </div>
        <div class="caption">
          <h1>Генерация № {String(details.number).padStart(3, '0')}</h1>
          <button class="details-toggle" aria-expanded={detailsOpen} aria-controls="generation-details" onclick={() => detailsOpen = !detailsOpen}>Details</button>
          <div id="generation-details" hidden={!detailsOpen}>
            <dl>
              <div><dt>Модель</dt><dd>{details.testVideo ? 'Тестовое видео' : model}</dd></div>
              <div><dt>Цена генерации</dt><dd class="price" aria-live="polite">{details.testVideo ? 'Без списания' : details.costUsd === null ? 'Уточняется' : details.costUsd === undefined ? 'Нет данных' : formatUsd(details.costUsd)}</dd></div>
            </dl>
            {#if details.prompt}
              <dl class="prompt">
                <dt>Промпт генерации</dt>
                <dd>{details.prompt}</dd>
              </dl>
            {/if}
            {#if details.comment}
              <dl class="prompt">
                <dt>Комментарий к слоту</dt>
                <dd>{details.comment}</dd>
              </dl>
            {/if}
          </div>
        </div>
      </article>
    {:else if error}
      <p class="message" role="alert">{error} <a href={location.href}>Повторить</a></p>
    {:else}
      <p class="message" role="status">Открываем видео…</p>
    {/if}
  </div>
</main>

<style>
  .cinema {
    display:grid; align-content:center; min-height:100svh; max-width:none; margin:0;
    padding:clamp(20px,4vw,64px); font-family:Manrope,sans-serif; color:#fff4fb; color-scheme:dark;
    background:radial-gradient(ellipse at 8% 24%,#462239 0,transparent 46%),
      radial-gradient(ellipse at 95% 93%,#38223d 0,transparent 43%),#0d0a13;
  }
  .wrap { width:min(100%,1080px); min-width:0; margin-inline:auto }
  .masthead { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:clamp(18px,3vh,32px) }
  .wordmark { display:inline-flex; align-items:center; gap:12px; font-size:18px; font-weight:800; letter-spacing:.23em }
  .wordmark svg { width:28px; fill:#fff6ff; filter:drop-shadow(0 0 7px #e58dc6) }
  a { color:#ead6e6; text-underline-offset:.25em }
  .masthead a { text-decoration:none; font-size:14px; padding:8px 0 }
  .masthead a:hover { color:#fff; text-decoration:underline }
  a:focus-visible, video:focus-visible, .details-toggle:focus-visible { outline:2px solid #f5a4df; outline-offset:3px }
  .film { margin:0; padding:clamp(6px,1vw,12px); border-radius:24px; border:1px solid transparent;
    background:linear-gradient(135deg,#321e32,#1c1521 58%,#321e30) padding-box,
      linear-gradient(135deg,#f9c1d8,#65455e 18%,#4b354a 72%,#ce83af) border-box;
    box-shadow:0 24px 84px #08050c94 }
  .screening { position:relative; overflow:hidden; background:#08070a; border-radius:16px }
  video { display:block; width:100%; height:auto; max-height:66svh; object-fit:contain; background:#08070a }
  .notice { position:absolute; inset:0; display:grid; place-content:center; text-align:center; background:#17101a; margin:0; padding:1rem }
  .caption { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:baseline; gap:12px; padding:clamp(12px,2vw,24px) }
  .details-toggle { justify-self:end; min-height:32px; padding:6px 2px; border:0; background:transparent; color:#bfa9b9; font:inherit; font-size:12px; cursor:pointer }
  .details-toggle:hover, .details-toggle[aria-expanded="true"] { color:#ead6e6; text-decoration:underline }
  #generation-details { grid-column:1/-1; min-width:0; border-top:1px solid #5b4155; padding-top:16px }
  h1,dt,dd,dl { margin:0 }
  h1 { color:inherit; font-size:clamp(18px,2vw,26px); font-weight:700; letter-spacing:-.035em; line-height:1.1 }
  dt { display:block; color:#d6bdcf; font-size:14px; font-weight:500; letter-spacing:0; line-height:1.5; margin-bottom:4px }
  dl { display:flex; align-items:baseline; gap:clamp(22px,5vw,72px); flex-wrap:wrap }
  dd { font-size:clamp(16px,2vw,23px); font-weight:600; overflow-wrap:anywhere }
  .price { color:#ffc6e5; font-variant-numeric:tabular-nums }
  dl.prompt { display:block; min-width:0; margin-top:16px }
  .prompt dd { max-width:72ch; font-size:1rem; font-weight:400; line-height:1.6; white-space:pre-wrap }
  .message { padding:32px 0; color:#ead6e6 }
  @media(max-width:600px) {
    .cinema { padding:24px 12px }
    .masthead { padding-inline:5px }
    .caption { padding:12px }
    dl { gap:14px 24px }
    .film { border-radius:18px } .screening { border-radius:12px }
  }
</style>
