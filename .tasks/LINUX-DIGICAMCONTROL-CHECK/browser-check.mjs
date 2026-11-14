import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const artifacts = resolve('.tasks/LINUX-DIGICAMCONTROL-CHECK');
const temp = await mkdtemp(join(tmpdir(), 'reelme-linux-camera-'));
const proc = spawn('python3', [resolve('linux_digiCamControl/linux_digicamcontrol.py'),
  'serve', '--camera', 'mock', '--port', '0', '--data-dir', join(temp, 'data')]);
let serverLog = '';
proc.stdout.on('data', b => { serverLog += b; });
proc.stderr.on('data', b => { serverLog += b; });
let browser;
const report = { mode: 'mock', physicalCamera: false, errors: [], uploads: [], runs: [] };
try {
  const deadline = Date.now() + 10_000;
  while (!serverLog.match(/http:\/\/localhost:(\d+)\/reelme-test.html/) && Date.now() < deadline) {
    assert.equal(proc.exitCode, null, serverLog);
    await new Promise(r => setTimeout(r, 50));
  }
  const match = serverLog.match(/http:\/\/localhost:(\d+)\/reelme-test.html/);
  assert.ok(match, serverLog);
  const base = `http://127.0.0.1:${match[1]}`;
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('response', r => { if (r.url().endsWith('/test-upload')) report.uploads.push(r.status()); });
  await page.goto(base + '/reelme-test.html');
  await page.screenshot({ path: join(artifacts, 'linux-ready.png'), fullPage: true });
  for (let run = 1; run <= 3; run++) {
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('result').className === 'ok', { timeout: 20_000 });
    assert.equal(await page.locator('#gallery .item').count(), 3);
    const rendered = await page.locator('#gallery img').evaluateAll(imgs => imgs.map(i => ({ complete: i.complete, width: i.naturalWidth, height: i.naturalHeight })));
    assert.equal(rendered.length, 3);
    assert.ok(rendered.every(i => i.complete && i.width === 960 && i.height === 640));
    const result = await page.locator('#result').innerText();
    assert.match(result, /DEMO/);
    assert.ok(await page.locator('#start').isEnabled());
    await page.waitForTimeout(1200);
    const files = await (await fetch(base + '/filelist.json')).json();
    assert.equal(files.length, run * 3);
    assert.equal(new Set(files.map(f => f.FileName)).size, run * 3);
    assert.equal(new Set(files.map(f => f.Sha256)).size, run * 3);
    assert.ok(files.every(f => f.Simulated === true));
    report.runs.push({ run, fileCount: files.length, rendered, result, buttonEnabled: true });
  }
  assert.deepEqual(report.uploads, [200, 200, 200]);
  await page.locator('summary').click();
  const logs = await page.locator('#logs').innerText();
  assert.match(logs, /РУЧНОЙ ПРОГОН 1/);
  assert.match(logs, /РУЧНОЙ ПРОГОН 3/);
  await page.screenshot({ path: join(artifacts, 'linux-success.png'), fullPage: true });
  await page.route('**/filelist.json*', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('result').className === 'bad');
  report.failureText = await page.locator('#result').innerText();
  assert.match(report.failureText, /Сергею/);
  assert.ok(await page.locator('#start').isEnabled());
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#logsBtn').click();
  const download = await downloadPromise;
  await download.saveAs(join(artifacts, 'downloaded-browser-log.txt'));
  assert.match(await readFile(join(artifacts, 'downloaded-browser-log.txt'), 'utf8'), /РУЧНОЙ ПРОГОН 4/);
  await page.waitForTimeout(1200);
  assert.equal((await (await fetch(base + '/filelist.json')).json()).length, 9);
  assert.deepEqual(report.errors, []);
  report.pass = true;
  console.log('PASS: Chromium, 3 manual runs, 9 distinct JPEGs decoded in browser, 3 local uploads, no automatic rerun, injected error + downloaded log, no JS errors.');
} catch (error) {
  report.pass = false;
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (proc.exitCode === null) {
    const stopped = once(proc, 'exit');
    proc.kill('SIGTERM');
    await stopped;
  }
  await writeFile(join(artifacts, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(artifacts, 'browser-server.log'), serverLog);
  await rm(temp, { recursive: true, force: true });
}
