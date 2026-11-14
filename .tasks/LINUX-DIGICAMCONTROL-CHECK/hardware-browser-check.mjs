import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = 'http://localhost:5513';
const health = await (await fetch(base + '/health')).json();
assert.equal(health.simulated, false);
assert.equal(health.camera.device, '/dev/video0');
const before = await (await fetch(base + '/filelist.json')).json();
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const report = { mode: 'physical-v4l2', camera: health.camera, errors: [], screenshotsSaved: false };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(base + '/reelme-test.html');
  const uploadPromise = page.waitForResponse(r => r.url().endsWith('/test-upload'));
  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('result').className === 'ok', null, { timeout: 60_000 });
  report.result = await page.locator('#result').innerText();
  assert.match(report.result, /УСПЕШНО/);
  assert.doesNotMatch(report.result, /DEMO/);
  report.rendered = await page.locator('#gallery img').evaluateAll(imgs => imgs.map(i => ({ complete: i.complete, width: i.naturalWidth, height: i.naturalHeight })));
  assert.equal(report.rendered.length, 3);
  assert.ok(report.rendered.every(i => i.complete && i.width === 1280 && i.height === 720));
  const upload = await uploadPromise;
  report.uploadStatus = upload.status();
  assert.equal(upload.status(), 200);
  const payload = await upload.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.stored, false);
  assert.equal(payload.local_only, true);
  assert.equal(payload.files.length, 3);
  await page.waitForTimeout(1200);
  const after = await (await fetch(base + '/filelist.json')).json();
  const newFiles = after.filter(f => !before.some(old => old.FileName === f.FileName));
  assert.equal(newFiles.length, 3);
  assert.ok(newFiles.every(f => f.Simulated === false));
  assert.equal(new Set(newFiles.map(f => f.Sha256)).size, 3);
  assert.deepEqual(payload.files.map(f => f.sha256), newFiles.map(f => f.Sha256));
  assert.deepEqual(payload.files.map(f => f.size), newFiles.map(f => f.Size));
  assert.ok(await page.locator('#start').isEnabled());
  assert.deepEqual(report.errors, []);
  report.files = newFiles.map(f => ({ name: f.FileName, width: f.Width, height: f.Height, sha256: f.Sha256, size: f.Size }));
  report.pass = true;
  console.log('PASS: physical HD User Facing, 3 JPEGs 1280x720 decoded in Chromium, HTTP upload 200 + identical SHA256 and size, no DEMO, no auto-rerun, zero JS exceptions. No physical-photo screenshots saved.');
} catch (error) {
  report.pass = false;
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile('.tasks/LINUX-DIGICAMCONTROL-CHECK/hardware-browser-report.json', JSON.stringify(report, null, 2) + '\n');
}
