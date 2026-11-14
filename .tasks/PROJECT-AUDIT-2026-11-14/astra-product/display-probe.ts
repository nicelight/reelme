import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { preparedSession } from '../../../tests/receive-fixture.ts';
import { openDatabase } from '../../../src/server/db.ts';
import { hashPassword } from '../../../src/server/access/credentials.ts';
const out=resolve('.tasks/PROJECT-AUDIT-2026-11-14/astra-product');
const root=await mkdtemp(join(tmpdir(),'reelme-audit-display-'));
const dataDir=join(root,'data'); const video=join(root,'fixture.mp4');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:d=1:r=10','-c:v','libx264','-pix_fmt','yuv420p',video]);
const bytes=await readFile(video);
for(let n=1;n<=8;n++) await preparedSession(dataDir,bytes,n);
const db=openDatabase(dataDir);
db.prepare('INSERT INTO accounts(username,role,password_hash) VALUES (?,?,?)').run('operator','operator',await hashPassword('audit-password'));db.close();
const child=spawn(process.execPath,['--import','tsx',join(out,'display-probe-server.ts'),dataDir],{stdio:'pipe'});
const origin='http://127.0.0.1:3291'; const browser=await chromium.launch();
try {
 for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
 const page=await browser.newPage();await page.goto(origin);
 await page.getByLabel('Логин').fill('operator');await page.getByLabel('Пароль').fill('audit-password');await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.locator('.result-qr').first().waitFor();
 await page.getByRole('button',{name:'Приостановить смену страниц'}).click();
 const observations=[];
 for(const [width,height] of [[1440,900],[1920,1080],[1280,720],[1366,768],[1920,1300]]){
  await page.setViewportSize({width,height}); await page.waitForTimeout(100); await page.evaluate(()=>scrollTo(0,0));
  observations.push(await page.evaluate(()=>({viewport:[innerWidth,innerHeight],scrollHeight:document.documentElement.scrollHeight,scrollY,cards:[...document.querySelectorAll('.result-card')].map(e=>({number:e.getAttribute('data-session'),top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom})),qrs:[...document.querySelectorAll('.result-qr')].map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,fullyInViewport:e.getBoundingClientRect().bottom<=innerHeight}))})));
  await page.screenshot({path:join(out,`display-viewport-${width}x${height}.png`)});
 }
 await page.setViewportSize({width:1280,height:720}); await page.clock.install(); await page.clock.pauseAt(new Date()); await page.reload(); await page.locator('.result-qr').first().waitFor(); await page.evaluate(()=>scrollTo(0,0));
 const firstPage=await page.locator('.result-card').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-session')));await page.clock.fastForward(10000);
 const secondPage=await page.locator('.result-card').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-session')));
 const afterPaging=await page.locator('.result-qr').evaluateAll(nodes=>nodes.map(n=>({bottom:n.getBoundingClientRect().bottom,viewport:innerHeight,fullyVisible:n.getBoundingClientRect().bottom<=innerHeight})));
 await writeFile(join(out,'display-paging-viewport.json'),JSON.stringify({firstPage,secondPage,afterPaging},null,2));
 await page.screenshot({path:join(out,'display-1280x720-after-automatic-page.png')});
 await writeFile(join(out,'display-viewport-observations.json'),JSON.stringify(observations,null,2));console.log(JSON.stringify(observations,null,2));
}finally{await browser.close();child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(root,{recursive:true,force:true});}
