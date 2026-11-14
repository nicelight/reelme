import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { openDatabase } from '../src/server/db.js';
import { preparedSession } from './receive-fixture.js';

test('visitor form at mobile/desktop: validation, pending, retry, sent, restart and download', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'reelme-receive-ui-'));
  const artifacts = process.env.REELME_BROWSER_ARTIFACTS ?? '.tasks/TASK-008-T3-FT-003-W5';
  await mkdir(artifacts, { recursive: true });
  const dataDir = join(root, 'data');
  const video = join(root, 'fixture.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=2:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const bytes = await readFile(video);
  const session = await preparedSession(dataDir, bytes);
  const config = { dataDir, clientDir: resolve('dist/client'), origin: 'http://127.0.0.1:3198', host: '127.0.0.1', port: 3198 };
  let child: ChildProcess | undefined;
  async function stop() {
    if (child && child.exitCode === null) {
      const stopped = new Promise<void>(resolve => child!.once('exit', () => resolve()));
      child.kill('SIGTERM'); await stopped;
    }
  }
  async function start() {
    child = spawn(process.execPath, ['dist/server/main.js'], { env: { ...process.env, FAL_KEY: '', APP_ORIGIN: config.origin, HOST: config.host, PORT: String(config.port), DATA_DIR: dataDir }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Receive test server exited');
      try { if ((await fetch(config.origin)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Receive test server did not start');
  }
  const db = openDatabase(dataDir);
  const row = () => db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id) as { receive_token: string; download_token: string; email_confirmed_at: number | null; opened_at: number | null; email_state: string; email: string | null };
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await start();
    const route = `${config.origin}/receive/${row().receive_token}`;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'История № 1' })).toBeVisible();
    await expect(page.getByAltText('Ваш исходный снимок, сессия № 1')).toBeVisible();
    await expect.poll(() => page.getByRole('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(400);
    expect(row().opened_at).toBeTruthy(); expect(row().email_confirmed_at).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(artifacts, 'receive-mobile.png'), fullPage: true });
    const input = page.getByLabel('Ваш email');
    await input.fill('invalid');
    await page.getByRole('button', { name: 'Получить видео по email' }).click();
    expect(await input.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
    expect(row().email_state).toBe('not_requested');
    // Valid browser syntax but a server-rejected address preserves the form.
    await input.fill('test@localhost');
    await page.getByRole('button', { name: 'Получить видео по email' }).click();
    await expect(page.getByRole('alert')).toContainText('Введите корректный email');
    await expect(input).toHaveValue('test@localhost');
    await input.fill('visitor@example.test');
    await page.getByRole('button', { name: 'Получить видео по email' }).click();
    await expect(page.getByRole('status')).toHaveText('Email принят. Письмо ожидает отправки.');
    await expect(input).toHaveCount(0); expect(row().email_state).toBe('pending');
    const confirmedAt = row().email_confirmed_at; expect(confirmedAt).toBeTruthy();
    await page.screenshot({ path: join(artifacts, 'receive-pending.png'), fullPage: true });
    db.prepare("UPDATE session_delivery SET email_state='sending' WHERE session_id=?").run(session.id);
    await expect(page.getByRole('status')).toContainText('Отправляем письмо', { timeout: 6000 });
    db.prepare("UPDATE session_delivery SET email_state='failed' WHERE session_id=?").run(session.id);
    await expect(page.getByRole('button', { name: 'Повторить отправку' })).toBeVisible({ timeout: 6000 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.screenshot({ path: join(artifacts, 'receive-retry-desktop-dark.png'), fullPage: true });
    await input.fill('corrected@example.test');
    await page.getByRole('button', { name: 'Повторить отправку' }).click();
    await expect(page.getByRole('status')).toContainText('Письмо ожидает отправки');
    expect(row().email).toBe('corrected@example.test'); expect(row().email_confirmed_at).toBe(confirmedAt);
    await stop(); await start();
    await page.reload(); await expect(page.getByRole('status')).toContainText('Письмо ожидает отправки');
    expect(row().email_confirmed_at).toBe(confirmedAt);
    db.prepare("UPDATE session_delivery SET email_state='sent' WHERE session_id=?").run(session.id);
    await expect(page.getByRole('status')).toContainText('Письмо отправлено.', { timeout: 6000 });
    await expect(page.getByRole('button')).toHaveCount(0);
    await page.screenshot({ path: join(artifacts, 'receive-sent-desktop-dark.png'), fullPage: true });
    const download = page.waitForEvent('download');
    await page.evaluate(url => { const a = document.createElement('a'); a.href = url; a.click(); }, `${config.origin}/download/${row().download_token}`);
    const saved = await download; expect(saved.suggestedFilename()).toBe('reelme-1.mp4');
    expect(await readFile((await saved.path())!)).toEqual(bytes);
    const bad = await request.get(`${config.origin}/receive/invalid`); expect(bad.status()).toBe(404);
    expect(errors).toEqual([]);
    await writeFile(join(artifacts, 'browser-observations.json'), JSON.stringify({ browser: 'Chromium', viewport: ['375x812 light', '1280x900 dark reduced-motion'], checks: ['original photo loaded', 'opened without confirmation', 'native and server email validation', 'pending without false sent', 'sending poll', 'failed retry with corrected address', 'fixed first confirmation', 'restart preserves pending', 'sent only from seeded worker state', 'real browser download matches MP4 bytes', 'invalid link 404', 'no horizontal overflow at 375px'], pageErrors: errors, externalMail: false, liveFal: false, uiQaLauncher: 'unavailable; authorized project-native Playwright fallback' }, null, 2) + '\n');
  } finally { await stop(); db.close(); await rm(root, { recursive: true, force: true }); }
});
