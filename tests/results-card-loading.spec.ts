import { test, expect, type Page, type Route } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import type { DisplaySession } from '../src/shared/display.js';

// Real Svelte/image decoding; only API and image responses are controlled.
const origin = 'http://127.0.0.1:4199';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
const ready = (n: number): DisplaySession => ({ id: String(n), number: n, stage: 4, label: 'Видео ждёт скачивания',
  error: null, simulation: null, hideAt: null, readyAt: n,
  card: { photoUrl: `/card/${n}/frame`, frameUrl: `/card/${n}/frame`, qrUrl: `/card/${n}/qr` } });
let server: ChildProcess;
test.beforeAll(async () => {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4199', '--strictPort'], { stdio: 'ignore' });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error('Card fixture Vite exited');
    try { return (await fetch(origin)).ok; } catch { return false; }
  }).toBe(true);
});
test.afterAll(async () => {
  if (server?.exitCode === null) {
    const stopped = new Promise<void>(resolve => server.once('exit', () => resolve()));
    server.kill('SIGTERM'); await stopped;
  }
});
async function projection(page: Page, sessions: () => DisplaySession[] = () => [ready(1), ready(2)], date = () => '2026-11-17') {
  const reports: unknown[] = [];
  await page.route('**/api/auth/session', route => route.fulfill({ json: { role: 'operator' } }));
  await page.route('**/api/display/today', route => route.fulfill({ json: {
    date: date(), serverNow: Date.now(), pageDurationSeconds: 10, sessions: sessions(),
  } }));
  await page.route('**/api/display/*/load-failure', async route => {
    reports.push(route.request().postDataJSON()); await route.fulfill({ status: 503 });
  });
  return reports;
}
const fulfilImage = (route: Route) => route.fulfill({ contentType: 'image/png', body: pixel });

test('first window delays its card behind healthy waiters; old card returns without a hatch', async ({ page }) => {
  const reports = await projection(page);
  const attempts = new Set<string>(); const release = Promise.withResolvers<void>();
  await page.route('**/card/**', async route => {
    if (!route.request().url().includes('/1/frame')) return fulfilImage(route);
    attempts.add(route.request().url());
    if (attempts.size <= 2) return route.fulfill({ status: 404 });
    await release.promise; return fulfilImage(route);
  });
  await page.goto(origin + '/results');
  await expect(page.locator('.card[data-session="2"]')).toBeVisible();
  await expect(page.locator('.card[data-session="1"]')).toHaveCount(0);
  await expect.poll(() => attempts.size).toBe(3);
  release.resolve();
  const restored = page.locator('.card[data-session="1"]');
  await expect(restored).toBeVisible(); await expect(restored).not.toHaveClass(/incubating/);
  await expect(page.locator('.card[data-session="2"]')).toBeVisible();
  await page.waitForTimeout(2200);
  expect(attempts.size).toBe(3); expect(reports).toEqual([]);
});

test('two exhausted windows deprecate once; late responses and polling cannot revive the card', async ({ page }) => {
  const reports = await projection(page);
  const attempts = new Set<string>(); const held: Route[] = [];
  await page.route('**/card/**', route => {
    if (!route.request().url().includes('/1/frame')) return fulfilImage(route);
    attempts.add(route.request().url()); held.push(route);
  });
  await page.goto(origin + '/results');
  await expect(page.locator('.card[data-session="2"]')).toBeVisible({ timeout: 8500 });
  await expect(page.locator('[data-progress-session="1"]')).toHaveText(/пройдите фотосессию снова/, { timeout: 8500 });
  expect(attempts.size).toBe(4);
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]).toEqual({ attempts: 4, reason: 'timeout' });
  for (const route of held) await fulfilImage(route).catch(() => {});
  await page.waitForTimeout(2200);
  await expect(page.locator('.card[data-session="1"]')).toHaveCount(0);
  await expect(page.locator('[data-progress-session="1"]')).toHaveCount(1);
  expect(attempts.size).toBe(4); expect(reports.length).toBe(1);
});

test('unmount cancels the active window without retries or a failure report', async ({ page }) => {
  const reports = await projection(page);
  let attempts = 0;
  await page.route('**/card/**', route => {
    if (!route.request().url().includes('/1/frame')) return fulfilImage(route);
    attempts++;
  });
  await page.goto(origin + '/results');
  await expect.poll(() => attempts).toBe(1);
  await page.goto('about:blank');
  await page.waitForTimeout(3500);
  expect(attempts).toBe(1); expect(reports).toEqual([]);
});

test('multiple delayed cards get their final turn without circular waiting', async ({ page }) => {
  const reports = await projection(page, () => [ready(1), ready(2), ready(3)]);
  const attempts = new Map<string, Set<string>>();
  await page.route('**/card/**', route => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/')[2];
    if (id === '3' || !url.pathname.endsWith('/frame')) return fulfilImage(route);
    const seen = attempts.get(id) ?? new Set(); seen.add(url.href); attempts.set(id, seen);
    return route.fulfill({ status: 404 });
  });
  await page.goto(origin + '/results');
  await expect(page.locator('.card[data-session="3"]')).toBeVisible();
  await expect(page.locator('.progress-label').filter({ hasText: 'пройдите фотосессию снова' }).first()).toBeVisible();
  await expect.poll(() => reports.length).toBe(2);
  expect([...attempts.values()].map(value => value.size)).toEqual([4, 4]);
});

test('a new day ignores the previous pending image and resets local loading state', async ({ page }) => {
  let date = '2026-11-17'; let old: Route | undefined; let attempts = 0;
  const reports = await projection(page, () => [ready(date === '2026-11-17' ? 1 : 2)], () => date);
  await page.route('**/card/**', route => {
    if (!route.request().url().includes('/1/frame')) return fulfilImage(route);
    attempts++; old = route;
  });
  await page.goto(origin + '/results');
  await expect.poll(() => attempts).toBe(1);
  date = '2026-11-18';
  await expect(page.locator('.card[data-session="2"]')).toBeVisible();
  await fulfilImage(old!).catch(() => {});
  await page.waitForTimeout(3300);
  await expect(page.locator('.card[data-session="1"]')).toHaveCount(0);
  expect(attempts).toBe(1); expect(reports).toEqual([]);
});
