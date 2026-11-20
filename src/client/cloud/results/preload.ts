/** Decodes resources before display. Each card window permits two attempts of at
 * most three seconds. Decode finishing after timeout cannot resolve the cancelled
 * attempt or replace its retry; one image's failure cancels its pending partner.
 * Successful image URLs are returned for rendering the same resources. */
import egg from '../results-prototype/assets/egg.png';
export function decodeImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.loading = 'eager'; image.decoding = 'async';
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', abort);
      if (error) { image.removeAttribute('src'); reject(error); }
      else resolve(image);
    };
    const abort = () => finish(signal!.reason);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    image.src = url;
    image.decode().then(() => finish(image.naturalWidth ? undefined : new Error('Image is empty')), finish);
  });
}
export class CardLoadError extends Error {
  constructor(public reason: 'timeout' | 'image') { super('Card images unavailable'); }
}
export async function loadCardImages(card: { frameUrl: string; qrUrl: string }, signal: AbortSignal, retry: boolean) {
  let reason: 'timeout' | 'image' = 'image';
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(3000);
    const attemptSignal = AbortSignal.any([signal, deadline, controller.signal]);
    const resourceUrl = (source: string) => {
      if (!retry && attempt === 0) return source;
      const url = new URL(source, location.href); url.searchParams.set('load', crypto.randomUUID()); return url.href;
    };
    const frameUrl = resourceUrl(card.frameUrl); const qrUrl = resourceUrl(card.qrUrl);
    try {
      const [frame, qr] = await Promise.all([decodeImage(frameUrl, attemptSignal), decodeImage(qrUrl, attemptSignal)]);
      attemptSignal.throwIfAborted();
      return { frame, qr, frameUrl, qrUrl };
    } catch {
      signal.throwIfAborted();
      reason = deadline.aborted ? 'timeout' : 'image';
    } finally { controller.abort(); }
  }
  throw new CardLoadError(reason);
}
export async function preloadStage() {
  const [image] = await Promise.all([
    decodeImage(egg),
    ...[400, 600, 700, 800].map(weight => document.fonts.load(`${weight} 24px Manrope`, 'Ваши видео № 0123456789')),
  ]);
  return image;
}
