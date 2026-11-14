import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ts from 'typescript';
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const report = { errors: [], previews: 0, photos: [], screenshotsSaved: false };
try {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => { if (response.url().endsWith('/liveview.jpg') && response.status() === 200) report.previews++; });
  await page.goto('http://localhost:5513/liveview.html');
  await page.getByRole('button', { name: 'Включить превью' }).click();
  await page.waitForFunction(() => document.querySelector('#preview').naturalWidth === 1280);
  const source = ts.transpileModule(await readFile('src/client/capture/camera.ts', 'utf8'), {compilerOptions:{ target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext }}).outputText.replace(/export /g, '');
  await page.addScriptTag({ content: source + '\nwindow.reelmeCamera = new DigiCamControl();' });
  report.photos = await page.evaluate(async () => {
    const frames=[];
    for(let pose=0;pose<2;pose++) {
      const blob=await window.reelmeCamera.capture('browser-live',pose,true,new AbortController().signal);
      const bitmap=await createImageBitmap(blob);
      frames.push({width:bitmap.width,height:bitmap.height,bytes:blob.size}); bitmap.close();
    }
    return frames;
  });
  assert.ok(report.photos.every(p => p.width===1280 && p.height===720));
  assert.ok(report.previews>=3);
  await page.getByRole('button', { name: 'Остановить', exact:true }).click();
  await page.waitForFunction(() => document.querySelector('#preview').hidden);
  await page.waitForTimeout(300);
  assert.equal((await page.request.get('http://localhost:5513/liveview.jpg')).status(),503);
  assert.deepEqual(report.errors,[]);
  report.pass=true;
} finally {
  await browser.close();
  await writeFile(new URL('./browser-report.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
