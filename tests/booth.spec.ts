import { readFile } from 'node:fs/promises';
import { test, expect } from './browser-fixture';
import { mockUsbCamera } from './usb-camera-fixture';

test.use({ capturePort: 0 });

test('WebUSB booth keeps one connection across screens and recovers a pose without duplicating the shutter', async ({ app, page, request }) => {
  test.setTimeout(60000);
  const headers = { Origin: app.origin };
  await request.post(app.origin + '/api/auth/login', { headers, data: { username: 'admin', password: app.password } });
  const media = await request.post(app.origin + '/api/admin/slot-media', { headers, multipart: {
    file: { name: 'guide.png', mimeType: 'image/png', buffer: await readFile(app.image) }
  } });
  const saved = await request.post(app.origin + '/api/admin/slots', { headers, data: {
    description: 'USB портрет', visible: true, thumbnailId: (await media.json()).id, referenceIds: [],
    mode: 'P2V', model: 'minimax/h3-max/reference-to-video', participants: 2, photosPerParticipant: 2,
    orientation: 'landscape', aspectRatio: '16:9', resolution: '768P', duration: 5, prompt: 'Two people', promptExpansionMode: 'disabled'
  } });
  expect(saved.status()).toBe(201);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const jpeg = await readFile(app.jpeg);
  await mockUsbCamera(page, jpeg);
  const response = await page.goto(app.origin + '/booth');
  expect(response?.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.getByRole('link', { name: 'Ввести ключ установки' }).click();
  await page.getByLabel('Ключ установки', { exact: true }).fill(app.installationKey);
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await page.getByRole('link', { name: 'Открыть каталог' }).click();
  expect(await page.evaluate('window.usbCalls')).toEqual([]);
  const panel = page.getByRole('dialog', { name: 'Подключение камеры' });
  const disconnected = page.getByRole('button', { name: 'Камера не подключена' });
  const ready = page.getByRole('button', { name: 'Canon OK' });
  async function connect() {
    await disconnected.click();
    await panel.getByRole('button', { name: 'Выбрать камеру' }).click();
    await expect(panel.getByRole('status')).toHaveText('Canon OK');
    await panel.getByRole('button', { name: 'Закрыть' }).click();
  }
  await connect();
  await page.setViewportSize({width: 375, height: 812});
  const steps = await page.getByLabel('Этапы создания').boundingBox();
  const button = await ready.boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(steps!.y);
  await page.setViewportSize({width: 1280, height: 900});
  await page.getByRole('button', { name: 'Сюжет 1: USB портрет' }).click();
  await page.getByRole('button', { name: 'Выбрать этот сюжет' }).click();
  await expect(page.locator('.live-preview')).toBeVisible();
  await expect(ready).toBeVisible();
  expect(await page.evaluate('window.usbCalls')).toEqual(['picker','list']);
  await page.evaluate('window.usbTest.holdShot = true');
  await page.getByRole('button', { name: 'Снять один кадр' }).click();
  await expect.poll(() => page.evaluate('window.usbTest.shots'), {timeout: 2500}).toBe(1);
  const gap = Number(await page.evaluate('window.usbTest.shotAt - window.usbTest.offAt'));
  expect(gap).toBeGreaterThanOrEqual(95);
  expect(gap).toBeLessThan(700);
  await ready.click();
  await panel.getByRole('button', { name: 'Освободить USB-порт' }).click();
  await page.evaluate('window.usbTest.releaseShot(); window.usbTest.holdShot = false');
  await panel.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.locator('.thumbnail.filled')).toHaveCount(1);
  await page.getByRole('button', { name: 'Снять один кадр' }).click();
  await expect(page.getByRole('alert')).toContainText('Проверьте камеру');
  expect(await page.evaluate('window.usbTest.shots')).toBe(1);
  await connect();
  await page.evaluate('window.usbTest.failShot = true');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByText('Камера могла сделать снимок.')).toBeVisible();
  await expect(page.locator('.thumbnail.filled')).toHaveCount(1);
  expect(await page.evaluate('window.usbTest.shots')).toBe(2);
  await page.evaluate('window.usbTest.failShot = false');
  await page.getByRole('button', { name: 'Снять эту позу заново' }).click();
  await expect(page.locator('.thumbnail.filled')).toHaveCount(2);
  await expect(page.getByText('Подготовьте второго человека.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.live .countdown')).toBeVisible();
  await page.evaluate("navigator.usb.dispatchEvent(Object.assign(new Event('disconnect'), {device: window.cameraDevice}))");
  await expect(page.getByRole('alert')).toContainText('Проверьте камеру');
  expect(await page.evaluate('window.usbTest.shots')).toBe(3);
  await connect();
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('.thumbnail.filled')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Снять один кадр' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.thumbnail.filled')).toHaveCount(4, {timeout: 10000});
  expect(await page.evaluate('window.usbTest.shots')).toBe(5);
  expect(await page.evaluate('window.usbTest.overlaps')).toBe(0);
  const sessionId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt.sessionId as string);
  await page.getByRole('button', { name: 'Завершить фотосессию' }).click();
  await expect(page.getByText('ФОТОГРАФИИ ПРИНЯТЫ')).toBeVisible();
  const photos = await app.photos(sessionId);
  expect(photos.map(photo => photo.pose_index)).toEqual([0, 1, 2, 3]);
  expect(photos.every(photo => photo.bytes.equals(jpeg))).toBe(true);
  expect(errors).toEqual([]);
});
