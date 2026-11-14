/** Real browser + Svelte/API/SQLite; only camera HTTP and selected transport
 * failures are controlled. Synthetic JPEGs, no cloud generation consumer. */
import { test, expect } from './browser-fixture';
import { request as apiRequest } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { CaptureStatus, StartReceipt } from '../src/shared/capture';
const artifacts = process.env.REELME_BROWSER_ARTIFACTS || '.tasks/TASK-004-T2-FT-002-W3';
const localOrigin = 'http://localhost:5513';
const local = localOrigin + '/reelme.html';
type TransferObservation = { path: string; blobId: number; bytes: number[]; credentials?: RequestCredentials };

test('accepted JPEGs, same-Blob upload retry, lost finalize acknowledgement and two visitors before generation', async ({ page, app }) => {
  test.setTimeout(130_000);
  await mkdir(artifacts, { recursive: true });
  const admin = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
  expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: app.password } })).status()).toBe(200);
  const upload = async (path: string, mimeType: string) => {
    const response = await admin.post('/api/admin/slot-media', { multipart: { file: { name: path.split('/').pop()!, mimeType, buffer: await readFile(path) } } });
    expect(response.status()).toBe(201); return (await response.json()).id;
  };
  const thumbnailId = await upload(app.image, 'image/png');
  const videoId = await upload(app.video, 'video/mp4');
  for (const one of [true, false]) {
    const response = await admin.post('/api/admin/slots', { data: {
      description: one ? 'Один портрет Recast' : 'Четыре разные позы', visible: true, thumbnailId, referenceIds: [],
      ...(one ? { mode: 'V2V', model: 'minimax/h3-max/recast', videoId, resolution: '768P', recastShotsConfirmed: true }
        : { mode: 'P2V', model: 'kling/v4/reference-to-video', resolution: '720p', duration: 5, prompt: 'Visitor @Element1' }),
    } });
    expect(response.status()).toBe(201);
  }
  await admin.dispose();
  const installation = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: localOrigin, Authorization: `Bearer ${app.installationKey}` } });
  const status = async (id: string): Promise<CaptureStatus> => {
    const response = await installation.get(`/api/capture/sessions/${id}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['access-control-allow-origin']).toBe(localOrigin);
    return response.json();
  };
  const frames = await Promise.all(Array.from({ length: 6 }, (_, i) => sharp(Buffer.from(`<svg width="640" height="480"><rect width="640" height="480" fill="${['#b1342f','#285d43','#c18428','#254e88','#81407c','#436348'][i]}"/><text x="25" y="80" font-size="45" fill="white">SYNTHETIC ${i}</text></svg>`)).jpeg().toBuffer()));
  const commands: string[] = []; const downloads: string[] = []; const unauthorizedOrigins: string[] = []; const pageErrors: string[] = [];
  let sequence = 0;
  await page.route('**/*', async route => {
    const origin = new URL(route.request().url()).origin;
    if (![localOrigin, app.origin].includes(origin)) { unauthorizedOrigins.push(origin); return route.abort(); }
    return route.fallback();
  });
  await page.route(localOrigin + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/reelme.html') return route.continue();
    expect(route.request().headers().authorization).toBeUndefined();
    if (url.pathname === '/liveview.html') return route.fulfill({ status: 503, body: 'controlled no-preview camera' });
    if (url.pathname === '/' && url.searchParams.has('CMD')) {
      commands.push(url.searchParams.get('CMD')!); sequence++; return route.fulfill({ body: 'accepted' });
    }
    if (url.pathname === '/filelist.json') return route.fulfill({ json: Array.from({ length: sequence + 1 }, (_, i) => ({ FileName: `frame-${i}.jpg`, Original: `/image/frame-${i}.jpg` })) });
    if (url.pathname.startsWith('/image/')) {
      downloads.push(url.pathname);
      return route.fulfill({ contentType: 'image/jpeg', body: frames[Number(url.pathname.match(/frame-(\d+)/)![1])] });
    }
    return route.fulfill({ status: 404 });
  });
  // Instrument fetch without replacing its result: prove the retry still owns
  // exactly the original camera Blob, not a fresh shutter/download or re-encode.
  await page.addInitScript(() => {
    const observations: TransferObservation[] = [];
    (window as typeof window & { transferObservations: TransferObservation[] }).transferObservations = observations;
    const ids = new WeakMap<Blob, number>(); let sequence = 0;
    const originalSet = FormData.prototype.set;
    const originalFetch = window.fetch;
    const blobs = new WeakMap<FormData, Blob>();
    FormData.prototype.set = function(name: string, value: string | Blob, filename?: string) {
      if (name === 'file' && value instanceof Blob) { blobs.set(this, value); if (!ids.has(value)) ids.set(value, ++sequence); }
      if (typeof value === 'string') return originalSet.call(this, name, value);
      return originalSet.call(this, name, value, filename);
    };
    window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.body instanceof FormData && blobs.has(init.body)) {
        const blob = blobs.get(init.body)!;
        observations.push({ path: String(input), blobId: ids.get(blob)!, bytes: [...new Uint8Array(await blob.arrayBuffer())], credentials: init.credentials });
      }
      return originalFetch.call(this, input, init);
    };
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  const transport: { method: string; path: string; origin?: string; cookie?: string; authorization: boolean }[] = [];
  page.on('request', request => {
    if (request.url().startsWith(app.origin + '/api/capture/')) {
      const headers = request.headers();
      transport.push({ method: request.method(), path: new URL(request.url()).pathname, origin: headers.origin, cookie: headers.cookie, authorization: headers.authorization === `Bearer ${app.installationKey}` });
      expect(request.url()).not.toContain(app.installationKey);
    }
  });
  let firstId = ''; let secondId = ''; let firstFinalized = false; let secondFinalized = false; let failUpload = true;
  let releaseFirst!: () => void; let releaseSecond!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  const finalizePosts: string[] = [];
  await page.route(app.origin + '/api/capture/sessions/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'PUT' && path === `/api/capture/sessions/${secondId}/photos/1` && failUpload) {
      failUpload = false;
      return route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': localOrigin }, json: { error: 'controlled outage before commit' } });
    }
    if (path.endsWith('/finalize')) {
      finalizePosts.push(path);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect(response.headers()['access-control-allow-origin']).toBe(localOrigin);
      if (path.includes(firstId)) { firstFinalized = true; await firstGate; return route.abort('failed'); }
      secondFinalized = true; await secondGate; return route.fulfill({ response });
    }
    return route.continue();
  });
  const noReceipt = async () => {
    await expect(page.locator('.visitor-number')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Следующий посетитель' })).toHaveCount(0);
    expect(await page.locator('main').innerText()).not.toContain('Ищи свое видео');
  };
  await page.goto(local + '#setup');
  await page.getByLabel('Ключ установки', { exact: true }).fill(app.installationKey);
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByRole('status')).toContainText('Ключ проверен и сохранён');
  await page.getByRole('link', { name: 'Открыть каталог' }).click();
  await page.getByRole('link', { name: 'Выбрать сюжет: Один портрет Recast', exact: true }).click();
  await page.getByRole('button', { name: 'Мне нравится' }).click();
  await expect(page.getByRole('button', { name: 'Начать съёмку' })).toBeVisible();
  const first: StartReceipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  firstId = first.sessionId;
  expect(first.number).toBe(1); expect(first.posePlan).toHaveLength(1);
  expect((await status(firstId)).state).toBe('capturing');
  await noReceipt();
  await page.getByRole('button', { name: 'Начать съёмку' }).click();
  await expect.poll(() => firstFinalized, { timeout: 15_000 }).toBe(true);
  await noReceipt();
  await expect(page.getByRole('heading', { name: 'Передаём фотографии…' })).toBeVisible();
  expect(await status(firstId)).toMatchObject({ number: 1, state: 'submit_pending', complete: true, finalized: true, acceptedPoseIndices: [0] });
  await page.screenshot({ path: `${artifacts}/transfer-finalize-pending.png`, fullPage: true });
  releaseFirst();
  await expect(page.getByRole('alert')).toContainText('снятые кадры сохранены');
  await noReceipt();
  await page.screenshot({ path: `${artifacts}/transfer-finalize-lost-ack.png`, fullPage: true });
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ищи свое видео под номером 001 на промо экране', exact: true })).toBeVisible();
  expect(commands).toHaveLength(1); expect(finalizePosts).toHaveLength(1);
  await page.screenshot({ path: `${artifacts}/transfer-number-001.png`, fullPage: true });
  const firstPhotos = await app.photos(firstId);
  expect(firstPhotos).toHaveLength(1); expect(firstPhotos[0].bytes).toEqual(frames[1]); expect(firstPhotos[0].pose_index).toBe(0);
  const repeat = await installation.post(`/api/capture/sessions/${firstId}/finalize`);
  expect(repeat.status()).toBe(200); expect(await repeat.json()).toEqual(await status(firstId));

  // No fixture reset/reload: release and start the next visitor using the UI.
  await page.getByRole('button', { name: 'Следующий посетитель' }).click();
  await expect(page.getByRole('heading', { name: 'Какую историю снимем?' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('reelme.captureStart'))).toBeNull();
  await expect(page.locator('.captured-frame, .visitor-number')).toHaveCount(0);
  await expect(page.locator('input')).toHaveCount(0);
  expect((await status(firstId)).state).toBe('submit_pending');
  await page.getByRole('link', { name: 'Выбрать сюжет: Четыре разные позы', exact: true }).click();
  await page.getByRole('button', { name: 'Мне нравится' }).click();
  await expect(page.getByRole('button', { name: 'Начать съёмку' })).toBeVisible();
  const second: StartReceipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  secondId = second.sessionId;
  expect(secondId).not.toBe(firstId); expect(second.number).toBe(2); expect(second.date).toBe(first.date); expect(second.posePlan).toHaveLength(4);
  expect(await app.photos(secondId)).toEqual([]);
  await expect(page.locator('.capture-progress')).toHaveText('Снято: 0 из 4');
  await noReceipt();
  await page.getByRole('button', { name: 'Начать съёмку' }).click();
  await expect(page.getByRole('alert')).toContainText('снятые кадры сохранены', { timeout: 40_000 });
  await noReceipt();
  expect(commands).toHaveLength(5);
  const partial = await app.photos(secondId);
  expect(partial).toHaveLength(1); expect(partial[0].pose_index).toBe(0); expect(partial[0].bytes).toEqual(frames[2]);
  expect(await status(secondId)).toMatchObject({ number: 2, state: 'capturing', acceptedPoseIndices: [0], complete: false, finalized: false });
  await page.screenshot({ path: `${artifacts}/transfer-upload-retry.png`, fullPage: true });
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect.poll(() => secondFinalized).toBe(true);
  await noReceipt();
  expect(commands).toHaveLength(5);
  releaseSecond();
  await expect(page.getByRole('heading', { name: 'Ищи свое видео под номером 002 на промо экране', exact: true })).toBeVisible();
  const secondPhotos = await app.photos(secondId);
  expect(secondPhotos).toHaveLength(4);
  expect(secondPhotos[0]).toEqual(partial[0]);
  for (let i = 0; i < 4; i++) {
    expect(secondPhotos[i]).toMatchObject({ session_id: secondId, pose_index: i, size: frames[i + 2].length });
    expect(secondPhotos[i].bytes).toEqual(frames[i + 2]);
  }
  expect(await app.photos(firstId)).toEqual(firstPhotos);
  const observations = await page.evaluate(() => (window as typeof window & { transferObservations: TransferObservation[] }).transferObservations);
  const retries = observations.filter(row => row.path.endsWith(`/${secondId}/photos/1`));
  expect(retries).toHaveLength(2); expect(retries[0].blobId).toBe(retries[1].blobId); expect(retries[0].bytes).toEqual(retries[1].bytes);
  expect(Buffer.from(retries[0].bytes)).toEqual(frames[3]);
  expect(observations.every(row => row.credentials === 'omit')).toBe(true);
  expect(observations.filter(row => row.path.endsWith(`/${secondId}/photos/0`))).toHaveLength(1);
  expect(downloads).toEqual([1, 2, 3, 4, 5].map(i => `/image/frame-${i}.jpg`));
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.visitor-number')).toHaveText('002');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${artifacts}/transfer-number-mobile.png`, fullPage: true });
  const statusesBeforeRestart = await Promise.all([status(firstId), status(secondId)]);
  expect(statusesBeforeRestart.every(row => row.state === 'submit_pending')).toBe(true);
  await app.restart();
  expect(await Promise.all([status(firstId), status(secondId)])).toEqual(statusesBeforeRestart);
  expect(await app.photos(firstId)).toEqual(firstPhotos); expect(await app.photos(secondId)).toEqual(secondPhotos);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ищи свое видео под номером 002 на промо экране', exact: true })).toBeVisible();
  expect(commands).toHaveLength(5); expect(app.sessionCount()).toBe(2);
  expect(await page.context().cookies()).toEqual([]);
  expect(transport.every(row => !row.cookie && row.authorization)).toBe(true);
  expect(pageErrors).toEqual([]); expect(unauthorizedOrigins).toEqual([]);
  const summarize = (photos: typeof firstPhotos) => photos.map(({ bytes, ...photo }) => ({ ...photo, sha256: createHash('sha256').update(bytes).digest('hex') }));
  await writeFile(`${artifacts}/transfer-observations.json`, JSON.stringify({ first: statusesBeforeRestart[0], second: statusesBeforeRestart[1], firstPhotos: summarize(firstPhotos), secondPhotos: summarize(secondPhotos), commands, downloads, retrySameBlob: true, retrySameBytes: true, earlierPositionUnchanged: true, noNumberBeforeFinalizeAcknowledgement: true, lostFinalizeRecovery: 'GET status, no second browser POST or shutter', repeatFinalize: 200, nextVisitor: 'real button, no fixture reset or page reload', generation: 'no consumer; both sessions remain submit_pending', persistedAfterRestart: true, localOriginCORS: localOrigin, visitorCookies: 0, credentials: 'omit', transport, pageErrors, externalOrigins: unauthorizedOrigins, hardware: 'synthetic JPEG and controlled DCC HTTP only' }, null, 2));
  await installation.dispose();
});
