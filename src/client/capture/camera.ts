/** Module contract: the local digiCamControl adapter owns one outstanding shutter
 * request. It compares file lists and returns original JPEG bytes, never mirrors
 * them or sends installation credentials. Retry resumes the same pending file;
 * an uncertain shutter response must not trigger another exposure or a new pose.
 * Source: docs/slot-setup/matrix.md. Nonrepeating filenames and exclusive control of the camera are prerequisites. */
import type { AttemptTrace, CaptureDiagnostics } from './capture-diagnostics';
import type { RequestStats } from '../../shared/capture-report';
export class CameraError extends Error {
  constructor(message: string, readonly status?: number, options?: ErrorOptions) { super(message, options); this.name = 'CameraError'; }
}
const originalJpeg = /^\/image\/[^/\\?#]+\.jpe?g$/i;
const pendingFrameMessage = 'Снимок пока не получен. Нажмите «Повторить», чтобы дождаться этого кадра. Если камера не сняла, позовите сотрудника.';
interface CameraFile { FileName: string; Original: string }
interface Pending { key: string; before: Set<string>; original?: string; rawBefore?: Set<string> }
export class DigiCamControl {
  private pending?: Pending;
  private busy = false;
  get hasPendingCapture(): boolean { return this.pending !== undefined; }
  constructor(private fetcher: typeof fetch = (input, init) => fetch(input, init), private waitMs = 30_000, private pollMs = 500, private diagnostics?: CaptureDiagnostics) {}
  private async get(path: string, signal: AbortSignal, stats?: RequestStats) {
    const started = performance.now();
    const response = await this.fetcher(path, { cache: 'no-store', credentials: 'omit', signal });
    if (stats) {
      stats.phase = 'headers';
      stats.headersMs = Math.round(performance.now() - started);
      stats.status = response.status;
      stats.type = response.headers.get('content-type')?.split(';')[0].slice(0,80);
      const length = response.headers.get('content-length');
      if (length && /^\d{1,12}$/.test(length)) stats.expectedBytes = Number(length);
    }
    if (!response.ok) throw new CameraError('Не удалось получить ответ камеры. Проверьте подключение и нажмите «Повторить».', response.status);
    return response;
  }
  private async files(signal: AbortSignal, step: 'poll' | 'baseline', trace?: AttemptTrace) {
    const stats = trace?.request(step);
    const response = await this.get('/filelist.json', signal, stats);
    if (stats) stats.phase = 'body';
    const bytes = await response.arrayBuffer();
    if (stats) {
      trace!.bodyRead(stats, bytes.byteLength);
      stats.phase = 'parse';
    }
    if (step === 'poll' && response.status === 200 && bytes.byteLength === 0) {
      return { jpeg: [], emptyBody: true };
    }
    const files: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(files) || files.some(file => typeof file?.FileName !== 'string' || typeof file?.Original !== 'string')) {
      throw new CameraError('Не удалось прочитать список снимков. Нажмите «Повторить».');
    }
    const all = files as CameraFile[];
    const jpeg = all.filter(file => originalJpeg.test(file.Original));
    if (stats) trace!.finishRequest(stats);
    const paths = trace?.list(step, all, jpeg, this.pending?.rawBefore, this.pending?.before);
    return { jpeg, paths, emptyBody: false };
  }
  async startLiveView(signal: AbortSignal) {
    const started = performance.now();
    try {
      const response = await this.get('/liveview.html?CMD=LiveViewWnd_Show', AbortSignal.any([signal, AbortSignal.timeout(5000)]));
      this.diagnostics?.openPreview(started, response.status);
    } catch (error) {
      if (!signal.aborted) this.diagnostics?.openPreview(started, error instanceof CameraError ? error.status : undefined, error);
      throw error;
    }
  }
  async preview(signal: AbortSignal): Promise<Blob> {
    return this.jpeg('/liveview.jpg', AbortSignal.any([signal, AbortSignal.timeout(5000)]));
  }
  private async jpeg(path: string, signal: AbortSignal, trace?: AttemptTrace) {
    const stats = trace?.request('download');
    const response = await this.get(path, signal, stats);
    if (stats) stats.phase = 'body';
    const blob = await response.blob();
    if (stats && trace) {
      trace.bodyRead(stats, blob.size);
      trace.finishRequest(stats);
      trace.enter('verify');
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      if (trace) trace.report.signatureOk = false;
      throw new CameraError('Камера ещё не передала корректный JPEG. Нажмите «Повторить».');
    }
    if (trace) trace.report.signatureOk = true;
    const jpeg = new Blob([blob], { type: 'image/jpeg' });
    // Decode in the browser before accepting a file; retain the original bytes.
    if (typeof createImageBitmap === 'function') {
      trace?.enter('decode');
      try { (await createImageBitmap(jpeg)).close(); if (trace) trace.report.decoded = true; }
      catch (cause) {
        if (trace) trace.report.decoded = false;
        throw new CameraError('Камера передала повреждённый JPEG. Нажмите «Повторить».', undefined, { cause });
      }
    }
    return jpeg;
  }
  async capture(sessionId: string, poseIndex: number, liveView: boolean, signal: AbortSignal, automatic = false, retry = false): Promise<Blob> {
    const key = `${sessionId}:${poseIndex}`;
    if (this.busy || (this.pending && this.pending.key !== key)) throw new CameraError('Сначала завершите получение текущего снимка.');
    this.busy = true;
    const command = liveView ? 'LiveView_Capture' : 'Capture';
    this.diagnostics?.stopProbe();
    const trace = this.diagnostics?.begin(poseIndex, automatic, this.pending ? 'resume' : command, this.waitMs, retry);
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(this.waitMs)]);
    try {
      if (!this.pending) {
        const baseline = await this.files(timeout, 'baseline', trace);
        this.pending = { key, before: new Set(baseline.jpeg.map(file => file.Original)), rawBefore: baseline.paths };
        // Record before dispatch: a lost response may still mean an exposure.
        const stats = trace?.request('command');
        this.diagnostics?.shutter();
        await this.get('/?CMD=' + command, timeout, stats);
        if (trace && stats) trace.finishRequest(stats);
      }
      let recoveryDelays: number[] | undefined;
      while (!this.pending.original) {
        const list = await this.files(timeout, 'poll', trace);
        const fresh = list.jpeg.filter(file => !this.pending!.before.has(file.Original));
        if (fresh.length > 1) throw new CameraError('Камера вернула несколько новых снимков. Позовите сотрудника для проверки камеры.');
        if (fresh[0]) {
          this.pending.original = fresh[0].Original;
          this.diagnostics?.found();
          if (trace) { trace.report.foundMs = trace.ms(); trace.report.remainingMs = Math.max(0, this.waitMs - trace.ms()); }
        } else {
          // DCC can briefly serve a zero-byte HTTP 200 while publishing the new JPEG.
          if (list.emptyBody) recoveryDelays ??= [300, 1000];
          const delay = recoveryDelays ? recoveryDelays.shift() : this.pollMs;
          if (delay === undefined) throw new CameraError(pendingFrameMessage);
          trace?.enter('wait');
          await pause(delay, timeout);
        }
      }
      if (trace) trace.report.fileTag = this.diagnostics!.fileTag(this.pending.original);
      const blob = await this.jpeg(this.pending.original, timeout, trace);
      this.pending = undefined;
      if (trace) { trace.enter('done'); this.diagnostics!.finish(trace, 'ok', false); }
      return blob;
    } catch (error) {
      if (trace) {
        if (timeout.aborted) trace.report.abort = signal.aborted ? 'lifecycle' : 'timeout';
        this.diagnostics!.finish(trace, signal.aborted ? 'aborted' : 'error', !!this.pending, error instanceof Error ? error.cause ?? error : error);
      }
      if (signal.aborted) throw error;
      if (error instanceof CameraError) throw error;
      throw new CameraError(this.pending
        ? pendingFrameMessage
        : 'Нет связи с камерой. Проверьте подключение и нажмите «Повторить».');
    } finally { this.busy = false; }
  }
}
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
