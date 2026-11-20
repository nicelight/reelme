/** Module contract: browser acceptance for the sequential slot editor and manual
 * tests against the real isolated backend. Only representative setup/prompt paths
 * are exercised; provider transport is controlled. Source: docs/slot-setup/matrix.md. */
import { test, expect } from './browser-fixture';
import type { Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/server/db.js';
test.use({ capturePort: 0 });
const artifacts = process.env.REELME_BROWSER_ARTIFACTS || '.tasks/TASK-017-T2-FT-001-W14';
const h3 = 'minimax/h3-max/reference-to-video';
const kling = 'kling/v4/reference-to-video';
async function login(page: Page, origin: string, password: string, role = 'admin') {
  await page.goto(origin + '/admin');
  await page.getByLabel('Логин').fill(role); await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  if (role === 'admin') await expect(page.getByRole('heading', { name: 'Сюжеты', exact: false })).toBeVisible();
  else { await page.getByRole('link', { name: 'Перейти к рабочему экрану' }).click(); await expect(page.getByRole('region', { name: 'Экран результатов ReelMe' })).toBeVisible(); }
}
async function setup(page: Page, mode: 'P2V' | 'V2V', model: string, people: string, count: string) {
  await page.getByLabel('Режим', { exact: true }).selectOption(mode);
  await page.getByLabel('Модель', { exact: true }).selectOption(model);
  await page.getByLabel('Участники', { exact: true }).selectOption(people);
  await page.locator('#photos-per-person').selectOption(count);
  const resolution = page.locator('#resolution');
  if (await resolution.count() && !await resolution.inputValue()) await resolution.selectOption({ index: 1 });
  const ratio = page.locator('#aspect-ratio');
  if (await ratio.count() && !await ratio.inputValue()) await ratio.selectOption({ index: 1 });
}
async function lock(page: Page) {
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
  await expect(page.getByText('Загружаем готовый промпт…', { exact: true })).toBeHidden();
  await expect(page.locator('#prompt')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Фиксация параметров генерации' })).toBeChecked();
}
async function openTests(page: Page) {
  const toggle = page.getByRole('button', { name: /^(Открыть|Свернуть) тесты$/ });
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
async function upload(page: Page, label: string, file: string) {
  await page.getByLabel(label, { exact: true }).setInputFiles(file);
  await expect(page.getByLabel('Заменить: ' + label, { exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем и проверяем файл…')).toHaveCount(0);
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Сохранить сюжет', exact: true }).click();
  await expect(page.getByText('Сюжет сохранён.', { exact: true })).toBeVisible();
}

test('visibility from a stale tab preserves the prompt saved in another tab', async ({ page, app }) => {
  await login(page, app.origin, app.password);
  await setup(page, 'P2V', h3, '1', '4');
  await lock(page);
  await upload(page, 'Изображение сюжета', app.image);
  await page.getByLabel('Описание', { exact: true }).fill('Портрет гостя');
  await page.locator('.editor').getByLabel('Отображать клиенту').check();
  await save(page);

  const other = await page.context().newPage();
  await other.goto(app.origin + '/admin');
  await other.getByRole('button', { name: /Портрет гостя/ }).click();
  const newPrompt = 'Show the guest in the mountains.';
  await other.locator('#prompt').fill(newPrompt);
  await save(other);

  await page.locator('.slot-list').getByLabel('Отображать клиенту').uncheck();
  await expect(page.getByText('Сюжет скрыт от клиента.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Портрет гостя/ }).click();
  await expect(page.locator('.slot-list').getByLabel('Отображать клиенту')).not.toBeChecked();
  await expect(page.locator('#prompt')).toHaveValue(newPrompt);
});

test('sequential setup exposes real capacities, locks fields, saves both modes and preserves the source on unlock', async ({ page, app }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await mkdir(artifacts, { recursive: true }); await login(page, app.origin, app.password);
  await expect(page.getByLabel('Участники', { exact: true })).toHaveCount(0);
  await expect(page.locator('#prompt')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Сохранить сюжет', exact: true })).toBeDisabled();
  await page.getByLabel('Режим', { exact: true }).selectOption('P2V');
  await page.getByLabel('Модель', { exact: true }).selectOption(h3);
  await expect(page.getByLabel('Возможности модели')).toContainText('Обычные изображения: до 9');
  await expect(page.locator('#photos-per-person')).toHaveCount(0);
  await page.getByLabel('Участники', { exact: true }).selectOption('2');
  await page.locator('#photos-per-person').selectOption('4');
  await expect(page.getByLabel('Распределение фотографий')).toContainText('Фото камеры: 8. Elements: 0. Дополнительные фото: 1');
  expect(await page.locator('#resolution option').allTextContents()).toEqual(['Выберите разрешение', '768P', '1080P']);
  expect(await page.locator('#aspect-ratio option').allTextContents()).toEqual(['Выберите соотношение', '16:9', '4:3', '21:9']);
  await lock(page);
  await expect(page.locator('#model')).toBeDisabled(); await expect(page.locator('#participants')).toBeDisabled();
  await expect(page.locator('#mode')).toHaveValue('P2V'); await expect(page.locator('#model')).toHaveValue(h3); await expect(page.locator('#participants')).toHaveValue('2'); await expect(page.locator('#photos-per-person')).toHaveValue('4');
  await expect(page.locator('#prompt')).toHaveValue(await readFile('public/slot-prompts/h3-reference/people-2__photos-4__refs-0.md', 'utf8'));
  await page.getByRole('button', { name: 'Сохранить сюжет', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Добавьте изображение');
  await upload(page, 'Изображение сюжета', app.image); await page.getByLabel('Описание', { exact: true }).fill('Групповой портрет для гостей');
  await upload(page, 'Референс 1', app.image);
  await expect(page.getByLabel('Референс 2', { exact: true })).toHaveCount(0);
  await expect(page.locator('#prompt')).toHaveValue(await readFile('public/slot-prompts/h3-reference/people-2__photos-4__refs-1.md', 'utf8'));
  await save(page); await expect(page.locator('.slot-list strong')).toHaveText('Групповой портрет для');
  await app.restart(); await page.reload(); await page.getByRole('button', { name: /Групповой портрет для/ }).click();
  await expect(page.locator('#model')).toBeDisabled(); await expect(page.getByLabel('Заменить: Референс 1')).toBeVisible();
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue('Групповой портрет для гостей');
  await expect(page.locator('#prompt')).toHaveCount(0);
  await page.getByLabel('Ориентация', { exact: true }).selectOption('portrait');
  expect(await page.locator('#aspect-ratio option').allTextContents()).toEqual(['Выберите соотношение', '9:16', '3:4']);
  await lock(page); await expect(page.getByLabel('Референс 1', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Заменить: Референс 1')).toHaveCount(0);
  await save(page);
  // Recast's deliberately empty file is success; a missing source is a saved draft.
  await page.getByRole('button', { name: 'Новый сюжет', exact: true }).click();
  await setup(page, 'V2V', 'minimax/h3-max/recast', '1', '1');
  await expect(page.locator('#participants option[value="group"]')).toBeDisabled();
  await expect(page.locator('#photos-per-person option[value="2"]')).toBeDisabled();
  await lock(page); await expect(page.locator('#prompt')).toBeEditable(); await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.getByText('РЕКОМЕНДУЕТСЯ ОСТАВИТЬ ПРОМПТ ПУСТЫМ!', { exact: true })).toBeVisible();
  await upload(page, 'Изображение сюжета', app.image); await page.getByLabel('Описание', { exact: true }).fill('Исходный ролик для портрета'); await save(page);
  const catalogueBefore = await page.request.get(app.origin + '/api/catalog', { headers: { authorization: `Bearer ${app.installationKey}` } });
  expect((await catalogueBefore.json()).total).toBe(1);
  const draftId = (await page.getByTestId('draft-slot-id').textContent())!; await app.prepareTemplate(draftId);
  await page.getByRole('button', { name: 'Подключить исходник из файла', exact: true }).click();
  await expect(page.getByLabel('Исходный ролик сюжета', { exact: true })).toBeVisible(); await page.getByLabel('Подтверждаю:', { exact: false }).check(); await save(page);
  const source = await page.locator('.materials video').getAttribute('src');
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click(); await lock(page);
  await expect(page.locator('.materials video')).toHaveAttribute('src', source!);
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
  await page.getByLabel('Модель', { exact: true }).selectOption('fal-ai/kling-video/o1/video-to-video/edit');
  await page.getByLabel('Участники', { exact: true }).selectOption('2');
  await expect(page.locator('#photos-per-person option[value="1"]')).toBeDisabled();
  await page.locator('#photos-per-person').selectOption('4');
  await expect(page.getByLabel('Распределение фотографий')).toContainText('Фото камеры: 8. Elements: 2. Дополнительные фото: 2');
  await expect(page.locator('#resolution')).toHaveCount(0); await lock(page);
  await expect(page.locator('.materials video')).toHaveAttribute('src', source!); await upload(page, 'Референс 1', app.image); await save(page);
  await page.screenshot({ path: join(artifacts, 'editor-desktop.png'), fullPage: true });
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
  await setup(page, 'P2V', 'kling/v4/flash/reference-to-video', '1', '2');
  await expect(page.getByLabel('Возможности модели')).toContainText('доступно 3 (max 7)');
  await expect(page.locator('#resolution option[value="1080p"]')).toBeDisabled();
  await lock(page); await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(artifacts, 'editor-mobile.png'), fullPage: true });
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
  await setup(page, 'P2V', 'fal-ai/vidu/q4/reference-to-video', '2', '3');
  await page.getByLabel('Разрешение', { exact: true }).selectOption('1080p');
  await page.getByLabel('Длительность, с', { exact: true }).fill('6'); await page.getByLabel('Длительность, с', { exact: true }).blur();
  await page.getByLabel('Модель', { exact: true }).selectOption('google/gemini-omni-flash/v1.2/reference-to-video');
  await expect(page.locator('#participants')).toHaveValue('2'); await expect(page.locator('#photos-per-person')).toHaveValue('3');
  await expect(page.locator('#resolution')).toHaveValue('1080p'); await expect(page.locator('#duration')).toHaveValue('6');
  await expect(page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true })).toBeEnabled();
  await page.getByLabel('Режим', { exact: true }).selectOption('V2V');
  await page.getByLabel('Модель', { exact: true }).selectOption('minimax/h3-max/recast');
  await expect(page.locator('#participants')).toHaveValue('2'); await expect(page.locator('#photos-per-person')).toHaveValue('');
  await expect(page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await login(page, app.origin, app.password, 'operator');
  await expect(page.getByRole('region', { name: 'Редактор сюжета' })).toHaveCount(0);
  expect((await page.request.get(app.origin + '/api/admin/slots')).status()).toBe(403);
  expect(errors).toEqual([]);
});

test('prompt text survives reference changes and stale fetches; real load failures block stale saves', async ({ page, app }) => {
  page.on('dialog', dialog => dialog.accept()); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, app.origin, app.password); await setup(page, 'P2V', h3, '1', '1');
  let release: (() => void) | undefined; let held = false;
  await page.route('**/slot-prompts/**', async route => {
    if (!held) { held = true; await new Promise<void>(resolve => release = resolve); await route.fulfill({ status: 200, body: 'STALE PROMPT RESPONSE' }); }
    else await route.continue();
  });
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
  await expect(page.getByText('Загружаем готовый промпт…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить сюжет', exact: true })).toBeDisabled();
  await page.locator('#prompt').fill('My authored text with Image 1'); release!();
  await expect(page.locator('#prompt')).toHaveValue('My authored text with Image 1');
  await upload(page, 'Референс 1', app.image);
  await expect(page.getByText('Референсы изменены.', { exact: false })).toBeVisible();
  await expect(page.locator('#prompt')).toHaveValue('My authored text with Image 1');
  await page.getByLabel('Заменить: Референс 1', { exact: true }).setInputFiles(app.jpeg);
  await expect(page.getByText('Загружаем и проверяем файл…')).toHaveCount(0);
  await expect(page.locator('#prompt')).toHaveValue('My authored text with Image 1');
  await page.locator('.references .media-field').first().getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect(page.locator('#prompt')).toHaveValue('My authored text with Image 1');
  // Orientation is an upper setting even when the chosen prompt filename is unchanged.
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
  await page.getByLabel('Ориентация', { exact: true }).selectOption('portrait'); await lock(page);
  const expected = await readFile('public/slot-prompts/h3-reference/people-1__photos-1__refs-0.md', 'utf8');
  await expect(page.locator('#prompt')).toHaveValue(expected);
  // A delayed previous setup response cannot replace the newly selected setup.
  await page.unroute('**/slot-prompts/**'); let oldHeld = false; let releaseOld: (() => void) | undefined;
  await page.route('**/slot-prompts/**', async route => {
    if (!oldHeld) { oldHeld = true; await new Promise<void>(resolve => releaseOld = resolve); await route.fulfill({ status: 200, body: 'OLD SETUP RESPONSE' }); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Восстановить готовый промпт', exact: true }).click();
  await expect(page.getByText('Загружаем готовый промпт…', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
  await page.getByLabel('Разрешение', { exact: true }).selectOption('1080P'); await lock(page); releaseOld!();
  await expect(page.locator('#prompt')).toHaveValue(expected);
  await page.unroute('**/slot-prompts/**');
  await page.route('**/slot-prompts/**', route => route.fulfill({ status: 503, body: 'offline' }));
  await page.getByRole('button', { name: 'Восстановить готовый промпт', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить готовый промпт');
  await expect(page.getByRole('button', { name: 'Сохранить сюжет', exact: true })).toBeDisabled();
  await page.unroute('**/slot-prompts/**'); await page.getByRole('button', { name: 'Восстановить готовый промпт', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.locator('#prompt')).toHaveValue(expected);
  await expect(page.getByRole('button', { name: 'Сохранить сюжет', exact: true })).toBeEnabled(); expect(errors).toEqual([]);
});

test.describe('manual test flow', () => {
  test.use({ runGeneration: true });
  test('per-position JPEG cache separates people/group and real results survive resets, failures and simulation', async ({ page, app }) => {
    test.setTimeout(120_000); await mkdir(artifacts, { recursive: true });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    const files: string[] = []; const bytes: Buffer[] = [];
    for (let i = 0; i < 6; i++) { files.push(join(app.dataDir, `person-${i}.jpg`)); bytes.push(await sharp({ create: { width: 60 + i, height: 48, channels: 3, background: '#d0b8ff' } }).jpeg().toBuffer()); await writeFile(files[i], bytes[i]); }
    await login(page, app.origin, app.password); await upload(page, 'Изображение сюжета', app.image);
    await page.getByLabel('Описание', { exact: true }).fill('Скрытый тестовый сюжет'); await page.locator('.editor').getByLabel('Отображать клиенту').uncheck();
    await setup(page, 'P2V', kling, '2', '2'); await lock(page); await openTests(page);
    const labels = ['Человек 1 — кадр 1 (JPEG)', 'Человек 1 — кадр 2 (JPEG)', 'Человек 2 — кадр 1 (JPEG)', 'Человек 2 — кадр 2 (JPEG)'];
    const send = page.getByRole('button', { name: 'Отправить тестовую генерацию', exact: true });
    for (let i = 0; i < 4; i++) { await upload(page, labels[i], files[i]); await expect(send).toBeDisabled(); }
    await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
    await page.getByLabel('Участники', { exact: true }).selectOption('group'); await page.locator('#photos-per-person').selectOption('2'); await lock(page); await openTests(page);
    await expect(page.getByLabel('Группа — кадр 1 (JPEG)', { exact: true })).toBeVisible(); await expect(page.getByLabel('Группа — кадр 2 (JPEG)', { exact: true })).toBeVisible();
    await upload(page, 'Группа — кадр 1 (JPEG)', files[4]); await upload(page, 'Группа — кадр 2 (JPEG)', files[5]);
    await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
    await page.getByLabel('Участники', { exact: true }).selectOption('2'); await page.locator('#photos-per-person').selectOption('2'); await lock(page); await openTests(page);
    for (const label of labels) await expect(page.getByLabel('Заменить: ' + label, { exact: true })).toBeVisible();
    await page.getByLabel('Режим генерации', { exact: true }).selectOption('inputs'); await save(page); await expect(send).toBeEnabled(); expect(app.sessionCount()).toBe(0);
    const stored = openDatabase(app.dataDir);
    const row = stored.prepare('SELECT config FROM slots').get() as {config:string}; const saved = JSON.parse(row.config); stored.close();
    expect(saved.testPhotoIds).toHaveLength(4); expect(new Set(saved.testPhotoIds).size).toBe(4);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toMatch(/base64|data:image/);
    let firstId = ''; const requestIds: string[] = []; let loseResponse = true;
    await page.route('**/api/admin/slots/*/test-generations', async route => {
      requestIds.push(route.request().postDataJSON().startRequestId);
      if (loseResponse) { loseResponse = false; const accepted = await route.fetch(); expect(accepted.status()).toBe(201); firstId = (await accepted.json()).sessionId; await route.abort('connectionreset'); }
      else await route.continue();
    });
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('reelme.slotTest.')) {
          Storage.prototype.setItem = original;
          throw new DOMException('Storage is full', 'QuotaExceededError');
        }
        original.call(this, key, value);
      };
    });
    await send.click();
    await expect(page.getByRole('alert')).toContainText('Не удалось сохранить его номер в хранилище браузера');
    await expect(send).toBeEnabled(); expect(requestIds).toEqual([]); expect(app.sessionCount()).toBe(0);
    await send.click(); await expect(page.getByRole('alert')).toContainText('Ответ не получен'); expect(app.sessionCount()).toBe(1);
    await page.reload(); await page.getByRole('button', { name: /Скрытый тестовый сюжет/ }).click(); await openTests(page);
    await page.getByRole('button', { name: 'Повторить запрос тестовой генерации', exact: true }).click();
    await expect(page.locator('.test-result')).toContainText('Проверка входных данных пройдена'); expect(requestIds[1]).toBe(requestIds[0]); expect(app.sessionCount()).toBe(1);
    const photos = await app.photos(firstId); expect(photos.map(row => row.pose_index)).toEqual([0, 1, 2, 3]);
    for (const photo of photos) expect(photo.bytes).toEqual(bytes[photo.pose_index]);
    await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
    await expect(page.locator('.test-result')).toContainText('Проверка входных данных пройдена'); await lock(page); await openTests(page);
    const simulation = page.getByLabel('Режим генерации', { exact: true }); await expect(simulation).toHaveValue('fal');
    await save(page); await send.click(); await expect(page.locator('.test-result')).toContainText('Видео готово');
    const player = page.getByLabel('Последнее реальное видео сюжета', { exact: true }); await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate(node => (node as HTMLVideoElement).play()); await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1); await player.evaluate(node => (node as HTMLVideoElement).pause());
    const stableUrl = await player.getAttribute('src'); await expect(page.locator('.last-video')).toContainText('Новосибирск'); await expect(page.locator('.last-video')).toContainText('До готового видео');
    await page.screenshot({ path: join(artifacts, 'slot-test-ready-desktop.png'), fullPage: true });
    await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click(); await expect(player).toHaveAttribute('src', stableUrl!);
    await lock(page); await openTests(page); await page.locator('#prompt').fill('fail-test'); await save(page); await send.click();
    await expect(page.locator('.test-result')).toContainText('Тест не завершён'); await expect(player).toHaveAttribute('src', stableUrl!);
    await simulation.selectOption('inputs'); await save(page); await send.click(); await expect(page.locator('.test-result')).toContainText('Проверка входных данных пройдена'); await expect(player).toHaveAttribute('src', stableUrl!);
    await page.setViewportSize({ width: 375, height: 812 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(artifacts, 'slot-test-ready-mobile.png'), fullPage: true });
    const resultId = stableUrl!.split('/').at(-2)!; const db = openDatabase(app.dataDir);
    expect((db.prepare('SELECT opened_at FROM session_delivery WHERE session_id=?').get(resultId) as {opened_at:number|null}).opened_at).toBeNull();
    db.prepare('UPDATE generation_jobs SET submitted_at=NULL,ready_at=NULL WHERE session_id=?').run(resultId); db.close();
    await page.reload(); await page.getByRole('button', { name: /Скрытый тестовый сюжет/ }).click();
    await expect(player).toHaveAttribute('src', stableUrl!); await expect(page.locator('.last-video dd')).toHaveText(['Нет данных', 'Нет данных']);
    expect(errors).toEqual([]);
    await writeFile(join(artifacts, 'editor-observations.json'), JSON.stringify({ distinctJPEGs: photos.length, cacheSeparatedGroupsAndPeople: true, lostResponseRetriedSameId: requestIds[0] === requestIds[1], actualPlayback: true, readySurvivesUnlockFailureSimulation: true, unknownLegacyTimes: true, receiveNotOpened: true, pageErrors: errors }, null, 2));
  });
});

test('draft source binding and five-guide page show actual immutable media on desktop and mobile', async ({ page, app }) => {
  await mkdir(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await login(page, app.origin, app.password);
  await setup(page, 'V2V', 'minimax/h3-max/recast', '1', '1'); await lock(page);
  const id = (await page.getByTestId('draft-slot-id').textContent())!;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText(`${id}__landscape.mp4`, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Исходное видео', { exact: true })).toHaveCount(0);
  const connect = page.getByRole('button', { name: 'Подключить исходник из файла', exact: true });
  await connect.click(); await expect(page.getByRole('alert')).toContainText('Шаблонный ролик этой ориентации не найден');
  await upload(page, 'Изображение сюжета', app.image); await page.getByLabel('Описание', { exact: true }).fill('Подготовленный исходник');
  await app.prepareTemplate(id); await connect.click();
  const player = page.getByLabel('Исходный ролик сюжета', { exact: true }); await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate(node => (node as HTMLVideoElement).play()); await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1); await player.evaluate(node => (node as HTMLVideoElement).pause());
  await page.getByLabel('Подтверждаю:', { exact: false }).check(); await save(page);
  const saved = await (await page.request.get(`${app.origin}/api/admin/slots/${id}`)).json();
  await expect(player).toHaveAttribute('src', `/api/admin/slot-media/${saved.videoId}`);
  const oldSource = saved.videoId;
  await page.getByRole('button', { name: 'Обновить исходник из файла', exact: true }).click();
  await expect(player).not.toHaveAttribute('src', `/api/admin/slot-media/${oldSource}`);
  await page.getByLabel('Подтверждаю:', { exact: false }).check(); await save(page);
  await page.getByRole('switch', { name: 'Фиксация параметров генерации', exact: true }).click();
  await page.getByLabel('Ориентация', { exact: true }).selectOption('portrait'); await lock(page);
  await expect(player).toHaveCount(0); await expect(page.getByText(`${id}__portrait.mp4`, { exact: true })).toBeVisible();
  // Filename alone cannot disguise a landscape fixture as portrait.
  await app.prepareTemplate(id, 'portrait'); await connect.click(); await expect(page.getByRole('alert')).toContainText('Ориентация файла не соответствует');
  await save(page); // Save an honest not-ready draft, without the prior landscape source.
  expect((await (await page.request.get(`${app.origin}/api/admin/slots/${id}`)).json()).videoId).toBeUndefined();
  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Образцы ракурсов', exact: true })).toBeVisible();
  await expect(page.locator('.guide-card')).toHaveCount(5);
  await expect(page.getByText('Образец не загружен.', { exact: false })).toHaveCount(5);
  for (const number of [1, 2, 3, 4, 5]) {
    const card = page.getByRole('region', { name: `Ракурс ${number}`, exact: true });
    await card.locator('input[type=file]').setInputFiles(number === 1 ? app.jpeg : app.image);
    await expect(card.locator('img')).toBeVisible();
    await expect.poll(async () => (await (await page.request.get(app.origin + '/api/admin/capture-guides')).json())[number - 1].mediaId).toBeTruthy();
  }
  const before = await (await page.request.get(app.origin + '/api/admin/capture-guides')).json();
  const firstCard = page.getByRole('region', { name: 'Ракурс 1', exact: true });
  await firstCard.locator('input[type=file]').setInputFiles(app.image);
  await expect.poll(async () => (await (await page.request.get(app.origin + '/api/admin/capture-guides')).json())[0].mediaId).not.toBe(before[0].mediaId);
  await page.screenshot({ path: join(artifacts, 'pose-guides-desktop.png'), fullPage: true });
  await page.getByRole('region', { name: 'Ракурс 3', exact: true }).getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ракурс 3', exact: true }).getByText('Образец не загружен.', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(artifacts, 'pose-guides-mobile.png'), fullPage: true });
  await page.reload(); await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await expect(page.locator('.guide-card img')).toHaveCount(4);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await login(page, app.origin, app.password, 'operator');
  await expect(page.getByRole('button', { name: 'Параметры', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('simulation warning persists on reopen and reload and keeps tests expanded', async ({ page, app }) => {
  await mkdir(artifacts, { recursive: true });
  await login(page, app.origin, app.password);
  await upload(page, 'Изображение сюжета', app.image);
  await page.getByLabel('Описание', { exact: true }).fill('Проверка режима тестирования');
  await setup(page, 'P2V', h3, '1', '1'); await lock(page); await openTests(page);
  const mode = page.getByLabel('Режим генерации', { exact: true });
  await mode.selectOption('video'); await save(page);
  const warning = page.locator('.testing-warning');
  const collapse = page.getByRole('button', { name: 'Свернуть тесты', exact: true });
  await expect(warning).toContainText('Тестирование!');
  await expect(collapse).toBeDisabled();
  await page.getByRole('button', { name: 'Новый сюжет', exact: true }).click();
  await expect(warning).toHaveCount(0);
  await page.getByRole('button', { name: /Проверка режима тестирования/ }).click();
  await expect(warning).toBeVisible(); await expect(mode).toHaveValue('video');
  await expect(collapse).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: /Проверка режима тестирования/ }).click();
  await expect(warning).toBeVisible(); await expect(mode).toBeVisible();
  await expect(mode).toHaveValue('video'); await expect(collapse).toBeDisabled();
  await page.screenshot({ path: join(artifacts, 'testing-warning.png'), fullPage: true });
  await mode.selectOption('inputs'); await expect(warning).toBeVisible(); await expect(collapse).toBeDisabled();
  await mode.selectOption('fal'); await save(page);
  await expect(warning).toHaveCount(0);
  // Normal generation may again hide its test tools.
  await openTests(page); await collapse.click(); await expect(mode).toBeHidden();
});
