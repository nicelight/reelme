import { test as base, expect, type Page } from '@playwright/test';
import { createServer } from 'vite';
import type { ServerResponse } from 'node:http';
import sharp from 'sharp';

// Real Capture component and HTTP image streams; no cloud server, camera or FFmpeg.
const test = base.extend<{ camera: {
  origin: string; shutters: number; previews: number; holdPreview: boolean; holdPhoto: boolean;
  previewWaiters: Set<ServerResponse>; photoWaiters: Set<ServerResponse>; releasePhoto: () => void;
  guides: Map<number, ServerResponse>; releaseGuide: (number: number) => void;
} }>({
  camera: async ({}, use) => {
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#aa88cc' } }).jpeg().toBuffer();
    const state = { origin: '', shutters: 0, previews: 0, holdPreview: false, holdPhoto: true,
      guides: new Map<number, ServerResponse>(), releaseGuide(number: number) {
        this.guides.get(number)?.end(jpeg); this.guides.delete(number);
      },
      previewWaiters: new Set<ServerResponse>(), photoWaiters: new Set<ServerResponse>(), releasePhoto() {
        this.holdPhoto = false;
        for (const response of this.photoWaiters) response.end(jpeg);
        this.photoWaiters.clear();
      } };
    const server = await createServer({ server: { host: '127.0.0.1', port: 4213, strictPort: true }, plugins: [{
      name: 'capture-preview-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const url = new URL(request.url!, 'http://fixture');
          const hold = (set: Set<ServerResponse>) => { set.add(response); response.once('close', () => set.delete(response)); };
          if (url.pathname === '/preview-fixture') {
            const receipt = { sessionId: 'preview-fixture', date: '2026-11-17', posePlan: (url.searchParams.has('fourPoses') ? [0, 1, 2, 3] : [0, 1, 2]).map(index => ({ index, participant: 1, key: 'front', instruction: 'Смотрите в объектив', ...(url.searchParams.has('guides') ? { guideNumber: index + 1, guideMediaId: `guide-${index + 1}` } : {}) })) };
            response.setHeader('Content-Type', 'text/html');
            response.end(`<div id="app"></div><script type="module">import { mount, unmount } from '/node_modules/.vite/deps/svelte.js'; import Capture from '/src/client/capture/Capture.svelte'; const app = mount(Capture, { target: document.querySelector('#app'), props: { receipt: ${JSON.stringify(receipt)}, installationKey: 'fixture', oncomplete: () => unmount(app), onscenario: () => unmount(app) } });</script>`);
          } else if (/\/guides\/guide-\d$/.test(url.pathname)) {
            response.setHeader('Content-Type', 'image/jpeg');
            response.setHeader('Cache-Control', 'private, no-cache');
            response.setHeader('Vary', 'Authorization');
            const number = Number(url.pathname.split('-').at(-1)); state.guides.set(number, response);
            response.once('close', () => { if (state.guides.get(number) === response) state.guides.delete(number); });
          } else if (url.pathname === '/liveview.html') response.end('ok');
          else if (url.pathname === '/liveview.jpg') {
            state.previews++; response.setHeader('Content-Type', 'image/jpeg');
            if (state.holdPreview) hold(state.previewWaiters); else response.end(jpeg);
          } else if (url.pathname === '/filelist.json') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(Array.from({ length: state.shutters }, (_, index) => ({ FileName: `${index}.jpg`, Original: `/image/${index}.jpg` }))));
          } else if (url.searchParams.has('CMD')) { state.shutters++; response.end('ok'); }
          else if (url.pathname.startsWith('/image/')) {
            response.setHeader('Content-Type', 'image/jpeg');
            if (state.holdPhoto) hold(state.photoWaiters); else response.end(jpeg);
          } else next();
        });
      },
    }] });
    try { await server.listen(); state.origin = 'http://127.0.0.1:4213'; await use(state); }
    finally { for (const response of [...state.previewWaiters, ...state.photoWaiters, ...state.guides.values()]) response.destroy(); await server.close(); }
  },
});

