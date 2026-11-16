import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/server/db.js';
import { preparedSession } from './receive-fixture.js';

test('Chromium preparation header: stable preparation slots, hide/restore, hatch labels and control-only safe errors', async ({ page }) => {
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
  try {
    await start();
    for (const [i, state] of ['submit_pending', 'observing', 'preparing'].entries()) db.prepare('UPDATE capture_sessions SET state=? WHERE id=?').run(state, seeds[i].id);
    await page.setViewportSize({ width: 1672, height: 941 });
    await page.goto(origin + '/?screen=results');
    await page.getByLabel('Логин').fill('operator'); await page.getByLabel('Пароль', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.locator('.progress-panel')).toBeVisible();
    await expect(page.locator('.progress-slot')).toHaveCount(3);
    for (const [number, stage] of [[1, 1], [2, 2], [3, 3]]) {
      await expect(page.locator(`[data-progress-session="${number}"]`)).toHaveAttribute('data-stage', String(stage));
    }
    await expect(page.locator('[data-progress-session="1"]')).toContainText('Отправка на генерацию');
    await expect(page.locator('[data-progress-session="2"]')).toContainText('Генерация');
    await expect(page.locator('[data-progress-session="3"]')).toContainText('Подготовка для скачивания');
    await expect(page.locator('.card .stage-bar, .card button')).toHaveCount(0);
    await page.locator('[data-progress-session="2"]').click();
    await expect(page.locator('.progress-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'StatusShow', exact: true }).click();
    await expect(page.locator('.progress-panel')).toBeVisible();
    db.prepare("UPDATE capture_sessions SET state='ready' WHERE id=?").run(seeds[0].id);
    await expect(page.locator('[data-progress-session="1"]')).toContainText('вот вот вылупится :)', { timeout: 6000 });
    await expect(page.locator('[data-progress-session="1"]')).toHaveAttribute('data-progress-position', '0');
    await expect(page.locator('[data-progress-session="2"]')).toHaveAttribute('data-progress-position', '1');
    await expect(page.locator('[data-progress-session="3"]')).toHaveAttribute('data-progress-position', '2');
    await expect(page.locator('[data-progress-session="1"]')).toContainText('готово', { timeout: 12000 });
    db.prepare("UPDATE capture_sessions SET state='observing' WHERE id=?").run(seeds[3].id);
    await expect(page.locator('[data-progress-session="4"]')).toHaveAttribute('data-progress-position', '0', { timeout: 6000 });
    await expect(page.locator('[data-progress-session="1"]')).toHaveCount(0);
    await expect(page.locator('[data-progress-session="2"]')).toHaveAttribute('data-progress-position', '1');
    await expect(page.locator('[data-progress-session="3"]')).toHaveAttribute('data-progress-position', '2');
    db.prepare("UPDATE capture_sessions SET state='failed' WHERE id=?").run(seeds[2].id);
    await expect(page.locator('[data-progress-session="3"]')).toHaveCount(0, { timeout: 6000 });
    await expect(page.locator('.operator-issues')).toHaveCount(0);
    await page.screenshot({ path: join(artifacts, 'production-progress-header.png') });
    await page.goto(origin);
    await expect(page.locator('[data-issue-session="3"]')).toContainText('Не удалось создать видео');
    const payload = await (await page.request.get(origin + '/api/display/today')).text();
    expect(payload).not.toMatch(/fixture.test|download_token/);
    expect(errors).toEqual([]);
  } finally { await stop(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('Chromium simulation: actual no-key worker shows honest success and safe preparation failure without QR or real stages', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'reelme-simulation-ui-'));
  const infoPath = join(root, 'fixture.json'); const origin = 'http://127.0.0.1:3197';
  const artifacts = process.env.REELME_BROWSER_ARTIFACTS ?? '.tasks/TASK-013-T3-FT-006-W10';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/simulation-browser-server.ts'], { env: { ...process.env, FIXTURE_INFO: infoPath }, stdio: 'ignore' });
  let db: ReturnType<typeof openDatabase> | undefined;
  try {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Simulation fixture exited');
      try { const info = JSON.parse(await readFile(infoPath, 'utf8')); db = openDatabase(info.dataDir); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!db) throw new Error('Simulation fixture did not start');
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(origin);
    await page.getByLabel('Логин').fill('operator'); await page.getByLabel('Пароль', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const success = page.locator('[data-issue-session="1"]'); const failed = page.locator('[data-issue-session="2"]');
    await expect(success).toContainText('Эмуляция успешна, но fal не отвечает');
    await expect(success).toContainText('Тестовый режим: fal не вызывался');
    await expect(failed).toContainText('Эмуляция не завершена');
    await expect(failed).toContainText('Не удалось подготовить фотографии или материалы сюжета. Обратитесь к сотруднику.');
    await expect(page.locator('.card .stage-bar, .card .qr, .card video')).toHaveCount(0);
    await expect(page.getByText('Фото и QR появятся здесь', { exact: false })).toHaveCount(0);
    expect(db.prepare('SELECT 1 FROM session_delivery LIMIT 1').get()).toBeUndefined();
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, 'display-simulation-desktop.png'), fullPage: true });
    await page.reload(); await expect(success).toContainText('Эмуляция успешна, но fal не отвечает');
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(success).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(artifacts, 'display-simulation-mobile.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    db?.close();
    if (child.exitCode === null) { const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGTERM'); await exited; }
    await rm(root, { recursive: true, force: true });
  }
});
