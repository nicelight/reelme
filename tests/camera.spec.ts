/** Browser contract evidence uses real Svelte/API/SQLite and controlled local
 * digiCamControl HTTP responses. It does not claim camera or acoustic hardware acceptance. */
import { test, expect } from './browser-fixture';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request as apiRequest } from '@playwright/test';
import sharp from 'sharp';
const artifacts = process.env.REELME_BROWSER_ARTIFACTS || '.tasks/TASK-003-T2-FT-002-W2';
const local = 'http://localhost:5513/reelme.html';
type Observations = { beeps: number; countdowns: string[]; poses: string[]; frames: { bytes: number[]; transform: string; step: string }[] };

test('camera plans 1/4, delayed JPEG, same-file retry, sequential visitors and preview fallback', async ({ page, app }) => {
  test.setTimeout(120_000);
  await mkdir(artifacts, { recursive: true });
  const admin = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
  expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: app.password } })).status()).toBe(200);
  const upload = async (path: string, mimeType: string) => {
    const response = await admin.post('/api/admin/slot-media', { multipart: { file: { name: path.split('/').pop()!, mimeType, buffer: await readFile(path) } } });
    expect(response.status()).toBe(201); return (await response.json()).id;
  };
  const thumbnailId = await upload(app.image, 'image/png');
  const videoId = await upload(app.video, 'video/mp4');
  const slots: string[] = [];
  for (const mode of ['one', 'four']) {
    const response = await admin.post('/api/admin/slots', { data: {
      description: mode === 'one' ? 'Один портрет Recast' : 'Четыре позы для сюжета', visible: true, thumbnailId, referenceIds: [],
      ...(mode === 'one' ? { mode: 'V2V', model: 'minimax/h3-max/recast', videoId, resolution: '768P', recastShotsConfirmed: true }
        : { mode: 'P2V', model: 'kling/v4/reference-to-video', resolution: '720p', duration: 5, prompt: 'Visitor @Element1' }),
    } });
    expect(response.status()).toBe(201); slots.push((await response.json()).id);
  }
  await admin.dispose();
  const frames = await Promise.all(Array.from({ length: 6 }, (_, i) => sharp(Buffer.from(`<svg width="640" height="480"><rect width="640" height="480" fill="#e1e8dd"/><rect x="0" width="160" height="480" fill="${['#b1342f','#285d43','#c18428','#254e88','#81407c','#436348'][i]}"/><circle cx="400" cy="190" r="85" fill="#e1b79b"/><path d="M290 450v-90a110 110 0 0 1 220 0v90" fill="#314434"/><text x="20" y="80" font-size="45" fill="white">L ${i}</text></svg>`)).jpeg().toBuffer()));
  let sequence = 0; let pendingPolls = 0; let fallback = false; let previewFails = false; let failedDownload = false;
  const names = ['/image/old.jpg'];
  const commands: string[] = []; const downloads: string[] = []; const localAuthorization: string[] = [];
  await page.route('http://localhost:5513/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/reelme.html') return route.continue();
    const authorization = route.request().headers().authorization;
    if (authorization) localAuthorization.push(authorization);
    if (url.pathname === '/liveview.html') return route.fulfill({ status: fallback ? 503 : 200, body: 'ok' });
    if (url.pathname === '/liveview.jpg') return previewFails ? route.fulfill({ status: 503, body: 'preview stopped' }) : route.fulfill({ contentType: 'image/jpeg', body: frames[0] });
    if (url.pathname === '/' && url.searchParams.has('CMD')) {
      commands.push(url.searchParams.get('CMD')!); sequence++; pendingPolls = 2;
      return route.fulfill({ body: 'accepted' });
    }
    if (url.pathname === '/filelist.json') {
      if (pendingPolls > 0 && --pendingPolls === 0) names.push(`/image/visitor-${sequence}.jpg`);
      return route.fulfill({ json: names.map(Original => ({ FileName: Original.slice(7), Original })) });
    }
    if (url.pathname.startsWith('/image/')) {
      downloads.push(url.pathname);
      if (url.pathname === '/image/visitor-3.jpg' && !failedDownload) { failedDownload = true; return route.fulfill({ status: 503, body: 'temporarily unavailable' }); }
      const index = Number(url.pathname.match(/visitor-(\d+)/)?.[1] || 0);
      return route.fulfill({ contentType: 'application/octet-stream', body: frames[index] });
    }
    return route.fulfill({ status: 404 });
  });
  await page.addInitScript(() => {
    const observations: Observations = { beeps: 0, countdowns: [], poses: [], frames: [] };
    (window as typeof window & { cameraObservations: Observations }).cameraObservations = observations;
    const originalStart = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function(when?: number) { observations.beeps++; return originalStart.call(this, when); };
    const blobs = new Map<string, Blob>(); const seen = new Set<string>();
    const originalURL = URL.createObjectURL;
    URL.createObjectURL = function(blob: Blob | MediaSource) { const url = originalURL.call(URL, blob); if (blob instanceof Blob) blobs.set(url, blob); return url; };
    new MutationObserver(() => {
      const countdown = document.querySelector('.countdown strong')?.textContent;
      if (countdown && observations.countdowns.at(-1) !== countdown) observations.countdowns.push(countdown);
      const pose = document.querySelector('.pose-panel h1')?.textContent;
      if (pose && observations.poses.at(-1) !== pose) observations.poses.push(pose);
      const image = document.querySelector<HTMLImageElement>('.captured-frame');
      if (image && !seen.has(image.src)) {
        seen.add(image.src);
        const transform = getComputedStyle(image).transform;
        const step = document.querySelector('.pose-panel .eyebrow')?.textContent || '';
        void blobs.get(image.src)!.arrayBuffer().then(buffer => observations.frames.push({ bytes: [...new Uint8Array(buffer)], transform, step }));
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(local + '#setup');
  await page.getByLabel('Ключ установки', { exact: true }).fill(app.installationKey);
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByRole('status')).toContainText('Ключ проверен и сохранён');
  await page.getByRole('link', { name: 'Открыть каталог' }).click();
  await page.getByRole('link', { name: 'Выбрать сюжет: Один портрет Recast', exact: true }).click();
  await page.getByRole('button', { name: 'Мне нравится' }).click();
  await expect(page.locator('.live-preview')).toBeVisible();
  await expect.poll(() => page.locator('.live-preview').evaluate(image => getComputedStyle(image).transform)).toBe('matrix(-1, 0, 0, 1, 0, 0)');
  const firstReceipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  expect(firstReceipt.posePlan).toHaveLength(1);
  await page.screenshot({ path: `${artifacts}/camera-live-desktop.png`, fullPage: true });
  const previewBox = await page.locator('.viewfinder').boundingBox();
  expect(previewBox!.width / page.viewportSize()!.width).toBeGreaterThan(0.5);
  previewFails = true;
  await expect(page.getByText('Съёмка без превью', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Начать съёмку' }).click();
  await expect(page.locator('.countdown strong')).toHaveText('3');
  await expect(page.locator('.countdown strong')).toHaveText('2');
  await expect(page.locator('.countdown strong')).toHaveText('1');
  await expect(page.getByText('Кадр снят ✓')).toBeVisible();
  await page.screenshot({ path: `${artifacts}/camera-original.png`, fullPage: true });
  await expect(page.getByRole('heading', { name: 'Съёмка завершена' })).toBeVisible();
  const first = await page.evaluate(() => (window as typeof window & { cameraObservations: Observations }).cameraObservations);
  expect(first.beeps).toBe(3); expect(first.countdowns).toEqual(['3', '2', '1']);
  expect(first.frames).toHaveLength(1); expect(Buffer.from(first.frames[0].bytes)).toEqual(frames[1]);
  expect(first.frames[0].transform).toBe('none'); expect(first.frames[0].step).toBe('ФОТО 1 ИЗ 1');
  expect(commands).toEqual(['LiveView_Capture']);
  // Explicit fixture reset: the product's next-visitor/finalize action belongs to TASK-004.
  fallback = true;
  await page.evaluate(() => sessionStorage.removeItem('reelme.captureStart'));
  await page.goto(local + '#slot=' + slots[1]); await page.reload();
  await page.getByRole('button', { name: 'Мне нравится' }).click();
  await expect(page.getByText('Съёмка без превью', { exact: true })).toBeVisible();
  const secondReceipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  expect(secondReceipt.sessionId).not.toBe(firstReceipt.sessionId); expect(secondReceipt.posePlan).toHaveLength(4);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${artifacts}/camera-mobile-fallback.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Начать съёмку' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось получить ответ камеры', { timeout: 20_000 });
  await expect(page.locator('.capture-progress')).toHaveText('Снято: 1 из 4');
  expect(commands).toEqual(['LiveView_Capture', 'Capture', 'Capture']);
  await page.screenshot({ path: `${artifacts}/camera-retry.png`, fullPage: true });
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.capture-progress')).toHaveText('Снято: 2 из 4', { timeout: 10_000 });
  expect(commands).toHaveLength(3);
  await expect(page.getByRole('heading', { name: 'Съёмка завершена' })).toBeVisible({ timeout: 30_000 });
  const second = await page.evaluate(() => (window as typeof window & { cameraObservations: Observations }).cameraObservations);
  expect(second.poses).toEqual(secondReceipt.posePlan.map((pose: { instruction: string }) => pose.instruction));
  expect(second.frames).toHaveLength(4); expect(second.beeps).toBe(15);
  expect(second.countdowns).toEqual(Array.from({ length: 5 }, () => ['3', '2', '1']).flat());
  for (let i = 0; i < 4; i++) { expect(Buffer.from(second.frames[i].bytes)).toEqual(frames[i + 2]); expect(second.frames[i].step).toBe(`ФОТО ${i + 1} ИЗ 4`); expect(second.frames[i].transform).toBe('none'); }
  expect(downloads).toEqual(['/image/visitor-1.jpg', '/image/visitor-2.jpg', '/image/visitor-3.jpg', '/image/visitor-3.jpg', '/image/visitor-4.jpg', '/image/visitor-5.jpg']);
  expect(commands).toEqual(['LiveView_Capture', 'Capture', 'Capture', 'Capture', 'Capture']);
  expect(localAuthorization).toEqual([]); expect(pageErrors).toEqual([]); expect(app.sessionCount()).toBe(2);
  expect(await page.locator('main').innerText()).not.toMatch(/Ищи свое видео|Ваш номер|Фото отправлены/);
  const summarize = (observation: Observations) => ({ ...observation, frames: observation.frames.map(frame => ({ size: frame.bytes.length, step: frame.step, transform: frame.transform })) });
  await writeFile(`${artifacts}/camera-observations.json`, JSON.stringify({ firstSessionId: firstReceipt.sessionId, secondSessionId: secondReceipt.sessionId, first: summarize(first), second: summarize(second), commands, downloads, byteEquality: true, previewFallback: ['preview 503 after successful LiveView_Show', 'initial LiveView_Show 503'], delayedFileList: 'two polls after each command', credentialLeak: false, pageErrors, nextVisitor: 'test fixture reset; production release is TASK-004', audio: 'real WebAudio oscillator start events; physical sound not audited', hardware: 'controlled HTTP, no Canon/Windows' }, null, 2));
});
