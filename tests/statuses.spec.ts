import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/server/db.js';
import { once } from 'node:events';

test('телефон оператора видит сбой за пределами первой страницы, восстановление и историю', async ({ page, playwright }) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'reelme-statuses-'));
  const origin = 'http://127.0.0.1:3197';
  execFileSync(process.execPath, ['--import','tsx','src/server/setup.ts'], {env:{...process.env,DATA_DIR:dataDir,OPERATOR_PASSWORD:'test-password', ADMIN_PASSWORD:'test-password'}});
  const db = openDatabase(dataDir);
  const time = Date.parse('2026-11-20T19:00:00Z'), date = '2026-11-21';
  await writeFile(join(dataDir,'display-control.json'),JSON.stringify({now:time,fail:false}));
  const server = spawn(process.execPath,['--import','tsx','tests/display-browser-server.ts'],{env:{...process.env,DATA_DIR:dataDir},stdio:'pipe'});
  try {
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error('Сервер фикстуры завершился');
      return (await fetch(origin).catch(() => null))?.status;
    }).toBe(200);
    db.prepare("INSERT INTO slots(id,config) VALUES ('slot','{}')").run();
    // The visitor number restarts each day. The day filter must isolate both rows and issues.
    db.prepare("INSERT INTO events(date,next_number) VALUES ('2026-11-20',2)").run();
    db.prepare("INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at) VALUES ('previous',?,'2026-11-20',1,'slot','{}','failed',?)").run(randomUUID(),time-86400000);
    const admin = await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{origin}});
    try {
      expect((await admin.post('/api/auth/login',{data:{username:'admin',password:'test-password'}})).ok()).toBe(true);
      const archived = await (await admin.get('/api/statuses?date=2026-11-20&number=1')).json();
      expect(archived.sessions.map((row: {id:string}) => row.id)).toEqual(['previous']);
      expect(archived.issues).toBe(1);
    } finally { await admin.dispose(); }
    const bearer = (await readFile(join(dataDir,'installation-key.txt'),'utf8')).trim();
    expect((await page.request.get(origin+'/api/statuses',{headers:{authorization:'Bearer '+bearer}})).status()).toBe(403);
    expect((await page.request.get(origin+'/api/statuses')).status()).toBe(401);
    expect((await page.request.get(origin+'/api/statuses/id-1')).status()).toBe(401);
    expect((await page.request.get(origin+'/api/statuses/fal-balance')).status()).toBe(401);
    expect((await page.request.get(origin+'/api/statuses/fal-balance',{headers:{authorization:'Bearer '+bearer}})).status()).toBe(403);
    await page.setViewportSize({width:360,height:760});
    await page.goto(origin+'/statuses');
    await page.getByLabel('Логин').fill('operator');
    await page.getByLabel('Пароль',{exact:true}).fill('test-password');
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Статусы видео'})).toBeVisible();
    await expect(page.getByLabel('Дата мероприятия')).toHaveValue(date);
    await expect(page.getByText('Сегодня сессий пока нет.', {exact:false})).toBeVisible();
    db.prepare('INSERT INTO events(date,next_number,name) VALUES (?,36,?)').run(date, 'Вечер кино');
    const session = db.prepare("INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at) VALUES (?,?,?,?,'slot',?,'observing',?)");
    const job = db.prepare('INSERT INTO generation_jobs(session_id,request_id,error_code) VALUES (?,?,?)');
    for (let n=1;n<=35;n++) {
      session.run('id-'+n, randomUUID(), date, n, JSON.stringify({expectedPhotos:2,generation:{model:'test-model'}}), time + n);
      job.run('id-'+n, n===2 ? 'https://secret.test/token' : 'test-job-'+n, n===1 ? 'GENERATION_RETRY' : null);
    }
    db.prepare("UPDATE capture_sessions SET state='failed' WHERE number=2").run();
    db.prepare("UPDATE generation_jobs SET error_code='FAL_FAILED' WHERE session_id='id-2'").run();
    await expect(page.getByRole('heading',{name:'Вечер кино'})).toBeVisible({timeout:8000});
    const pricedRow = page.locator('.row').filter({hasText:'№ 35'});
    db.prepare("UPDATE capture_sessions SET state='ready' WHERE id='id-35'").run();
    await expect(pricedRow).toContainText('Видео готово · ..$', {timeout:8000});
    db.prepare("UPDATE generation_jobs SET cost_usd=0.045 WHERE session_id='id-35'").run();
    await expect(pricedRow).toContainText('Видео готово · 0,045 $', {timeout:8000});
    const issues = page.getByRole('button',{name:'Проблемы · 2'});
    await expect(issues).toBeVisible();
    expect(await page.locator('.row').count()).toBe(30);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await issues.click();
    const failed = page.locator('.row').filter({hasText:'№ 2'});
    await expect(failed).toContainText('Ошибка задания fal');
    await expect(failed.locator('.track')).toHaveCSS('height','11px');
    await expect(failed.locator('.track i')).toHaveCSS('background-color','rgb(255, 35, 62)');
    await failed.click();
    await expect(page.getByText('История частичная.',{exact:false})).toBeVisible();
    const details = await (await page.request.get(origin+'/api/statuses/id-2')).json();
    expect(details.facts.requestId).toBeNull();
    const providerReason = 'Every shot must be at most 15 seconds long.';
    await expect(page.getByText(providerReason, {exact:false})).toHaveCount(0);
    db.prepare("INSERT INTO session_history(session_id,at,last_at,source,step,event,outcome,detail,bucket) VALUES ('id-2',?,?,'worker','fal.result','error','failed',?,'pipeline')")
      .run(time, time, JSON.stringify({code:'FAL_FAILED', httpStatus:422, providerField:'video_url', providerReason}));
    await expect(page.getByText('Ответ fal · video_url — ' + providerReason)).toBeVisible({timeout:8000});
    db.prepare("UPDATE generation_jobs SET error_code=NULL WHERE session_id='id-1'").run();
    await expect(page.locator('.row')).toHaveCount(1,{timeout:8000});
    await expect(failed).toHaveAttribute('aria-expanded','true');
    const insert = db.prepare("INSERT INTO session_history(session_id,at,last_at,source,step,event,outcome,detail,bucket) VALUES ('id-2',?,?,'worker','fal.status','provider_status','waiting',?,'pipeline')");
    db.transaction(() => { for (let i=0;i<102;i++) insert.run(time+i,time+i,'{"providerStatus":"IN_QUEUE"}'); })();
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.getByRole('button',{name:'Скопировать JSON'}).click();
    await expect(page.getByText('История скопирована')).toBeVisible();
    const exported = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(exported.entries).toHaveLength(103);
    expect(exported.entries[0].detail).toMatchObject({providerReason, providerField:'video_url', httpStatus:422});
    expect(exported.session.id).toBe('id-2');
    await page.route('**/api/statuses?*', route => route.abort());
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('status')).toContainText(['Нет свежих данных','История скопирована'],{timeout:8000});
    await expect(failed).toBeVisible();
    await page.unroute('**/api/statuses?*');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('Нет свежих данных',{exact:false})).toHaveCount(0);
    await page.getByRole('button',{name:/Все сессии/}).click();
    await page.getByLabel('Номер посетителя').fill('1');
    await expect(page.locator('.row')).toContainText('№ 1');
    await expect(page.locator('.row')).not.toHaveClass(/problem/);
    db.exec('DROP TABLE session_history');
    expect((await (await page.request.get(origin+'/api/statuses')).json()).issues).toBe(1);
    const partial = await (await page.request.get(origin+'/api/statuses/id-2')).json();
    expect(partial.partial).toBe(true);
    expect(partial.facts.errorCode).toBe('FAL_FAILED');
    db.prepare('UPDATE events SET deleting=1 WHERE date=?').run(date);
    expect((await page.request.get(origin+'/api/statuses/id-1')).status()).toBe(404);
    expect((await (await page.request.get(origin+'/api/statuses')).json()).sessions).toEqual([]);
    await expect(page.getByText('Ключ для проверки баланса не настроен')).toBeVisible();
    let balanceCalls = 0;
    await page.route('**/api/statuses/fal-balance', route => route.fulfill({ json: {
      credits: { amount: ++balanceCalls, currency: 'USD', checkedAt: time }, error: null,
    } }));
    await page.clock.install();
    await page.reload();
    await expect(page.locator('.balance strong')).toHaveText('1,00 USD');
    await page.clock.fastForward(50_000);
    expect(balanceCalls).toBe(1);
    await page.clock.fastForward(10_000);
    await expect(page.locator('.balance strong')).toHaveText('2,00 USD');
    await page.goto(origin+'/operator');
    await page.clock.fastForward(60_000);
    expect(balanceCalls).toBe(2);
  } finally {
    if (server.exitCode === null) { const stopped = once(server,'exit'); server.kill('SIGTERM'); await stopped; }
    db.close(); await rm(dataDir,{recursive:true,force:true});
  }
});
