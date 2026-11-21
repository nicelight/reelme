/** Public promo and account routes against the real isolated API/database.
 * Synthetic media only; generation, camera and external email stay disabled. */
import { request as playwrightRequest } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from './browser-fixture';

test.use({ capturePort: 0, reducedMotion: 'reduce' });
const artifacts = process.env.REELME_BROWSER_ARTIFACTS ?? '/tmp/reelme-promo-qa';

test('public promo browses all visible stories and playable previews without capture or account requests', async ({ browser, page, app }) => {
  await mkdir(artifacts, { recursive: true });
  const admin = await playwrightRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
  try {
    expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: app.password } })).status()).toBe(200);
    async function upload(path: string, mimeType: string) {
      const response = await admin.post('/api/admin/slot-media', { multipart: { file: { name: path.split('/').pop()!, mimeType, buffer: await readFile(path) } } });
      expect(response.status()).toBe(201);
      return (await response.json()).id as string;
    }
    const thumbnailId = await upload(app.image, 'image/png');
    const demoId = await upload(app.video, 'video/mp4');
    for (let i = 1; i <= 14; i++) {
      const response = await admin.post('/api/admin/slots', { data: {
        id: randomUUID(), description: `История номер ${i}`, visible: i <= 13, thumbnailId,
        participants: 1, photosPerParticipant: 4, orientation: 'landscape', aspectRatio: '16:9',
        mode: 'P2V', model: 'kling/v4/reference-to-video', resolution: '720p', duration: 5,
        prompt: 'Private instructions for @Element1', referenceIds: [], ...(i === 2 ? { demoId } : {}),
      } });
      expect(response.status()).toBe(201);
    }
  } finally { await admin.dispose(); }
  const pageErrors: string[] = [], mutations: string[] = [], privateRequests: string[] = [], badResponses: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push(`${request.method()} ${path}`);
    if (path.startsWith('/api/') && !path.startsWith('/api/public/catalog')) privateRequests.push(path);
  });
  page.on('response', response => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app.origin);
  await expect(page.getByRole('heading', { name: 'Ваша киноистория', exact: true })).toBeVisible();
  await expect(page.locator('.story')).toHaveCount(13);
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 1');
  await expect(page.locator('.center .story-preview img')).toHaveJSProperty('naturalWidth', 512);
  await expect(page.getByRole('button', { name: 'Выбор доступен в фотобудке' })).toBeDisabled();
  await expect(page.getByLabel('Логин')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Начать съёмку/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Выбор сюжета' }).getByRole('button')).toHaveCount(13);
  await expect(page.getByRole('button', { name: 'Сюжет 14: История номер 14', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(artifacts, 'promo-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Следующий сюжет', exact: true }).click();
  const video = page.locator('.center video');
  await expect(video).toHaveAttribute('src', /^\/api\/public\/catalog\//);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await page.screenshot({ path: join(artifacts, 'promo-preview-desktop.png'), fullPage: true });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 3');
  await page.getByRole('link', { name: 'Выбрать сюжет: История номер 4', exact: true }).click();
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 4');
  await page.getByRole('button', { name: 'Сюжет 13: История номер 13', exact: true }).click();
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 13');
  await page.getByRole('button', { name: 'Следующий сюжет', exact: true }).click();
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 1');
  await page.getByRole('button', { name: 'Предыдущий сюжет', exact: true }).click();
  await expect(page.locator('.center .story-heading h2')).toHaveText('История номер 13');
  await page.getByRole('button', { name: 'Обновить каталог', exact: true }).click();
  await expect(page.locator('.story')).toHaveCount(13);
  const renamed = 'История номер 13 на танцполе под звёздным небом';
  const editor = await browser.newPage();
  try {
    await editor.goto(app.origin + '/admin');
    await editor.getByLabel('Логин').fill('admin');
    await editor.getByLabel('Пароль', { exact: true }).fill(app.password);
    await editor.getByRole('button', { name: 'Войти', exact: true }).click();
    await editor.getByRole('button', { name: /История номер 13/ }).click();
    await editor.getByLabel('Описание', { exact: true }).fill(renamed);
    await editor.getByRole('button', { name: 'Сохранить сюжет', exact: true }).click();
    await expect(editor.getByText('Сюжет сохранён.', { exact: true })).toBeVisible();
  } finally { await editor.close(); }
  await page.reload();
  const heading = page.locator('.center .story-heading h2');
  await expect(heading).toHaveText(renamed);
  await page.getByRole('button', { name: 'Предыдущий сюжет', exact: true }).click();
  const side = page.getByRole('link', { name: `Выбрать сюжет: ${renamed}`, exact: true });
  await expect(side.getByRole('heading')).toHaveText('История номер');
  await side.click();
  await expect(heading).toHaveText(renamed);
  await page.screenshot({ path: join(artifacts, 'promo-renamed-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Выбор доступен в фотобудке' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(artifacts, 'promo-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Сюжет 2: История номер 2', exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await page.screenshot({ path: join(artifacts, 'promo-preview-mobile.png'), fullPage: true });
  expect(app.sessionCount()).toBe(0);
  expect(await page.context().cookies()).toEqual([]);
  expect(mutations).toEqual([]); expect(privateRequests).toEqual([]); expect(pageErrors).toEqual([]); expect(badResponses).toEqual([]);
  await writeFile(join(artifacts, 'promo-observations.json'), JSON.stringify({
    visibleStories: 13, hiddenExcluded: true, realImageDecoded: true, realVideoPlayed: true,
    browsing: ['arrows', 'keyboard', 'side card', 'dots', 'wrap', 'refresh'], chooseDisabled: true,
    sessions: app.sessionCount(), mutations, privateRequests, pageErrors, badResponses, horizontalOverflow: false,
  }, null, 2) + '\n');
});

test('account routes preserve public root, separate operator workspace and fullscreen results for both roles', async ({ browser, app }) => {
  await mkdir(artifacts, { recursive: true });
  for (const role of ['admin', 'operator'] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(app.origin + '/admin');
      await page.getByLabel('Логин').fill(role);
      await page.getByLabel('Пароль', { exact: true }).fill(app.password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      if (role === 'admin') await expect(page.getByRole('region', { name: 'Редактор сюжета' })).toBeVisible();
      else {
        await expect(page.getByRole('heading', { name: 'Админка доступна администратору' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Редактор сюжета' })).toHaveCount(0);
        expect((await page.request.get(app.origin + '/api/admin/slots')).status()).toBe(403);
      }
      const rootRequests: string[] = [];
      const rootWatch = (request: import('@playwright/test').Request) => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/') && !path.startsWith('/api/public/catalog')) rootRequests.push(path); };
      page.on('request', rootWatch);
      await page.goto(app.origin);
      await expect(page.getByRole('heading', { name: 'Ваша киноистория', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Сюжеты скоро появятся' })).toBeVisible();
      await expect(page.getByLabel('Логин')).toHaveCount(0);
      expect(rootRequests).toEqual([]); page.off('request', rootWatch);
      const editorRequests: string[] = [];
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/admin/')) editorRequests.push(request.url()); });
      await page.goto(app.origin + '/operator');
      await expect(page.getByRole('button', { name: 'Сегодня', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Архив', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Редактор сюжета' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Сюжеты', exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible();
      await page.getByRole('button', { name: 'Архив', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Архив мероприятий' })).toBeVisible();
      await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible();
      await page.screenshot({ path: join(artifacts, `operator-workspace-${role}.png`), fullPage: true });
      await page.goto(app.origin + '/results');
      await expect(page.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible();
      await expect(page.locator('.admin-shell, .app-header, .surface-nav')).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible();
      const legacy = page.waitForResponse(response => response.url() === app.origin + '/?screen=results');
      await page.goto(app.origin + '/?screen=results');
      expect((await legacy).status()).toBe(308);
      await expect(page).toHaveURL(app.origin + '/results');
      await expect(page.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible();
      expect(editorRequests).toEqual([]); expect(errors).toEqual([]);
      expect((await (await page.request.get(app.origin + '/api/auth/session')).json()).role).toBe(role);
    } finally { await context.close(); }
  }
});
