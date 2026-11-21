/** Browser regression for shared result-screen access and admin-only editing.
 * Real ready media and account cookies use isolated fixture storage/random ports;
 * no camera, provider, external email, or persistent user data is involved. */
import type { Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { test, expect } from './browser-fixture';
import { preparedSession } from './receive-fixture';
import { openDatabase } from '../src/server/db';
import { publishReady } from '../src/server/sessions/receive';
import { eventDate } from '../src/server/sessions/index';
import { blankSlot } from '../src/shared/scenarios';

test.use({ capturePort: 0, reducedMotion: 'reduce' });

test('admin keeps editor access beside a reloadable results popup; operator sees results but cannot enter admin', async ({ page, app, browser }) => {
  test.setTimeout(90_000);
  const artifacts = process.env.REELME_BROWSER_ARTIFACTS ?? '.tasks/TASK-027-T1-FT-004-W24';
  await mkdir(artifacts, { recursive: true });
  const errors: string[] = [];
  const watch = (target: Page) => target.on('pageerror', error => errors.push(error.message));
  watch(page);
  await page.setViewportSize({ width: 1672, height: 941 });
  async function login(target: Page, role: 'admin' | 'operator', path: string) {
    await target.goto(app.origin + path);
    await target.getByLabel('Логин').fill(role);
    await target.getByLabel('Пароль', { exact: true }).fill(app.password);
    await target.getByRole('button', { name: 'Войти', exact: true }).click();
  }
  await login(page, 'admin', '/admin');
  await expect(page.getByRole('heading', { name: 'Новый сюжет', exact: true })).toBeVisible();
  const upload = await page.request.post(app.origin + '/api/admin/slot-media', {
    headers: { Origin: app.origin },
    multipart: { file: { name: 'fixture.png', mimeType: 'image/png', buffer: await readFile(app.image) } },
  });
  expect(upload.status()).toBe(201);
  const thumbnailId = (await upload.json()).id;
  const seed = await preparedSession(app.dataDir, await readFile(app.video));
  const db = openDatabase(app.dataDir);
  try {
    const date = eventDate(Date.now());
    db.prepare('UPDATE capture_sessions SET event_date=? WHERE id=?').run(date, seed.id);
    db.prepare('UPDATE slots SET config=? WHERE id=(SELECT slot_id FROM capture_sessions WHERE id=?)')
      .run(JSON.stringify({ ...blankSlot(), description: 'Готовая история для проверки', thumbnailId, visible: false }), seed.id);
    await publishReady(db, app.dataDir, seed.id, app.origin);
  } finally { db.close(); }
  const expectedMedia = {
    photo: seed.photo,
    frame: await readFile(join(app.dataDir, 'media', seed.frame_path)),
    qr: await readFile(join(app.dataDir, 'media', 'sessions', seed.id, 'qr.png')),
  };
  async function results(target: Page, role: 'admin' | 'operator') {
    await expect(target.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible();
    await expect(target.locator('.admin-shell, .app-header, .surface-nav')).toHaveCount(0);
    await expect(target.locator('.card[data-session="1"]')).toBeVisible();
    await expect(target.locator('.grid')).toHaveAttribute('data-phase', 'result', { timeout: 15_000 });
    await expect.poll(() => target.locator('.card .portrait, .card .qr').evaluateAll(nodes =>
      nodes.length === 2 && nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0),
    )).toBe(true);
    expect((await (await target.request.get(app.origin + '/api/auth/session')).json()).role).toBe(role);
    for (const [kind, bytes] of Object.entries(expectedMedia)) {
      const response = await target.request.get(`${app.origin}/api/display/${seed.id}/${kind}`);
      expect(response.status()).toBe(200);
      expect(await response.body()).toEqual(bytes);
    }
    expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const popupPromise = page.context().waitForEvent('page');
  await page.getByRole('link', { name: 'Открыть экран', exact: true }).click();
  const popup = await popupPromise;
  watch(popup);
  await popup.setViewportSize({ width: 1672, height: 941 });
  await expect(popup).toHaveURL(app.origin + '/results');
  await results(popup, 'admin');
  await popup.screenshot({ path: join(artifacts, 'admin-results-desktop.png') });
  const editorRequests: string[] = [];
  popup.on('request', request => { if (new URL(request.url()).pathname === '/api/admin/slots') editorRequests.push(request.url()); });
  await popup.reload();
  await results(popup, 'admin');
  expect(editorRequests).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Новый сюжет', exact: true })).toBeVisible();
  expect((await (await page.request.get(app.origin + '/api/auth/session')).json()).role).toBe('admin');
  await page.screenshot({ path: join(artifacts, 'admin-editor-preserved.png') });

  const operator = await browser.newContext({ viewport: { width: 1672, height: 941 }, reducedMotion: 'reduce' });
  try {
    const operatorPage = await operator.newPage();
    watch(operatorPage);
    await login(operatorPage, 'operator', '/results');
    await results(operatorPage, 'operator');
    await operatorPage.screenshot({ path: join(artifacts, 'operator-results-desktop.png') });
    const card = operatorPage.locator('.card[data-session="1"]');
    const showActions = () => card.hover({ position: { x: 30, y: 30 } });
    await showActions();
    await expect(card.getByRole('link', { name: 'Посмотреть' })).toBeVisible();
    await operatorPage.screenshot({ path: join(artifacts, 'results-card-actions.png') });
    const newTab = operator.waitForEvent('page');
    await card.getByRole('link', { name: 'Посмотреть' }).click();
    const video = await newTab;
    await expect(video).toHaveURL(`${app.origin}/results?video=${seed.id}`);
    watch(video);
    await expect(video.getByRole('heading', { name: /Генерация.*001/ })).toBeVisible();
    await expect(video.getByText('MiniMax H3 Max Recast', { exact: true })).toBeVisible();
    await expect(video.getByText('Уточняется', { exact: true })).toBeVisible();
    const player = video.locator('video');
    await player.evaluate(async node => { node.muted = true; await node.play(); });
    await expect.poll(() => player.evaluate(node => node.currentTime)).toBeGreaterThan(0);
    const billing = openDatabase(app.dataDir);
    try { billing.prepare('UPDATE generation_jobs SET cost_usd=4.53129 WHERE session_id=?').run(seed.id); }
    finally { billing.close(); }
    await expect(video.getByText('4,53 $', { exact: true })).toBeVisible({ timeout: 15_000 });
    await video.screenshot({ path: join(artifacts, 'player-desktop.png') });
    await video.setViewportSize({ width: 390, height: 844 });
    await video.reload();
    await expect(video.getByText('4,53 $', { exact: true })).toBeVisible();
    expect(await video.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await video.screenshot({ path: join(artifacts, 'player-mobile.png') });
    await video.close();
    await showActions();
    await card.getByRole('button', { name: 'Большой QR' }).click();
    const largeQr = operatorPage.getByRole('dialog', { name: /Большой QR.*001/ });
    const image = largeQr.getByRole('img');
    await expect(image).toBeVisible();
    await operatorPage.screenshot({ path: join(artifacts, 'results-large-qr.png') });
    const pixels = await sharp(await image.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const original = await sharp(expectedMedia.qr).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const expectedUrl = jsQR(new Uint8ClampedArray(original.data), original.info.width, original.info.height)?.data;
    expect(expectedUrl).toContain(app.origin + '/receive/');
    expect(jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height)?.data).toBe(expectedUrl);
    await operatorPage.keyboard.press('Escape');
    await expect(largeQr).toHaveCount(0);
    await showActions();
    await card.getByRole('button', { name: 'Убрать с экрана' }).click();
    await expect(operatorPage.getByText(/Убрать №\s*001 с экрана\?/)).toBeVisible();
    await operatorPage.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(card).toBeVisible();
    await showActions();
    await card.getByRole('button', { name: 'Убрать с экрана' }).click();
    await operatorPage.route(`**/api/display/${seed.id}/hide`, route => route.fulfill({ status: 503 }), { times: 1 });
    await operatorPage.getByRole('button', { name: 'Убрать', exact: true }).click();
    await expect(operatorPage.getByRole('alert')).toBeVisible();
    await expect(card).toBeVisible();
    const otherCard = popup.locator('.card[data-session="1"]');
    await otherCard.hover({ position: { x: 30, y: 30 } });
    await otherCard.getByRole('button', { name: 'Большой QR' }).click();
    const otherQr = popup.getByRole('dialog', { name: /Большой QR.*001/ });
    await expect(otherQr).toBeVisible();
    await operatorPage.getByRole('button', { name: 'Убрать', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(otherQr).toHaveCount(0, { timeout: 4_000 });
    await expect(otherCard).toHaveCount(0);
    await popup.reload();
    await expect(popup.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible();
    await expect(popup.locator('.card')).toHaveCount(0);
    await operatorPage.goto(app.origin + '/admin');
    await expect(operatorPage.getByRole('heading', { name: 'Админка доступна администратору' })).toBeVisible();
    await expect(operatorPage.getByRole('region', { name: 'Редактор сюжета' })).toHaveCount(0);
    expect((await operatorPage.request.get(app.origin + '/api/admin/slots')).status()).toBe(403);
    await operatorPage.screenshot({ path: join(artifacts, 'operator-admin-denied.png') });
    await operatorPage.getByRole('link', { name: 'Перейти к рабочему экрану' }).click();
    await expect(operatorPage).toHaveURL(app.origin + '/operator');
    await expect(operatorPage.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible();
  } finally { await operator.close(); await popup.close(); }
  expect(errors).toEqual([]);
  await writeFile(join(artifacts, 'results-access-observations.json'), JSON.stringify({
    adminPopupAndReload: true, adminEditorSessionPreserved: true, operatorAdminDenied: true,
    bothRolesRenderedReadyCard: true, privatePhotoFrameQrBytesMatch: true, fullscreenWithoutAdminChrome: true,
    inlineVideoOpened: true, enlargedQrDecoded: true, hideAppliedOnBothScreens: true,
    horizontalOverflow: false, pageErrors: errors, externalFalOrSmtp: false,
  }, null, 2) + '\n');
});
