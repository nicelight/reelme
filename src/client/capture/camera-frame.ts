import type { AttemptTrace } from './capture-diagnostics';

export class CameraError extends Error {
  constructor(message: string, readonly status?: number, options?: ErrorOptions) { super(message, options); this.name = 'CameraError'; }
}

export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function validatedCameraJpeg(blob: Blob, trace?: AttemptTrace) {
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
