import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/server/db.js';
import { seedArchive } from './archive-fixture.js';

test('Chromium archive: both accounts browse dates, original thumbnails and their own playable videos after public hide', async ({ page, request }) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), 'reelme-archive-'));
  const dataDir = join(root, 'data'); const origin = 'http://127.0.0.1:3196';
  const artifacts = process.env.REELME_BROWSER_ARTIFACTS ?? '.tasks/TASK-011-T2-FT-005-W8';
  await mkdir(dataDir); await mkdir(artifacts, { recursive: true });
  let now = Date.parse('2026-11-14T10:00:00Z');
  const clock = () => writeFile(join(dataDir, 'archive-clock'), String(now)); await clock();
  execFileSync(process.execPath, ['--import','tsx','src/server/setup.ts'], {env:{...process.env,DATA_DIR:dataDir,ADMIN_PASSWORD:'test-password',OPERATOR_PASSWORD:'test-password'},stdio:'pipe'});
  const videos: Buffer[] = [];
  for (const [color, duration] of [['blue',1],['red',2]] as const) {
    const path = join(root, `${color}.mp4`);
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:s=320x240:d=${duration}:r=10`,'-c:v','libx264','-pix_fmt','yuv420p',path]);
    videos.push(await readFile(path));
  }
  const seed = await seedArchive(dataDir,videos[0],videos[1]);
  const db = openDatabase(dataDir);
  const delivery = () => db.prepare('SELECT * FROM session_delivery ORDER BY session_id').all();
  const firstDelivery = db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(seed.first.id) as {receive_token:string;download_token:string};
  let child: ChildProcess | undefined;
  const errors: string[] = []; page.on('pageerror',error => errors.push(error.message));
  const openedCalls: string[] = []; page.on('request',req => { if(req.url().endsWith('/opened')) openedCalls.push(req.url()); });
  async function login(role: string) {
    await page.getByLabel('Логин').fill(role); await page.getByLabel('Пароль').fill('test-password'); await page.getByRole('button',{name:'Войти',exact:true}).click();
    await expect(page.getByRole('button',{name:'Архив',exact:true})).toBeVisible();
  }
  try {
    child = spawn(process.execPath,['--import','tsx','tests/archive-browser-server.ts'],{env:{...process.env,DATA_DIR:dataDir},stdio:'ignore'});
    let started = false;
    for(let i=0;i<100;i++) {
      if(child.exitCode !== null) throw new Error('Archive fixture exited');
      try { if((await fetch(origin)).ok) { started=true;break; } } catch {}
      await new Promise(resolve => setTimeout(resolve,100));
    }
    expect(started).toBe(true);
    await page.setViewportSize({width:1440,height:900}); await page.emulateMedia({colorScheme:'light'});
    await page.goto(origin); await login('operator');
    await expect(page.locator('[data-session="1"]')).toBeVisible();
    expect((await request.post(`${origin}/api/receive/${firstDelivery.receive_token}/email`,{data:{email:'visitor@example.test'}})).status()).toBe(200);
    now += 180_000; await clock(); await page.reload();
    await expect(page.locator('[data-session="1"]')).toHaveCount(0);
    await page.getByRole('button',{name:'Архив',exact:true}).click();
    await expect(page.locator('.archive-day')).toHaveCount(1);
    expect((await page.request.get(`${origin}/api/events/2026-11-14`)).status()).toBe(404);
    now=Date.parse('2026-11-14T17:00:00Z'); await clock();
    const before=delivery();
    await page.getByRole('button',{name:'Сегодня',exact:true}).click();
    for(const role of ['operator','admin']) {
      if(role==='admin') { await page.getByRole('button',{name:'Выйти',exact:true}).click(); await login(role); }
      await page.getByRole('button',{name:'Архив',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Архив мероприятий'})).toBeVisible();
      await expect(page.locator('.archive-day')).toHaveCount(2);
      expect(await page.locator('.archive-day').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-date')))).toEqual(['2026-11-14','2026-11-13']);
      const day=page.locator('[data-date="2026-11-14"]');
      await expect(day).toContainText(`${seed.expected.photoBytes.toLocaleString('ru-RU')} Б`);
      await expect(day).toContainText(`${seed.expected.videoBytes.toLocaleString('ru-RU')} Б`);
      await page.screenshot({path:join(artifacts,`archive-${role}-days.png`),fullPage:true});
      await day.click(); await expect(page.locator('.archive-session')).toHaveCount(4);
      await expect(page.getByRole('button',{name:'Смотреть видео № 3',exact:true})).toBeDisabled();
      await expect(page.getByRole('button',{name:'Смотреть видео № 4',exact:true})).toBeDisabled();
      await expect(page.locator('.archive-session img')).toHaveCount(4);
      await expect.poll(() => page.locator('.archive-session img').evaluateAll(nodes => nodes.every(n => (n as HTMLImageElement).naturalWidth===320))).toBe(true);
      expect(await (await page.request.get(`${origin}/api/events/2026-11-14/${seed.first.id}/thumbnail`)).body()).toEqual(seed.thumb);
      expect(await (await page.request.get(`${origin}/api/events/2026-11-14/${seed.second.id}/thumbnail`)).body()).toEqual(seed.changed);
      await page.screenshot({path:join(artifacts,`archive-${role}-gallery.png`),fullPage:true});
      for(const [number,id,duration] of [[1,seed.first.id,1],[2,seed.second.id,2]] as const) {
        await page.getByRole('button',{name:`Смотреть видео № ${number}`,exact:true}).click();
        const player=page.locator('video');
        await expect(player).toHaveAttribute('src',`/api/events/2026-11-14/${id}/video`);
        await expect.poll(() => player.evaluate(n => n.duration)).toBe(duration);
        await player.evaluate(async n => { n.muted=true; await n.play(); });
        await expect.poll(() => player.evaluate(n => n.currentTime)).toBeGreaterThan(0);
        expect(await (await page.request.get(`${origin}/api/events/2026-11-14/${id}/video`)).body()).toEqual(videos[number-1]);
        await page.getByRole('button',{name:'Закрыть видео'}).click();
      }
      if(role==='admin') {
        await page.getByRole('button',{name:'Тёмная тема'}).click(); await page.setViewportSize({width:375,height:812});
        await page.getByRole('button',{name:'Смотреть видео № 1',exact:true}).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:join(artifacts,'archive-mobile-dark-player.png'),fullPage:true});
        await page.getByRole('button',{name:'Закрыть видео'}).click();
      }
      await page.getByRole('button',{name:'Все мероприятия',exact:false}).click();
      await page.locator('[data-date="2026-11-13"]').click();
      await expect(page.locator('.archive-session')).toHaveCount(1);
      await expect(page.getByRole('button',{name:'Смотреть видео № 1',exact:true})).toBeDisabled();
      expect(delivery()).toEqual(before);
    }
    for(const url of ['/api/events','/api/events/2026-11-14',`/api/events/2026-11-14/${seed.first.id}/thumbnail`,`/api/events/2026-11-14/${seed.first.id}/video`]) expect((await request.get(origin+url)).status()).toBe(401);
    expect(openedCalls).toEqual([]); expect(errors).toEqual([]);
    await writeFile(join(artifacts,'archive-observations.json'),JSON.stringify({browser:'Chromium',roles:['operator','admin'],expectedTotals:seed.expected,order:['2026-11-14','2026-11-13'],todayRejected:true,publicHideThenMidnightPreservesArchive:true,snapshotThumbnailBytesMatch:true,selectedVideosVerifiedByBytesAndPlayback:true,incompleteResultsDisabled:true,deliveryUnchanged:true,openedCalls,pageErrors:errors,mobileWidth:375,themes:['light','dark'],externalFalOrSmtp:false},null,2)+'\n');
  } finally {
    if(child && child.exitCode===null) {const exited=new Promise<void>(resolve => child!.once('exit',()=>resolve())); child.kill('SIGTERM'); await exited;}
    db.close(); await rm(root,{recursive:true,force:true});
  }
});
