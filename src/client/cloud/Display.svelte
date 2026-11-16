<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from './api';
  import type { DisplaySession, TodayDisplay } from '../../shared/display';
  import ResultsScreen from './results/ResultsScreen.svelte';
  import { ResultsQueue } from './results/state';
  import { ProgressSlots } from './results/progress';
  import { decodeImage, preloadStage } from './results/preload';
  import './results-prototype/assets/fonts.css';
  let { onunauthorized }: { onunauthorized: () => void } = $props();
  let sessions = $state<Record<string, DisplaySession>>({});
  let error = $state('');
  let progress = $state<(DisplaySession | null)[]>([]);
  let issues = $state<DisplaySession[]>([]);
  const publicScreen = new URLSearchParams(location.search).get('screen') === 'results';
  let resourcesReady = $state(false);
  let reduced = $state(false);
  let revision = $state(0);
  let queue = new ResultsQueue();
  let headerSlots = new ProgressSlots();
  const scene = $derived.by(() => {
    revision;
    return { cells: [...queue.cells], phase: queue.phase, page: queue.page, pageCount: queue.pageCount,
      pageVersion: queue.pageVersion, completedIds: [...queue.hatched], moving: queue.movingUntil !== null,
      leaving: queue.leavingUntil !== null, entering: queue.enteringUntil !== null };
  });
  onMount(() => {
    let stopped = false;
    let initialized = false;
    let firstIds: Set<string> | undefined;
    let currentDate: string | undefined;
    let projection: TodayDisplay | undefined;
    let anchor = 0;
    let anchorClock = 0;
    let generation = 0;
    let stageImage: HTMLImageElement | undefined;
    let poll: ReturnType<typeof setTimeout>;
    let expiry: ReturnType<typeof setTimeout>;
    let wake: ReturnType<typeof setTimeout>;
    let hiddenAt: number | null = document.hidden ? performance.now() : null;
    const decoded = new Map<string, { frame: HTMLImageElement; qr: HTMLImageElement; urls: string }>();
    const loading = new Set<string>();
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = media.matches; queue.reduced = reduced;
    const serverNow = () => anchor + performance.now() - anchorClock;
    const readySessions = () => (projection?.sessions ?? []).filter(item => item.card && (item.hideAt === null || item.hideAt > serverNow()))
      .sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0) || a.number - b.number || a.id.localeCompare(b.id));
    function publish() {
      revision++;
      // Keep current page metadata/decoded resources even after API expiry.
      const retain = new Set([...queue.cells, ...queue.circular, ...queue.pending]);
      const next = { ...sessions };
      for (const id of Object.keys(next)) if (!retain.has(id) && !projection?.sessions.some(item => item.id === id)) delete next[id];
      sessions = next;
      for (const id of decoded.keys()) if (!retain.has(id) && !projection?.sessions.some(item => item.id === id)) decoded.delete(id);
      clearTimeout(wake);
      if (!document.hidden) {
        const now = performance.now(); const next = queue.nextWake(now);
        if (next !== null) wake = setTimeout(() => { queue.advance(performance.now()); publish(); }, Math.max(1, next - now));
      }
    }
    function reconcile() {
      if (stopped || !resourcesReady || !projection) return;
      const live = readySessions();
      // A slower first result must not be overtaken by a later decoded result.
      let blocked = false;
      const available = live.filter(item => {
        if (queue.seen.has(item.id)) return decoded.has(item.id);
        if (!decoded.has(item.id)) { blocked = true; return false; }
        return !blocked;
      });
      const now = performance.now();
      if (!initialized) {
        if (document.hidden) return;
        // First response is one bootstrap snapshot; do not hatch old results simply
        // because one image was slower to decode than another.
        if (live.some(item => firstIds?.has(item.id) && !decoded.has(item.id))) return;
        queue.bootstrap(available.filter(item => firstIds?.has(item.id)).map(item => item.id), now);
        initialized = true;
      }
      queue.sync(available.map(item => item.id), now, !document.hidden);
      publish();
    }
    function updateExpiry() {
      clearTimeout(expiry);
      if (!projection) return;
      const deadline = projection.sessions.map(item => item.hideAt).filter((value): value is number => value !== null && value > serverNow()).sort((a, b) => a - b)[0];
      if (deadline !== undefined) expiry = setTimeout(() => { reconcile(); updateExpiry(); }, Math.max(1, deadline - serverNow()));
    }
    async function prepare(item: DisplaySession) {
      if (!item.card || loading.has(item.id)) return;
      const urls = `${item.card.frameUrl}\n${item.card.qrUrl}`;
      if (decoded.get(item.id)?.urls === urls) return;
      const epoch = generation; loading.add(item.id);
      try {
        const [frame, qr] = await Promise.all([decodeImage(item.card.frameUrl), decodeImage(item.card.qrUrl)]);
        if (stopped || epoch !== generation) return;
        decoded.set(item.id, { frame, qr, urls });
        sessions = { ...sessions, [item.id]: item };
        reconcile();
      } catch {
        if (!stopped && epoch === generation) error = 'Подготавливаем изображения. Повторяем загрузку…';
      } finally { if (epoch === generation) loading.delete(item.id); }
    }
    async function refresh() {
      const started = performance.now();
      try {
        const next = await api<TodayDisplay>('/display/today');
        if (stopped) return;
        if (currentDate !== undefined && currentDate !== next.date) {
          generation++; headerSlots = new ProgressSlots(); queue = new ResultsQueue(); queue.reduced = reduced; decoded.clear(); loading.clear(); sessions = {};
          initialized = false; firstIds = undefined;
        }
        currentDate = next.date; projection = next; anchor = next.serverNow; anchorClock = started;
        queue.duration = next.pageDurationSeconds * 1000;
        firstIds ??= new Set(readySessions().map(item => item.id));
        error = '';
        issues = next.sessions.filter(item => item.error || item.simulation && item.simulation.status !== 'pending');
        progress = headerSlots.sync([...next.sessions].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id)));
        const updated = { ...sessions }; next.sessions.forEach(item => { updated[item.id] = item; }); sessions = updated;
        readySessions().forEach(item => void prepare(item));
        reconcile(); updateExpiry();
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
          stopped = true; clearTimeout(wake); clearTimeout(expiry); sessions = {}; onunauthorized(); return;
        }
        error = 'Нет связи с сервером. Повторяем подключение…';
      } finally { if (!stopped) poll = setTimeout(refresh, 2000); }
    }
    function visibility() {
      const now = performance.now();
      if (document.hidden) { hiddenAt = now; clearTimeout(wake); }
      else {
        if (hiddenAt !== null) queue.shiftTime(now - hiddenAt);
        hiddenAt = null; reconcile();
      }
      document.querySelectorAll('.results-shell .bloom,.results-shell .egg-scene img,.results-shell .grid').forEach(node => node.getAnimations().forEach(animation => { if (document.hidden) animation.pause(); else animation.play(); }));
    }
    function preference() { reduced = media.matches; queue.reduced = reduced; queue.advance(performance.now()); publish(); }
    media.addEventListener('change', preference); document.addEventListener('visibilitychange', visibility);
    void preloadStage().then(image => {
      if (stopped) return;
      stageImage = image; resourcesReady = true; reconcile();
    }).catch(() => { if (!stopped) error = 'Не удалось подготовить экран. Обновите страницу.'; });
    void refresh();
    return () => {
      stopped = true; generation++; clearTimeout(poll); clearTimeout(expiry); clearTimeout(wake); decoded.clear(); stageImage = undefined;
      media.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility);
    };
  });
</script>
<ResultsScreen {...scene} {sessions} {reduced} {resourcesReady} {error} {progress} />

{#if !publicScreen && issues.length}
  <section class="operator-issues" aria-label="Сообщения обработки">
    {#each issues as item (item.id)}
      <p data-issue-session={item.number}><strong>№ {String(item.number).padStart(3, '0')}</strong> — {item.simulation?.message ?? item.error}{#if item.simulation?.detail} <span>{item.simulation.detail}</span>{/if}</p>
    {/each}
  </section>
{/if}
<style>
  .operator-issues { padding:12px 24px; color:var(--text); background:var(--surface); border-top:1px solid var(--line); font-size:14px; }
  .operator-issues p { margin:6px 0; }
</style>
