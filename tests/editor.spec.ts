import { test, expect } from './browser-fixture';
import { mkdir, writeFile } from 'node:fs/promises';
import { openDatabase } from '../src/server/db.js';
test.use({ capturePort: 0 });
const artifacts = process.env.REELME_BROWSER_ARTIFACTS || '.tasks/TASK-001-T3-FT-001-W1';
// Independent expectations from the accepted model reference (not imported from UI rules).
const expectedModels = [
  ['V2V', 'minimax/h3-max/recast', ['768P', '1080P'], 'Один главный персонаж'],
  ['V2V', 'fal-ai/kling-video/o1/video-to-video/edit', [], '@Element1'],
  ['V2V', 'fal-ai/kling-video/o3/pro/video-to-video/edit', [], '@Element1'],
  ['V2V', 'kling/v4/video-to-video/edit', ['720p', '1080p'], '@Element1'],
  ['V2V', 'kling/v4/flash/video-to-video', ['720p'], '@Element1'],
  ['P2V', 'kling/v4/reference-to-video', ['720p', '1080p'], '@Element1'],
  ['P2V', 'fal-ai/kling-video/o3/pro/reference-to-video', [], '@Element1'],
  ['P2V', 'kling/v4/flash/reference-to-video', ['720p'], '@Element1'],
  ['P2V', 'minimax/h3-max/reference-to-video', ['480P', '768P', '1080P'], 'Image 5–7'],
  ['P2V', 'fal-ai/vidu/q4/reference-to-video', ['540p', '720p', '1080p', '2K', '4K'], '[@reference_image_5]'],
  ['P2V', 'google/gemini-omni-flash/v1.2/reference-to-video', ['360p', '720p', '1080p', '4k'], '<IMAGE_REF_4>'],
] as const;

