/** Real event setup → capture/intake → next visitor and archive. Only the local
 * camera is an HTTP fixture; server/database and saved metadata stay production. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { request as apiRequest } from '@playwright/test';
import { test, expect } from './browser-fixture';

test.use({ capturePort: 0, preconfiguredEvent: false });
const artifacts = process.env.REELME_BROWSER_ARTIFACTS || '.tasks/TASK-025-T2-FT-005-W22';

for (const action of ['save', 'skip'] as const) {
  test(`${action}: first event setup persists, capture continues and archive shows its name`, async ({ page, app, browser }) => {
    test.setTimeout(90_000);
    await mkdir(artifacts, { recursive: true });
    const admin = await apiRequest.newContext({ baseURL: app.origin, extraHTTPHeaders: { Origin: app.origin } });
    expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: app.password } })).status()).toBe(200);
    const uploaded = await admin.post('/api/admin/slot-media', { multipart: { file: { name: 'cover.png', mimeType: 'image/png', buffer: await readFile(app.image) } } });
    expect(uploaded.status()).toBe(201);
    const id = randomUUID(); await app.prepareTemplate(id);
    const imported = await admin.post(`/api/admin/slots/${id}/template-video`, { data: { model: 'minimax/h3-max/recast', orientation: 'landscape' } });
    expect(imported.status()).toBe(201);
    expect((await admin.post('/api/admin/slots', { data: {
      id, description: 'Сюжет первого мероприятия', visible: true, thumbnailId: (await uploaded.json()).id,
      mode: 'V2V', model: 'minimax/h3-max/recast', participants: 1, photosPerParticipant: 1, orientation: 'landscape',
      videoId: (await imported.json()).id, referenceIds: [], resolution: '768P', recastShotsConfirmed: true,
    } })).status()).toBe(201);
    const photoMaxEdge = action === 'skip' ? 1024 : 2048;
    const timing = action === 'skip'
      ? { startMode: 'automatic', countdownSeconds: 2, reviewSeconds: 1, receiptSeconds: 3 }
      : { startMode: 'manual', countdownSeconds: 5, reviewSeconds: 3, receiptSeconds: 5 };
    expect((await admin.put('/api/admin/capture-settings', { data: { ...timing, photoMaxEdge } })).status()).toBe(200);
    const jpeg = await sharp(app.jpeg).resize(3200, 1600, { fit: 'fill' })
      .withMetadata({ orientation: action === 'skip' ? 6 : 1 }).jpeg().toBuffer();
    let shots = 0;
    await page.route(app.captureOrigin + '/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/reelme.html') return route.continue();
      if (url.pathname === '/liveview.html') return route.fulfill({ status: 503 });
      if (url.pathname === '/' && url.searchParams.has('CMD')) { shots++; return route.fulfill({ body: 'accepted' }); }
      if (url.pathname === '/filelist.json') return route.fulfill({ json: Array.from({ length: shots + 1 }, (_, i) => ({ FileName: `visitor-${i}.jpg`, Original: `/image/visitor-${i}.jpg` })) });
      if (url.pathname.startsWith('/image/')) return route.fulfill({ contentType: 'image/jpeg', body: jpeg });
      return route.fulfill({ status: 404 });
    });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(key => localStorage.setItem('reelme.installationKey', key), app.installationKey);
    await page.goto(`${app.captureOrigin}/reelme.html#slot=${id}`);
    await page.getByRole('button', { name: 'Выбрать этот сюжет', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Новое мероприятие', exact: true })).toBeVisible();
    expect(app.sessionCount()).toBe(0);
    await expect(page.getByLabel('Локация', { exact: true })).toHaveValue('Новосибирск');
    expect(await page.getByLabel('Количество участников').locator('option').allTextContents()).toEqual(['Выберите диапазон', '0–50', '50–100', '100–300', '300–1000']);
    await page.screenshot({ path: join(artifacts, `event-${action}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(artifacts, `event-${action}-mobile.png`), fullPage: true });
    if (action === 'save') {
      await page.getByLabel('Название', { exact: true }).fill('   ');
      await page.getByLabel('Количество участников').selectOption('100–300');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Введите название');
      expect(app.sessionCount()).toBe(0);
      await page.getByLabel('Название', { exact: true }).fill('День команды');
      await page.getByLabel('Локация', { exact: true }).fill('Томск');
      let lost = false;
      await page.route('**/api/capture/sessions', async route => {
        if (!lost && route.request().postDataJSON().eventSetup?.action === 'save') {
          lost = true; const committed = await route.fetch(); expect(committed.status()).toBe(201);
          return route.abort('failed');
        }
        return route.continue();
      });
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Не удалось подтвердить');
      expect(app.sessionCount()).toBe(1);
      await page.reload();
      await expect(page.getByLabel('Название', { exact: true })).toHaveValue('День команды');
      await expect(page.getByLabel('Количество участников')).toHaveValue('100–300');
      await expect(page.getByLabel('Локация', { exact: true })).toHaveValue('Томск');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    } else await page.getByRole('button', { name: 'Пропустить', exact: true }).click();

    if (action === 'skip') {
      await expect(page.locator('.live .countdown strong')).toHaveText('2');
      // The active session keeps its timers. The next visitor uses manual mode.
      expect((await admin.put('/api/admin/capture-settings', { data: { startMode: 'manual', countdownSeconds: 4, reviewSeconds: 3, receiptSeconds: 5 } })).status()).toBe(200);
      await expect(page.getByText('Отлично! Все кадры готовы')).toBeVisible({ timeout: 10_000 });
    } else {
      await page.getByRole('button', { name: 'Снять один кадр', exact: true }).click();
      await page.getByRole('button', { name: 'Завершить фотосессию', exact: true }).click({ timeout: 20_000 });
    }
    await admin.dispose();
    await expect(page.getByRole('heading', { name: 'Ищите видео под номером 001 на промоэкране', exact: true })).toBeVisible();
    expect(app.sessionCount()).toBe(1); expect(shots).toBe(1);
    const receipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt);
    const uploadedPhoto = (await app.photos(receipt.sessionId))[0].bytes;
    const expectedSize = action === 'skip' ? { width: 512, height: 1024 } : { width: 2048, height: 1024 };
    expect(await sharp(uploadedPhoto).metadata()).toMatchObject({ format: 'jpeg', ...expectedSize });
    await expect(page.getByRole('button', { name: 'Еще фотосессия сюжета', exact: true })).toBeVisible();
    if (action === 'save') await page.getByRole('button', { name: 'Следующий посетитель', exact: true }).click();
    else await expect(page.getByRole('heading', { name: 'Выберите историю' })).toBeVisible({ timeout: 4500 });
    await page.getByRole('button', { name: /Сюжет 1:/ }).click();
    await page.getByRole('button', { name: 'Выбрать этот сюжет', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Начать съёмку', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Новое мероприятие' })).toHaveCount(0);
    expect(app.sessionCount()).toBe(2);
    await app.restart(); await page.reload();
    await expect(page.getByRole('button', { name: 'Начать съёмку', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Новое мероприятие' })).toHaveCount(0);

    await app.advanceTime(24 * 60 * 60 * 1000);
    const account = await browser.newContext();
    try {
      const archive = await account.newPage();
      await archive.goto(app.origin + '/operator');
      await archive.getByLabel('Логин', { exact: true }).fill('operator');
      await archive.getByLabel('Пароль', { exact: true }).fill(app.password);
      await archive.getByRole('button', { name: 'Войти', exact: true }).click();
      await archive.getByRole('button', { name: 'Архив', exact: true }).click();
      const name = action === 'save' ? 'День команды' : 'Session_1';
      await expect(archive.locator('.archive-day')).toContainText(name);
      await archive.locator('.archive-day').click();
      await expect(archive.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(archive.locator('.archive-heading')).toContainText(action === 'save' ? 'Томск · 100–300 участников' : 'Новосибирск');
      await archive.screenshot({ path: join(artifacts, `event-${action}-archive.png`), fullPage: true });
      expect((await (await archive.request.get(app.origin + '/api/events')).json())[0]).toMatchObject({ name, participantRange: action === 'save' ? '100–300' : null, location: action === 'save' ? 'Томск' : 'Новосибирск' });
    } finally { await account.close(); }
    expect(errors).toEqual([]);
  });
}

test('оператор завершает мероприятие с подтверждением, а следующая съёмка продолжает номера дня', async ({page, app}) => {
  const http = page.request, headers = {Origin:app.origin};
  const login = (username:string) => http.post(app.origin+'/api/auth/login',{headers,data:{username,password:app.password}});
  expect((await login('admin')).ok()).toBe(true);
  const thumbnail = await http.post(app.origin+'/api/admin/slot-media',{headers,multipart:{file:{name:'cover.png',mimeType:'image/png',buffer:await readFile(app.image)}}});
  const slot = await http.post(app.origin+'/api/admin/slots',{headers,data:{description:'Портрет',thumbnailId:(await thumbnail.json()).id,visible:true,
    referenceIds:[],mode:'P2V',model:'minimax/h3-max/reference-to-video',orientation:'landscape',participants:1,photosPerParticipant:1,
    aspectRatio:'16:9',resolution:'768P',duration:5,prompt:'Portrait',promptExpansionMode:'disabled'}});
  expect(slot.status()).toBe(201);
  const slotId = (await slot.json()).id;
  const start = await http.post(app.origin+'/api/capture/sessions',{headers:{Authorization:'Bearer '+app.installationKey},
    data:{slotId,startRequestId:randomUUID(),eventSetup:{action:'save',name:'Утро',participantRange:'0–50',location:'Зал'}}});
  expect((await start.json()).number).toBe(1);
  expect((await login('operator')).ok()).toBe(true);
  await page.goto(app.origin+'/operator');
  const button = page.getByRole('button',{name:'Завершить текущее мероприятие'});
  await button.click();
  await expect(page.getByRole('dialog')).toContainText('«Утро»');
  await page.getByRole('button',{name:'Отмена'}).click();
  await button.click();
  await page.getByRole('button',{name:'Завершить мероприятие',exact:true}).click();
  await expect(page.locator('.archive-day')).toContainText('Утро');
  await page.locator('.archive-day').click();
  await expect(page.locator('.archive-session')).toContainText('№ 1');
  await button.click();
  await expect(page.getByRole('dialog')).toContainText('Сейчас нет открытого мероприятия');
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.addInitScript(key => localStorage.setItem('reelme.installationKey',key),app.installationKey);
  await page.goto(app.captureOrigin+'/reelme.html#slot='+slotId);
  await page.getByRole('button',{name:'Выбрать этот сюжет'}).click();
  await expect(page.getByRole('heading',{name:'Новое мероприятие'})).toBeVisible();
  await page.getByRole('button',{name:'Пропустить',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('reelme.captureStart') ?? '{}').receipt?.number)).toBe(2);
});
