import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const url='http://127.0.0.1:3197/receive/LWyk4HNoiiRdlpZLohiqk0reesbgA9AUGHrd-uPnsnk';
let downloads=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/download/')&&!r.url().includes('?'))downloads++;});
await page.addInitScript(()=>{
 window.shareCalls=[];window.shareMode='success';
 Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files.length===1&&files[0] instanceof File&&files[0].type==='video/mp4'});
 Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{
  const file=files[0];window.shareCalls.push({isFile:file instanceof File,name:file.name,type:file.type,bytes:Array.from(new Uint8Array(await file.arrayBuffer())),active:navigator.userActivation.isActive});
  if(window.shareMode==='cancel')throw new DOMException('Cancelled','AbortError');
  if(window.shareMode==='fail')throw new DOMException('Failed','NotAllowedError');
 }});
});
await page.goto(url);const share=page.getByRole('button',{name:'Поделиться видео',exact:true});await share.waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Поделиться видео')?.disabled);
const link=page.getByRole('link',{name:'Скачать видео'});const expected=await (await page.request.get(new URL(await link.getAttribute('href'),url).href)).body();
await share.click();await page.waitForFunction(()=>window.shareCalls.length===1);
const first=await page.evaluate(()=>window.shareCalls[0]);assert(first.isFile);assert(first.active);assert.equal(first.type,'video/mp4');assert.equal(first.name,'reelme-13.mp4');assert.deepEqual(Buffer.from(first.bytes),expected);
await page.evaluate(()=>window.shareMode='cancel');await share.click();await page.waitForFunction(()=>window.shareCalls.length===2);assert.equal(await page.getByText('Не удалось открыть отправку.',{exact:false}).count(),0);
await page.evaluate(()=>window.shareMode='fail');await share.click();await page.getByText('Не удалось открыть отправку. Попробуйте ещё раз или скачайте видео.',{exact:true}).waitFor();assert(await share.isEnabled());assert.equal(downloads,1);assert(await page.getByLabel('Ваш email').isVisible());
await page.evaluate(()=>window.shareMode='success');await share.click();await page.waitForFunction(()=>window.shareCalls.length===4);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'.tasks/receive-design/share-mobile.png',fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
const fallback=await browser.newPage();await fallback.addInitScript(()=>{Object.defineProperty(navigator,'canShare',{value:undefined});Object.defineProperty(navigator,'share',{value:undefined});});await fallback.goto(url);await fallback.getByText('Скачайте видео и поделитесь им из галереи.',{exact:true}).waitFor();assert(await fallback.getByRole('link',{name:'Скачать видео'}).isVisible());assert(await fallback.getByRole('button',{name:'Поделиться видео',exact:true}).isDisabled());assert.deepEqual(errors,[]);
const result={actualMP4FileMatches:true,gestureActive:true,onePreparationFetch:true,cancelSilent:true,failureRecoverable:true,unsupportedDownloadFallback:true,emailFormPreserved:true,mobileOverflow:false,pageErrors:errors,nativeShareMocked:true};await writeFile('.tasks/receive-design/share-observations.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();
