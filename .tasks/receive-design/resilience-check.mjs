import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const url='http://127.0.0.1:3197/receive/LWyk4HNoiiRdlpZLohiqk0reesbgA9AUGHrd-uPnsnk';
const statusPath='/api'+new URL(url).pathname;
const initial=await (await page.request.get(new URL(statusPath,url).href)).json();
assert.equal(initial.emailState,'not_requested');
const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
await page.addInitScript(({statusPath,initial})=>{
 const nativeFetch=window.fetch.bind(window), nativeTimer=window.setTimeout.bind(window);
 window.qa={opened:0,preparations:0,posts:0,statusCalls:0,statusActive:0,statusMax:0,aborts:0,statusMode:'timeout',shareMode:'cancel',shares:0,shareFile:false};
 window.setTimeout=(fn,ms,...args)=>nativeTimer(fn,ms===15000?300:ms===120000?400:ms===3000?70:ms,...args);
 const pending=(signal)=>new Promise((resolve,reject)=>{const abort=()=>{window.qa.aborts++;reject(signal.reason);};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
 const sleep=ms=>new Promise(r=>nativeTimer(r,ms));
 window.fetch=async(input,init={})=>{
  const path=typeof input==='string'?input:new URL(input.url).pathname;
  if(path===statusPath+'/opened'&&++window.qa.opened===1)return pending(init.signal);
  if(path===initial.downloadUrl&&++window.qa.preparations===1)return pending(init.signal);
  if(path===statusPath+'/email'){window.qa.posts++;return pending(init.signal);}
  if(path===statusPath){
   window.qa.statusCalls++;window.qa.statusActive++;window.qa.statusMax=Math.max(window.qa.statusMax,window.qa.statusActive);
   try {
    if(window.qa.statusMode==='timeout')return await pending(init.signal);
    await sleep(180);
    return new Response(JSON.stringify({...initial,emailState:window.qa.statusMode,canSubmit:false}),{headers:{'Content-Type':'application/json'}});
   }finally{window.qa.statusActive--;}
  }
  return nativeFetch(input,init);
 };
 Object.defineProperty(navigator,'canShare',{value:({files})=>files[0] instanceof File});
 Object.defineProperty(navigator,'share',{value:async({files})=>{window.qa.shares++;window.qa.shareFile=files[0] instanceof File&&files[0].type==='video/mp4'&&files[0].size>0;if(window.qa.shareMode==='cancel')throw new DOMException('Cancelled','AbortError');}});
},{statusPath,initial});
await page.goto(url);
await page.getByText('Не удалось открыть историю. Проверьте связь и попробуйте снова.',{exact:true}).waitFor();
await page.getByRole('button',{name:'Попробовать снова',exact:true}).click();
await page.getByRole('heading',{name:'История № 13'}).waitFor();
await page.getByRole('button',{name:'Подготовить видео снова',exact:true}).waitFor();
await page.getByRole('button',{name:'Подготовить видео снова',exact:true}).click();
const share=page.getByRole('button',{name:'Поделиться видео',exact:true});await share.click();
assert.equal(await page.getByText('Не удалось открыть отправку.',{exact:false}).count(),0);
assert.equal(await page.evaluate(()=>window.qa.shareFile),true);assert.equal(await page.evaluate(()=>window.qa.preparations),2);
await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('error')));await page.getByText('Не удалось загрузить видео.',{exact:true}).waitFor();
await page.locator('video').evaluate(v=>{const original=v.load.bind(v);window.playerLoads=0;v.load=()=>{window.playerLoads++;original();};});
await page.getByRole('button',{name:'Загрузить снова',exact:true}).click();assert.equal(await page.evaluate(()=>window.playerLoads),1);assert.equal(await page.getByText('Не удалось загрузить видео.',{exact:true}).count(),0);
await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'.tasks/receive-design/resilience-ready-mobile.png',fullPage:true});
await page.getByLabel('Ваш email').fill('uncertain@example.test');await page.getByRole('button',{name:'Получить видео по email',exact:true}).click();
await page.getByRole('button',{name:'Проверить статус',exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'Сохраняем…',exact:true}).count(),0);
await page.getByText('Не удалось проверить приём email. Адрес сохранён. Проверим связь ещё раз.',{exact:true}).waitFor();
assert.equal(await page.getByLabel('Ваш email').inputValue(),'uncertain@example.test');
await page.evaluate(()=>window.qa.statusMode='pending');
await page.getByText('Email принят. Письмо ожидает отправки.',{exact:true}).waitFor();
const start=await page.evaluate(()=>window.qa.statusCalls);await page.waitForFunction(n=>window.qa.statusCalls>=n+3,start);
assert.equal(await page.evaluate(()=>window.qa.statusMax),1);assert.equal(await page.evaluate(()=>window.qa.posts),1);
await page.evaluate(()=>window.qa.statusMode='sent');await page.getByText('Письмо отправлено. Проверьте входящие и папку «Спам».',{exact:false}).waitFor();
assert.equal(await page.locator('.receive-check').count(),1);assert.equal(await page.getByLabel('Ваш email').count(),0);
const stoppedAt=await page.evaluate(()=>window.qa.statusCalls);await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.qa.statusCalls),stoppedAt);
const motion=await page.locator('.receive-card').evaluate(el=>getComputedStyle(el).animationName);assert(motion.endsWith('receive-enter'));
await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.receive-card').evaluate(el=>getComputedStyle(el).animationName),'none');assert.equal(await page.locator('.receive-check').evaluate(el=>getComputedStyle(el).animationName),'none');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'.tasks/receive-design/resilience-sent-mobile.png',fullPage:true});
const result={initialTimeoutRetry:true,shareTimeoutRetry:true,nativeCancelSilent:true,actualMP4File:true,playerRetryCallsLoad:true,emailTimeoutPreservesAddress:true,emailPostCount:await page.evaluate(()=>window.qa.posts),singleFlightMax:await page.evaluate(()=>window.qa.statusMax),pollStopsAtSent:true,abortedDeadlines:await page.evaluate(()=>window.qa.aborts),reducedMotion:true,pageErrors,nativeShareMocked:true,deadlineTimersAccelerated:true,unmountCleanup:'source-inspected'};
assert.deepEqual(pageErrors,[]);
await writeFile('.tasks/receive-design/resilience-observations.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();
