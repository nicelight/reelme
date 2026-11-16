/** Targeted visual regression only: no-preview copy must not overlap countdown.
 * Source: docs/slot-setup/matrix.md. Isolated fixture, no actual shutter/provider. */
import { test, expect } from '../../../tests/browser-fixture';
import { request as apiRequest } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const out = '.tasks/TASK-019-T2-FT-002-W16/ui-smoke';
test.use({ capturePort: 0 });
test('no-preview countdown hides fallback copy and keeps guide visible', async ({ page, app }) => {
  const admin = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
  expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: app.password } })).status()).toBe(200);
  const uploaded = await admin.post('/api/admin/slot-media', { multipart: { file: { name: 'guide.png', mimeType: 'image/png', buffer: await readFile(app.image) } } });
  expect(uploaded.status()).toBe(201); const mediaId = (await uploaded.json()).id;
  expect((await admin.put('/api/admin/capture-guides/1', { data: { mediaId } })).status()).toBe(200);
  expect((await admin.post('/api/admin/slots', { data: { description: 'Проверка чистого отсчёта', visible: true, thumbnailId: mediaId, referenceIds: [], mode: 'P2V', model: 'minimax/h3-max/reference-to-video', participants: 1, photosPerParticipant: 1, orientation: 'landscape', aspectRatio: '16:9', resolution: '768P', duration: 5, prompt: 'Portrait', promptExpansionMode: 'disabled' } })).status()).toBe(201);
  let shutters = 0;
  await page.route(app.captureOrigin + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/reelme.html') return route.continue();
    if (url.pathname === '/liveview.html') return route.fulfill({ status: 503 });
    if (url.pathname === '/' && url.searchParams.has('CMD')) shutters++;
    return route.fulfill({ status: 404 });
  });
  await page.clock.install({ time: new Date('2026-11-16T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-16T12:00:01Z'));
  await page.goto(app.captureOrigin + '/reelme.html#setup');
  await page.getByLabel('Ключ установки', { exact: true }).fill(app.installationKey);
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByRole('status')).toContainText('Ключ проверен');
  await page.getByRole('link', { name: 'Открыть каталог' }).click();
  await page.getByRole('link', { name: 'Выбрать сюжет: Проверка чистого отсчёта', exact: true }).click();
  await page.getByRole('button', { name: 'Мне нравится' }).click();
  await expect(page.locator('.pose-guide img')).toHaveJSProperty('naturalWidth', 512);
  await expect(page.getByText('Съёмка без превью', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  for (const [width,height,name] of [[1440,1000,'wide'],[375,812,'narrow']] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('.countdown strong')).toHaveText('3');
    await expect(page.locator('.countdown strong')).toBeVisible();
    await expect(page.locator('.pose-guide img')).toBeVisible();
    await expect(page.locator('.preview-fallback span')).toBeHidden();
    await expect(page.locator('.preview-fallback p')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${out}/countdown-${name}.png`, fullPage: true });
  }
  expect(shutters).toBe(0);
  await writeFile(out + '/countdown-fix-observations.json', JSON.stringify({ fallbackCopyHidden: true, countdownAndGuideVisible: true, viewports: [[1440,1000],[375,812]], shutterCount: shutters, horizontalOverflow: false }, null, 2));
  await admin.dispose();
});
