import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true,channel:'chromium'});
const page=await browser.newPage();
const report={errors:[],pass:false};
page.on('pageerror',e=>report.errors.push(e.message));
const origin='http://localhost:5513';
let fail=false;
try {
  await page.route('**/liveview.jpg',route=> fail ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Injected preview unavailable'})}) : route.continue());
  await page.goto(origin+'/liveview.html');
  await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#preview').naturalWidth===1280);
  fail=true;
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Injected preview unavailable'));
  report.errorState=await page.evaluate(()=>({hidden:document.querySelector('#preview').hidden,display:getComputedStyle(document.querySelector('#preview')).display,startEnabled:!document.querySelector('#start').disabled,error:document.querySelector('#status').textContent}));
  assert.equal(await page.locator('#preview').isVisible(),false,'preview must be visually hidden after 503');
  assert.equal(report.errorState.startEnabled,true);
  fail=false;
  await page.locator('#start').click();
  await page.waitForFunction(()=>!document.querySelector('#preview').hidden && document.querySelector('#preview').naturalWidth===1280 && document.querySelector('#status').textContent==='Превью включено.');
  report.recovered=true;
  await page.locator('#stop').click();
  await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  assert.equal(await page.locator('#preview').isVisible(),false);
  assert.deepEqual(report.errors,[]);
  report.pass=true;
} catch(error) {report.failure=String(error); throw error;}
finally {
  await page.request.get(origin+'/liveview.html?CMD=LiveViewWnd_Hide').catch(()=>{});
  await browser.close();
  await writeFile(new URL(process.env.REPORT || './browser-recovery-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
