import { test, expect } from './browser-fixture';
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

test('preview and local originals share the camera without repeating an uncertain shutter', async ({ page, app }) => {
  const bytes = await readFile(app.jpeg);
  const apiRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    const device = { vendorId: 0x04a9, productId: 0x3218, productName: 'Canon EOS 1100D',
      configurations: [{ interfaces: [{ alternates: [{ interfaceClass: 6, interfaceSubclass: 1 }] }] }] };
    const usb = Object.assign(new EventTarget(), { requestDevice: async () => device, getDevices: async () => [device] });
    Object.defineProperty(navigator, 'usb', { configurable: true, value: usb });
  });
  // Replace only the USB boundary. The gallery, decoder, shutter and preview controls are real.
  await page.route('**/cam-test-web-assets/*/build/camera.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const jpeg = Uint8Array.from(atob('${bytes.toString('base64')}'), c => c.charCodeAt(0));
      const stats = window.usbTest = { shots: 0, previews: 0, active: 0, overlaps: 0, stops: 0 };
      async function read() {
        if (stats.active++) stats.overlaps++;
        await new Promise(resolve => setTimeout(resolve, 25));
        stats.active--;
      }
      export class Camera {
        async connect() {}
        async disconnect() { if (stats.active) stats.overlaps++; }
        async getSupportedOps() { return {capturePreview:true, captureImage:true, config:true}; }
        async setConfigValue(name, value) {
          if (name === 'viewfinder' && value === false) stats.stops++;
          await read();
        }
        async capturePreviewAsBlob() {
          await read(); stats.previews++;
          return new Blob([jpeg], {type:'image/jpeg'});
        }
        async captureImageAsFile() {
          const shot = ++stats.shots;
          await read();
          if (shot === 7) throw new Error('Transfer interrupted');
          return new File([jpeg], 'frame-' + shot + '.jpg', {type:'image/jpeg'});
        }
      }`,
  }));
  await page.goto(app.origin + '/cam-test-web');
  await page.getByRole('button', { name: 'Выбрать камеру' }).click();
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
