import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/server/db.js';
import { seedArchive } from './archive-fixture.js';

test('Chromium: operator cannot delete; admin cancel preserves files, confirmation deletes without opening gallery', async ({page}) => {
  const root=await mkdtemp(join(tmpdir(),'reelme-cleanup-browser-')); const dataDir=join(root,'data');
  const origin='http://127.0.0.1:3195'; const artifacts=process.env.REELME_BROWSER_ARTIFACTS??'.tasks/TASK-012-T3-FT-005-W9';
  await mkdir(dataDir); await mkdir(artifacts,{recursive:true});
  execFileSync(process.execPath,['--import','tsx','src/server/setup.ts'],{env:{...process.env,DATA_DIR:dataDir,ADMIN_PASSWORD:'test-password',OPERATOR_PASSWORD:'test-password'},stdio:'pipe'});
  const video=join(root,'fixture.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:d=1:r=10','-c:v','libx264','-pix_fmt','yuv420p',video]);
  const seed=await seedArchive(dataDir,await readFile(video),await readFile(video));
  const db=openDatabase(dataDir); let child: ChildProcess|undefined;
  const files=async()=> (await readdir(join(dataDir,'media'),{recursive:true})).sort();
  const rows=()=>db.prepare('SELECT * FROM capture_sessions ORDER BY id').all();
  const beforeFiles=await files(); const beforeRows=rows();
  const errors:string[]=[]; const deletes:string[]=[]; const galleries:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='DELETE')deletes.push(r.url());if(r.method()==='GET' && /\/api\/events\/\d{4}-\d{2}-\d{2}$/.test(r.url()))galleries.push(r.url());});
  async function login(role:string) {await page.getByLabel('Логин').fill(role);await page.getByLabel('Пароль').fill('test-password');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Архив',exact:true}).click();await expect(page.locator('.archive-day')).toHaveCount(2);}
  try {
    child=spawn(process.execPath,['--import','tsx','tests/cleanup-browser-server.ts'],{env:{...process.env,DATA_DIR:dataDir},stdio:'ignore'});
    let started=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Cleanup fixture exited');try{if((await fetch(origin)).ok){started=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}expect(started).toBe(true);
    await page.goto(origin);await login('operator');await expect(page.getByRole('button',{name:/Удалить мероприятие/})).toHaveCount(0);
    await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('admin');
    await expect(page.getByRole('button',{name:/Удалить мероприятие/})).toHaveCount(2);
    await page.getByRole('button',{name:'Удалить мероприятие 14 ноября 2026 г.',exact:true}).click();
    const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible();await expect(dialog).toContainText('Отменить удаление нельзя');
    expect(galleries).toEqual([]);expect(deletes).toEqual([]);
    await page.screenshot({path:join(artifacts,'cleanup-confirmation.png'),fullPage:true});
    await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(dialog).toHaveCount(0);
    expect(deletes).toEqual([]);expect(galleries).toEqual([]);expect(await files()).toEqual(beforeFiles);expect(rows()).toEqual(beforeRows);
    await page.setViewportSize({width:375,height:812});
    await page.getByRole('button',{name:'Удалить мероприятие 14 ноября 2026 г.',exact:true}).click();await expect(dialog).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(page.locator('.archive-day')).toHaveCount(1);await expect(page.locator('[data-date="2026-11-13"]')).toBeVisible();
    expect(deletes).toEqual([`${origin}/api/events/2026-11-14`]);expect(galleries).toEqual([]);
    const afterFiles=await files();expect(afterFiles.some(p=>p.includes(seed.first.id)||p.includes(seed.second.id))).toBe(false);
    expect(afterFiles).toContain(seed.thumbnailId);expect(afterFiles).toContain(seed.changedId);
    expect(db.prepare("SELECT 1 FROM events WHERE date='2026-11-14'").get()).toBeUndefined();
    await page.screenshot({path:join(artifacts,'cleanup-after-mobile.png'),fullPage:true});
    await page.locator('[data-date="2026-11-13"]').click();await expect(page.locator('.archive-session')).toHaveCount(1);
    expect(errors).toEqual([]);
    await writeFile(join(artifacts,'cleanup-browser-observations.json'),JSON.stringify({browser:'Chromium',isolatedFixture:root,operatorDeleteHidden:true,cancel:{deleteRequests:0,galleryRequests:0,filesAndRowsUnchanged:true},confirmed:{deleteRequests:1,galleryRequests:0,otherDayReadable:true,sharedMaterialsPreserved:true},beforeFiles,afterFiles,pageErrors:errors,externalFalOrSmtp:false},null,2)+'\n');
  } finally {if(child&&child.exitCode===null){const exited=new Promise<void>(r=>child!.once('exit',()=>r()));child.kill('SIGTERM');await exited;}db.close();await rm(root,{recursive:true,force:true});}
});
