/** Module contract: the local digiCamControl adapter owns one outstanding shutter
 * request. It compares file lists and returns original JPEG bytes, never mirrors
 * them or sends installation credentials. Retry resumes the same pending file;
 * an uncertain shutter response must not trigger another exposure or a new pose.
 * Nonrepeating filenames and exclusive control of the camera are prerequisites. */
export class CameraError extends Error {}
interface CameraFile { FileName: string; Original: string }
interface Pending { key: string; before: Set<string>; original?: string }
export class DigiCamControl {
  private pending?: Pending;
  private busy = false;
  constructor(private fetcher: typeof fetch = (input, init) => fetch(input, init), private waitMs = 30_000, private pollMs = 500) {}
  private async get(path: string, signal: AbortSignal) {
    const response = await this.fetcher(path, { cache: 'no-store', credentials: 'omit', signal });
    if (!response.ok) throw new CameraError('Не удалось получить ответ камеры. Проверьте подключение и нажмите «Повторить».');
    return response;
  }
  private async files(signal: AbortSignal): Promise<CameraFile[]> {
    const files: unknown = await (await this.get('/filelist.json', signal)).json();
    if (!Array.isArray(files) || files.some(file => typeof file?.FileName !== 'string' || typeof file?.Original !== 'string')) {
      throw new CameraError('Не удалось прочитать список снимков. Нажмите «Повторить».');
    }
    return files.filter(file => /^\/image\/[^/\\?#]+\.jpe?g$/i.test(file.Original));
  }
  async startLiveView(signal: AbortSignal) {
    await this.get('/liveview.html?CMD=LiveViewWnd_Show', AbortSignal.any([signal, AbortSignal.timeout(5000)]));
  }
  async preview(signal: AbortSignal): Promise<Blob> {
    return this.jpeg('/liveview.jpg', AbortSignal.any([signal, AbortSignal.timeout(5000)]));
  }
  private async jpeg(path: string, signal: AbortSignal) {
    const blob = await (await this.get(path, signal)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      throw new CameraError('Камера ещё не передала корректный JPEG. Нажмите «Повторить».');
    }
    const jpeg = new Blob([blob], { type: 'image/jpeg' });
    // Decode in the browser before accepting a file; retain the original bytes.
    if (typeof createImageBitmap === 'function') {
      try { (await createImageBitmap(jpeg)).close(); }
      catch { throw new CameraError('Камера передала повреждённый JPEG. Нажмите «Повторить».'); }
    }
    return jpeg;
  }
  async capture(sessionId: string, poseIndex: number, liveView: boolean, signal: AbortSignal): Promise<Blob> {
    const key = `${sessionId}:${poseIndex}`;
    if (this.busy || (this.pending && this.pending.key !== key)) throw new CameraError('Сначала завершите получение текущего снимка.');
    this.busy = true;
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(this.waitMs)]);
    try {
      if (!this.pending) {
        const before = new Set((await this.files(timeout)).map(file => file.Original));
        this.pending = { key, before };
        // Record before dispatch: a lost response may still mean an exposure.
        await this.get(`/?CMD=${liveView ? 'LiveView_Capture' : 'Capture'}`, timeout);
      }
      while (!this.pending.original) {
        const fresh = (await this.files(timeout)).filter(file => !this.pending!.before.has(file.Original));
        if (fresh.length > 1) throw new CameraError('Камера вернула несколько новых снимков. Позовите сотрудника для проверки камеры.');
        if (fresh[0]) this.pending.original = fresh[0].Original;
        else await pause(this.pollMs, timeout);
      }
      const blob = await this.jpeg(this.pending.original, timeout);
      this.pending = undefined;
      return blob;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof CameraError) throw error;
      throw new CameraError(this.pending
        ? 'Снимок пока не получен. Нажмите «Повторить», чтобы дождаться этого кадра. Если камера не сняла, позовите сотрудника.'
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
