/** One real browser path from saved slot/camera intake to the QR's public form
 * and actual Nodemailer MIME. Only camera HTTP and the SMTP destination are
 * local fixtures; the production test-video mode owns generation. */
import { test as base, expect } from './browser-fixture';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { smtpFixture, attachedBytes } from './email-smtp';

const test = base.extend<{ smtp: Awaited<ReturnType<typeof smtpFixture>> }>({
  smtp: async ({}, use) => { const smtp = await smtpFixture(); try { await use(smtp); } finally { await smtp.close(); } },
  smtpPort: async ({ smtp }, use) => { await use(smtp.port); },
});
test.use({ capturePort: 0, runGeneration: true, testVideoOnly: true, reducedMotion: 'reduce' });

test('saved test-video mode: camera → ordinary worker → visible QR → playable download → SMTP attachment', async ({ page, app, browser, smtp }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.origin + '/admin');
  await page.getByLabel('Логин').fill('admin'); await page.getByLabel('Пароль', { exact: true }).fill(app.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новый сюжет', exact: true })).toBeVisible();
  const headers = { Origin: app.origin };
  const upload = await page.request.post(app.origin + '/api/admin/slot-media', { headers, multipart: { file: { name: 'thumb.png', mimeType: 'image/png', buffer: await readFile(app.image) } } });
  expect(upload.status()).toBe(201);
  const saved = await page.request.post(app.origin + '/api/admin/slots', { headers, data: {
    description: 'Полный проход без fal', visible: true, thumbnailId: (await upload.json()).id,
    participants: 1, photosPerParticipant: 1, orientation: 'landscape', aspectRatio: '16:9',
    mode: 'P2V', model: 'minimax/h3-max/reference-to-video', resolution: '768P', duration: 5,
    prompt: 'Preserve the photographed person', promptExpansionMode: 'disabled', referenceIds: [], simulateGeneration: true,
  } });
  expect(saved.status()).toBe(201); const slotId = (await saved.json()).id;
  await page.reload(); await page.getByRole('button', { name: /Полный проход без/ }).click();
  // Saved simulation mode already expands the test controls.
  const mode = page.getByLabel('Режим генерации', { exact: true });
  await expect(mode).toBeVisible();
  await expect(mode).toHaveValue('inputs'); await mode.selectOption('video');
  await expect(page.getByText(/Письмо отправляется через настроенный SMTP/)).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить сюжет', exact: true }).click();
  await expect(page.getByText('Сюжет сохранён.', { exact: true })).toBeVisible();
  const config = await (await page.request.get(`${app.origin}/api/admin/slots/${slotId}`)).json();
  expect(config).toMatchObject({ simulateGeneration: true, simulationOutput: 'video' });

  const jpeg = await readFile(app.jpeg); let shots = 0;
  await page.route(app.captureOrigin + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/reelme.html') return route.continue();
    if (url.pathname === '/liveview.html') return route.fulfill({ status: 503 });
    if (url.pathname === '/' && url.searchParams.has('CMD')) { shots++; return route.fulfill({ body: 'accepted' }); }
    if (url.pathname === '/filelist.json') return route.fulfill({ json: Array.from({ length: shots + 1 }, (_, index) => ({ FileName: `visitor-${index}.jpg`, Original: `/image/visitor-${index}.jpg` })) });
    if (url.pathname.startsWith('/image/')) return route.fulfill({ contentType: 'image/jpeg', body: jpeg });
    return route.fulfill({ status: 404 });
  });
  await page.goto(app.captureOrigin + '/reelme.html#setup');
  await page.getByLabel('Ключ установки', { exact: true }).fill(app.installationKey);
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByRole('status')).toContainText('Ключ проверен и сохранён');
  await page.getByRole('link', { name: 'Открыть каталог' }).click();
  await page.getByRole('button', { name: /Сюжет 1: Полный проход/ }).click();
  await page.getByRole('button', { name: 'Выбрать этот сюжет', exact: true }).click();
  await page.getByRole('button', { name: 'Начать съёмку', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить фотосессию', exact: true }).click({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Ищите видео под номером 001 на промоэкране', exact: true })).toBeVisible();
  expect(shots).toBe(1); expect(app.sessionCount()).toBe(1);
  const receipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  const photos = await app.photos(receipt.sessionId); expect(photos).toHaveLength(1); expect(photos[0].bytes).toEqual(jpeg);

  const operatorContext = await browser.newContext({ reducedMotion: 'reduce' });
  const operator = await operatorContext.newPage(); operator.on('pageerror', error => errors.push(error.message));
  const visitor = await browser.newPage({ reducedMotion: 'reduce' });
  visitor.on('pageerror', error => errors.push(error.message));
  const guestAssets = new Set<string>();
  visitor.on('request', request => guestAssets.add(new URL(request.url()).pathname));
  try {
    await operator.goto(app.origin + '/operator');
    await operator.getByLabel('Логин').fill('operator'); await operator.getByLabel('Пароль', { exact: true }).fill(app.password);
    await operator.getByRole('button', { name: 'Войти', exact: true }).click();
    const qr = operator.locator('.card[data-session="1"] img.qr');
    await expect(qr).toBeVisible({ timeout: 25_000 });
    const qrImage = await operator.request.get(new URL((await qr.getAttribute('src'))!, app.origin).href);
    const pixels = await sharp(await qrImage.body()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height);
    expect(decoded?.data).toMatch(new RegExp('^' + app.origin + '/receive/'));
    await visitor.goto(decoded!.data);
    await expect(visitor.getByRole('heading', { name: 'История № 1', exact: true })).toBeVisible();
    const manifest = JSON.parse(await readFile('dist/client/.vite/manifest.json', 'utf8'));
    const admin = manifest['src/client/cloud/App.svelte'];
    expect(guestAssets.has('/' + manifest['src/client/cloud/Receive.svelte'].file)).toBe(true);
    for (const file of [admin.file, ...admin.css, manifest['src/client/cloud/style.css'].file]) {
      expect(guestAssets.has('/' + file), file).toBe(false);
    }
    const player = visitor.locator('video');
    await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate(node => (node as HTMLVideoElement).play());
    await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
    const download = await visitor.request.get(new URL((await player.getAttribute('src'))!, app.origin).href);
    expect(await download.body()).toEqual(await readFile('public/test-videos/landscape.mp4'));
    await visitor.getByLabel('email для получения видео', { exact: true }).fill('visitor@example.test');
    await visitor.getByRole('button', { name: 'Получить видео по email', exact: true }).click();
    await expect(visitor.locator('.receive-status')).toContainText('Письмо отправлено.', { timeout: 10_000 });
    expect(smtp.messages).toHaveLength(1); expect(smtp.messages[0].recipient).toBe('visitor@example.test');
    expect(attachedBytes(smtp.messages[0].raw)).toEqual(await download.body());
    await expect.poll(async () => (await (await operator.request.get(app.origin + '/api/display/today')).json()).sessions[0].stage).toBe(6);
    const artifacts = process.env.REELME_BROWSER_ARTIFACTS;
    if (artifacts) { await mkdir(artifacts, { recursive: true }); await operator.screenshot({ path: join(artifacts, 'test-video-results.png'), fullPage: true }); await visitor.screenshot({ path: join(artifacts, 'test-video-received.png'), fullPage: true }); }
    await app.restart(); await visitor.reload();
    await expect(visitor.locator('.receive-status')).toContainText('Письмо отправлено.'); expect(smtp.messages).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally { await visitor.close(); await operatorContext.close(); }
});
