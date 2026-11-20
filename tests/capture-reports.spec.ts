import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from './browser-fixture';
import type { CaptureReport } from '../src/shared/capture-report';

test.use({ capturePort: 0 });
test('offline capture reports survive reload, correlate JPEG retry, and respect the session setting', async ({ page, app, request }) => {
  const adminHeaders = { Origin: app.origin };
  await request.post(app.origin + '/api/auth/login', { headers: adminHeaders, data: { username: 'admin', password: app.password } });
  const settings = { startMode: 'manual', countdownSeconds: 1, reviewSeconds: 30, receiptSeconds: 30 };
  const configure = (enabled: boolean) => request.put(app.origin + '/api/admin/capture-settings', { headers: adminHeaders, data: { ...settings, sendCaptureLogs: enabled } });
  expect((await configure(true)).ok()).toBe(true);
  const thumb = await request.post(app.origin + '/api/admin/slot-media', { headers: adminHeaders, multipart: {
    file: { name: 'cover.png', mimeType: 'image/png', buffer: await readFile(app.image) },
  } });
  const slot = await request.post(app.origin + '/api/admin/slots', { headers: adminHeaders, data: {
    description: 'Проверка журналов', visible: true, thumbnailId: (await thumb.json()).id, referenceIds: [],
    mode: 'P2V', model: 'minimax/h3-max/reference-to-video', participants: 1, photosPerParticipant: 2,
    orientation: 'landscape', aspectRatio: '16:9', resolution: '768P', duration: 5, prompt: 'Portrait', promptExpansionMode: 'disabled',
  } });
  expect(slot.status()).toBe(201);
  const slotId = (await slot.json()).id;
  const jpeg = await readFile(app.jpeg);
  const db = new Database(join(app.dataDir,'reelme.sqlite'), { readonly: true });
  const reports = (): CaptureReport[] => (db.prepare('SELECT report FROM capture_reports ORDER BY received_at').all() as {report:string}[]).map(row => JSON.parse(row.report));
  let shutters = 0;
  let malformedPoll = true;
  let waitForFile = true;
  let failPhoto = true;
  let offline = true;
  let reads = 0;
  const localHeaders: string[] = [];
  const transport = '**/api/capture/sessions/*/capture-reports';
  await page.route(transport, route => offline ? route.abort() : route.continue());
  await page.route(app.captureOrigin + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/reelme.html') return route.continue();
    if (route.request().headers().authorization) localHeaders.push(url.pathname);
    if (url.searchParams.has('slc')) {
      reads++;
      const values: Record<string,string> = { session:'PRIVATE-session','camera.session':'PRIVATE-session',lastcaptured:shutters ? 'PRIVATE.jpg' : '-',
        transfer:'Save to PC only', compressionsetting:'JPEG', shutterspeed:'1/125', focusmode:'Manual', 'property.devicename':'Canon EOS 1100D' };
      return route.fulfill({ body: values[url.searchParams.get('param1')!] ?? 'Unknow parameter' });
    }
    if (url.pathname === '/liveview.html') return route.fulfill({body:'OK'});
    if (url.pathname === '/liveview.jpg') return route.fulfill({status:503});
    if (url.searchParams.has('CMD')) {
      shutters++;
      await new Promise(resolve => setTimeout(resolve, 90));
      return route.fulfill({body:'OK'});
    }
    if (url.pathname === '/filelist.json') {
      if (malformedPoll && shutters > 0) {
        malformedPoll = false;
        return route.fulfill({body:'PRIVATE damaged file list'});
      }
      if (waitForFile && shutters > 0) {
        waitForFile = false;
        return route.fulfill({json:[]});
      }
      const names = ['old.jpg','RAW.cr2','bad?.jpg', ...Array.from({ length: shutters }, (_, i) => i ? 'second.jpg' : 'PRIVATE.jpg')];
      return route.fulfill({json:names.map(name => ({FileName:'C:/PRIVATE/' + name, Original:'/image/' + name}))});
    }
    if (failPhoto) { failPhoto = false; return route.fulfill({status:503}); }
    return route.fulfill({body:jpeg, contentType:'image/jpeg'});
  });
  try {
    await page.addInitScript(key => localStorage.setItem('reelme.installationKey', key),app.installationKey);
    await page.goto(app.captureOrigin + '/reelme.html#slot=' + slotId);
    await page.getByRole('button',{name:'Выбрать этот сюжет'}).click();
    await expect(page.getByText('Съёмка без превью',{exact:true})).toBeVisible();
    const sessionId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reelme.captureStart')!).receipt.sessionId);
    await configure(false);
    await page.getByRole('button',{name:'Снять один кадр'}).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Код случая');
    const code = await alert.locator('strong').innerText();
    await expect(alert).toContainText('Снимок пока не получен');
    await expect.poll(() => reads).toBe(22);
    await page.getByRole('button',{name:'Повторить',exact:true}).click();
    await expect(alert).toContainText('Не удалось получить ответ камеры');
    await expect(alert.locator('strong')).toHaveText(code);
    await expect.poll(() => reads).toBe(33);
    await page.getByRole('button',{name:'Повторить',exact:true}).click();
    await expect(page.getByText('Кадр снят ✓',{exact:true})).toBeVisible();
    expect(shutters).toBe(1);
    expect(reports()).toHaveLength(0);
    offline = false;
    await page.reload();
    await expect.poll(() => reports().length).toBe(6);
    const saved = reports();
    expect(JSON.stringify(saved)).not.toContain('PRIVATE');
    expect(JSON.stringify(saved)).not.toContain(app.installationKey);
    expect(localHeaders).toEqual([]);
    const failure = saved.find(r => r.kind === 'attempt' && r.outcome === 'error')!;
    expect(failure.caseId.startsWith(code)).toBe(true);
    expect(failure).toMatchObject({stage:'poll', command:'LiveView_Capture', pending:true,
      preview:{open:'accepted', stop:'error',status:503}, requests:{poll:{phase:'parse',status:200}},error:{name:'SyntaxError'},baseline:{raw:1, invalidPath:1}});
    const attempts = saved.filter(report => report.kind === 'attempt').sort((a,b) => a.attempt - b.attempt);
    const [first, second, recovered] = attempts;
    expect(first.countdownMs).toBeGreaterThanOrEqual(950);
    expect(first.stageMs!.command).toBeGreaterThanOrEqual(80);
    expect(first.requests.poll!.lastDurationMs).toBeGreaterThanOrEqual(first.requests.poll!.headersMs!);
    expect(first.requests.poll!.bodyMs).toBeGreaterThanOrEqual(0);
    expect(first.retryDelayMs).toBeUndefined();
    expect(first.shutterToFoundMs).toBeUndefined();
    expect(second.retryDelayMs).toBeGreaterThan(0);
    expect(second.stageMs!.wait).toBeGreaterThanOrEqual(480);
    expect(second.shutterToFoundMs).toBeGreaterThanOrEqual(second.stageMs!.wait!);
    expect(second.shutterAt).toBe(first.shutterAt);
    expect(recovered.shutterAt).toBe(first.shutterAt);
    expect(recovered.shutterToFoundMs).toBe(second.shutterToFoundMs);
    expect(recovered.sinceShutterMs).toBeGreaterThanOrEqual(second.sinceShutterMs!);
    for (const step of ['download','verify','decode'] as const) expect(recovered.stageMs![step]).toBeGreaterThanOrEqual(0);
    expect(recovered.countdownMs).toBeUndefined();
    expect(saved).toContainEqual(expect.objectContaining({caseId:failure.caseId, attempt:2, stage:'download',requests:expect.objectContaining({download:expect.objectContaining({status:503})})}));
    expect(saved).toContainEqual(expect.objectContaining({caseId:failure.caseId, attempt:3, command:'resume', outcome:'ok', decoded:true}));
    expect(saved).toContainEqual(expect.objectContaining({caseId:failure.caseId, kind:'camera-settings',trigger:'error',
      values:expect.objectContaining({sameSession:true,lastCaptured:'file-1',shutterSpeed:'1/125'})}));
    const endpoint = app.origin + '/api/capture/sessions/' + sessionId + '/capture-reports';
    const headers = {Authorization:'Bearer ' + app.installationKey};
    expect((await request.post(endpoint,{data:failure})).status()).toBe(403);
    expect((await request.post(endpoint,{headers,data:failure})).status()).toBe(204);
    expect(reports()).toHaveLength(6);
    expect((await request.post(endpoint,{headers,data:{...failure, rawFileName:'visitor'}})).status()).toBe(400);
    const newSession = await request.post(app.origin + '/api/capture/sessions',{headers,data:{slotId,startRequestId:crypto.randomUUID()}});
    const next = await newSession.json();
    expect(next.captureSettings.sendCaptureLogs).toBe(false);
    expect((await request.post(endpoint.replace(sessionId,next.sessionId),{headers,data:failure})).status()).toBe(409);
    await page.evaluate(receipt => {
      const start = JSON.parse(sessionStorage.getItem('reelme.captureStart')!);
      start.receipt = receipt; sessionStorage.setItem('reelme.captureStart',JSON.stringify(start));
    },next);
    await page.reload();
    await expect(page.getByText('Съёмка без превью',{exact:true})).toBeVisible();
    const readsBefore = reads;
    await page.getByRole('button',{name:'Снять один кадр'}).click();
    await expect(page.getByText('Кадр снят ✓',{exact:true})).toBeVisible();
    expect(reads).toBe(readsBefore);
    expect(reports()).toHaveLength(6);
  } finally { db.close(); }
});
