import { test, expect } from './browser-fixture';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request as apiRequest } from '@playwright/test';
const artifacts = '.tasks/TASK-002-T2-FT-001-W2';
const local = 'http://localhost:5513/reelme.html';

test('visitor catalog, protected media, durable start and lost acknowledgement recovery', async ({ page, app }) => {
  await mkdir(artifacts, { recursive: true });
  // Seed through the real administrator API, isolated from the visitor's cookie jar.
  const admin = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
  expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: app.password } })).status()).toBe(200);
  const upload = async (path: string, mimeType: string) => {
    const response = await admin.post('/api/admin/slot-media', { multipart: { file: { name: path.split('/').pop()!, mimeType, buffer: await readFile(path) } } });
    expect(response.status()).toBe(201); return (await response.json()).id as string;
  };
  const thumbnailId = await upload(app.image, 'image/png');
  const videoId = await upload(app.video, 'video/mp4');
  const slots: { id: string; description: string }[] = [];
  for (let i = 0; i < 14; i++) {
    const description = `История номер ${i + 1} — полное описание выбранного сюжета`;
    const data = { description, visible: i < 13, thumbnailId, referenceIds: [], ...(i === 0
      ? { mode: 'V2V', model: 'minimax/h3-max/recast', videoId, resolution: '768P', recastShotsConfirmed: true }
      : { mode: 'P2V', model: 'kling/v4/reference-to-video', resolution: '720p', duration: 5, prompt: 'Visitor @Element1', ...(i === 1 ? { demoId: videoId } : {}) }) };
    const response = await admin.post('/api/admin/slots', { data });
    expect(response.status()).toBe(201); slots.push(await response.json());
  }
  await admin.dispose();
  expect((await page.request.get(app.origin + '/api/catalog')).status()).toBe(401);
  expect((await page.request.get(`${app.origin}/api/catalog/${slots[0].id}/media/${thumbnailId}`)).status()).toBe(401);
  expect((await page.request.post(app.origin + '/api/capture/sessions', { data: {} })).status()).toBe(401);
  expect((await page.request.get(`${app.origin}/api/catalog/${slots[13].id}`, { headers: { Authorization: `Bearer ${app.installationKey}` } })).status()).toBe(404);
  const errors: string[] = []; const consoleErrors: string[] = []; let leakedKey = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('request', req => { if (req.url().includes(app.installationKey)) leakedKey = true; });
  await page.goto(local);
  await expect(page.getByRole('heading', { name: 'Нужна настройка установки' })).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0);
  await page.goto(local + '#setup');
  await page.getByLabel('Ключ установки', { exact: true }).fill(app.installationKey);
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByRole('status')).toContainText('Ключ проверен и сохранён');
  await expect(page.locator('#installation-key')).toHaveValue('');
  await page.getByRole('link', { name: 'Открыть каталог' }).click();
  await expect(page.locator('.card')).toHaveCount(12);
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(12);
  await expect(page.locator('.card h2').first()).toHaveText('История номер 1');
  await expect(page.locator('.card img').first()).toHaveJSProperty('naturalWidth', 512);
  await expect(page.getByRole('link', { name: 'Выбрать сюжет: История номер 14', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/browser-catalog.png`, fullPage: true });
  await page.getByRole('button', { name: 'Далее →' }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Выбрать сюжет: История номер 13', exact: true }).click();
  await expect(page.getByRole('heading', { name: slots[12].description })).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByText('У этого сюжета пока нет демовидео.')).toBeVisible();
  await page.getByRole('button', { name: '← Назад в каталог' }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.pagination')).toContainText('2 / 2');
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await page.getByRole('link', { name: 'Выбрать сюжет: История номер 2', exact: true }).click();
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('video').evaluate((video: HTMLVideoElement) => { video.muted = true; return video.play(); });
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
  await expect(page.getByText('Демонстрация сюжета', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← Назад в каталог' }).click();
  await page.getByRole('link', { name: 'Выбрать сюжет: История номер 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: slots[0].description })).toBeVisible();
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('video').evaluate((video: HTMLVideoElement) => { video.muted = true; return video.play(); });
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
  const videoBox = await page.locator('video').boundingBox();
  expect(videoBox!.height / page.viewportSize()!.height).toBeGreaterThan(0.35);
  expect(videoBox!.height / page.viewportSize()!.height).toBeLessThan(0.65);
  await page.screenshot({ path: `${artifacts}/browser-detail.png`, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Мне нравится' })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/browser-mobile.png`, fullPage: true });
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/capture/sessions'));
  await page.getByRole('button', { name: 'Мне нравится' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const receipt = await response.json();
  expect(receipt.sessionId).toBeTruthy(); expect(receipt.posePlan).toHaveLength(1);
  await expect(page.locator('.poses li')).toHaveCount(1);
  expect(await page.locator('main').innerText()).not.toMatch(/\d/);
  await page.reload();
  await expect(page.locator('.poses li')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt.sessionId) === receipt.sessionId).toBe(true);
  await page.screenshot({ path: `${artifacts}/browser-handoff.png`, fullPage: true });
  // Lose the acknowledgement after the server commits. A reload/retry must reuse the request.
  await page.evaluate(() => sessionStorage.removeItem('reelme.captureStart'));
  await page.goto(local + '#slot=' + slots[1].id);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Мне нравится' })).toBeVisible();
  const before = app.sessionCount(); const requests: string[] = [];
  let lostReceipt: { sessionId: string; number: number } | undefined;
  await page.route('**/api/capture/sessions', async route => {
    requests.push(route.request().postDataJSON().startRequestId);
    if (requests.length === 1) { const committed = await route.fetch(); expect(committed.status()).toBe(201); lostReceipt = await committed.json(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Мне нравится' }).click();
  await expect(page.getByRole('alert')).toContainText('Подтверждение старта не получено');
  expect(app.sessionCount()).toBe(before + 1);
  await page.reload();
  await page.getByRole('button', { name: 'Повторить старт' }).click();
  await expect(page.locator('.poses li')).toHaveCount(4);
  expect(requests).toHaveLength(2); expect(requests[0] === requests[1]).toBe(true);
  const recovered = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  expect(recovered.sessionId === lostReceipt!.sessionId && recovered.number === lostReceipt!.number).toBe(true);
  expect(app.sessionCount()).toBe(before + 1);
  expect(await page.locator('main').innerText()).not.toMatch(/\d/);
  expect((await page.context().cookies()).length).toBe(0);
  expect(leakedKey).toBe(false); expect(errors).toEqual([]);
  // Only the deliberately lost acknowledgement and optional favicon are allowed.
  expect(consoleErrors.filter(message => !message.includes('net::ERR_FAILED') && !message.includes('404 (Not Found)'))).toEqual([]);
  await writeFile(`${artifacts}/browser-observations.json`, JSON.stringify({ catalog: '12+1 visible, hidden unavailable', protectedMedia: 'real decoded image/video via blob URLs', setupPersistence: true, plans: [1, 4], lostAcknowledgement: 'same request, session and number; one DB row', numberVisible: false, keyInURL: leakedKey, visitorCookies: 0, pageErrors: errors, expectedAbortedRequests: 1 }, null, 2));
});
