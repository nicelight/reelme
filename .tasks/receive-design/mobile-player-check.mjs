import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
const db=new Database('/tmp/reelme-approved-preview-9XINnP/data/reelme.sqlite');
const row=db.prepare('SELECT d.receive_token,g.video_path FROM session_delivery d JOIN capture_sessions s ON s.id=d.session_id JOIN generation_jobs g ON g.session_id=s.id WHERE s.number=2').get();db.close();
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:320,height:568},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const url=`http://127.0.0.1:3197/receive/${row.receive_token}`;
await page.goto(url);await page.getByLabel('Видео истории № 2').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
const measures=[];
for(const [width,height] of [[320,568],[430,844]]){
 await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
 measures.push(await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,inputFont:getComputedStyle(document.querySelector('input')).fontSize,buttonHeight:document.querySelector('.receive-download').getBoundingClientRect().height})));
 await page.screenshot({path:`.tasks/receive-design/phone-${width}.png`,fullPage:true});
}
assert(measures.every(x=>!x.overflow&&parseFloat(x.inputFont)>=16&&x.buttonHeight>=48));
await page.setViewportSize({width:320,height:330});const input=page.getByLabel('Ваш email');await input.focus();await input.scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Получить видео по email'}).scrollIntoViewIfNeeded();
assert(await page.getByRole('button',{name:'Получить видео по email'}).isVisible());await page.screenshot({path:'.tasks/receive-design/phone-short.png'});
await page.locator('video').scrollIntoViewIfNeeded();await page.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video').currentTime>0.1);await page.locator('video').evaluate(v=>v.pause());
const download=page.waitForEvent('download');await page.getByRole('link',{name:'Скачать видео'}).click();const saved=await download;assert.equal(saved.suggestedFilename(),'reelme-2.mp4');assert.deepEqual(await readFile(await saved.path()),await readFile(`/tmp/reelme-approved-preview-9XINnP/data/media/${row.video_path}`));
await input.fill('phone-check@example.test');await input.press('Enter');await page.getByRole('status').filter({hasText:'Письмо отправлено.'}).waitFor({timeout:8000});
assert.deepEqual(errors,[]);const result={measures,shortViewportScroll:true,actualVideoPlayback:true,downloadMatchesMP4:true,emailSubmit:true,pageErrors:errors,realKeyboard:false};await writeFile('.tasks/receive-design/phone-observations.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();
