import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { openDatabase } from '../src/server/db.js';
import { preparedSession } from './receive-fixture.js';
import { attachedBytes, smtpFixture } from './email-smtp.js';

test('real worker form: pending, sending, uncertain failure and explicit corrected retry to sent', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'reelme-email-ui-'));
  const artifacts = process.env.REELME_BROWSER_ARTIFACTS ?? '.tasks/TASK-009-T3-FT-004-W6';
  await mkdir(artifacts, { recursive: true });
  const config = { dataDir: join(root, 'data'), clientDir: resolve('dist/client'), origin: 'http://127.0.0.1:3197', host: '127.0.0.1', port: 3197 };
  const video = join(root, 'fixture.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const bytes = await readFile(video); const session = await preparedSession(config.dataDir, bytes);
  const smtp = await smtpFixture(15_000); let acknowledge!: (value: string | null) => void;
  smtp.setAction(() => new Promise<string | null>(resolve => { acknowledge = resolve; }));
  let child: ChildProcess | undefined;
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'tests/email-browser-server.ts'], {
      env: { ...process.env, DATA_DIR: config.dataDir, EMAIL_TEST_SMTP_PORT: String(smtp.port) }, stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Email test server exited');
      try { if ((await fetch(config.origin)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Email test server did not start');
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()));
      child.kill('SIGTERM'); await exited;
    }
  }
  const db = openDatabase(config.dataDir);
  const row = () => db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id) as { receive_token: string; download_token: string; email_confirmed_at: number; email_state: string };
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await start();
    const route = `${config.origin}/receive/${row().receive_token}`;
    await page.setViewportSize({ width: 375, height: 812 }); await page.goto(route);
    await expect(page.getByRole('heading', { name: 'История № 1' })).toBeVisible();
    const email = page.getByLabel('Ваш email'); await email.fill('visitor@example.test');
    await page.getByRole('button', { name: 'Получить видео по email' }).click();
    await expect(page.getByRole('status')).toContainText('Письмо ожидает отправки');
    const confirmed = row().email_confirmed_at;
    await expect(page.getByRole('status')).toContainText('Отправляем письмо', { timeout: 6000 });
    await expect(page.getByRole('button')).toHaveCount(0); expect(row().email_state).toBe('sending');
    await page.screenshot({ path: join(artifacts, 'email-sending-mobile.png'), fullPage: true });
    // Lose the server's final acknowledgement after receiving a complete MIME body.
    acknowledge(null);
    await expect(page.getByRole('status')).toContainText('Письмо могло уже уйти', { timeout: 6000 });
    await expect(page.getByRole('button', { name: 'Повторить отправку' })).toBeVisible();
    expect(smtp.messages.length).toBe(1); expect(row().email_state).toBe('failed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(artifacts, 'email-uncertain-mobile.png'), fullPage: true });
    await page.reload(); await expect(page.getByRole('button', { name: 'Повторить отправку' })).toBeVisible();
    expect(smtp.messages.length).toBe(1); expect(row().email_confirmed_at).toBe(confirmed);
    await email.fill('corrected@example.test'); await page.getByRole('button', { name: 'Повторить отправку' }).click();
    await expect.poll(() => smtp.messages.length).toBe(2);
    expect(row().email_state).toBe('sending'); expect(row().email_confirmed_at).toBe(confirmed);
    expect(smtp.messages[1].recipient).toBe('corrected@example.test'); expect(attachedBytes(smtp.messages[1].raw)).toEqual(bytes);
    acknowledge('250 2.0.0 Accepted');
    await expect(page.getByRole('status')).toContainText('Письмо отправлено.', { timeout: 6000 });
    await expect(page.getByRole('button')).toHaveCount(0); expect(row().email_state).toBe('sent');
    await page.setViewportSize({ width: 1280, height: 900 }); await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: join(artifacts, 'email-sent-desktop-dark.png'), fullPage: true });
    const api = `${config.origin}/api/receive/${row().receive_token}`;
    expect((await request.post(api + '/email', { data: { email: 'repeat@example.test' } })).status()).toBe(409);
    expect(smtp.messages.length).toBe(2); expect(row().email_confirmed_at).toBe(confirmed);
    expect(await (await request.get(`${config.origin}/download/${row().download_token}`)).body()).toEqual(bytes);
    expect(errors).toEqual([]);
    await writeFile(join(artifacts, 'browser-observations.json'), JSON.stringify({ browser: 'Chromium', transport: 'real Nodemailer → loopback SMTP only', states: ['pending', 'sending', 'failed (lost acknowledgement)', 'pending (manual correction)', 'sending', 'sent'], smtpMessages: 2, automaticRetries: 0, firstConfirmationUnchanged: true, attachmentMatchesDownload: true, repeatAfterSent: 409, pageErrors: errors, externalMail: false, liveFal: false, uiQaLauncher: 'unavailable; authorized project-native Playwright fallback' }, null, 2) + '\n');
  } finally { acknowledge?.(null); await stop(); await smtp.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
