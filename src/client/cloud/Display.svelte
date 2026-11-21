<script lang="ts">
  /** Admits decoded cards in readiness order. A failed six-second window moves
   * the card behind current waiters; its last window starts when they are admitted,
   * not when their animations finish. Deprecated cards stay local until reload.
   * Polling cannot start another load for an active or deprecated id. Date/unmount
   * cancellation and generation checks reject completions from the previous screen.
   * Confirmed manual hides take precedence over active page snapshots, in-flight
   * loads and older polls. A hidden result keeps its guest delivery and archive. */
  import { onMount } from 'svelte';
  import { api, ApiError } from './api';
  import type { DisplaySession, TodayDisplay } from '../../shared/display';
  import ResultsScreen from './results/ResultsScreen.svelte';
  import { ResultsQueue } from './results/state';
  import { ProgressSlots } from './results/progress';
  import { CardLoadError, loadCardImages, preloadStage } from './results/preload';
  import './results-prototype/assets/fonts.css';
  let { onunauthorized }: { onunauthorized: () => void } = $props();
  let sessions = $state<Record<string, DisplaySession>>({});
  let error = $state('');
  let stageError = $state('');
  let progress = $state<(DisplaySession | null)[]>([]);
  let issues = $state<DisplaySession[]>([]);
  let loadStates = $state<Record<string, 'delayed' | 'deprecated'>>({});
  const publicScreen = location.pathname === '/results';
  let resourcesReady = $state(false);
  let reduced = $state(false);
  let revision = $state(0);
  let queue = new ResultsQueue();
  let headerSlots = new ProgressSlots();
  let hiddenIds = $state<string[]>([]);
  let displayEventKey = $state('');
  let hideCard: (id: string) => Promise<void>;
  let setQrOpen: (open: boolean) => void;
  let nextPage: () => void;
  const decoded = new Map<string, Awaited<ReturnType<typeof loadCardImages>>>();
  const scene = $derived.by(() => {
    revision;
    return { cells: [...queue.cells], phase: queue.phase, page: queue.page, pageCount: queue.pageCount,
      pageVersion: queue.pageVersion, completedIds: [...queue.hatched], moving: queue.movingUntil !== null,
      leaving: queue.leavingUntil !== null, entering: queue.enteringUntil !== null,
      canAdvance: queue.paged && queue.leavingUntil === null && queue.enteringUntil === null };
  });
  onMount(() => {
    let stopped = false;
    const lifecycle = new AbortController();
    let initialized = false;
    let firstIds: Set<string> | undefined;
    let projection: TodayDisplay | undefined;
    let anchor = 0;
    let anchorClock = 0;
    let generation = 0;
    let resourceLifetime = new AbortController();
    let order = 0;
    let stageImage: HTMLImageElement | undefined;
    let stageLoading = false;
    let stageRetryAt = 0;
    let poll: ReturnType<typeof setTimeout>;
    let expiry: ReturnType<typeof setTimeout>;
    let wake: ReturnType<typeof setTimeout>;
    let pausedAt: number | null = document.hidden ? performance.now() : null;
    let qrOpen = false;
    const hidden = new Set<string>();
    const loads = new Map<string, { state: 'loading' | 'delayed' | 'retry' | 'ready' | 'deprecated'; order: number }>();
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = media.matches; queue.reduced = reduced;
    const serverNow = () => anchor + performance.now() - anchorClock;
    const serverReadySessions = () => (projection?.sessions ?? []).filter(item => item.card && (item.hideAt === null || item.hideAt > serverNow()))
      .sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0) || a.number - b.number || a.id.localeCompare(b.id));
    const readySessions = () => serverReadySessions().filter(item => loads.get(item.id)?.state !== 'deprecated')
      .sort((a, b) => (loads.get(a.id)?.order ?? 0) - (loads.get(b.id)?.order ?? 0));
    function withImages(item: DisplaySession): DisplaySession {
      const images = decoded.get(item.id);
      return images && item.card ? { ...item, card: { ...item.card, frameUrl: images.frameUrl, qrUrl: images.qrUrl } } : item;
    }
    function excludeHidden(ids: string[]) {
      const previousSize = hidden.size;
      for (const id of ids) {
        if (hidden.has(id)) continue;
        hidden.add(id);
        queue.hide(id);
        loads.delete(id);
        decoded.delete(id);
      }
      if (hidden.size !== previousSize) hiddenIds = [...hidden];
      if (projection && hidden.size) projection.sessions = projection.sessions.filter(item => !hidden.has(item.id));
    }
    hideCard = async id => {
      const epoch = generation;
      await api(`/display/${encodeURIComponent(id)}/hide`, {
        method: 'POST', signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15_000)]),
      });
      if (stopped || generation !== epoch) return;
      excludeHidden([id]);
      updateProgress();
      reconcile();
    };
    function updateProgress() {
      const states: typeof loadStates = {};
      for (const [id, entry] of loads) {
        if (entry.state === 'deprecated') states[id] = 'deprecated';
        else if (entry.state === 'delayed' || entry.state === 'retry') states[id] = 'delayed';
      }
      loadStates = states;
      const failed = new Set([...loads].filter(([, entry]) => entry.state === 'deprecated').map(([id]) => id));
      progress = headerSlots.sync([...(projection?.sessions ?? [])].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id)), failed);
    }
    function publish() {
      revision++;
      // Keep current page metadata/decoded resources even after API expiry.
      const retain = new Set([...queue.cells, ...queue.circular, ...queue.pending]);
      const next = { ...sessions };
      for (const id of Object.keys(next)) if (!retain.has(id) && !projection?.sessions.some(item => item.id === id)) delete next[id];
      sessions = next;
      for (const id of decoded.keys()) if (!retain.has(id) && !projection?.sessions.some(item => item.id === id)) decoded.delete(id);
      clearTimeout(wake);
      if (pausedAt === null) {
        const now = performance.now(); const next = queue.nextWake(now);
        if (next !== null) wake = setTimeout(() => { queue.advance(performance.now()); publish(); }, Math.max(1, next - now));
      }
    }
    function reconcile() {
      if (stopped || !resourcesReady || !projection) return;
      const live = readySessions();
      // Readiness order changes only when a failed window moves its card to the tail.
      let blocked = false;
      let retry: DisplaySession | undefined;
      const available = live.filter(item => {
        if (queue.seen.has(item.id)) return decoded.has(item.id);
        if (!decoded.has(item.id)) {
          if (!blocked && loads.get(item.id)?.state === 'delayed') retry = item;
          blocked = true; return false;
        }
        return !blocked;
      });
      const now = pausedAt ?? performance.now();
      if (!initialized) {
        if (document.hidden) return;
        // First response is one bootstrap snapshot; do not hatch old results simply
        // because one image was slower to decode than another.
        if (live.some(item => firstIds?.has(item.id) && loads.get(item.id)?.state === 'loading')) return;
        queue.bootstrap(available.filter(item => firstIds?.has(item.id)).map(item => item.id), now);
        initialized = true;
      }
      queue.sync(available.map(item => item.id), now, pausedAt === null, firstIds);
      publish();
      if (retry) void prepare(retry, true);
    }
    function updateExpiry() {
      clearTimeout(expiry);
      if (!projection) return;
      const deadline = projection.sessions.map(item => item.hideAt).filter((value): value is number => value !== null && value > serverNow()).sort((a, b) => a - b)[0];
      if (deadline !== undefined) expiry = setTimeout(() => { reconcile(); updateExpiry(); }, Math.max(1, deadline - serverNow()));
    }
    async function prepareStage() {
      if (stopped || resourcesReady || stageLoading || performance.now() < stageRetryAt) return;
      stageLoading = true;
      try {
        const image = await preloadStage();
        if (stopped) return;
        stageImage = image; resourcesReady = true; stageError = ''; reconcile();
      } catch {
        if (!stopped) {
          stageError = 'Не удалось подготовить экран. Повторяем загрузку…';
          stageRetryAt = performance.now() + 5000;
        }
      } finally { stageLoading = false; }
    }
    async function prepare(item: DisplaySession, retry = false) {
      if (!item.card) return;
      const existing = loads.get(item.id);
      if (retry ? existing?.state !== 'delayed' : existing !== undefined) return;
      const entry = existing ?? { state: 'loading' as const, order: ++order };
      if (retry) entry.state = 'retry';
      loads.set(item.id, entry);
      const epoch = generation;
      const signal = AbortSignal.any([lifecycle.signal, resourceLifetime.signal]);
      try {
        const images = await loadCardImages(item.card, signal, retry);
        if (stopped || epoch !== generation || signal.aborted || loads.get(item.id) !== entry) return;
        entry.state = 'ready'; decoded.set(item.id, images);
        const current = projection?.sessions.find(value => value.id === item.id) ?? item;
        sessions = { ...sessions, [item.id]: withImages(current) };
        updateProgress();
        reconcile();
      } catch (cause) {
        if (stopped || epoch !== generation || signal.aborted || loads.get(item.id) !== entry) return;
        if (!serverReadySessions().some(value => value.id === item.id)) return;
        if (!retry) { entry.state = 'delayed'; entry.order = ++order; }
        else {
          entry.state = 'deprecated';
          void api(`/display/${encodeURIComponent(item.id)}/load-failure`, {
            method: 'POST', signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15_000)]),
            body: JSON.stringify({ attempts: 4, reason: cause instanceof CardLoadError ? cause.reason : 'image' }),
          }).catch(() => {});
        }
        updateProgress(); reconcile();
      }
    }
    async function refresh() {
      const started = performance.now();
      try {
        const next = await api<TodayDisplay>('/display/today', { signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15_000)]) });
        if (stopped) return;
        const screenKey = next.eventKey === undefined ? next.date : next.eventKey ?? `${next.date}:closed`;
        if (displayEventKey && displayEventKey !== screenKey) {
          resourceLifetime.abort(); resourceLifetime = new AbortController();
          generation++; headerSlots = new ProgressSlots(); queue = new ResultsQueue(); queue.reduced = reduced; decoded.clear(); loads.clear(); loadStates = {}; sessions = {}; order = 0;
          initialized = false; firstIds = undefined; hidden.clear(); hiddenIds = [];
        }
        displayEventKey = screenKey; projection = next; anchor = next.serverNow; anchorClock = started;
        excludeHidden(next.hiddenIds ?? []);
        queue.duration = next.pageDurationSeconds * 1000;
        firstIds ??= new Set(serverReadySessions().map(item => item.id));
        error = '';
        issues = next.sessions.filter(item => item.error || item.simulation && item.simulation.status !== 'pending');
        updateProgress();
        const updated = { ...sessions }; next.sessions.forEach(item => { updated[item.id] = withImages(item); }); sessions = updated;
        serverReadySessions().forEach(item => void prepare(item));
        reconcile(); updateExpiry();
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
          stopped = true; lifecycle.abort(); clearTimeout(wake); clearTimeout(expiry); sessions = {}; onunauthorized(); return;
        }
        error = 'Нет связи с сервером. Повторяем подключение…';
      } finally {
        if (!stopped) {
          // Reuse the API polling loop for recovery; never run parallel stage loads.
          void prepareStage();
          poll = setTimeout(refresh, 2000);
        }
      }
    }
    function visibility() {
      if (stopped) return;
      const paused = document.hidden || qrOpen;
      if (paused === (pausedAt !== null)) return;
      const now = performance.now();
      if (paused) { pausedAt = now; clearTimeout(wake); }
      else {
        queue.shiftTime(now - pausedAt!);
        pausedAt = null;
        reconcile();
      }
      document.querySelectorAll('.results-shell .bloom,.results-shell .egg-scene img,.results-shell .grid').forEach(node => node.getAnimations().forEach(animation => { if (paused) animation.pause(); else animation.play(); }));
    }
    setQrOpen = open => { qrOpen = open; visibility(); };
    nextPage = () => {
      if (pausedAt !== null) return;
      queue.nextPage(performance.now());
      publish();
    };
    function preference() { reduced = media.matches; queue.reduced = reduced; if (pausedAt === null) queue.advance(performance.now()); publish(); }
    media.addEventListener('change', preference); document.addEventListener('visibilitychange', visibility);
    void prepareStage();
    void refresh();
    return () => {
      lifecycle.abort();
      stopped = true; generation++; clearTimeout(poll); clearTimeout(expiry); clearTimeout(wake); decoded.clear(); stageImage = undefined;
      media.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility);
    };
  });
</script>
<ResultsScreen {...scene} {sessions} {reduced} {resourcesReady} error={stageError || error} {progress} {loadStates}
  {displayEventKey} {hiddenIds} onhide={id => hideCard(id)} getQr={id => decoded.get(id)?.qr}
  onqrchange={open => setQrOpen(open)} onnextpage={() => nextPage()} />

{#if !publicScreen && issues.length}
  <section class="operator-issues" aria-label="Сообщения обработки">
    {#each issues as item (item.id)}
      <p data-issue-session={item.number}><strong>№ {String(item.number).padStart(3, '0')}</strong> — {item.simulation?.message ?? item.error}{#if item.simulation?.detail}<span> · {item.simulation.detail}</span>{/if}</p>
    {/each}
  </section>
{/if}
<style>
  .operator-issues { padding:12px 24px; color:var(--text); background:var(--surface); border-top:1px solid var(--line); font-size:14px; }
  .operator-issues p { margin:6px 0; }
</style>
