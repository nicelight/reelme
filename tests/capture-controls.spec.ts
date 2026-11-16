/** Module contract: bounded controlled-camera evidence for explicit capture controls
 * and transfer-loss recovery. Source: docs/slot-setup/matrix.md. No hardware/fal. */
import { test, expect } from './browser-fixture';
import { request as apiRequest, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const artifacts = process.env.REELME_BROWSER_ARTIFACTS || '.tasks/TASK-019-T2-FT-002-W16';
const local = 'http://localhost:5513/reelme.html';

async function installation(page: Page, key: string) {
  await page.goto(local + '#setup');
  await page.getByLabel('Ключ установки', { exact: true }).fill(key);
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByRole('status')).toContainText('Ключ проверен');
  await page.getByRole('link', { name: 'Открыть каталог' }).click();
}
async function freeze(page: Page) {
  await page.clock.install({ time: new Date('2026-11-16T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-16T12:00:01Z'));
}

test('pause 3/2/1, restart, last retakes, person boundary, pending JPEG and guide visibility', async ({ page, app }) => {
  test.setTimeout(120_000); await mkdir(artifacts, { recursive: true });
  const admin = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
  await admin.post('/api/auth/login', { data: { username: 'admin', password: app.password } });
  const uploaded = await admin.post('/api/admin/slot-media', { multipart: { file: { name: 'guide.png', mimeType: 'image/png', buffer: await readFile(app.image) } } });
  const thumbnailId = (await uploaded.json()).id;
  for (const number of [1, 2, 5]) expect((await admin.put(`/api/admin/capture-guides/${number}`, { data: { mediaId: thumbnailId } })).status()).toBe(200);
  const saved = await admin.post('/api/admin/slots', { data: { description: 'Два человека по два кадра', visible: true, thumbnailId, referenceIds: [], mode: 'P2V', model: 'minimax/h3-max/reference-to-video', participants: 2, photosPerParticipant: 2, orientation: 'landscape', aspectRatio: '16:9', resolution: '768P', duration: 5, prompt: 'Two people', promptExpansionMode: 'disabled' } });
  expect(saved.status()).toBe(201);
  const frames = await Promise.all(Array.from({ length: 12 }, (_, i) => sharp({ create: { width: 320, height: 240, channels: 3, background: { r: i * 20, g: 120, b: 200 - i * 10 } } }).jpeg().toBuffer()));
  let shutters = 0; let published = 0; let hold = false; let failDownload = false;
  const commands: number[] = []; const pageErrors: string[] = []; const apiWrites: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { if (/\/photos\/|\/finalize$/.test(request.url()) && request.method() !== 'GET') apiWrites.push(request.url()); });
  await page.route('http://localhost:5513/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/reelme.html') return route.continue();
    expect(route.request().headers().authorization).toBeUndefined();
    if (url.pathname === '/liveview.html') return route.fulfill({ body: 'ok' });
    if (url.pathname === '/liveview.jpg') return route.fulfill({ contentType: 'image/jpeg', body: frames[0] });
    if (url.pathname === '/') { shutters++; commands.push(shutters); return route.fulfill({ body: 'ok' }); }
    if (url.pathname === '/filelist.json') {
      if (!hold) published = shutters;
      return route.fulfill({ json: Array.from({ length: published + 1 }, (_, i) => ({ FileName: `frame-${i}.jpg`, Original: `/image/frame-${i}.jpg` })) });
    }
    if (url.pathname.startsWith('/image/')) {
      if (failDownload) { failDownload = false; return route.fulfill({ status: 503 }); }
      return route.fulfill({ contentType: 'image/jpeg', body: frames[Number(url.pathname.match(/frame-(\d+)/)![1])] });
    }
    return route.fulfill({ status: 404 });
  });
  await freeze(page); await installation(page, app.installationKey);
  await page.getByRole('link', { name: 'Выбрать сюжет: Два человека по', exact: true }).click();
  await page.getByRole('button', { name: 'Мне нравится' }).click();
  await expect(page.locator('.pose-guide img')).toHaveJSProperty('naturalWidth', 512);
  const receipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  await page.getByRole('button', { name: 'Начать съёмку' }).click();
  for (const [elapsed, digit] of [[0,'3'],[1000,'2'],[2000,'1']] as const) {
    if (elapsed) await page.clock.runFor(elapsed);
    await expect(page.locator('.countdown strong')).toHaveText(digit);
    await expect(page.locator('.pose-guide img')).toBeVisible();
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    await page.clock.runFor(5000); expect(shutters).toBe(0);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(page.locator('.countdown strong')).toHaveText('3');
  }
  await page.screenshot({ path: `${artifacts}/controls-countdown-wide.png`, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.countdown strong')).toBeVisible(); await expect(page.locator('.pose-guide img')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${artifacts}/controls-countdown-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const expose = async () => { await page.clock.runFor(3000); await expect(page.getByText('Кадр снят ✓', { exact: true })).toBeVisible(); };
  const advance = () => page.clock.runFor(1500);
  await expose(); await advance();
  await page.getByRole('button', { name: 'Перефоткать последнее' }).click();
  expect(shutters).toBe(1); await expect(page.locator('.pose-panel .eyebrow')).toHaveText('ФОТО 1 ИЗ 4');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expose(); await advance();
  await expose(); await advance();
  await expect(page.getByText('Подготовьте второго человека')).toBeVisible();
  await expect(page.locator('.capture-progress')).toHaveText('Снято: 2 из 4');
  await page.getByRole('button', { name: 'Перефоткать последнее' }).click();
  await expect(page.locator('.pose-panel .eyebrow')).toHaveText('ФОТО 2 ИЗ 4');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expose(); await advance();
  await expect(page.getByText('Подготовьте второго человека')).toBeVisible();
  await page.getByRole('button', { name: 'Restart фотосессия' }).click();
  await expect(page.locator('.capture-progress')).toHaveText('Снято: 0 из 4');
  await page.clock.runFor(5000); expect(shutters).toBe(4);
  hold = true; await page.getByRole('button', { name: 'Начать съёмку' }).click(); await page.clock.runFor(3000);
  await expect(page.getByText('Получаем снимок…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restart фотосессия' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Перефоткать последнее' })).toBeDisabled();
  await page.clock.runFor(500); expect(shutters).toBe(5);
  hold = false; failDownload = true; await page.clock.runFor(500);
  await expect(page.getByRole('alert')).toContainText('Ожидается текущий JPEG');
  await expect(page.getByRole('button', { name: 'Restart фотосессия' })).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('Кадр снят ✓', { exact: true })).toBeVisible(); expect(shutters).toBe(5);
  await advance(); await expose(); await advance();
  await expect(page.getByText('Подготовьте второго человека')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expose(); await advance(); await expose(); await advance();
  await expect(page.getByRole('button', { name: 'Завершить фотосессию' })).toBeVisible();
  await page.getByRole('button', { name: 'Перефоткать последнее' }).click();
  await expect(page.getByRole('button', { name: 'Завершить фотосессию' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expose(); await advance();
  expect(shutters).toBe(9); expect(apiWrites).toEqual([]); expect(await app.photos(receipt.sessionId)).toEqual([]);
  await page.getByRole('button', { name: 'Завершить фотосессию' }).click();
  await expect(page.locator('.visitor-number')).toHaveText('001');
  const savedPhotos = await app.photos(receipt.sessionId);
  for (const [index, frame] of [5,6,7,9].entries()) expect(savedPhotos[index].bytes).toEqual(frames[frame]);
  expect(apiWrites).toHaveLength(5); expect(pageErrors).toEqual([]);
  await writeFile(`${artifacts}/controls-observations.json`, JSON.stringify({ pauseDigits: [3,2,1], restartWait: true, retakeBoundaryAndLast: true, finalFrames: [5,6,7,9], pendingRetryShutters: 1, noSubmitBeforeFinish: true, guideVisible: true, pageErrors }));
  await admin.dispose();
});

test('group uses guide 5; lost local transfer after reload stops even before first accepted upload', async ({ page, app }) => {
  test.setTimeout(90_000); await mkdir(artifacts, { recursive: true });
  const admin = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
  await admin.post('/api/auth/login', { data: { username: 'admin', password: app.password } });
  const uploaded = await admin.post('/api/admin/slot-media', { multipart: { file: { name: 'thumb.png', mimeType: 'image/png', buffer: await readFile(app.image) } } });
  const thumbnailId = (await uploaded.json()).id;
  const saved = await admin.post('/api/admin/slots', { data: { description: 'Групповой снимок', visible: true, thumbnailId, referenceIds: [], mode: 'P2V', model: 'minimax/h3-max/reference-to-video', participants: 'group', photosPerParticipant: 2, orientation: 'landscape', aspectRatio: '16:9', resolution: '768P', duration: 5, prompt: 'Group', promptExpansionMode: 'disabled' } });
  expect(saved.status()).toBe(201);
  const frame = await readFile(app.jpeg); let shutters = 0; let failPosition = 0;
  await page.route('http://localhost:5513/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/reelme.html') return route.continue();
    if (path === '/liveview.html') return route.fulfill({ status: 503 });
    if (path === '/') { shutters++; return route.fulfill({ body: 'ok' }); }
    if (path === '/filelist.json') return route.fulfill({ json: Array.from({ length: shutters + 1 }, (_, i) => ({ FileName: `frame-${i}.jpg`, Original: `/image/frame-${i}.jpg` })) });
    if (path.startsWith('/image/')) return route.fulfill({ contentType: 'image/jpeg', body: frame });
    return route.fulfill({ status: 404 });
  });
  await page.route(app.origin + '/api/capture/sessions/**/photos/*', async route => {
    if (route.request().url().endsWith(`/photos/${failPosition}`)) return route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': 'http://localhost:5513' }, json: { message: 'Controlled outage' } });
    return route.continue();
  });
  await freeze(page); await installation(page, app.installationKey);
  const sessions: string[] = [];
  for (const position of [0, 1]) {
    failPosition = position;
    await page.getByRole('link', { name: 'Выбрать сюжет: Групповой снимок', exact: true }).click();
    await page.getByRole('button', { name: 'Мне нравится' }).click();
    await expect(page.getByText('Образец №5 ещё не загружен')).toBeVisible();
    const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt.sessionId); sessions.push(id);
    await page.getByRole('button', { name: 'Начать съёмку' }).click();
    for (let i = 0; i < 2; i++) { await page.clock.runFor(3000); await expect(page.getByText('Кадр снят ✓', { exact: true })).toBeVisible(); await page.clock.runFor(1500); }
    await page.getByRole('button', { name: 'Завершить фотосессию' }).click();
    await expect(page.getByRole('alert')).toContainText('снятые кадры сохранены');
    const accepted = await app.photos(id); expect(accepted).toHaveLength(position);
    const before = shutters;
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Недостающие кадры потеряны после перезагрузки' })).toBeVisible();
    await page.clock.runFor(10000); expect(shutters).toBe(before);
    expect(await app.photos(id)).toEqual(accepted);
    await expect(page.getByRole('button', { name: 'Restart фотосессия' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Начать новую фотосессию' }).click();
    await expect(page.getByRole('heading', { name: 'Какую историю снимем?' })).toBeVisible();
  }
  // Leaving a countdown never dispatches its delayed shutter.
  await page.getByRole('link', { name: 'Выбрать сюжет: Групповой снимок', exact: true }).click();
  await page.getByRole('button', { name: 'Мне нравится' }).click();
  await page.getByRole('button', { name: 'Начать съёмку' }).click();
  await expect(page.locator('.countdown strong')).toHaveText('3');
  const before = shutters; await page.goto(local + '#setup'); await page.clock.runFor(5000); expect(shutters).toBe(before);
  await writeFile(`${artifacts}/reload-loss-observations.json`, JSON.stringify({ sessions, acceptedCounts: [0,1], reloadNewShutters: 0, leavingCountdownNewShutters: 0, noIndexedDB: true, groupGuide: 5 }));
  await admin.dispose();
});
