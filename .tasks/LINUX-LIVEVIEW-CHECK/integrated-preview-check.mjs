import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const origin='http://localhost:5513';
const browser=await chromium.launch({headless:true,channel:'chromium'});
const page=await browser.newPage();
const report={errors:[],runs:[],screenshotsSaved:false,pass:false};
page.on('pageerror',error=>report.errors.push(error.message));
const commands=[];
page.on('request',request=>{
  const command=new URL(request.url()).searchParams.get('CMD');
  if(['Capture','LiveView_Capture'].includes(command))commands.push(command);
});
try {
  await page.addInitScript(()=>{
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    window.activeBlobUrls=new Set();
    URL.createObjectURL=(value)=>{const url=create(value);window.activeBlobUrls.add(url);return url;};
    URL.revokeObjectURL=(url)=>{window.activeBlobUrls.delete(url);return revoke(url);};
  });
  await page.goto(origin+'/reelme-test.html');
  await page.evaluate(()=>{
    window.observations={photos:[],countdownFrames:[],previewOverPhoto:false,originalChanged:false};
    const photo=document.querySelector('#photo'),live=document.querySelector('#livePreview'),text=document.querySelector('#stageText');
    let active=null,lastPreview='';
    function record(){
      const now=performance.now();
      if(!photo.hidden){
        if(!active){active={start:now,src:photo.src,width:photo.naturalWidth,height:photo.naturalHeight};window.observations.photos.push(active);}
        if(photo.src!==active.src)window.observations.originalChanged=true;
        if(!live.hidden)window.observations.previewOverPhoto=true;
      }else if(active){active.durationMs=now-active.start;active=null;}
      if(live.src!==lastPreview){
        lastPreview=live.src;
        if(text.textContent.startsWith('Снимок через')&&!live.hidden&&photo.hidden)
          window.observations.countdownFrames.push({at:now,text:text.textContent,width:live.naturalWidth});
      }
    }
    new MutationObserver(record).observe(document.querySelector('#stage'),{attributes:true,childList:true,characterData:true,subtree:true});
  });
  async function run(failure=false){
    const before=await(await fetch(origin+'/filelist.json')).json();
    const commandStart=commands.length;
    const uploadPromise=page.waitForResponse(response=>response.url().endsWith('/test-upload'));
    await page.locator('#start').click();
    if(failure){
      await page.waitForFunction(()=>document.querySelector('#gallery').children.length===1&&document.querySelector('#stageText').textContent==='Снимок через 3');
      await page.route('**/liveview.jpg',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"injected preview failure"}'}));
    }
    await page.waitForFunction(()=>document.querySelector('#result').className==='ok'&&!document.querySelector('#start').disabled,null,{timeout:45000});
    const upload=await uploadPromise;assert.equal(upload.status(),200);
    const payload=await upload.json();assert.equal(payload.files.length,3);
    const state=await page.evaluate(async()=>{
      const imgs=Array.from(document.querySelectorAll('#gallery img'));
      const photos=[];
      for(const img of imgs){
        const bytes=await(await fetch(img.src)).arrayBuffer();
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        photos.push({width:img.naturalWidth,height:img.naturalHeight,bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')});
      }
      return {photos,liveHidden:document.querySelector('#livePreview').hidden,liveSrc:document.querySelector('#livePreview').getAttribute('src'),activeBlobUrls:window.activeBlobUrls.size,previewStatus:document.querySelector('#previewStatus').textContent};
    });
    assert.ok(state.photos.every(x=>x.width===1280&&x.height===720));
    assert.deepEqual(state.photos.map(x=>x.sha256),payload.files.map(x=>x.sha256));
    assert.deepEqual(state.photos.map(x=>x.bytes),payload.files.map(x=>x.size));
    assert.equal(state.liveHidden,true);assert.equal(state.liveSrc,null);assert.equal(state.activeBlobUrls,3);
    const after=await(await fetch(origin+'/filelist.json')).json();assert.equal(after.length-before.length,3);
    const runCommands=commands.slice(commandStart);
    assert.deepEqual(runCommands,failure?['LiveView_Capture','Capture','Capture']:['LiveView_Capture','LiveView_Capture','LiveView_Capture']);
    await page.waitForTimeout(800);
    assert.equal((await(await fetch(origin+'/filelist.json')).json()).length,after.length,'no automatic rerun');
    if(failure){assert.match(state.previewStatus,/Превью недоступно/);await page.unroute('**/liveview.jpg');}
    report.runs.push({injectedPreviewFailure:failure,commands:runCommands,...state});
  }
  await run();
  await run();
  await run(true);
  report.observations=await page.evaluate(()=>window.observations);
  assert.equal(report.observations.photos.length,9);
  assert.ok(report.observations.photos.every(p=>p.durationMs>=500),'each original visible at least 500ms');
  assert.equal(report.observations.originalChanged,false);assert.equal(report.observations.previewOverPhoto,false);
  assert.ok(report.observations.countdownFrames.length>=20);
  assert.deepEqual(report.errors,[]);
  report.pass=true;
} catch(error){report.failure=String(error);throw error;}
finally {
  report.commands=commands;
  report.observations=await page.evaluate(()=>window.observations).catch(()=>report.observations);
  await browser.close();
  await writeFile(new URL('./integrated-preview-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({pass:report.pass,runs:report.runs.length,photoHoldMs:report.observations?.photos.map(p=>Math.round(p.durationMs)),countdownFrames:report.observations?.countdownFrames.length,errors:report.errors},null,2));
