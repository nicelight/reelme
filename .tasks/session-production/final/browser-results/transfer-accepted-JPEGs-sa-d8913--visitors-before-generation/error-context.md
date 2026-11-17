# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: transfer.spec.ts >> accepted JPEGs, same-Blob upload retry, lost finalize acknowledgement and two visitors before generation
- Location: tests/transfer.spec.ts:15:1

# Error details

```
Error: locator.innerText: Test ended.
Call log:
  - waiting for locator('main')

```

# Test source

```ts
  23  |   };
  24  |   const thumbnailId = await upload(app.image, 'image/png');
  25  | 
  26  |   for (const one of [true, false]) {
  27  |     const id = randomUUID(); let videoId: string | undefined;
  28  |     if (one) { await app.prepareTemplate(id); const imported = await admin.post(`/api/admin/slots/${id}/template-video`, { data: { orientation: 'landscape', model: 'minimax/h3-max/recast' } }); expect(imported.status()).toBe(201); videoId = (await imported.json()).id; }
  29  |     const response = await admin.post('/api/admin/slots', { data: {
  30  |       id, participants: 1, photosPerParticipant: one ? 1 : 4, orientation: 'landscape', ...(one ? {} : { aspectRatio: '16:9' }),
  31  |       description: one ? 'Один портрет Recast' : 'Четыре разные позы', visible: true, thumbnailId, referenceIds: [],
  32  |       ...(one ? { mode: 'V2V', model: 'minimax/h3-max/recast', videoId, resolution: '768P', recastShotsConfirmed: true }
  33  |         : { mode: 'P2V', model: 'kling/v4/reference-to-video', resolution: '720p', duration: 5, prompt: 'Visitor @Element1' }),
  34  |     } });
  35  |     expect(response.status()).toBe(201);
  36  |   }
  37  |   await admin.dispose();
  38  |   const installation = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: localOrigin, Authorization: `Bearer ${app.installationKey}` } });
  39  |   const status = async (id: string): Promise<CaptureStatus> => {
  40  |     const response = await installation.get(`/api/capture/sessions/${id}`);
  41  |     expect(response.status()).toBe(200);
  42  |     expect(response.headers()['access-control-allow-origin']).toBe(localOrigin);
  43  |     return response.json();
  44  |   };
  45  |   const frames = await Promise.all(Array.from({ length: 6 }, (_, i) => sharp(Buffer.from(`<svg width="640" height="480"><rect width="640" height="480" fill="${['#b1342f','#285d43','#c18428','#254e88','#81407c','#436348'][i]}"/><text x="25" y="80" font-size="45" fill="white">SYNTHETIC ${i}</text></svg>`)).jpeg().toBuffer()));
  46  |   const commands: string[] = []; const downloads: string[] = []; const unauthorizedOrigins: string[] = []; const pageErrors: string[] = [];
  47  |   let sequence = 0;
  48  |   await page.route('**/*', async route => {
  49  |     const origin = new URL(route.request().url()).origin;
  50  |     if (![localOrigin, app.origin].includes(origin)) { unauthorizedOrigins.push(origin); return route.abort(); }
  51  |     return route.fallback();
  52  |   });
  53  |   await page.route(localOrigin + '/**', async route => {
  54  |     const url = new URL(route.request().url());
  55  |     if (url.pathname === '/reelme.html') return route.continue();
  56  |     expect(route.request().headers().authorization).toBeUndefined();
  57  |     if (url.pathname === '/liveview.html') return route.fulfill({ status: 503, body: 'controlled no-preview camera' });
  58  |     if (url.pathname === '/' && url.searchParams.has('CMD')) {
  59  |       commands.push(url.searchParams.get('CMD')!); sequence++; return route.fulfill({ body: 'accepted' });
  60  |     }
  61  |     if (url.pathname === '/filelist.json') return route.fulfill({ json: Array.from({ length: sequence + 1 }, (_, i) => ({ FileName: `frame-${i}.jpg`, Original: `/image/frame-${i}.jpg` })) });
  62  |     if (url.pathname.startsWith('/image/')) {
  63  |       downloads.push(url.pathname);
  64  |       return route.fulfill({ contentType: 'image/jpeg', body: frames[Number(url.pathname.match(/frame-(\d+)/)![1])] });
  65  |     }
  66  |     return route.fulfill({ status: 404 });
  67  |   });
  68  |   // Instrument fetch without replacing its result: prove the retry still owns
  69  |   // exactly the original camera Blob, not a fresh shutter/download or re-encode.
  70  |   await page.addInitScript(() => {
  71  |     const observations: TransferObservation[] = [];
  72  |     (window as typeof window & { transferObservations: TransferObservation[] }).transferObservations = observations;
  73  |     const ids = new WeakMap<Blob, number>(); let sequence = 0;
  74  |     const originalSet = FormData.prototype.set;
  75  |     const originalFetch = window.fetch;
  76  |     const blobs = new WeakMap<FormData, Blob>();
  77  |     FormData.prototype.set = function(name: string, value: string | Blob, filename?: string) {
  78  |       if (name === 'file' && value instanceof Blob) { blobs.set(this, value); if (!ids.has(value)) ids.set(value, ++sequence); }
  79  |       if (typeof value === 'string') return originalSet.call(this, name, value);
  80  |       return originalSet.call(this, name, value, filename);
  81  |     };
  82  |     window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
  83  |       if (init?.body instanceof FormData && blobs.has(init.body)) {
  84  |         const blob = blobs.get(init.body)!;
  85  |         observations.push({ path: String(input), blobId: ids.get(blob)!, bytes: [...new Uint8Array(await blob.arrayBuffer())], credentials: init.credentials });
  86  |       }
  87  |       return originalFetch.call(this, input, init);
  88  |     };
  89  |   });
  90  |   page.on('pageerror', error => pageErrors.push(error.message));
  91  |   const transport: { method: string; path: string; origin?: string; cookie?: string; authorization: boolean }[] = [];
  92  |   page.on('request', request => {
  93  |     if (request.url().startsWith(app.origin + '/api/capture/')) {
  94  |       const headers = request.headers();
  95  |       transport.push({ method: request.method(), path: new URL(request.url()).pathname, origin: headers.origin, cookie: headers.cookie, authorization: headers.authorization === `Bearer ${app.installationKey}` });
  96  |       expect(request.url()).not.toContain(app.installationKey);
  97  |     }
  98  |   });
  99  |   let firstId = ''; let secondId = ''; let firstFinalized = false; let secondFinalized = false; let failUpload = true;
  100 |   let releaseFirst!: () => void; let releaseSecond!: () => void;
  101 |   const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  102 |   const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  103 |   const finalizePosts: string[] = [];
  104 |   await page.route(app.origin + '/api/capture/sessions/**', async route => {
  105 |     const path = new URL(route.request().url()).pathname;
  106 |     if (route.request().method() === 'PUT' && path === `/api/capture/sessions/${secondId}/photos/1` && failUpload) {
  107 |       failUpload = false;
  108 |       return route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': localOrigin }, json: { error: 'controlled outage before commit' } });
  109 |     }
  110 |     if (path.endsWith('/finalize')) {
  111 |       finalizePosts.push(path);
  112 |       const response = await route.fetch();
  113 |       expect(response.status()).toBe(200);
  114 |       expect(response.headers()['access-control-allow-origin']).toBe(localOrigin);
  115 |       if (path.includes(firstId)) { firstFinalized = true; await firstGate; return route.abort('failed'); }
  116 |       secondFinalized = true; await secondGate; return route.fulfill({ response });
  117 |     }
  118 |     return route.continue();
  119 |   });
  120 |   const noReceipt = async () => {
  121 |     await expect(page.locator('.visitor-number')).toHaveCount(0);
  122 |     await expect(page.getByRole('button', { name: 'Следующий посетитель' })).toHaveCount(0);
> 123 |     expect(await page.locator('main').innerText()).not.toContain('Ищи свое видео');
      |                                       ^ Error: locator.innerText: Test ended.
  124 |   };
  125 |   await page.goto(local + '#setup');
  126 |   await page.getByLabel('Ключ установки', { exact: true }).fill(app.installationKey);
  127 |   await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  128 |   await expect(page.getByRole('status')).toContainText('Ключ проверен и сохранён');
  129 |   await page.getByRole('link', { name: 'Открыть каталог' }).click();
  130 |   await page.getByRole('button', { name: 'Сюжет 1: Один портрет Recast', exact: true }).click();
  131 |   await page.getByRole('button', { name: 'Выбрать этот сюжет' }).click();
  132 |   await expect(page.getByRole('button', { name: 'Начать съёмку' })).toBeVisible();
  133 |   const first: StartReceipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  134 |   firstId = first.sessionId;
  135 |   expect(first.number).toBe(1); expect(first.posePlan).toHaveLength(1);
  136 |   expect((await status(firstId)).state).toBe('capturing');
  137 |   await noReceipt();
  138 |   await page.getByRole('button', { name: 'Начать съёмку' }).click();
  139 |   await expect(page.getByRole('button', { name: 'Завершить фотосессию' })).toBeVisible({ timeout: 15_000 });
  140 |   expect(await app.photos(firstId)).toEqual([]); expect(finalizePosts).toEqual([]);
  141 |   await page.getByRole('button', { name: 'Завершить фотосессию' }).click();
  142 |   await expect.poll(() => firstFinalized, { timeout: 15_000 }).toBe(true);
  143 |   await noReceipt();
  144 |   await expect(page.getByRole('heading', { name: 'Передаём фотографии…' })).toBeVisible();
  145 |   expect(await status(firstId)).toMatchObject({ number: 1, state: 'submit_pending', complete: true, finalized: true, acceptedPoseIndices: [0] });
  146 |   await page.screenshot({ path: `${artifacts}/transfer-finalize-pending.png`, fullPage: true });
  147 |   releaseFirst();
  148 |   await expect(page.getByRole('alert')).toContainText('снятые кадры сохранены');
  149 |   await noReceipt();
  150 |   await page.screenshot({ path: `${artifacts}/transfer-finalize-lost-ack.png`, fullPage: true });
  151 |   await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  152 |   await expect(page.getByRole('heading', { name: 'Ищи свое видео под номером 001 на промо экране', exact: true })).toBeVisible();
  153 |   expect(commands).toHaveLength(1); expect(finalizePosts).toHaveLength(1);
  154 |   await page.screenshot({ path: `${artifacts}/transfer-number-001.png`, fullPage: true });
  155 |   const firstPhotos = await app.photos(firstId);
  156 |   expect(firstPhotos).toHaveLength(1); expect(firstPhotos[0].bytes).toEqual(frames[1]); expect(firstPhotos[0].pose_index).toBe(0);
  157 |   const repeat = await installation.post(`/api/capture/sessions/${firstId}/finalize`);
  158 |   expect(repeat.status()).toBe(200); expect(await repeat.json()).toEqual(await status(firstId));
  159 | 
  160 |   // No fixture reset/reload: release and start the next visitor using the UI.
  161 |   await page.getByRole('button', { name: 'Следующий посетитель' }).click();
  162 |   await expect(page.getByRole('heading', { name: 'Выберите историю' })).toBeVisible();
  163 |   expect(await page.evaluate(() => sessionStorage.getItem('reelme.captureStart'))).toBeNull();
  164 |   await expect(page.locator('.captured-frame, .visitor-number')).toHaveCount(0);
  165 |   await expect(page.locator('input')).toHaveCount(0);
  166 |   expect((await status(firstId)).state).toBe('submit_pending');
  167 |   await page.getByRole('button', { name: 'Сюжет 2: Четыре разные позы', exact: true }).click();
  168 |   // Do not retain the outgoing CTA while the carousel swaps accessible content.
  169 |   await expect(page.locator('.center .story-heading h2')).toHaveText('Четыре разные позы');
  170 |   await page.getByRole('button', { name: 'Выбрать этот сюжет' }).click();
  171 |   await expect(page.getByRole('button', { name: 'Начать съёмку' })).toBeVisible();
  172 |   const second: StartReceipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
  173 |   secondId = second.sessionId;
  174 |   expect(secondId).not.toBe(firstId); expect(second.number).toBe(2); expect(second.date).toBe(first.date); expect(second.posePlan).toHaveLength(4);
  175 |   expect(await app.photos(secondId)).toEqual([]);
  176 |   await expect(page.locator('.capture-progress')).toHaveText('Снято: 0 из 4');
  177 |   await noReceipt();
  178 |   await page.getByRole('button', { name: 'Начать съёмку' }).click();
  179 |   await page.getByRole('button', { name: 'Завершить фотосессию' }).click({ timeout: 40_000 });
  180 |   await expect(page.getByRole('alert')).toContainText('снятые кадры сохранены', { timeout: 40_000 });
  181 |   await noReceipt();
  182 |   expect(commands).toHaveLength(5);
  183 |   const partial = await app.photos(secondId);
  184 |   expect(partial).toHaveLength(1); expect(partial[0].pose_index).toBe(0); expect(partial[0].bytes).toEqual(frames[2]);
  185 |   expect(await status(secondId)).toMatchObject({ number: 2, state: 'capturing', acceptedPoseIndices: [0], complete: false, finalized: false });
  186 |   await page.screenshot({ path: `${artifacts}/transfer-upload-retry.png`, fullPage: true });
  187 |   await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  188 |   await expect.poll(() => secondFinalized).toBe(true);
  189 |   await noReceipt();
  190 |   expect(commands).toHaveLength(5);
  191 |   releaseSecond();
  192 |   await expect(page.getByRole('heading', { name: 'Ищи свое видео под номером 002 на промо экране', exact: true })).toBeVisible();
  193 |   const secondPhotos = await app.photos(secondId);
  194 |   expect(secondPhotos).toHaveLength(4);
  195 |   expect(secondPhotos[0]).toEqual(partial[0]);
  196 |   for (let i = 0; i < 4; i++) {
  197 |     expect(secondPhotos[i]).toMatchObject({ session_id: secondId, pose_index: i, size: frames[i + 2].length });
  198 |     expect(secondPhotos[i].bytes).toEqual(frames[i + 2]);
  199 |   }
  200 |   expect(await app.photos(firstId)).toEqual(firstPhotos);
  201 |   const observations = await page.evaluate(() => (window as typeof window & { transferObservations: TransferObservation[] }).transferObservations);
  202 |   const retries = observations.filter(row => row.path.endsWith(`/${secondId}/photos/1`));
  203 |   expect(retries).toHaveLength(2); expect(retries[0].blobId).toBe(retries[1].blobId); expect(retries[0].bytes).toEqual(retries[1].bytes);
  204 |   expect(Buffer.from(retries[0].bytes)).toEqual(frames[3]);
  205 |   expect(observations.every(row => row.credentials === 'omit')).toBe(true);
  206 |   expect(observations.filter(row => row.path.endsWith(`/${secondId}/photos/0`))).toHaveLength(1);
  207 |   expect(downloads).toEqual([1, 2, 3, 4, 5].map(i => `/image/frame-${i}.jpg`));
  208 |   await page.setViewportSize({ width: 375, height: 812 });
  209 |   await expect(page.locator('.visitor-number')).toHaveText('002');
  210 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  211 |   await page.screenshot({ path: `${artifacts}/transfer-number-mobile.png`, fullPage: true });
  212 |   const statusesBeforeRestart = await Promise.all([status(firstId), status(secondId)]);
  213 |   expect(statusesBeforeRestart.every(row => row.state === 'submit_pending')).toBe(true);
  214 |   await app.restart();
  215 |   expect(await Promise.all([status(firstId), status(secondId)])).toEqual(statusesBeforeRestart);
  216 |   expect(await app.photos(firstId)).toEqual(firstPhotos); expect(await app.photos(secondId)).toEqual(secondPhotos);
  217 |   await page.reload();
  218 |   await expect(page.getByRole('heading', { name: 'Ищи свое видео под номером 002 на промо экране', exact: true })).toBeVisible();
  219 |   expect(commands).toHaveLength(5); expect(app.sessionCount()).toBe(2);
  220 |   expect(await page.context().cookies()).toEqual([]);
  221 |   expect(transport.every(row => !row.cookie && row.authorization)).toBe(true);
  222 |   expect(pageErrors).toEqual([]); expect(unauthorizedOrigins).toEqual([]);
  223 |   const summarize = (photos: typeof firstPhotos) => photos.map(({ bytes, ...photo }) => ({ ...photo, sha256: createHash('sha256').update(bytes).digest('hex') }));
```