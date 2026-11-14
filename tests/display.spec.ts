import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { openDatabase } from '../src/server/db.js';
import { preparedSession } from './receive-fixture.js';

test('Chromium operator journey: stages, QR, paging, email retry, durable deadline and preserved links', async ({ page, browser, request }) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), 'reelme-display-'));
  const dataDir = join(root, 'data'); const origin = 'http://127.0.0.1:3197';
  const artifacts = process.env.REELME_BROWSER_ARTIFACTS ?? '.tasks/TASK-010-T2-FT-004-W7';
  await mkdir(artifacts, { recursive: true }); await mkdir(dataDir);
  let now = Date.parse('2026-11-14T10:00:00Z'); let fail = true;
  const control = () => writeFile(join(dataDir, 'display-control.json'), JSON.stringify({ now, fail }));
  await control();
  execFileSync(process.execPath, ['--import', 'tsx', 'src/server/setup.ts'], { env: { ...process.env, DATA_DIR: dataDir, ADMIN_PASSWORD: 'test-password', OPERATOR_PASSWORD: 'test-password' }, stdio: 'pipe' });
  const video = join(root, 'fixture.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const bytes = await readFile(video);
  const seeds = [];
  for (let number = 1; number <= 8; number++) seeds.push(await preparedSession(dataDir, bytes, number));
  const db = openDatabase(dataDir);
  type Delivery = { receive_token: string; download_token: string; opened_at: number | null; email_confirmed_at: number | null; email_state: string };
  const row = () => db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(seeds[0].id) as Delivery;
  let child: ChildProcess | undefined;
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'tests/display-browser-server.ts'], { env: { ...process.env, DATA_DIR: dataDir }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Display fixture exited');
      try { if ((await fetch(origin)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Display fixture did not start');
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()));
      child.kill('SIGTERM'); await exited;
    }
  }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const visitor = await browser.newContext(); const form = await visitor.newPage();
  form.on('pageerror', error => errors.push(error.message));
  try {
    await start();
    for (const [i, state] of ['submit_pending', 'observing', 'preparing'].entries()) db.prepare('UPDATE capture_sessions SET state=? WHERE id=?').run(state, seeds[i].id);
    await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: 'Войти в аккаунт' })).toBeVisible();
    await expect(page.locator('.result-card')).toHaveCount(0);
    await page.getByLabel('Логин').fill('operator'); await page.getByLabel('Пароль').fill('test-password');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ваша история — здесь.' })).toBeVisible();
    await expect(page.locator('.result-card')).toHaveCount(3);
    await page.getByRole('button', { name: 'Приостановить смену страниц' }).click();
    const first = page.locator('[data-session="1"]');
    for (const [number, stage, color] of [[1, 1, 'rgb(219, 119, 158)'], [2, 2, 'rgb(152, 98, 197)'], [3, 3, 'rgb(125, 198, 223)']] as const) {
      const card = page.locator(`[data-session="${number}"]`);
      await expect(card.locator('.stage-bar .filled')).toHaveCount(stage);
      expect(await card.locator('.filled').first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe(color);
    }
    await expect(first).toContainText('Отправка на генерацию');
    await expect(page.locator('[data-session="2"]')).toContainText('Генерация');
    await expect(page.locator('[data-session="3"]')).toContainText('Подготовка для скачивания');
    await page.screenshot({ path: join(artifacts, 'display-stages-1-3-desktop.png'), fullPage: true });
    // Same session advances; preparing already has verified fixture files.
    for (const [state, stage] of [['observing', 2], ['preparing', 3], ['ready', 4]] as const) {
      db.prepare('UPDATE capture_sessions SET state=? WHERE id=?').run(state, seeds[0].id);
      await expect(first.locator('.stage-bar .filled')).toHaveCount(stage, { timeout: 5000 });
    }
    db.prepare("UPDATE capture_sessions SET state='capturing' WHERE id=?").run(seeds[2].id);
    await expect(page.locator('[data-session="3"]')).toContainText('Идёт съёмка');
    await expect(page.locator('[data-session="3"] .filled')).toHaveCount(0);
    db.prepare("UPDATE capture_sessions SET state='failed' WHERE id=?").run(seeds[2].id);
    await expect(page.locator('[data-session="3"]')).toContainText('Не удалось создать видео');
    await expect(page.locator('[data-session="3"] .result-qr')).toHaveCount(0);
    await expect(first).toContainText('Видео ждёт скачивания');
    expect(await first.locator('.filled').first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(175, 216, 140)');
    const images = first.locator('.result-images img');
    await expect(images).toHaveCount(2);
    expect(await images.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
    // Decode exactly the QR raster drawn in Chromium, including its rendered size.
    const qrShot = await first.getByAltText('QR формы получения видео № 1').screenshot();
    const png = await sharp(qrShot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.info.width, png.info.height)?.data;
    expect(decoded).toBe(`${origin}/receive/${row().receive_token}`);
    expect(row().opened_at).toBeNull(); expect(row().email_confirmed_at).toBeNull();
    await page.screenshot({ path: join(artifacts, 'display-ready-desktop.png'), fullPage: true });
    // Overflow pages cycle on a controlled 10-second clock and never open forms.
    await page.clock.install(); await page.clock.pauseAt(new Date());
    await page.getByRole('button', { name: 'Продолжить смену страниц' }).click();
    // DOM visibility alone misses clipped QR codes on short operator screens.
    // Never scroll a locator into view before measuring the actual viewport.
    const viewportChecks = [];
    for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [1920, 1300]]) {
      await page.setViewportSize({ width, height });
      await page.reload(); await expect(first).toBeVisible();
      await page.evaluate(() => scrollTo(0, 0));
      for (const phase of ['initial', 'next'] as const) {
        if (phase === 'next') {
          await page.clock.fastForward(10_000);
          await expect(page.locator(`[data-session="${height >= 1300 ? 7 : 4}"]`)).toBeVisible();
        }
        await expect.poll(() => page.locator('.result-qr').evaluateAll(nodes =>
          nodes.length > 0 && nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
        const bounds = await page.locator('.result-card, .result-qr').evaluateAll(nodes => nodes.map(node => {
          const { top, right, bottom, left, width, height } = node.getBoundingClientRect();
          return { kind: node.classList.contains('result-qr') ? 'qr' : 'card', top, right, bottom, left, width, height };
        }));
        expect(await page.evaluate(() => scrollY)).toBe(0);
        for (const box of bounds) {
          expect(box.top, `${width}x${height} ${phase} ${box.kind} top`).toBeGreaterThanOrEqual(0);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          expect(box.bottom, `${width}x${height} ${phase} ${box.kind} bottom`).toBeLessThanOrEqual(height);
          if (box.kind === 'qr') expect(box.width).toBe(height >= 1300 ? 128 : 154);
        }
        if (height <= 768) {
          const shot = await page.screenshot({ path: join(artifacts, `display-fit-${width}x${height}-${phase}.png`) });
          const box = bounds.find(box => box.kind === 'qr')!;
          const raster = await sharp(shot).extract({ left: Math.floor(box.left), top: Math.floor(box.top),
            width: Math.ceil(box.width), height: Math.ceil(box.height) }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const qr = jsQR(new Uint8ClampedArray(raster.data), raster.info.width, raster.info.height)?.data;
          const token = await page.locator('.result-card:has(.result-qr)').first().getAttribute('data-session');
          const delivery = db.prepare('SELECT receive_token FROM session_delivery WHERE session_id=?').get(seeds[Number(token) - 1].id) as Delivery;
          expect(qr).toBe(`${origin}/receive/${delivery.receive_token}`);
        }
        viewportChecks.push({ width, height, phase, bounds });
      }
    }
    await writeFile(join(artifacts, 'display-viewport-observations.json'), JSON.stringify(viewportChecks, null, 2) + '\n');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload(); await expect(first).toBeVisible();
    await page.clock.fastForward(9999); await expect(first).toBeVisible();
    await page.clock.fastForward(1); await expect(page.locator('[data-session="4"]')).toBeVisible();
    await page.clock.fastForward(10_000); await expect(page.locator('[data-session="7"]')).toBeVisible();
    await page.clock.fastForward(10_000); await expect(first).toBeVisible();
    expect(row().opened_at).toBeNull();
    await page.getByRole('button', { name: 'Приостановить смену страниц' }).click();
    await form.goto(decoded!); await expect(form.getByRole('heading', { name: 'История № 1' })).toBeVisible();
    expect((await visitor.cookies()).some(cookie => cookie.name === 'reelme')).toBe(false);
    await expect.poll(() => row().opened_at).not.toBeNull();
    await page.clock.fastForward(2100); await expect(first).toContainText('Видео в процессе получения клиентом');
    await expect(first.locator('.filled')).toHaveCount(5);
    expect(await first.locator('.filled').first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(75, 156, 95)');
    now += 240_000; await control(); await page.reload(); await expect(first).toBeVisible();
    expect(row().email_confirmed_at).toBeNull();
    await page.getByRole('button', { name: 'Приостановить смену страниц' }).click();
    await form.getByLabel('Ваш email').fill('mailname@example.com');
    await form.getByRole('button', { name: 'Получить видео по email' }).click();
    await expect.poll(() => row().email_state).toBe('failed');
    const confirmed = row().email_confirmed_at!;
    await page.clock.fastForward(2100); await expect(first).toContainText('Письмо не подтверждено');
    await expect(first.locator('.filled')).toHaveCount(5);
    await page.screenshot({ path: join(artifacts, 'display-mail-error.png'), fullPage: true });
    await stop(); await start(); expect(row().email_confirmed_at).toBe(confirmed);
    fail = false; now += 30_000; await control();
    await form.reload(); await form.getByLabel('Ваш email').fill('mailname@example.com');
    await form.getByRole('button', { name: 'Повторить отправку' }).click();
    await expect.poll(() => row().email_state).toBe('sent');
    await page.clock.fastForward(2100); await expect(first).toContainText('Видео отправлено на mailname***@***.com');
    expect(row().email_confirmed_at).toBe(confirmed);
    await expect(first.locator('.filled')).toHaveCount(6);
    const fillColors = await first.locator('.filled').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    expect(new Set(fillColors)).toEqual(new Set(['rgb(77, 98, 56)']));
    expect(await page.locator('body').innerText()).not.toContain('mailname@example.com');
    const payload = await (await page.request.get(origin + '/api/display/today')).text();
    expect(payload).not.toMatch(/mailname@example\.com|fixture.test|download_token/);
    await page.getByRole('button', { name: 'Тёмная тема' }).click();
    await page.screenshot({ path: join(artifacts, 'display-sent-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(first).toBeVisible(); await expect(page.locator('.result-card')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(artifacts, 'display-mobile-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    // The old deadline remains across restart, retry, reload and a failed poll.
    now = confirmed + 179_000; await control(); await page.reload();
    await expect(first.locator('.result-progress')).toBeVisible(); await expect(first.locator('.result-qr')).toBeVisible();
    await page.screenshot({ path: join(artifacts, 'display-2m59.png'), fullPage: true });
    await page.route('**/api/display/today', route => route.abort());
    await page.clock.fastForward(1001); await expect(first).toHaveCount(0);
    now = confirmed + 180_000; await control(); await page.unroute('**/api/display/today');
    await page.reload(); await expect(first).toHaveCount(0);
    await page.screenshot({ path: join(artifacts, 'display-3m00.png'), fullPage: true });
    expect(row().email_confirmed_at).toBe(confirmed);
    expect((await request.get(decoded!)).status()).toBe(200);
    expect(await (await request.get(`${origin}/download/${row().download_token}`)).body()).toEqual(bytes);
    expect(await readFile(join(dataDir, 'media', seeds[0].video_path))).toEqual(bytes);
    now = Date.parse('2026-11-14T17:00:00Z'); await control(); await page.reload();
    await expect(page.getByRole('heading', { name: 'Здесь появится ваше видео.' })).toBeVisible();
    expect((await request.get(decoded!)).status()).toBe(200);
    expect(await (await request.get(`${origin}/download/${row().download_token}`)).body()).toEqual(bytes);
    expect(errors).toEqual([]);
    await writeFile(join(artifacts, 'display-observations.json'), JSON.stringify({ browser: 'Chromium', stages: [1, 2, 3, 4, 5, 6], filledSegmentsMatchStage: true, capturingNotGeneration: true, generationFailureNoSuccess: true, currentStageColorAcrossFilledBar: true, qrDecodedFromRenderedCard: true, noOpenedFromDisplayOrMedia: true, pagingMilliseconds: 10000, wraps: true, unauthenticatedQrForm: true, email: 'real worker / injected local transport / failed then sent', firstConfirmationSurvivesRetryRestartReload: true, visibleAtSeconds: 179, hiddenAtSeconds: 180, hiddenWithoutSuccessfulPoll: true, fullEmailAbsent: true, mobileWidth: 375, theme: ['light', 'dark'], filesAndLinksPreservedAfterHideAndDayChange: true, archiveUi: 'deferred to FT-005', pageErrors: errors, externalFalOrSmtp: false }, null, 2) + '\n');
  } finally { await visitor.close(); await stop(); db.close(); await rm(root, { recursive: true, force: true }); }
});
