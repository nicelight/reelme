/** Module contract: capture/browser evidence for docs/slot-setup/matrix.md; isolated local fixtures only. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from './browser-fixture';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request as apiRequest } from '@playwright/test';
const artifacts = process.env.REELME_BROWSER_ARTIFACTS ? `${process.env.REELME_BROWSER_ARTIFACTS}/catalog-regression` : '.tasks/TASK-002-T2-FT-001-W2';
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
  const portraitVideo = join(app.dataDir, 'portrait-demo.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=2:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', portraitVideo]);
  const videoId = await upload(portraitVideo, 'video/mp4');
  const slots: { id: string; description: string }[] = [];
  for (let i = 0; i < 14; i++) {
    const description = i === 1 ? 'История номер 2' : `История номер ${i + 1} — полное описание выбранного сюжета`;
    const id = randomUUID(); let sourceId: string | undefined;
    if (i === 0) { await app.prepareTemplate(id); const imported = await admin.post(`/api/admin/slots/${id}/template-video`, { data: { orientation: 'landscape', model: 'minimax/h3-max/recast' } }); expect(imported.status()).toBe(201); sourceId = (await imported.json()).id; }
    const data = { id, participants: 1, photosPerParticipant: i === 0 ? 1 : 4, orientation: 'landscape', ...(i === 0 ? {} : { aspectRatio: '16:9' }), description, visible: i < 13, thumbnailId, referenceIds: [], ...(i === 0
      ? { mode: 'V2V', model: 'minimax/h3-max/recast', videoId: sourceId, resolution: '768P', recastShotsConfirmed: true }
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
  await expect(page.locator('.story')).toHaveCount(13);
  await page.reload();
  await expect(page.locator('.story')).toHaveCount(13);
  await expect(page.locator('.story h2').first()).toHaveText('История номер 1');
  await expect(page.locator('.story img').first()).toHaveJSProperty('naturalWidth', 512);
  await expect(page.getByRole('link', { name: 'Выбрать сюжет: История номер 14', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/browser-catalog.png`, fullPage: true });
  // The transport still pages at 12; the visitor's sequence includes all 13.
  await expect(page.getByRole('navigation', { name: 'Выбор сюжета' }).getByRole('button')).toHaveCount(13);
  await page.getByRole('button', { name: 'Сюжет 13: История номер 13', exact: true }).click();
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 13');
  await expect(page.locator('.center video')).toHaveCount(0);
  await expect(page.locator('.center .qualities')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp('#slot=' + slots[12].id));
  await page.getByRole('button', { name: '← Назад в каталог' }).click();
  await expect(page.locator('.story')).toHaveCount(13);
  await expect(page.locator('.pagination')).toHaveCount(0);
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 13');
  await page.reload();
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 13');
  await page.getByRole('button', { name: 'Сюжет 2: История номер 2', exact: true }).click();
  await expect(page.locator('.center video')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => page.locator('.center video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('.center video').evaluate((video: HTMLVideoElement) => { video.muted = true; return video.play(); });
  await expect.poll(() => page.locator('.center video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await page.locator('.center video').evaluate((video: HTMLVideoElement) => video.pause());
  await expect(page.getByText('Демонстрация сюжета', { exact: true })).toHaveCount(0);
  await expect(page.locator('.center .story-heading p')).toHaveCount(0);
  await expect(page.locator('.center .story-preview')).toHaveClass(/portrait/);
  await expect(page.locator('.center video')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Выбрать этот сюжет' })).toBeEnabled();
  const portraitCard = await page.locator('.story.center').boundingBox();
  await page.screenshot({ path: `${artifacts}/browser-portrait.png`, fullPage: true });
  await page.getByRole('button', { name: '← Назад в каталог' }).click();
  await page.getByRole('button', { name: 'Сюжет 1: История номер 1', exact: true }).click();
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 1');
  await expect.poll(async () => Math.round((await page.locator('.story.center').boundingBox())!.height)).toBe(Math.round(portraitCard!.height));
  await expect(page.locator('.center video')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => page.locator('.center video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('.center video').evaluate((video: HTMLVideoElement) => { video.muted = true; return video.play(); });
  await expect.poll(() => page.locator('.center video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await page.locator('.center video').evaluate((video: HTMLVideoElement) => video.pause());
  const videoBox = await page.locator('.center video').boundingBox();
  expect(videoBox!.height / page.viewportSize()!.height).toBeGreaterThan(0.2);
  expect(videoBox!.height / page.viewportSize()!.height).toBeLessThan(0.65);
  await page.screenshot({ path: `${artifacts}/browser-detail.png`, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Выбрать этот сюжет' })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/browser-mobile.png`, fullPage: true });
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/capture/sessions'));
  await page.getByRole('button', { name: 'Выбрать этот сюжет' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const receipt = await response.json();
  expect(receipt.sessionId).toBeTruthy(); expect(receipt.posePlan).toHaveLength(1);
  await expect(page.locator('.progress strong')).toHaveText('1 из 1');
  expect(await page.locator('main').innerText()).not.toMatch(/Ищи свое видео|Ваш номер|Фото отправлены/);
  await page.reload();
  await expect(page.locator('.progress strong')).toHaveText('1 из 1');
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt.sessionId) === receipt.sessionId).toBe(true);
  await page.screenshot({ path: `${artifacts}/browser-handoff.png`, fullPage: true });
  // Lose the acknowledgement after the server commits. A reload/retry must reuse the request.
  await page.evaluate(() => sessionStorage.removeItem('reelme.captureStart'));
  await page.goto(local + '#slot=' + slots[1].id);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Выбрать этот сюжет' })).toBeVisible();
  const before = app.sessionCount(); const requests: string[] = [];
  let lostReceipt: { sessionId: string; number: number } | undefined;
  await page.route('**/api/capture/sessions', async route => {
    requests.push(route.request().postDataJSON().startRequestId);
    if (requests.length === 1) { const committed = await route.fetch(); expect(committed.status()).toBe(201); lostReceipt = await committed.json(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Выбрать этот сюжет' }).click();
  await expect(page.getByRole('alert')).toContainText('Подтверждение старта не получено');
  expect(app.sessionCount()).toBe(before + 1);
  await page.reload();
  await page.getByRole('button', { name: 'Повторить старт' }).click();
  await expect(page.locator('.progress strong')).toHaveText('1 из 4');
  expect(requests).toHaveLength(2); expect(requests[0] === requests[1]).toBe(true);
  const recovered = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  expect(recovered.sessionId === lostReceipt!.sessionId && recovered.number === lostReceipt!.number).toBe(true);
  expect(app.sessionCount()).toBe(before + 1);
  expect(await page.locator('main').innerText()).not.toMatch(/Ищи свое видео|Ваш номер|Фото отправлены/);
  expect((await page.context().cookies()).length).toBe(0);
  expect(leakedKey).toBe(false); expect(errors).toEqual([]);
  // Only the deliberately lost acknowledgement and optional favicon are allowed.
  expect(consoleErrors.filter(message => !message.includes('net::ERR_FAILED') && !message.includes('404 (Not Found)'))).toEqual([]);
  // A staff visibility change invalidates the selected route on focus refresh.
  await page.evaluate(() => sessionStorage.removeItem('reelme.captureStart'));
  await page.goto(local + '#slot=' + slots[12].id); await page.reload();
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 13');
  const staff = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
  await staff.post('/api/auth/login', { data: { username: 'admin', password: app.password } });
  const hide = async (index: number) => {
    const { id: _id, ...data } = await (await staff.get(`/api/admin/slots/${slots[index].id}`)).json();
    expect((await staff.put(`/api/admin/slots/${slots[index].id}`, { data: { ...data, visible: false } })).status()).toBe(200);
  };
  await hide(12);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.story')).toHaveCount(12);
  await expect(page).toHaveURL(/#catalog$/);
  await expect(page.locator('.center .story-heading h2')).not.toHaveText('История номер 13');
  for (let index = 3; index < 12; index++) await hide(index);
  for (const count of [3, 2, 1, 0]) {
    await page.getByRole('button', { name: 'Обновить каталог', exact: true }).click();
    await expect(page.locator('.story')).toHaveCount(count);
    await expect(page.getByRole('navigation', { name: 'Выбор сюжета' }).getByRole('button')).toHaveCount(count);
    if (count > 0) {
      await expect(page.getByRole('button', { name: 'Выбрать этот сюжет' })).toHaveCount(1);
      await hide(count - 1);
    }
  }
  await expect(page.getByRole('heading', { name: 'Сюжеты скоро появятся' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать этот сюжет' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Следующий сюжет' })).toHaveCount(0);
  await staff.dispose();
  await writeFile(`${artifacts}/browser-observations.json`, JSON.stringify({ catalog: '13 slots in one carousel, hidden unavailable, API pages aggregated; selected hidden on focus clears route; counts 3/2/1/0 preserve no duplicates or stale CTA', protectedMedia: 'real decoded image/video via blob URLs', setupPersistence: true, plans: [1, 4], lostAcknowledgement: 'same request, session and number; one DB row', numberVisible: false, keyInURL: leakedKey, visitorCookies: 0, pageErrors: errors, expectedAbortedRequests: 1 }, null, 2));
});
