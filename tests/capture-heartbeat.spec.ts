import { test, expect } from './browser-fixture';
import { readFile } from 'node:fs/promises';

test.use({ capturePort: 0, reducedMotion: 'reduce' });

test('open photo page sends periodic heartbeats and a closed page turns red in statuses', async ({page, app}) => {
  const admin = page.request;
  const headers = { Origin: app.origin };
  expect((await admin.post(app.origin + '/api/auth/login', { headers, data:{username:'admin',password:app.password} })).ok()).toBe(true);
  const photo = await admin.post(app.origin + '/api/admin/slot-media', {headers, multipart:{file:{name:'test.png',mimeType:'image/png',buffer:await readFile(app.image)}}});
  const slot = await admin.post(app.origin + '/api/admin/slots', {headers, data:{
    description:'Проверка связи', visible:true, thumbnailId:(await photo.json()).id, referenceIds:[],
    mode:'P2V', model:'minimax/h3-max/reference-to-video', participants:1, photosPerParticipant:1,
    orientation:'landscape', aspectRatio:'16:9', resolution:'768P',duration:5,prompt:'Portrait',promptExpansionMode:'disabled',
  }});
  expect(slot.status()).toBe(201);
  await app.advanceTime(0);
  await page.clock.install();
  await page.addInitScript(key => localStorage.setItem('reelme.installationKey', key), app.installationKey);
  await page.goto(app.captureOrigin + '/reelme.html');
  await page.getByRole('button', {name:/Сюжет 1:/}).click();
  const pulse = () => page.waitForResponse(r => r.url().endsWith('/heartbeat') && r.request().method() === 'POST' && r.status() === 204);
  await Promise.all([pulse(), page.getByRole('button', {name:'Выбрать этот сюжет'}).click()]);
  await app.advanceTime(50_000);
  await Promise.all([pulse(), page.clock.fastForward(15_000)]);
  const monitor = await page.context().newPage();
  await monitor.goto(app.origin + '/statuses');
  await page.close();
  await app.advanceTime(60_000);
  await monitor.reload();
  await expect(monitor.locator('.row')).toContainText('Принято 0 из 1 фото');
  await expect(monitor.locator('.row')).not.toHaveClass(/problem/);
  await app.advanceTime(1);
  await monitor.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(monitor.locator('.row .step')).toHaveText('Ошибка: потеряна связь со страницей фотосессии', {timeout:8000});
  await expect(monitor.locator('.row .track i')).toHaveCSS('background-color','rgb(255, 35, 62)');
  await monitor.getByRole('button',{name:'Проблемы · 1'}).click();
  await expect(monitor.locator('.row')).toHaveCount(1);
});
