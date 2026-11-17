import { test as base, expect, type Page } from '@playwright/test';
import { createServer } from 'vite';
import type { ServerResponse } from 'node:http';
import sharp from 'sharp';

// Real Capture component and HTTP image streams; no cloud server, camera or FFmpeg.
const test = base.extend<{ camera: {
  origin: string; shutters: number; previews: number; holdPreview: boolean; holdPhoto: boolean;
  previewWaiters: Set<ServerResponse>; photoWaiters: Set<ServerResponse>; releasePhoto: () => void;
} }>({
  camera: async ({}, use) => {
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#aa88cc' } }).jpeg().toBuffer();
    const state = { origin: '', shutters: 0, previews: 0, holdPreview: false, holdPhoto: true,
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
            const receipt = { sessionId: 'preview-fixture', date: '2026-11-17', posePlan: [0, 1, 2].map(index => ({ index, participant: 1, key: 'front', instruction: 'Смотрите в объектив' })) };
            response.setHeader('Content-Type', 'text/html');
            response.end(`<div id="app"></div><script type="module">import { mount, unmount } from '/node_modules/.vite/deps/svelte.js'; import Capture from '/src/client/capture/Capture.svelte'; const app = mount(Capture, { target: document.querySelector('#app'), props: { receipt: ${JSON.stringify(receipt)}, installationKey: 'fixture', oncomplete: () => unmount(app), onscenario: () => unmount(app) } }); window.unmountCapture = () => unmount(app);</script>`);
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
    finally { for (const response of [...state.previewWaiters, ...state.photoWaiters]) response.destroy(); await server.close(); }
  },
});

async function open(page: Page, origin: string) {
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.addInitScript(() => {
    const fetcher = window.fetch;
    const events: string[] = []; (window as any).captureEvents = events;
    window.fetch = (input, init) => {
      const path = String(input);
      if (path === '/liveview.jpg') init?.signal?.addEventListener('abort', () => events.push('preview-abort'), { once: true });
      if (path.includes('CMD=LiveView_Capture')) events.push('shutter');
      return fetcher(input, init);
    };
  });
  await page.goto(origin + '/preview-fixture');
  await expect(page.locator('.live-preview')).toBeVisible();
}

test('preview stops before shutter, photo holds one second, countdowns are 5 → pause/play 3 → 5', async ({ page, camera }) => {
  await open(page, camera.origin);
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
  camera.holdPreview = true;
  await page.clock.runFor(200); await expect.poll(() => camera.previewWaiters.size).toBe(1);
  await page.clock.runFor(4800); await expect.poll(() => camera.shutters).toBe(1);
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
  await expect(page.locator('.countdown strong')).toHaveText(['3', '3']);
  await page.clock.runFor(2999); expect(camera.shutters).toBe(1);
  await page.clock.runFor(1); await expect(page.locator('.captured-frame')).toBeVisible();
  expect(camera.shutters).toBe(2);
  await page.clock.runFor(1000); await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
  await page.clock.runFor(4999); expect(camera.shutters).toBe(2);
  await page.clock.runFor(1); await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(1000); await expect(page.getByRole('button', { name: 'Завершить фотосессию' })).toBeVisible();
  await expect(page.locator('.live-preview')).toBeVisible();
  await expect(page.locator('.thumb-image')).toHaveCount(3);
  // Exercise the app's visibility handler; this does not simulate OS timer throttling.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenReads = camera.previews; await page.clock.runFor(2000); expect(camera.previews).toBe(hiddenReads);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.live-preview')).toBeVisible();
  camera.holdPreview = true; await page.clock.runFor(200); await expect.poll(() => camera.previewWaiters.size).toBe(1);
  await page.evaluate(() => (window as any).unmountCapture());
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
  await page.clock.runFor(5000); await expect(page.locator('.capture-white')).toBeVisible();
  await expect.poll(() => camera.photoWaiters.size).toBe(1);
  await page.clock.runFor(300);
  await expect(page.getByRole('alert')).toContainText('Снимок пока не получен');
  await expect(page.locator('.capture-white')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Переснять предыдущий кадр' })).toBeDisabled();
  camera.releasePhoto(); await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.captured-frame')).toBeVisible(); expect(camera.shutters).toBe(1);
  await page.clock.runFor(1000); await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
});

test('pause during shutter keeps the photo hold and resumes with one three-second countdown', async ({ page, camera }) => {
  await open(page, camera.origin);
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await page.clock.runFor(5000); await expect.poll(() => camera.photoWaiters.size).toBe(1);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  camera.releasePhoto(); await expect(page.locator('.captured-frame')).toBeVisible();
  await page.clock.runFor(999); await expect(page.locator('.captured-frame')).toBeVisible();
  expect(camera.shutters).toBe(1); await expect(page.locator('.countdown')).toHaveCount(0);
  await page.clock.runFor(1); await expect(page.getByText('Съёмка на паузе', { exact: true })).toBeVisible();
  await page.clock.runFor(5000); expect(camera.shutters).toBe(1);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.countdown strong')).toHaveText(['3', '3']);
  await page.clock.runFor(3000); await expect(page.locator('.captured-frame')).toBeVisible();
  expect(camera.shutters).toBe(2);
  await page.clock.runFor(1000); await expect(page.locator('.countdown strong')).toHaveText(['5', '5']);
});

test('quick Pause→Play during confirmation waits only the remaining photo hold', async ({ page, camera }) => {
  await open(page, camera.origin);
  camera.holdPhoto = false;
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await page.clock.runFor(5000); await expect(page.locator('.captured-frame')).toBeVisible();
  const reads = camera.previews;
  await page.clock.runFor(100); await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByText('Съёмка на паузе', { exact: true })).toBeVisible();
  await page.clock.runFor(100); await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.clock.runFor(799);
  await expect(page.locator('.captured-frame')).toBeVisible(); await expect(page.locator('.countdown')).toHaveCount(0);
  expect(camera.previews).toBe(reads); expect(camera.shutters).toBe(1);
  await page.clock.runFor(1);
  await expect(page.locator('.countdown strong')).toHaveText(['3', '3']);
  await expect(page.locator('.captured-frame')).toHaveCount(0);
});
