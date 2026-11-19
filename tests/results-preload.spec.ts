import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';

// Real Svelte page and image decoding, with only the API boundary stubbed. No DB,
// camera, worker, fal or SMTP is needed to reproduce a static-resource failure.
test('results recover a failed stage preload without hiding its error on successful API polls', async ({ page }) => {
  const origin = 'http://127.0.0.1:4198';
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4198', '--strictPort'], { stdio: 'ignore' });
  let allowEgg = false; let eggAttempts = 0; let polls = 0;
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
  try {
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error('Preload fixture Vite exited');
      try { return (await fetch(origin)).ok; } catch { return false; }
    }).toBe(true);
    await page.route('**/api/auth/session', route => route.fulfill({ json: { role: 'operator' } }));
    await page.route('**/api/display/today', route => {
      polls++;
      return route.fulfill({ json: {
        date: '2026-11-17', serverNow: Date.now(), pageDurationSeconds: 10,
        sessions: [{ id: 'ready-fixture', number: 1, stage: 4, label: 'Видео ждёт скачивания',
          error: null, hideAt: null, readyAt: 1, simulation: null,
          card: { photoUrl: '/fixture.png', frameUrl: '/fixture.png', qrUrl: '/fixture.png' } }],
      } });
    });
    await page.route('**/fixture.png*', route => route.fulfill({ contentType: 'image/png', body: pixel }));
    await page.route(/\/egg\.png(?:\?.*)?$/, route => {
      if (route.request().resourceType() !== 'image') return route.continue();
      eggAttempts++;
      return allowEgg ? route.continue() : route.abort('failed');
    });
    await page.goto(origin + '/results');
    const error = page.getByText('Не удалось подготовить экран. Повторяем загрузку…', { exact: true });
    await expect(error).toBeVisible();
    await expect.poll(() => polls, { timeout: 8000 }).toBeGreaterThanOrEqual(3);
    await expect(error).toBeVisible(); // Successful polling must not erase the unresolved resource failure.
    expect(eggAttempts).toBe(1); // Retry is throttled, not started by every API response.
    await expect(page.locator('.card')).toHaveCount(0);
    allowEgg = true;
    await expect(page.locator('.card[data-session="1"]')).toBeVisible({ timeout: 10000 });
    await expect(error).toHaveCount(0);
    expect(eggAttempts).toBe(2);
    await expect(page.getByText('Подготавливаем экран…', { exact: true })).toHaveCount(0);
  } finally {
    await page.close();
    if (server.exitCode === null) {
      const stopped = new Promise<void>(resolve => server.once('exit', () => resolve()));
      server.kill('SIGTERM'); await stopped;
    }
  }
});
