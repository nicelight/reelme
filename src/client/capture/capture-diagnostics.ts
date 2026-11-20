import type { AttemptReport, CaptureReport, DccReport, ListStats, RequestStats } from '../../shared/capture-report';

type RequestStep = keyof AttemptReport['requests'];
const elapsed = (start: number) => Math.max(0, Math.round(performance.now() - start));
const now = () => new Date().toISOString();
export function safeProblem(error: unknown) {
  const name = error instanceof Error ? error.name : 'UnknownError';
  let message = error instanceof Error ? error.message : '';
  if (error instanceof SyntaxError) {
    // JSON.parse messages can quote the received HTML or a visitor's filename.
    message = 'Invalid JSON' + (message.match(/ at position \d+/)?.[0] ?? '');
  } else if (!/^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|The (?:user aborted|operation was aborted|operation timed out|signal timed out)[\w .]*|Не удалось .*|Камера .*|Failed to decode source image\.?|The source image could not be decoded\.?)$/u.test(message)) {
    message = 'Unrecognized error';
  }
  return { name: /^[A-Za-z]+$/.test(name) ? name.slice(0,64) : 'Error', message: message.slice(0,160) };
}
export class AttemptTrace {
  private started = performance.now();
  private stageStart?: number;
  private completedStages: NonNullable<AttemptReport['stageMs']> = {};
  constructor(readonly report: AttemptReport, private tag: (path: string) => number) {}
  ms() { return elapsed(this.started); }
  enter(stage: AttemptReport['stage']) {
    const at = this.ms();
    this.completedStages = this.stageTimes(at);
    this.stageStart = at;
    this.report.stage = stage;
  }
  stageTimes(at: number) {
    const totals = { ...this.completedStages };
    const stage = this.report.stage;
    if (this.stageStart !== undefined && stage !== 'done') {
      totals[stage] = (totals[stage] ?? 0) + at - this.stageStart;
    }
    return totals;
  }
  request(step: RequestStep) {
    this.enter(step);
    const at = this.ms();
    const previous = this.report.requests[step];
    const stats: RequestStats = { count: (previous?.count ?? 0) + 1, completed: previous?.completed ?? 0,
      firstMs: previous?.firstMs ?? at, lastMs: at, maxMs: previous?.maxMs ?? 0, phase: 'request' };
    this.report.requests[step] = stats;
    return stats;
  }
  list(step: 'baseline' | 'poll', all: { Original: string }[], jpeg: { Original: string }[], baseline?: Set<string>, beforeJpeg?: Set<string>) {
    const paths = new Set(all.map(file => file.Original));
    const eligible = new Set(jpeg.map(file => file.Original));
    const list: ListStats = { total: all.length, jpeg: jpeg.length, duplicatePaths: all.length - paths.size,
      raw: 0, invalidPath: 0, other: 0, newPaths: 0, removedPaths: 0, freshJpeg: 0, added: [] };
    for (const { Original: path } of all) {
      if (eligible.has(path)) continue;
      if (/\.(?:cr2|cr3|nef|arw|dng|raw)$/i.test(path)) list.raw++;
      else if (/\.jpe?g$/i.test(path)) list.invalidPath++;
      else list.other++;
    }
    if (baseline) {
      for (const path of paths) {
        if (baseline.has(path)) continue;
        list.newPaths++;
        if (list.added.length >= 6) continue;
        const extension = path.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ?? 'unknown';
        let reason: ListStats['added'][number]['reason'] = 'not-jpeg';
        if (eligible.has(path)) reason = 'accepted';
        else if (/^jpe?g$/.test(extension)) reason = /[?#]/.test(path) ? 'reserved-character' : 'unexpected-path';
        list.added.push({ tag: this.tag(path), extension, reason });
      }
      for (const path of baseline) if (!paths.has(path)) list.removedPaths++;
    }
    if (beforeJpeg) list.freshJpeg = jpeg.filter(file => !beforeJpeg.has(file.Original)).length;
    if (step === 'baseline') this.report.baseline = list;
    else if (JSON.stringify(list) !== JSON.stringify(this.report.changes.at(-1)?.list)) {
      this.report.listChanges++;
      if (this.report.changes.length === 12) this.report.changes.splice(1, 1);
      this.report.changes.push({ atMs: this.ms(), list });
    }
    return paths;
  }
  bodyRead(stats: RequestStats, bytes: number) {
    stats.bytes = bytes;
    stats.bodyMs = Math.max(0, this.ms() - stats.lastMs - (stats.headersMs ?? 0));
  }
  finishRequest(stats: RequestStats) {
    stats.lastDurationMs = this.ms() - stats.lastMs;
    stats.maxMs = Math.max(stats.maxMs, stats.lastDurationMs);
    stats.phase = 'complete';
    stats.completed++;
  }
}

type Probe = Pick<DccReport, 'values' | 'unavailable' | 'elapsedMs' | 'at'>;
type PreviewState = AttemptReport['preview'];
export class CaptureDiagnostics {
  readonly installation: string;
  private sessionStart = performance.now();
  private frames = 0;
  private frameAt?: number;
  private preview: PreviewState = { frames: 0, open: 'starting', stop: 'none' };
  private visibility: AttemptReport['visibility'] = [];
  private lastShutter?: number;
  private lastSuccess?: number;
  private group?: { id: string; started: number; pose: number; attempts: number; shutter?: number;
    shutterAt?: string; foundMs?: number; failedAt?: number; retryDelayMs?: number };
  private countdownStart?: number;
  private names = new Map<string, number>();
  private initial?: Promise<Probe>;
  private probeRun?: AbortController;
  active?: AttemptTrace;
  constructor(private send: (report: CaptureReport) => void) {
    let id = crypto.randomUUID();
    try {
      const stored = localStorage.getItem('reelme.diagnosticInstallation');
      this.lastShutter = Number(localStorage.getItem('reelme.lastLoggedShutter')) || undefined;
      this.lastSuccess = Number(localStorage.getItem('reelme.lastLoggedSuccess')) || undefined;
      if (stored && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(stored)) id = stored as typeof id;
      else localStorage.setItem('reelme.diagnosticInstallation', id);
    } catch { /* The in-memory id identifies this visit. */ }
    this.installation = id;
    this.visibilityChanged();
  }
  visibilityChanged() {
    this.visibility.push({ at: now(), hidden: document.hidden });
    this.visibility = this.visibility.slice(-12);
  }
  openPreview(start: number, status?: number, error?: unknown) {
    this.preview.openMs = elapsed(start);
    this.preview.openStatus = status;
    this.preview.open = error ? 'failed' : 'accepted';
    if (error) this.stopPreview('error', error, status);
  }
  frame() { this.frames++; this.frameAt = performance.now(); this.preview.stop = 'none'; }
  stopPreview(stop: PreviewState['stop'], error?: unknown, status?: number) {
    // A shutter pause after preview failed must preserve the failure.
    if (!error && this.preview.stop === 'error') return;
    if (stop === 'shutter' && this.preview.stop !== 'none') return;
    this.preview.stop = stop;
    if (error) { this.preview.error = safeProblem(error); this.preview.status = status; }
  }
  fileTag(path: string) {
    const basename = path.split(/[\\/]/).at(-1)!;
    if (!this.names.has(basename)) this.names.set(basename, this.names.size + 1);
    return this.names.get(basename)!;
  }
  countdown() { this.countdownStart = performance.now(); }
  retryRequested() {
    if (this.group?.failedAt !== undefined) this.group.retryDelayMs = elapsed(this.group.failedAt);
  }
  begin(pose: number, automatic: boolean, command: AttemptReport['command'], budgetMs: number, retry: boolean) {
    if (this.group?.pose !== pose || (!retry && command !== 'resume')) {
      this.group = { id: crypto.randomUUID(), started: performance.now(), pose, attempts: 0 };
    }
    const group = this.group!;
    const report: AttemptReport = {
      id: crypto.randomUUID(), caseId: group.id, installation: this.installation, pose, attempt: ++group.attempts,
      at: now(), offsetMinutes: new Date().getTimezoneOffset(), kind: 'attempt', outcome: 'ok', elapsedMs: 0,
      budgetMs, sinceCaseMs: elapsed(group.started), sessionAgeMs: elapsed(this.sessionStart),
      retryDelayMs: retry ? group.retryDelayMs : undefined,
      countdownMs: this.countdownStart === undefined ? undefined : elapsed(this.countdownStart),
      sinceLastShutterMs: this.lastShutter === undefined ? undefined : Math.max(0, Date.now() - this.lastShutter),
      sinceLastSuccessMs: this.lastSuccess === undefined ? undefined : Math.max(0, Date.now() - this.lastSuccess),
      mode: automatic ? 'automatic' : 'manual', command, stage: 'baseline', pending: false,
      build: new URL(import.meta.url).pathname.split('/').pop()!.slice(0,160),
      browser: navigator.userAgent.slice(0,160), navigation: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.type ?? 'unknown',
      visibility: [...this.visibility], preview: { ...this.preview, frames: this.frames,
        lastFrameAgeMs: this.frameAt === undefined ? undefined : elapsed(this.frameAt) },
      requests: {}, changes: [], listChanges: 0,
    };
    this.countdownStart = undefined;
    this.active = new AttemptTrace(report, path => this.fileTag(path));
    return this.active;
  }
  shutter() {
    if (this.group) {
      this.group.shutter = performance.now();
      this.group.shutterAt = now();
    }
    this.lastShutter = Date.now();
    try { localStorage.setItem('reelme.lastLoggedShutter', String(this.lastShutter)); } catch { /* Use the current visit. */ }
  }
  found() {
    if (this.group?.shutter !== undefined) this.group.foundMs = elapsed(this.group.shutter);
  }
  private snapshot(trace: AttemptTrace): AttemptReport {
    const report = structuredClone(trace.report);
    report.elapsedMs = trace.ms();
    report.stageMs = trace.stageTimes(report.elapsedMs);
    const step = report.stage;
    const stats = step === 'baseline' || step === 'command' || step === 'poll' || step === 'download' ? report.requests[step] : undefined;
    if (stats && stats.phase !== 'complete') {
      stats.lastDurationMs = report.elapsedMs - stats.lastMs;
      stats.maxMs = Math.max(stats.maxMs, stats.lastDurationMs);
      if (stats.phase === 'body' && stats.headersMs !== undefined) stats.bodyMs = Math.max(0, stats.lastDurationMs - stats.headersMs);
    }
    report.visibility = [...this.visibility];
    if (this.group?.shutter !== undefined) {
      report.shutterAt = this.group.shutterAt;
      report.sinceShutterMs = elapsed(this.group.shutter);
      report.shutterToFoundMs = this.group.foundMs;
    }
    return report;
  }
  finish(trace: AttemptTrace, outcome: AttemptReport['outcome'], pending: boolean, error?: unknown) {
    if (trace !== this.active) return;
    this.active = undefined;
    const report = this.snapshot(trace);
    if (outcome === 'error' && this.group) this.group.failedAt = performance.now();
    report.outcome = outcome;
    report.pending = pending;
    if (error) report.error = safeProblem(error);
    if (outcome === 'ok') {
      this.lastSuccess = Date.now();
      try { localStorage.setItem('reelme.lastLoggedSuccess', String(this.lastSuccess)); } catch { /* Use the current visit. */ }
    }
    this.send(report);
    if (this.initial) { this.sendProbe(this.initial, report, 'start'); this.initial = undefined; }
    if (outcome === 'error') this.sendProbe(this.probe(), report, 'error');
  }
  pageHidden(pending: boolean) {
    if (!this.active) return;
    this.send({ ...this.snapshot(this.active), id: crypto.randomUUID(), outcome: 'pagehide', pending });
  }
  start() { this.initial = this.probe(); }
  stopProbe() { this.probeRun?.abort(); }
  private sendProbe(probe: Promise<Probe>, attempt: AttemptReport, trigger: DccReport['trigger']) {
    void probe.then(result => this.send({
      id: crypto.randomUUID(), caseId: attempt.caseId, attempt: attempt.attempt, installation: this.installation,
      pose: attempt.pose, offsetMinutes: attempt.offsetMinutes, kind: 'camera-settings', trigger, ...result,
    })).catch(() => {});
  }
  private async probe(): Promise<Probe> {
    this.stopProbe();
    const controller = this.probeRun = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3500)]);
    const started = performance.now();
    const result: Probe = { values: {}, unavailable: [], elapsedMs: 0, at: now() };
    let session: string | undefined;
    const fields = ['lastcaptured','session','camera.session','transfer','compressionsetting','shutterspeed','focusmode',
      'property.devicename','liveview.capturedelay','liveview.capturecount','liveview.autofocusbeforcapture'];
    for (const field of fields) {
      try {
        signal.throwIfAborted();
        const response = await fetch('/?slc=get&param1=' + field, { credentials: 'omit', cache: 'no-store', signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const value = (await response.text()).trim();
        if (!value || value.length > 160 || /[<>\r\n]|^OK$|unknown|unknow|not set|not found|exception|error|wrong|unable|invalid|not connected/i.test(value)) throw new Error('unsupported');
        if (field === 'lastcaptured') result.values.lastCaptured = value === '-' ? 'pending-or-unknown' : 'file-' + this.fileTag(value);
        else if (field === 'session') session = value;
        else if (field === 'camera.session') { if (session !== undefined) result.values.sameSession = value === session; }
        else {
          // Accept short scalar settings only. A shutter fraction is the only value with a slash.
          if (!/^[\p{L}\p{N} .,+_()'":-]{1,64}$/u.test(value) && !(field === 'shutterspeed' && /^\d+\/\d+$/.test(value))) throw new Error('unsupported');
          const keys = { transfer:'transfer', compressionsetting:'compression', shutterspeed:'shutterSpeed', focusmode:'focus',
            'property.devicename':'cameraModel','liveview.capturedelay':'delay','liveview.capturecount':'captureCount','liveview.autofocusbeforcapture':'autofocus' } as const;
          result.values[keys[field as keyof typeof keys]] = value;
        }
      } catch (error) {
        result.unavailable.push(field + ' ' + (signal.aborted ? 'interrupted' : error instanceof Error && /^HTTP \d{3}$/.test(error.message) ? error.message : 'unavailable'));
      }
    }
    result.elapsedMs = elapsed(started);
    return result;
  }
}
