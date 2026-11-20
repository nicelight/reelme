import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test as browserTest, expect } from './browser-fixture';

const test = browserTest.extend<{ previews: string[] }>({
  previews: async ({ app, playwright }, use) => {
    const admin = await playwright.request.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
    const urls: string[] = [];
    try {
      expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: app.password } })).ok()).toBe(true);
      const image = await admin.post('/api/admin/slot-media', {
        multipart: { file: { name: 'cover.png', mimeType: 'image/png', buffer: await readFile(app.image) } },
      });
      expect(image.status()).toBe(201);
      const thumbnailId = (await image.json()).id;
      for (let i = 1; i <= 3; i++) {
        const id = randomUUID();
        await app.prepareTemplate(id);
        const model = 'minimax/h3-max/recast';
        const source = await admin.post(`/api/admin/slots/${id}/template-video`, { data: { orientation: 'landscape', model } });
        expect(source.status()).toBe(201);
        const videoId = (await source.json()).id;
        const saved = await admin.post('/api/admin/slots', { data: {
          id, thumbnailId, videoId, model, description: `Сюжет ${i}`, visible: true, mode: 'V2V', orientation: 'landscape',
          participants: 1, photosPerParticipant: 1, resolution: '768P', recastShotsConfirmed: true, referenceIds: [],
        } });
        expect(saved.status()).toBe(201);
        urls.push(`${app.origin}/api/catalog/${id}/media/${videoId}`);
      }
    } finally { await admin.dispose(); }
    await use(urls);
  },
});
test.use({ capturePort: 0, reducedMotion: 'reduce' });

test('first story opens while previews warm in sequence and a normal reload reuses all three', async ({ page, app, previews: urls }) => {
  // CDP throttling keeps Chromium's real HTTP cache enabled. Routing would disable it.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const slowSecond = { urlPattern: urls[1], latency: 2000, uploadThroughput: -1, downloadThroughput: -1 };
  await cdp.send('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [slowSecond] });
  const pending = new Map<string, string>();
  const transfers: { url: string; bytes: number }[] = [];
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (request.method === 'GET' && urls.includes(request.url)) pending.set(requestId, request.url);
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const url = pending.get(requestId);
    if (url) { transfers.push({ url, bytes: encodedDataLength }); pending.delete(requestId); }
  });
  await page.addInitScript(key => localStorage.setItem('reelme.installationKey', key), app.installationKey);
  await page.goto(`${app.captureOrigin}/reelme.html`);
  await expect(page.locator('.center video')).toHaveJSProperty('readyState', 4);
  await expect(page.getByRole('button', { name: 'Выбрать этот сюжет' })).toBeEnabled();
  await expect.poll(() => [...pending.values()]).toEqual([urls[1]]);
  expect(transfers.map(file => file.url)).toEqual([urls[0]]);
  await expect.poll(() => transfers.map(file => file.url)).toEqual(urls);
  expect(transfers.every(file => file.bytes > 0)).toBe(true);
  await cdp.send('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [] });
  transfers.length = 0;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Выбрать этот сюжет' })).toBeEnabled();
  await expect.poll(() => transfers).toEqual(urls.map(url => ({ url, bytes: 0 })));
});

test('selecting the active background download reuses it and leaving for capture cancels the next one', async ({ page, app, previews }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [
    { urlPattern: previews[1], latency: 2000, uploadThroughput: -1, downloadThroughput: -1 },
    { urlPattern: previews[2], latency: 5000, uploadThroughput: -1, downloadThroughput: -1 },
  ] });
  const started: string[] = [];
  page.on('request', request => {
    if (request.method() === 'GET' && previews.includes(request.url())) started.push(request.url());
  });
  await page.addInitScript(key => localStorage.setItem('reelme.installationKey', key), app.installationKey);
  await page.goto(`${app.captureOrigin}/reelme.html`);
  await expect.poll(() => started).toEqual(previews.slice(0, 2));
  await page.getByRole('button', { name: 'Следующий сюжет' }).click();
  await expect(page.locator('.center .story-heading')).toHaveText('Сюжет 2');
  await expect(page.locator('.center video')).toHaveJSProperty('readyState', 4);
  await expect.poll(() => started).toEqual(previews);
  const cancelled = page.waitForEvent('requestfailed', request => request.url() === previews[2]);
  await page.getByRole('button', { name: 'Выбрать этот сюжет' }).click();
  expect((await cancelled).failure()?.errorText).toContain('ERR_ABORTED');
  await expect(page.locator('.progress strong')).toHaveText('1 из 1');
});

test('a failed background preview does not prevent the next preview from downloading', async ({ page, app, previews }) => {
  await page.route(previews[1], route => route.abort('failed'));
  await page.addInitScript(key => localStorage.setItem('reelme.installationKey', key), app.installationKey);
  const failed = page.waitForEvent('requestfailed', request => request.url() === previews[1]);
  const finished = page.waitForEvent('requestfinished', request => request.method() === 'GET' && request.url() === previews[2]);
  await page.goto(`${app.captureOrigin}/reelme.html`);
  await Promise.all([failed, finished]);
  await expect(page.getByRole('button', { name: 'Выбрать этот сюжет' })).toBeEnabled();
});
