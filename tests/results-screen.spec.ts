import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { openDatabase } from '../src/server/db.js';
import { preparedSession } from './receive-fixture.js';
import { publishReady } from '../src/server/sessions/receive.js';

test('production results: admin timing, real preload/QR, first fill and stable paged arrivals', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const root = await mkdtemp(join(tmpdir(), 'reelme-results-ui-'));
  const dataDir = join(root, 'data'); const origin = 'http://127.0.0.1:3197';
  const artifacts = process.env.REELME_BROWSER_ARTIFACTS ?? '.tasks/TASK-020-T2-FT-004-W17';
  await mkdir(dataDir); await mkdir(artifacts, { recursive: true });
  let now = Date.parse('2026-11-14T10:00:00Z');
  const control = () => writeFile(join(dataDir, 'display-control.json'), JSON.stringify({ now, fail: false }));
  await control();
  execFileSync(process.execPath, ['--import', 'tsx', 'src/server/setup.ts'], { env: { ...process.env, DATA_DIR: dataDir, ADMIN_PASSWORD: 'test-password', OPERATOR_PASSWORD: 'test-password' }, stdio: 'pipe' });
  const video = join(root, 'fixture.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=purple:s=480x320:d=1:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const bytes = await readFile(video); const seeds = [];
  for (let n = 1; n <= 11; n++) seeds.push(await preparedSession(dataDir, bytes, n));
  const db = openDatabase(dataDir);
  for (const seed of seeds) await publishReady(db, dataDir, seed.id, origin, () => now);
  db.prepare("UPDATE capture_sessions SET state='capturing'").run();
  const ready = (n: number) => {
    db.prepare("UPDATE capture_sessions SET state='ready' WHERE id=?").run(seeds[n - 1].id);
    db.prepare('UPDATE generation_jobs SET ready_at=? WHERE session_id=?').run(now + n, seeds[n - 1].id);
  };
  let child: ChildProcess | undefined;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const admin = await browser.newContext(); const settings = await admin.newPage();
  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'tests/display-browser-server.ts'], { env: { ...process.env, DATA_DIR: dataDir }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Fixture server exited');
      try { if ((await fetch(origin)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect((await request.get(origin + '/api/display/today')).status()).toBe(401);
    await settings.goto(origin + '/admin');
    await settings.getByLabel('Логин').fill('admin'); await settings.getByLabel('Пароль', { exact: true }).fill('test-password');
    await settings.getByRole('button', { name: 'Войти', exact: true }).click();
    await settings.getByRole('button', { name: 'Параметры', exact: true }).click();
    const duration = settings.getByLabel('Длительность показа страницы');
    expect(await duration.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value))).toEqual(['10','20','30','40','50','60']);
    await duration.selectOption('20'); await settings.getByRole('button', { name: 'Сохранить настройку' }).click();
    await expect.poll(async () => (await (await settings.request.get(origin + '/api/admin/display-settings')).json()).pageDurationSeconds).toBe(20);
    expect((await settings.request.get(origin + '/api/display/today')).status()).toBe(200);
    await page.setViewportSize({ width: 1672, height: 941 });
    await page.goto(origin + '/results');
    await page.getByLabel('Логин').fill('operator'); await page.getByLabel('Пароль', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible();
    await expect(page.locator('.app-header, .surface-nav, .lab')).toHaveCount(0);
    await expect(page.locator('.card')).toHaveCount(0);
    expect((await page.request.put(origin + '/api/admin/display-settings', { headers: { Origin: origin }, data: { pageDurationSeconds: 30 } })).status()).toBe(403);
    ready(1);
    const center = page.locator('.card[data-position="4"]');
    await expect(center).toHaveAttribute('data-session', '1', { timeout: 8000 });
    await expect.poll(() => center.locator('.portrait, .qr').evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expect(page.locator('.grid')).toHaveAttribute('data-phase', 'result', { timeout: 8000 });
    for (let n = 2; n <= 9; n++) ready(n);
    await expect(page.locator('.card[data-position="0"]')).toHaveAttribute('data-session', '1', { timeout: 8000 });
    await expect(center).toHaveAttribute('data-session', '9', { timeout: 65_000 });
    await expect(page.locator('.grid')).toHaveAttribute('data-phase', 'result', { timeout: 8000 });
    await expect(page.locator('.card')).toHaveCount(9);
    const ids = () => page.locator('.card').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-session')));
    expect(new Set(await ids()).size).toBe(9);
    await expect(page.locator('.card button, .card .stage-bar')).toHaveCount(0);
    const first = page.locator('.card[data-session="1"]');
    const qrPng = await sharp(await first.locator('.qr').screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(qrPng.data), qrPng.info.width, qrPng.info.height)?.data;
    const delivery = db.prepare('SELECT receive_token,opened_at FROM session_delivery WHERE session_id=?').get(seeds[0].id) as {receive_token: string; opened_at: number | null};
    expect(decoded).toBe(`${origin}/receive/${delivery.receive_token}`); expect(delivery.opened_at).toBeNull();
    await page.screenshot({ path: join(artifacts, 'production-results-A.png') });
    const snapshot = await ids(); const version = await page.locator('.grid').getAttribute('data-page-version');
    ready(10); ready(11);
    await page.waitForTimeout(2600);
    expect(await ids()).toEqual(snapshot);
    await expect(page.locator('.grid')).not.toHaveAttribute('data-page-version', version!, { timeout: 22000 });
    await expect(center).toHaveAttribute('data-session', '10');
    expect(await ids()).not.toContain('11');
    expect(new Set(await ids()).size).toBe(9);
    await expect(page.locator('.grid')).toHaveAttribute('data-phase', 'result', { timeout: 8000 });
    // The active page is immutable even if an old session leaves future queues.
    const current = await ids();
    const oldNumber = Number(current.find(n => n !== '10'));
    db.prepare('UPDATE session_delivery SET email_confirmed_at=? WHERE session_id=?').run(now - 180001, seeds[oldNumber - 1].id);
    await page.waitForTimeout(2600); expect(await ids()).toEqual(current);
    const nextVersion = await page.locator('.grid').getAttribute('data-page-version');
    await expect(page.locator('.grid')).not.toHaveAttribute('data-page-version', nextVersion!, { timeout: 22000 });
    await expect(center).toHaveAttribute('data-session', '11');
    expect(await ids()).not.toContain(String(oldNumber));
    expect((await request.get(decoded!)).status()).toBe(200);
    // A reload must decode the existing gallery again without downloading its images.
    const network = await page.context().newCDPSession(page);
    await network.send('Network.enable');
    const images = new Set<string>();
    const statuses = new Map<string, number>();
    network.on('Network.requestWillBeSent', ({ requestId, request: resource }) => {
      if (/\/api\/display\/[^/]+\/(frame|qr)$/.test(resource.url)) images.add(requestId);
    });
    network.on('Network.responseReceivedExtraInfo', ({ requestId, statusCode }) => statuses.set(requestId, statusCode));
    await page.reload();
    await expect(page.locator('.card')).toHaveCount(9, { timeout: 12_000 });
    expect(images.size).toBeGreaterThanOrEqual(18);
    for (const id of images) {
      // Memory-cache hits need no HTTP response. Revalidation returns headers only.
      if (statuses.has(id)) expect(statuses.get(id)).toBe(304);
    }
    await network.detach();
    expect(errors).toEqual([]);
    await writeFile(join(artifacts, 'production-results-observations.json'), JSON.stringify({ firstFill: 9, pageDurationSeconds: 20, qrDecoded: true, stableMidpageArrivals: true, oneHatchPerPage: true, expiresAtBoundary: true, errors }, null, 2));
  } finally {
    await admin.close();
    if (child && child.exitCode === null) { const exited = new Promise<void>(resolve => child!.once('exit', resolve)); child.kill('SIGTERM'); await exited; }
    db.close(); await rm(root, { recursive: true, force: true });
  }
});