test('admin saves both modes, reopens after restart, model rules, access and local capture', async ({ page, app }) => {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text() + ' ' + (message.location().url ? new URL(message.location().url).pathname : '')); });
  page.on('response', response => {
    if (response.status() >= 400 && !(response.url().endsWith('/api/auth/session') && response.status() === 401)) badResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on('dialog', dialog => dialog.accept());
  await mkdir(artifacts, { recursive: true });
  await page.goto(app.origin + '/admin');
  await expect(page.getByLabel('Логин')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Редактор сюжета' })).toHaveCount(0);
  async function login(username: string) {
    await page.getByLabel('Логин').fill(username);
    await page.getByLabel('Пароль', { exact: true }).fill(app.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
  }
  await login('admin');
  const simulation = page.getByLabel('Отправлять на фейковую генерацию', { exact: true });
  await expect(simulation).not.toBeChecked();
  const save = page.getByRole('button', { name: 'Сохранить сюжет', exact: true });
  await expect(save).toBeVisible();
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Добавьте изображение');
  await page.getByLabel('Изображение сюжета', { exact: true }).setInputFiles(app.image);
  await expect(page.getByLabel('Заменить: Изображение сюжета')).toBeVisible();
  await page.getByLabel('Описание', { exact: true }).fill('Прогулка по ночному Токио');
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Загрузите исходное видео');
  await page.getByLabel('Исходное видео', { exact: true }).setInputFiles(app.video);
  await expect(page.getByLabel('Заменить: Исходное видео')).toBeVisible();
  await page.getByLabel('Подтверждаю:', { exact: false }).check();
  await expect(page.locator('#prompt')).toBeDisabled();
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Сюжет сохранён.');
  await expect(page.locator('.slot-list strong')).toHaveText('Прогулка по ночному');
  await expect(page.locator('.slot-list img')).toHaveJSProperty('naturalWidth', 512);
  const v2vImage = await page.locator('.slot-list img').getAttribute('src');
  await page.locator('.slot-list').getByLabel('Отображать клиенту').uncheck();
  await expect(page.getByRole('status')).toContainText('скрыт');
  await page.getByRole('button', { name: 'Новый сюжет', exact: true }).click();
  await page.getByLabel('Изображение сюжета', { exact: true }).setInputFiles(app.image);
  await expect(page.getByLabel('Заменить: Изображение сюжета')).toBeVisible();
  await page.getByLabel('Описание', { exact: true }).fill('Полет над облаками заката');
  await page.getByLabel('Режим', { exact: true }).selectOption('P2V');
  await page.getByLabel('Референс 1', { exact: true }).setInputFiles(app.image);
  await expect(page.getByLabel('Заменить: Референс 1')).toBeVisible();
  for (const index of [2, 3]) {
    await page.getByLabel(`Референс ${index}`, { exact: true }).setInputFiles(app.image);
    await expect(page.getByLabel(`Заменить: Референс ${index}`)).toBeVisible();
  }
  await expect(page.getByLabel('Референс 4', { exact: true })).toHaveCount(0);
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Введите промпт');
  await page.locator('#prompt').fill('Посетитель @Element1 летит среди облаков @Image1');
  await simulation.check();
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Сюжет сохранён.');
  await expect(page.locator('.slot-list li')).toHaveCount(2);
  await app.restart();
  await page.reload();
  await page.getByRole('button', { name: /Полет над облаками/ }).click();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue('Полет над облаками заката');
  await expect(simulation).toBeChecked();
  await simulation.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifacts}/editor-simulation-saved.png`, fullPage: true });
  await expect(page.getByLabel('Заменить: Референс 1')).toBeVisible();
  await expect(page.getByLabel('Заменить: Референс 2')).toBeVisible();
  await expect(page.getByLabel('Заменить: Референс 3')).toBeVisible();
  await expect(page.getByLabel('Демовидео', { exact: true })).toBeVisible();
  await expect(page.locator('.media-preview video')).toHaveCount(0);
  await page.getByRole('button', { name: /Прогулка по ночному/ }).click();
  await expect(page.getByLabel('Заменить: Исходное видео')).toBeVisible();
  await expect(simulation).not.toBeChecked();
  await expect(page.locator('.slot-list li').filter({ hasText: 'Прогулка по ночному' }).getByLabel('Отображать клиенту')).not.toBeChecked();
  expect((await page.request.get(app.origin + v2vImage)).status()).toBe(200);
  await page.screenshot({ path: `${artifacts}/browser-desktop.png`, fullPage: true });
  for (const [mode, id, resolutions, hint] of expectedModels) {
    await page.getByLabel('Режим', { exact: true }).selectOption(mode);
    await page.getByLabel('Модель', { exact: true }).selectOption(id);
    if (id === 'minimax/h3-max/recast') await expect(page.locator('#prompt')).toBeDisabled();
    else { await expect(page.locator('#prompt')).toBeEnabled(); await expect(page.locator('#prompt')).toHaveAttribute('required', ''); }
    if (resolutions.length) expect(await page.locator('#resolution option').allTextContents()).toEqual([...resolutions]);
    else await expect(page.locator('#resolution')).toHaveCount(0);
    await expect(page.locator('#prompt-hint')).toContainText(hint);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(save).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${artifacts}/browser-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await login('operator');
  await expect(page.getByRole('heading', { name: 'Ваша история — здесь.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Редактор сюжета' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ваша история — здесь.' })).toBeVisible();
  const assets: string[] = [];
  page.on('response', response => { if (response.url().startsWith(app.origin + '/assets/')) assets.push(response.url()); });
  await page.goto(app.captureOrigin + '/reelme.html');
  await expect(page.getByRole('heading', { name: 'Нужна настройка установки' })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(app.captureOrigin);
  expect(assets.some(url => url.endsWith('.js'))).toBe(true);
  expect(assets.some(url => url.endsWith('.css'))).toBe(true);
  await page.screenshot({ path: `${artifacts}/browser-capture.png`, fullPage: true });
  await writeFile(`${artifacts}/browser-observations.json`, JSON.stringify({ pageErrors: errors, consoleErrors, unexpectedHttpErrors: badResponses, modelCount: expectedModels.length, captureOrigin: new URL(page.url()).origin }, null, 2));
  expect(errors).toEqual([]);
  expect(badResponses).toEqual([]);
  expect(consoleErrors.filter(message => !message.includes('401 (Unauthorized) /api/auth/session') && !message.includes('404 (Not Found) /favicon.ico'))).toEqual([]);
});

test.describe('manual slot test', () => {
  test.use({ runGeneration: true });
  test('JPEG save, hidden slot, recovered request, simulated and real worker results stay separate from camera', async ({ page, app }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.origin + '/admin');
    await page.getByLabel('Логин').fill('admin'); await page.getByLabel('Пароль', { exact: true }).fill(app.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const send = page.getByRole('button', { name: 'Отправить тестовую генерацию', exact: true });
    const save = page.getByRole('button', { name: 'Сохранить сюжет', exact: true });
    const simulation = page.getByLabel('Отправлять на фейковую генерацию', { exact: true });
    await expect(send).toBeDisabled();
    await page.getByLabel('Изображение сюжета', { exact: true }).setInputFiles(app.image);
    await expect(page.getByLabel('Заменить: Изображение сюжета')).toBeVisible();
    await page.getByLabel('Описание', { exact: true }).fill('Скрытый тестовый сюжет');
    await page.getByLabel('Режим', { exact: true }).selectOption('P2V');
    await simulation.check();
    await expect(page.getByLabel('Тестовая фотография (JPEG)', { exact: true })).toHaveAttribute('accept', 'image/jpeg,.jpg,.jpeg');
    await page.getByLabel('Тестовая фотография (JPEG)', { exact: true }).setInputFiles(app.jpeg);
    await expect(page.getByLabel('Заменить: Тестовая фотография (JPEG)')).toBeVisible();
    // Changing generation mode must retain the independent testing configuration.
    await page.getByLabel('Режим', { exact: true }).selectOption('V2V');
    await page.getByLabel('Режим', { exact: true }).selectOption('P2V');
    await expect(simulation).toBeChecked(); await expect(page.getByLabel('Заменить: Тестовая фотография (JPEG)')).toBeVisible();
    await page.locator('#prompt').fill('@Element1 walks');
    await page.locator('.editor').getByLabel('Отображать клиенту').uncheck();
    await expect(send).toBeDisabled(); expect(app.sessionCount()).toBe(0);
    await save.click(); await expect(page.getByRole('status')).toHaveText('Сюжет сохранён.');
    await expect(send).toBeEnabled(); expect(app.sessionCount()).toBe(0);
    await expect(page.getByText('Пока нет готового реального видео.', { exact: true })).toBeVisible();
    await app.restart(); await page.reload();
    await page.getByRole('button', { name: /Скрытый тестовый сюжет/ }).click();
    await expect(page.getByLabel('Заменить: Тестовая фотография (JPEG)')).toBeVisible(); await expect(simulation).toBeChecked();
    let firstId = ''; const requestIds: string[] = []; let loseResponse = true;
    await page.route('**/api/admin/slots/*/test-generations', async route => {
      requestIds.push(route.request().postDataJSON().startRequestId);
      if (loseResponse) {
        loseResponse = false;
        const accepted = await route.fetch(); expect(accepted.status()).toBe(201); firstId = (await accepted.json()).sessionId;
        await route.abort('connectionreset');
      } else await route.continue();
    });
    await send.click(); await expect(page.getByRole('alert')).toContainText('Ответ не получен');
    expect(app.sessionCount()).toBe(1);
    await page.reload(); await page.getByRole('button', { name: /Скрытый тестовый сюжет/ }).click();
    await page.getByRole('button', { name: 'Повторить запрос тестовой генерации', exact: true }).click();
    await expect(page.locator('.test-result')).toContainText('Эмуляция успешна, но fal не отвечает');
    await expect(page.locator('.test-result')).toContainText('Тестовый режим: fal не вызывался');
    expect(requestIds[1]).toBe(requestIds[0]); expect(app.sessionCount()).toBe(1);
    const original = await import('node:fs/promises').then(fs => fs.readFile(app.jpeg));
    const photos = await app.photos(firstId); expect(photos.map(p => p.pose_index)).toEqual([0,1,2,3]);
    for (const photo of photos) expect(photo.bytes).toEqual(original);
    await mkdir(artifacts, { recursive: true });
    await page.locator('.form-section').last().screenshot({ path: `${artifacts}/slot-test-simulated.png` });
    await send.click(); await expect(page.locator('.test-result')).toContainText('Тест № 2');
    expect(app.sessionCount()).toBe(2); expect(requestIds[2]).not.toBe(requestIds[1]);
    await simulation.uncheck(); await expect(send).toBeDisabled();
    await save.click(); await expect(page.getByRole('status')).toHaveText('Сюжет сохранён.');
    await send.click(); await expect(page.locator('.test-result')).toContainText('Тест № 3 · Видео готово');
    const player = page.getByLabel('Последнее реальное видео сюжета', { exact: true });
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate(node => (node as HTMLVideoElement).play());
    await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
    await player.evaluate(node => (node as HTMLVideoElement).pause());
    const stableVideoUrl = await player.getAttribute('src');
    await expect(page.locator('.last-video')).toContainText('Отправлено в fal');
    await expect(page.locator('.last-video')).toContainText('Новосибирск');
    await expect(page.locator('.last-video')).toContainText('До готового видео');
    expect(await page.locator('.last-video dd').allTextContents()).not.toContain('Нет данных');
    await page.locator('.form-section').last().screenshot({ path: `${artifacts}/slot-test-real-ready.png` });
    await page.locator('#prompt').fill('fail-test'); await save.click(); await expect(page.getByRole('status')).toHaveText('Сюжет сохранён.');
    await send.click(); await expect(page.locator('.test-result')).toContainText('Тест № 4 · Тест не завершён');
    await expect(page.locator('.test-result')).toContainText('Сервис отклонил запрос генерации');
    expect(app.sessionCount()).toBe(4);
    await expect(player).toHaveAttribute('src', stableVideoUrl!);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.form-section').last().screenshot({ path: `${artifacts}/slot-test-failed-mobile.png` });
    await simulation.check(); await save.click(); await expect(page.getByRole('status')).toHaveText('Сюжет сохранён.');
    await send.click(); await expect(page.locator('.test-result')).toContainText('Тест № 5 · Эмуляция успешна');
    await expect(player).toHaveAttribute('src', stableVideoUrl!);
    // Legacy rows keep the same playable MP4 while both unknown measurements are explicit.
    const resultId = stableVideoUrl!.split('/').at(-2)!;
    const db = openDatabase(app.dataDir);
    try {
      expect((db.prepare('SELECT opened_at FROM session_delivery WHERE session_id=?').get(resultId) as { opened_at: number | null }).opened_at).toBeNull();
      db.prepare('UPDATE generation_jobs SET submitted_at=NULL,ready_at=NULL WHERE session_id=?').run(resultId);
    } finally { db.close(); }
    await page.reload(); await page.getByRole('button', { name: /Скрытый тестовый сюжет/ }).click();
    await expect(player).toHaveAttribute('src', stableVideoUrl!);
    await expect(page.locator('.last-video dd')).toHaveText(['Нет данных', 'Нет данных']);
    await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    await page.locator('.last-video').screenshot({ path: `${artifacts}/slot-last-video-legacy.png` });
    expect(errors).toEqual([]);
    await writeFile(`${artifacts}/slot-test-browser-observations.json`, JSON.stringify({ hiddenSlot: true, noAutomaticSessionFromUploadOrSave: true, lostResponseSameRequestAfterReload: requestIds[0] === requestIds[1], sessionCount: app.sessionCount(), photos: photos.length, fixtureBytesEqual: true, simulated: true, realReady: true, actualPlayback: true, safeFailureKeepsVideo: true, simulationKeepsVideo: true, legacyTimesExplicit: true, receiveNotOpened: true, modeChangePreservesTestSettings: true, cameraCalls: 0, externalCalls: 0, pageErrors: errors }, null, 2));
  });
});
