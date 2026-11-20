import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from './browser-fixture';

test.use({ capturePort: 0, preconfiguredEvent: false });
test('administrator prepares the archive from Settings, with empty, cancellation and confirmed outcomes', async ({ page, app }) => {
  await writeFile(join(app.dataDir, 'clock'), String(Date.parse('2026-11-19T17:00:00Z')));
  const db = new Database(join(app.dataDir, 'reelme.sqlite'));
  try {
    const dates = () => db.prepare('SELECT date FROM events ORDER BY date').pluck().all();
    const dialogs: string[] = [];
    let confirm = false, posts = 0;
    page.on('dialog', async dialog => {
      dialogs.push(dialog.message());
      if (confirm) await dialog.accept(); else await dialog.dismiss();
    });
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/admin/event-preparation')) posts++;
    });
    await page.goto(app.origin + '/admin');
    await page.getByLabel('Логин').fill('admin');
    await page.getByLabel('Пароль', { exact: true }).fill(app.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const settings = page.getByRole('button', { name: 'Параметры', exact: true });
    await settings.click();
    const prepare = page.getByRole('button', { name: 'Подготовка к мероприятию' });
    await prepare.click();
    await expect(page.getByText('Нет мероприятий для удаления.')).toBeVisible();
    expect(dialogs).toEqual([]);
    expect(posts).toBe(0);

    db.exec("INSERT INTO events(date,next_number) VALUES ('2026-11-08',1),('2026-11-09',1)");
    await prepare.click();
    await expect.poll(() => dialogs.length).toBe(1);
    await expect(prepare).toBeEnabled();
    expect(dialogs[0]).toBe('Будут безвозвратно удалены мероприятия за 8 ноября и раньше вместе с их фото и видео. Продолжить?');
    expect(posts).toBe(0);
    expect(dates()).toEqual(['2026-11-08', '2026-11-09']);

    confirm = true;
    await prepare.click();
    await expect(page.getByText('Идёт очистка.', { exact: false })).toBeVisible();
    await expect(prepare).toBeDisabled();
    await page.getByRole('button', { name: 'Сюжеты', exact: true }).click();
    await settings.click();
    await expect(page.getByText('Очистка завершена. Удалено мероприятий — 1. Без ошибок.')).toBeVisible();
    expect(posts).toBe(1);
    expect(dates()).toEqual(['2026-11-09']);
  } finally { db.close(); }
});
