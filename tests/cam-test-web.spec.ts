import { test, expect } from './browser-fixture';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const library = '/cam-test-web-assets/v0.4.1/build';

test.use({ capturePort: 0 });

test('the isolated camera page initializes its same-origin WASM runtime', async ({ page, app }) => {
  const response = await page.goto(app.origin + '/cam-test-web');
  expect(response?.status()).toBe(200);
  const windowsSetup = page.getByRole('region', { name: 'Подключение и драйвер Windows' });
  await expect(windowsSetup.getByRole('link', { name: 'Скачайте Zadig' })).toBeVisible();
  await expect(windowsSetup.getByRole('listitem')).toHaveCount(5);
  expect(await windowsSetup.evaluate(node =>
    Boolean(node.compareDocumentPosition(document.querySelector('button')!) & Node.DOCUMENT_POSITION_FOLLOWING)
  )).toBe(true);
  expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin');
  expect(response?.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  const worker = await page.request.get(app.origin + library + '/libapi.mjs');
  expect(worker.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  const wasm = await page.request.head(app.origin + library + '/libapi.wasm');
  expect(wasm.headers()['content-type']).toContain('application/wasm');
  const initialized = await page.evaluate(async url => {
    const { default: initialize } = await import(url);
    const module = await initialize();
    return window.crossOriginIsolated && typeof module.Context === 'function';
  }, library + '/libapi.mjs');
  expect(initialized).toBe(true);

  const admin = await page.request.get(app.origin + '/admin');
  expect(admin.headers()['cross-origin-embedder-policy']).toBeUndefined();
  expect(admin.headers()['cross-origin-opener-policy']).toBeUndefined();
  expect(app.sessionCount()).toBe(0);
});

// Exercise the shipped JS queue and its 800 ms acknowledgement timer. Only
// the WASM camera context and browser device picker are simulated.
async function connectCamera(page: Page, origin: string, bytes: Buffer) {
  await page.addInitScript(() => {
    const device = { vendorId: 0x04a9, productId: 0x3218, productName: 'Canon EOS 1100D',
      configurations: [{ interfaces: [{ alternates: [{ interfaceClass: 6, interfaceSubclass: 1 }] }] }] };
    const usb = Object.assign(new EventTarget(), { requestDevice: async () => device, getDevices: async () => [device] });
    Object.defineProperty(navigator, 'usb', { configurable: true, value: usb });
  });
  await page.route('**/cam-test-web-assets/*/build/libapi.mjs', route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const jpeg = Uint8Array.from(atob('${bytes.toString('base64')}'), c => c.charCodeAt(0));
      const stats = window.usbTest = { shots: 0, previews: 0, active: 0, overlaps: 0, stops: 0, writes: [],
        failOff: false, holdShot: false };
      async function read(ms = 25) {
        if (stats.active++) stats.overlaps++;
        await new Promise(resolve => setTimeout(resolve, ms));
        stats.active--;
      }
      class Context {
        isDeleted() { return false; }
        delete() { if (stats.active) stats.overlaps++; }
        supportedOps() { return {capturePreview:true, captureImage:true, config:true}; }
        configToJS() {
          const controls = {
            viewfinder: {}, autofocusdrive: {}, manualfocusdrive: { choices: ['Near 1', 'Near 2', 'Near 3', 'Far 1', 'Far 2', 'Far 3'] },
            afmethod: { choices: ['Quick', 'Live'], value: 'Quick' }, eosremoterelease: { choices: ['Immediate'] }
          };
          for (const [name, widget] of Object.entries(controls)) Object.assign(widget, {name, readonly:false});
          return {name:'main', children:{ actions: {name:'actions', children:controls} }};
        }
        async setConfigValue(name, value) {
          stats.writes.push([name, value]);
          if (name === 'viewfinder' && value === false) {
            stats.stops++;
            stats.offAt = performance.now();
            await read();
            if (stats.failOff) throw new Error('viewfinder failure');
          } else await read();
        }
        async capturePreviewAsBlob() {
          await read(); stats.previews++;
          return new Blob([jpeg], {type:'image/jpeg'});
        }
        async captureImageAsFile() {
          const shot = ++stats.shots;
          stats.shotAt = performance.now();
          if (stats.holdShot) await new Promise(resolve => { stats.releaseShot = resolve; });
          await read(120);
          if (shot === 7) throw new Error('Transfer interrupted');
          return new File([jpeg], 'frame-' + shot + '.jpg', {type:'image/jpeg'});
        }
      }
      export default async () => ({Context});`,
  }));
  await page.goto(origin + '/cam-test-web');
  await page.getByRole('button', { name: 'Выбрать камеру' }).click();
}

test('preview and local originals share the camera without repeating an uncertain shutter', async ({ page, app }) => {
  const bytes = await readFile(app.jpeg);
  const apiRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await connectCamera(page, app.origin, bytes);
  await page.getByRole('button', { name: 'Запустить Live View' }).click();
  await expect.poll(() => page.evaluate('window.usbTest.previews')).toBeGreaterThan(1);
  await expect(page.getByLabel('Статистика Live View')).toHaveText(/[1-9]\d* FPS.*P95/);
  await page.getByRole('button', { name: 'Остановить Live View' }).click();
  await expect.poll(() => page.evaluate('window.usbTest.stops')).toBe(1);
  await page.getByRole('button', { name: 'Запустить Live View' }).click();
  const downloads = page.locator('a[download]');
  for (let i = 1; i <= 6; i++) {
    await page.getByRole('button', { name: 'Снять фото' }).click();
    await expect(downloads).toHaveCount(Math.min(5, i));
  }
  await expect(page.getByRole('img', { name: 'Кадр 6', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Кадр 1', exact: true })).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await downloads.first().click();
  const path = await (await downloaded).path();
  expect(await readFile(path!)).toEqual(bytes);
  await page.getByRole('button', { name: 'Снять фото' }).click();
  await expect(page.getByRole('button', { name: 'Снять новый кадр' })).toBeVisible();
  await expect(downloads).toHaveCount(5);
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выбрать камеру' })).toBeEnabled();
  expect(await page.evaluate('window.usbTest.shots')).toBe(7);
  expect(await page.evaluate('window.usbTest.overlaps')).toBe(0);
  expect(apiRequests).toEqual([]);
});

test('automatic capture drains preview, bypasses the config timer, flashes and reviews the JPEG', async ({ page, app }) => {
  await connectCamera(page, app.origin, await readFile(app.jpeg));
  await page.getByRole('button', { name: 'Автоматический' }).click();
  // Observe short DOM states in the page, independently of Playwright polling.
  await page.evaluate(() => {
    const changes: { selector: string; visible: boolean; at: number }[] = [];
    Object.assign(window, { changes });
    const visible = new Map<string, boolean>();
    const observer = new MutationObserver(() => {
      for (const selector of ['.countdown', '.screen.white', '.flash', '.review', 'a[download]']) {
        const present = !!document.querySelector(selector);
        if ((visible.get(selector) ?? false) !== present) {
          visible.set(selector, present);
          changes.push({ selector, visible: present, at: performance.now() });
        }
      }
    });
    observer.observe(document.body, { attributes: true, subtree: true, childList: true });
  });
  const shoot = page.getByRole('button', { name: 'Снять через 3 с' });
  await shoot.click();
  await expect(page.getByLabel('Обратный отсчёт')).toHaveText('3');
  await expect(shoot).toBeDisabled();
  await expect(page.getByRole('img', { name: 'Полученный JPEG' })).toBeVisible();
  await expect(page.locator('a[download]')).toHaveCount(0);
  await expect(page.getByText('Восстановление Live View · первый кадр')).toBeVisible();
  const timeline: { selector: string; visible: boolean; at: number }[] = await page.evaluate('window.changes');
  const at = (selector: string, visible = true) => timeline.find(e => e.selector === selector && e.visible === visible)!.at;
  expect(at('.screen.white') - at('.countdown')).toBeGreaterThanOrEqual(2600);
  expect(at('.screen.white') - at('.countdown')).toBeLessThan(2950);
  expect(at('.flash') - at('.screen.white')).toBeGreaterThanOrEqual(175);
  expect(at('.flash') - at('.screen.white')).toBeLessThan(340);
  expect(at('.flash', false) - at('.flash')).toBeGreaterThanOrEqual(40);
  expect(at('.flash', false) - at('.flash')).toBeLessThan(150);
  expect(at('a[download]') - at('.review')).toBeGreaterThanOrEqual(990);
  expect(await page.evaluate('window.usbTest.shotAt - window.usbTest.offAt')).toBeLessThan(500);
  expect(await page.evaluate('window.usbTest.shots')).toBe(1);

  await page.evaluate('window.usbTest.failOff = true');
  await shoot.click();
  await expect(page.getByRole('alert')).toContainText('viewfinder failure');
  await expect(page.locator('a[download]')).toHaveCount(2);
  await expect(shoot).toBeEnabled();
  expect(await page.evaluate('window.usbTest.shots')).toBe(2);
  expect(await page.evaluate('window.usbTest.overlaps')).toBe(0);
});

test('manual controls repeat AF, commit one relative move and keep Immediate independent of JPEG capture', async ({ page, app }) => {
  await connectCamera(page, app.origin, await readFile(app.jpeg));
  await page.getByRole('button', { name: 'Запустить Live View' }).click();
  const af = page.getByRole('button', { name: 'Автофокус без снимка' });
  await af.click();
  await expect(page.getByRole('button', { name: 'Снять фото' })).toBeDisabled();
  await af.click();
  await page.getByRole('button', { name: 'Live AF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Live AF', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const slider = page.getByRole('slider');
  await expect(slider).toHaveValue('0');
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 2, box.y + box.height / 2, { steps: 15 });
  expect(await page.evaluate('window.usbTest.writes.length')).toBe(3);
  await page.mouse.up();
  await expect(slider).toHaveValue('0');
  await expect(slider).toBeEnabled();
  await slider.press('End');
  await expect(slider).toHaveValue('0');
  await page.getByRole('button', { name: 'Спуск без AF · без JPEG' }).click();
  await expect(af).toBeEnabled();
  await expect(page.locator('a[download]')).toHaveCount(0);
  expect(await page.evaluate('window.usbTest.writes')).toEqual([
    ['autofocusdrive', true], ['autofocusdrive', true], ['afmethod', 'Live'],
    ['manualfocusdrive', 'Near 3'], ['manualfocusdrive', 'Far 3'], ['eosremoterelease', 'Immediate'],
  ]);
  expect(await page.evaluate('window.usbTest.shots')).toBe(0);
  expect(await page.evaluate('window.usbTest.overlaps')).toBe(0);
});

test('disconnect cancels a countdown and drains a dispatched shot into the gallery', async ({ page, app }) => {
  await connectCamera(page, app.origin, await readFile(app.jpeg));
  await page.getByRole('button', { name: 'Автоматический' }).click();
  const shoot = page.getByRole('button', { name: 'Снять через 3 с' });
  const disconnect = page.getByRole('button', { name: 'Отключить', exact: true });
  await shoot.click();
  await expect(page.getByLabel('Обратный отсчёт')).toHaveText('3');
  await disconnect.click();
  await expect(page.getByLabel('Обратный отсчёт')).toHaveCount(0);
  await page.getByRole('button', { name: 'Выбрать камеру' }).click();
  await page.evaluate('window.usbTest.holdShot = true');
  await shoot.click();
  await expect.poll(() => page.evaluate('window.usbTest.shots')).toBe(1);
  await disconnect.click();
  await expect(page.getByText(/Освобождаем USB/)).toBeVisible();
  await page.evaluate('window.usbTest.releaseShot()');
  await expect(page.getByRole('button', { name: 'Выбрать камеру' })).toBeEnabled();
  await expect(page.locator('a[download]')).toHaveCount(1);
  expect(await page.evaluate('window.usbTest.shots')).toBe(1);
  expect(await page.evaluate('window.usbTest.stops')).toBe(1);
  expect(await page.evaluate('window.usbTest.overlaps')).toBe(0);
});
