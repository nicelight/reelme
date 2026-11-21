import { readFile } from 'node:fs/promises';
import { preparedSession } from './receive-fixture';
import { openDatabase } from '../src/server/db';
import { publishReady } from '../src/server/sessions/receive';
import { test as base, expect } from './browser-fixture';
import { attachedBytes, smtpFixture } from './email-smtp';

const test = base.extend<{ smtp: Awaited<ReturnType<typeof smtpFixture>> }>({
  smtp: async ({}, use) => {
    const smtp = await smtpFixture();
    try { await use(smtp); } finally { await smtp.close(); }
  },
  smtpPort: async ({ smtp }, use) => use(smtp.port),
});
test.use({ capturePort: 0 });

test('admin tests Mail.ru before activation and returns to the saved mailbox after switching providers', async ({ page, app, smtp }) => {
  await page.goto(app.origin + '/admin');
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill(app.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const parameters = page.getByRole('button', { name: 'Параметры', exact: true });
  await parameters.click();
  const form = page.getByRole('region', { name: 'Электронная почта' });
  const provider = form.getByLabel('Почтовый сервис');
  const send = form.getByRole('button', { name: 'Отправить тестовое письмо' });
  const save = form.getByRole('button', { name: 'Сохранить и использовать' });
  await expect(provider).toHaveValue('mailru');
  await form.getByLabel('Адрес ящика Mail.ru').fill('studio@mail.ru');
  await form.getByLabel('Пароль приложения').fill('fixture-password');
  await form.getByLabel('Адрес получателя').fill('visitor@example.test');
  await send.click();
  await expect(form.getByRole('status')).toContainText('принял тестовое письмо');
  await expect(form).toContainText('Отправка через настройки сервера.');
  expect(smtp.messages).toHaveLength(1);
  expect(smtp.messages[0].recipient).toBe('visitor@example.test');
  expect(smtp.messages[0].raw).toContain('From: ReelMe <studio@mail.ru>');
  await save.click();
  await expect(form).toContainText('Отправка через Mail.ru.');
  await expect(form.getByLabel('Пароль приложения')).toHaveValue('');
  await provider.selectOption('smtpbz');
  await form.getByLabel('Логин SMTP.BZ').fill('studio');
  await form.getByLabel('Адрес отправителя').fill('studio@example.test');
  await form.getByLabel('Пароль SMTP.BZ').fill('fixture-bz-password');
  await save.click();
  await expect(form).toContainText('Отправка через SMTP.BZ.');
  await page.reload();
  await parameters.click();
  await expect(provider).toHaveValue('smtpbz');
  await provider.selectOption('mailru');
  await expect(form.getByLabel('Адрес ящика Mail.ru')).toHaveValue('studio@mail.ru');
  await save.click();
  await expect(form).toContainText('Отправка через Mail.ru.');
  const video = await readFile(app.video);
  const session = await preparedSession(app.dataDir, video);
  const db = openDatabase(app.dataDir);
  try {
    await publishReady(db, app.dataDir, session.id, app.origin);
    const token = db.prepare('SELECT receive_token FROM session_delivery WHERE session_id=?').pluck().get(session.id);
    const queued = await page.request.post(app.origin + '/api/receive/' + token + '/email', { data: { email: 'guest@example.test' } });
    expect(queued.ok()).toBeTruthy();
    await expect.poll(() => smtp.messages.length).toBe(2);
    expect(smtp.messages[1].raw).toContain('From: ReelMe <studio@mail.ru>');
    expect(smtp.messages[1].recipient).toBe('guest@example.test');
    expect(attachedBytes(smtp.messages[1].raw)).toEqual(video);
  } finally { db.close(); }
  smtp.rejectAuth();
  await form.getByLabel('Адрес получателя').fill('visitor@example.test');
  await send.click();
  await expect(form.getByRole('alert')).toContainText('отклонил логин или пароль');
  expect(smtp.messages).toHaveLength(2);
});
