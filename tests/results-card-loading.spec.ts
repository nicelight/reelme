import { test, expect, type Page, type Route } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import type { DisplaySession } from '../src/shared/display.js';

// Real Svelte/image decoding; only API and image responses are controlled.
const origin = 'http://127.0.0.1:4199';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
const ready = (n: number): DisplaySession => ({ id: String(n), number: n, stage: 4, label: 'Видео ждёт скачивания',
  error: null, simulation: null, hideAt: null, readyAt: n,
  card: { photoUrl: `/card/${n}/frame`, frameUrl: `/card/${n}/frame`, qrUrl: `/card/${n}/qr`, videoUrl: `/card/${n}/video` } });
let server: ChildProcess;
test.beforeAll(async () => {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4199', '--strictPort'], { stdio: 'ignore' });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error('Card fixture Vite exited');
    try { return (await fetch(origin)).ok; } catch { return false; }
  }, { timeout: 15_000 }).toBe(true);
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
    date: date(), serverNow: Date.now(), pageDurationSeconds: 10, sessions: sessions(), hiddenIds: [],
  } }));
  await page.route('**/api/display/*/load-failure', async route => {
    reports.push(route.request().postDataJSON()); await route.fulfill({ status: 503 });
  });
  return reports;
}
const fulfilImage = (route: Route) => route.fulfill({ contentType: 'image/png', body: pixel });

test('REELME advances the results before their timer by click or keyboard', async ({ page }) => {
  await projection(page, () => Array.from({ length: 12 }, (_, index) => ready(index + 1)));
  await page.route('**/card/**', fulfilImage);
  await page.goto(origin + '/results');
  const next = page.getByRole('button', { name: 'Следующая страница результатов' });
  await expect(next).toHaveText('REELME');
  const firstSlot = page.locator('.card[data-position="0"]');
  await expect(firstSlot).toHaveAttribute('data-session', '1');
  await next.click();
  await expect(firstSlot).toHaveAttribute('data-session', '10', { timeout: 3_000 });
  await expect(next).toBeEnabled();
  await next.press('Enter');
  await expect(firstSlot).toHaveAttribute('data-session', '7', { timeout: 3_000 });
});

test('the large QR pauses paging for five seconds and resumes the remaining interval', async ({ page }) => {
  await page.clock.install();
  let count = 10;
  await projection(page, () => Array.from({ length: count }, (_, index) => ready(index + 1)));
  await page.route('**/card/**', fulfilImage);
  await page.goto(origin + '/results');
  const ninth = page.locator('.card[data-session="9"]');
  await expect(ninth).toBeVisible();
  await page.clock.fastForward(7_500);
  await ninth.hover({ position: { x: 30, y: 30 } });
  await ninth.getByRole('button', { name: 'Большой QR' }).click();
  const dialog = page.getByRole('dialog', { name: /Большой QR.*009/ });
  await expect(dialog).toBeVisible();
  const image = dialog.getByRole('img');
  const initialSrc = await image.getAttribute('src');
  expect(initialSrc).toBeTruthy();
  const grid = page.locator('.grid');
  const firstVersion = await grid.getAttribute('data-page-version');
  count = 11;
  await page.clock.fastForward(4_000);
  await expect(grid).toHaveAttribute('data-page-version', firstVersion!);
  await expect(ninth).toHaveCount(1);
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', initialSrc!);
  await page.clock.fastForward(1_100);
  await expect(dialog).toHaveCount(0);
  await page.clock.fastForward(600);
  await expect(grid).toHaveAttribute('data-page-version', firstVersion!);
  await page.clock.fastForward(2_000);
  await page.clock.fastForward(400);
  await expect(grid).not.toHaveAttribute('data-page-version', firstVersion!);
  await expect(page.locator('.card[data-position="4"]')).toHaveAttribute('data-session', '11');
  await page.clock.fastForward(800);
  const tenth = page.locator('.card[data-session="10"]');
  await tenth.hover({ position: { x: 30, y: 30 } });
  await expect(tenth.getByRole('button', { name: 'Убрать с экрана' })).toBeVisible();
  const version = await grid.getAttribute('data-page-version');
  await page.clock.fastForward(11_000);
  await page.clock.fastForward(500);
  await expect(grid).not.toHaveAttribute('data-page-version', version!);
  await expect(page.getByRole('button', { name: 'Убрать с экрана' })).toHaveCount(0);
});

test.describe('touchscreen results', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });
  test('tapping the frame opens its actions, tapping the large QR dismisses it', async ({ page }) => {
    await projection(page);
    await page.route('**/card/**', fulfilImage);
    await page.goto(origin + '/results');
    const card = page.locator('.card[data-session="1"]');
    await expect(card).toBeVisible();
    const enlarge = card.getByRole('button', { name: 'Большой QR' });
    await expect(enlarge).toBeHidden();
    await card.tap({ position: { x: 25, y: 25 } });
    await expect(enlarge).toBeVisible();
    await expect(card.locator('.qr')).toBeVisible();
    await enlarge.tap();
    const dialog = page.getByRole('dialog', { name: /Большой QR.*001/ });
    await dialog.getByRole('img').tap();
    await expect(dialog).toHaveCount(0);
  });

  test('the compact action panel identifies the selected history and is keyboard accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await projection(page);
    await page.route('**/card/**', fulfilImage);
    await page.goto(origin + '/results');
    const next = page.getByRole('button', { name: 'Следующая страница результатов' });
    await expect(next).toBeDisabled();
    const trigger = page.getByRole('button', { name: 'Действия истории № 001' });
    await trigger.tap();
    const menu = page.getByRole('group', { name: 'Действия истории № 001' });
    await expect(menu.getByRole('button', { name: 'Большой QR' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await trigger.focus();
    await trigger.press('Enter');
    await expect(menu.getByRole('link', { name: 'Посмотреть' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(menu).toHaveCount(0);
  });
});

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