async function open(page: Page, origin: string, query = '') {
  await page.clock.install({ time: new Date('2026-11-17T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-17T12:01:00Z'));
  await page.addInitScript(() => {
    const fetcher = window.fetch;
    const events: string[] = []; (window as any).captureEvents = events;
    window.fetch = (input, init) => {
      const path = String(input);
      if (path === '/liveview.jpg') init?.signal?.addEventListener('abort', () => events.push('preview-abort'), { once: true });
      if (path === '/filelist.json') events.push('list');
      if (path.startsWith('/image/')) events.push('download');
      if (path.includes('CMD=LiveView_Capture')) events.push('shutter');
      return fetcher(input, init);
    };
  });
  await page.goto(origin + '/preview-fixture' + query);
  await expect(page.locator('.live-preview')).toBeVisible();
}

test('preview stops before shutter, photo holds one second, countdowns are five seconds before and after a mode change', async ({ page, camera }) => {
  await open(page, camera.origin);
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
  camera.holdPreview = true;
  await page.clock.runFor(200); await expect.poll(() => camera.previewWaiters.size).toBe(1);
  await page.clock.runFor(4800);
  await expect.poll(() => camera.previewWaiters.size).toBe(0);
  await page.clock.runFor(199);
  const beforeCapture = await page.evaluate(() => (window as any).captureEvents as string[]);
  expect(beforeCapture).toContain('preview-abort');
  expect(beforeCapture).not.toContain('list');
  expect(camera.shutters).toBe(0);
  await page.clock.runFor(1); await expect.poll(() => camera.shutters).toBe(1);
  await expect(page.locator('.capture-white')).toBeVisible();
  expect(await page.locator('.capture-white').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 255, 255)');
  const events = await page.evaluate(() => (window as any).captureEvents as string[]);
  expect(events.indexOf('preview-abort')).toBeLessThan(events.indexOf('shutter'));
  const reads = camera.previews;
  await page.clock.runFor(1000); expect(camera.previews).toBe(reads);
  camera.holdPreview = false; camera.releasePhoto();
  await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(999); await expect(page.locator('.captured-frame')).toBeVisible();
  expect(camera.previews).toBe(reads); expect(camera.shutters).toBe(1);
  await expect(page.locator('.countdown')).toHaveCount(0);
  await page.clock.runFor(1); await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
  await expect(page.locator('.live-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
  await page.clock.runFor(4999); expect(camera.shutters).toBe(1);
  await page.clock.runFor(201); await expect(page.locator('.captured-frame')).toBeVisible();
  expect(camera.shutters).toBe(2);
  await page.clock.runFor(1000); await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
  await page.clock.runFor(4999); expect(camera.shutters).toBe(2);
  await page.clock.runFor(201); await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(1000); await expect(page.getByRole('button', { name: 'Завершить фотосессию' })).toBeVisible();
  await expect(page.locator('.live-preview')).toBeVisible();
  await expect(page.locator('.thumb-image')).toHaveCount(3);
  // Exercise the app's visibility handler; this does not simulate OS timer throttling.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenReads = camera.previews; await page.clock.runFor(2000); expect(camera.previews).toBe(hiddenReads);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.live-preview')).toBeVisible();
  camera.holdPreview = true; await page.clock.runFor(200); await expect.poll(() => camera.previewWaiters.size).toBe(1);
  await page.clock.runFor(799);
  await expect(page.getByRole('button', { name: 'Завершить фотосессию' })).toBeVisible();
  await page.clock.runFor(1);
  await expect(page.locator('.photo-session-view')).toHaveCount(0);
  await expect.poll(() => camera.previewWaiters.size).toBe(0);
  const finalReads = camera.previews; await page.clock.runFor(2000); expect(camera.previews).toBe(finalReads);
});

test('camera timeout removes white screen and retry retrieves the same pending photo', async ({ page, camera }) => {
  await open(page, camera.origin);
  // Drive just the camera deadline with the controlled clock; fetch still aborts normally.
  await page.evaluate(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = ms => {
      if (ms !== 30_000) return timeout(ms);
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Camera timed out', 'TimeoutError')), 300);
      return controller.signal;
    };
  });
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await page.clock.runFor(5200); await expect(page.locator('.capture-white')).toBeVisible();
  await expect.poll(() => camera.photoWaiters.size).toBe(1);
  await page.clock.runFor(300);
  await expect(page.getByRole('alert')).toContainText('Снимок пока не получен');
  await expect(page.locator('.capture-white')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Переснять предыдущий кадр' })).toBeDisabled();
  await expect(page.locator('.live-preview')).toBeVisible();
  camera.releasePhoto(); await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await page.clock.runFor(199);
  const downloads = () => page.evaluate(() => ((window as any).captureEvents as string[]).filter(event => event === 'download').length);
  expect(await downloads()).toBe(1);
  await page.clock.runFor(1);
  await expect.poll(downloads).toBe(2);
  await expect(page.locator('.captured-frame')).toBeVisible(); expect(camera.shutters).toBe(1);
  await page.clock.runFor(1000); await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
});

test('pause during shutter keeps the photo hold and resumes with the configured countdown', async ({ page, camera }) => {
  await open(page, camera.origin);
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await page.clock.runFor(5200); await expect.poll(() => camera.photoWaiters.size).toBe(1);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  camera.releasePhoto(); await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(999); await expect(page.locator('.captured-frame')).toBeVisible();
  expect(camera.shutters).toBe(1); await expect(page.locator('.countdown')).toHaveCount(0);
  await page.clock.runFor(1); await expect(page.getByRole('button', { name: 'Снять один кадр' })).toBeVisible();
  await page.clock.runFor(5000); expect(camera.shutters).toBe(1);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
  await page.clock.runFor(5200); await expect(page.locator('.captured-frame')).toBeVisible();
  expect(camera.shutters).toBe(2);
  await page.clock.runFor(1000); await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
});

test('quick Pause→Play during confirmation waits only the remaining photo hold', async ({ page, camera }) => {
  await open(page, camera.origin);
  camera.holdPhoto = false;
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await page.clock.runFor(5200); await expect(page.locator('.captured-frame')).toBeVisible();
  const reads = camera.previews;
  await page.clock.runFor(100); await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Снять один кадр' })).toBeVisible();
  await page.clock.runFor(100); await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.clock.runFor(799);
  await expect(page.locator('.captured-frame')).toBeVisible(); await expect(page.locator('.countdown')).toHaveCount(0);
  expect(camera.previews).toBe(reads); expect(camera.shutters).toBe(1);
  await page.clock.runFor(1);
  await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
  await expect(page.locator('.captured-frame')).toHaveCount(0);
});

test('immediate and repeated pose guides always fade for one second without a delay', async ({ page, camera }) => {
  const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#aa88cc' } }).jpeg().toBuffer();
  await page.addInitScript(base64 => {
    // Return the same cached bytes immediately, with real native image decoding.
    const blob = new Blob([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], { type: 'image/jpeg' });
    const fetcher = window.fetch;
    window.fetch = (input, init) => /\/guides\/guide-\d$/.test(String(input))
      ? Promise.resolve(new Response(blob)) : fetcher(input, init);
  }, jpeg.toString('base64'));
  await open(page, camera.origin, '?guides'); camera.holdPhoto = false;
  const image = page.locator('.pose-picture img');
  const verifyFade = async () => {
    await expect(image).toHaveCount(1);
    const result = await image.evaluate(node => {
      const transition = node.getAnimations().find(value => (value as CSSTransition).transitionProperty === 'opacity');
      if (!transition) throw new Error('Immediate guide has no opacity transition');
      transition.pause(); transition.currentTime = 0;
      const start = getComputedStyle(node).opacity;
      transition.currentTime = 500; const middle = Number(getComputedStyle(node).opacity);
      const { duration, delay } = transition.effect!.getTiming();
      transition.finish();
      return { start, middle, duration, delay, end: getComputedStyle(node).opacity };
    });
    expect(result).toMatchObject({ start: '0', duration: 1000, delay: 0, end: '1' });
    expect(result.middle).toBeGreaterThan(0); expect(result.middle).toBeLessThan(1);
  };
  await verifyFade();
  const first = await image.getAttribute('src');
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await page.clock.runFor(5200); await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(1000); await expect(image).not.toHaveAttribute('src', first!);
  await verifyFade();
  const second = await image.getAttribute('src');
  await page.getByRole('button', { name: 'Переснять предыдущий кадр', exact: true }).click();
  await expect(page.locator('.pose-guide')).toHaveAttribute('aria-label', 'Образец позы 1');
  await expect(image).not.toHaveAttribute('src', second!);
  await verifyFade();
});

test('the current pose appears first and all remaining session guides warm one at a time', async ({ page, camera }) => {
  const requests: string[] = [];
  page.on('request', req => {
    if (req.url().includes('/api/capture/guides/')) requests.push(new URL(req.url()).pathname.split('/').pop()!);
  });
  await open(page, camera.origin, '?guides&fourPoses');
  for (const number of [1, 2, 3, 4]) {
    await expect.poll(() => [...camera.guides.keys()]).toEqual([number]);
    expect(requests).toEqual(Array.from({ length: number }, (_, i) => `guide-${i + 1}`));
    if (number > 1) await expect(page.locator('.pose-guide img')).toHaveJSProperty('naturalWidth', 640);
    camera.releaseGuide(number);
  }
  await expect(page.locator('.progress strong')).toHaveText('1 из 4');
  camera.holdPhoto = false;
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await page.clock.runFor(5200); await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(1000);
  await expect(page.locator('.pose-guide[aria-label="Образец позы 2"] img')).toHaveJSProperty('naturalWidth', 640);
  expect(camera.guides.size).toBe(0); // A network miss would stay held on the fixture.
});

test('pose guide keeps a transparent frame, reveals after decode and ignores an old decode', async ({ page, camera }) => {
  // Hold native decode completions independently of network arrival.
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    (window as any).guideDecodes = [];
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      await new Promise<void>(resolve => (window as any).guideDecodes.push({ resolve, src: this.src }));
    };
  });
  await open(page, camera.origin, '?guides'); camera.holdPhoto = false;
  const frame = page.locator('.pose-picture'); const image = frame.locator('img');
  await expect.poll(() => camera.guides.has(1)).toBe(true);
  const geometry = await frame.boundingBox();
  await expect(image).toHaveCount(0);
  expect(await frame.locator('.media').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('.pose-panel').evaluate(node => getComputedStyle(node).backgroundImage)).toBe('none');
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await page.clock.runFor(1000); await expect(page.locator('.countdown strong')).toHaveText(['4', '4']);
  camera.releaseGuide(1);
  await expect.poll(() => page.evaluate(() => (window as any).guideDecodes.length)).toBe(1);
  await expect(image).toHaveCount(0); // Fetch alone must not publish undecoded media.
  await page.evaluate(() => (window as any).guideDecodes[0].resolve());
  await expect(image).toHaveCount(1);
  const transition = await image.evaluate(node => {
    const animation = node.getAnimations().find(value => (value as CSSTransition).transitionProperty === 'opacity');
    if (!animation) throw new Error('No actual opacity transition');
    animation.pause(); animation.currentTime = 0;
    const start = getComputedStyle(node).opacity;
    animation.currentTime = 500; const middle = getComputedStyle(node).opacity;
    const duration = animation.effect!.getTiming().duration;
    animation.finish(); return { start, middle, duration, end: getComputedStyle(node).opacity };
  });
  expect(transition.start).toBe('0'); expect(Number(transition.middle)).toBeGreaterThan(0);
  expect(Number(transition.middle)).toBeLessThan(1); expect(transition.duration).toBe(1000); expect(transition.end).toBe('1');
  expect(await frame.boundingBox()).toEqual(geometry);
  await page.clock.runFor(4200); await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(1000); await expect.poll(() => camera.guides.has(2)).toBe(true);
  await expect(image).toHaveCount(0); expect(await frame.boundingBox()).toEqual(geometry);
  camera.releaseGuide(2);
  await expect.poll(() => page.evaluate(() => (window as any).guideDecodes.length)).toBe(2);
  await page.clock.runFor(5200); await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(1000); await expect.poll(() => camera.guides.has(3)).toBe(true);
  camera.releaseGuide(3);
  await expect.poll(() => page.evaluate(() => (window as any).guideDecodes.length)).toBe(3);
  await page.evaluate(() => (window as any).guideDecodes[2].resolve());
  await expect(image).toHaveCount(1); const latest = await image.getAttribute('src');
  await page.evaluate(() => (window as any).guideDecodes[1].resolve());
  await expect(image).toHaveAttribute('src', latest!);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).guideDecodes.length)).toBe(1);
  expect(camera.guides.has(1)).toBe(false);
  await page.evaluate(() => (window as any).guideDecodes[0].resolve());
  await expect(image).toHaveCount(1);
  expect(await image.evaluate(node => ({ opacity: getComputedStyle(node).opacity, transitions: node.getAnimations().length }))).toEqual({ opacity: '1', transitions: 0 });
  await page.route('**/guides/guide-1', route => route.fulfill({ status: 500 })); await page.reload();
  await expect(frame.getByText('Изображение не загрузилось.')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Повторить загрузку' })).toBeEnabled();
  expect(await frame.boundingBox()).toEqual(geometry);
});

test('manual Live View takes one shot per tap and Play continues the series', async ({ page, camera }) => {
  camera.holdPhoto = false;
  await open(page, camera.origin);
  const shutter = page.getByRole('button', { name: 'Снять один кадр' });
  await page.getByRole('button', { name: 'Продолжить без превью' }).click();
  await expect(page.getByText('Съёмка без превью')).toBeVisible();
  await shutter.dblclick();
  await page.clock.runFor(5000);
  await expect(page.locator('.captured-frame')).toBeVisible();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.clock.runFor(7000);
  expect(camera.shutters).toBe(1);
  await shutter.click();
  await page.clock.runFor(2000);
  await page.locator('.controls .play').click();
  await page.clock.runFor(3000);
  await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(1000);
  await expect(page.locator('.live .countdown strong')).toHaveText('5');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await page.clock.runFor(6000);
  expect(camera.shutters).toBe(2);
  await expect(shutter).toBeEnabled();
});
