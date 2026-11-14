/** Local HTTP contract fixtures, not evidence of Canon compatibility. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { DigiCamControl } from '../src/client/capture/camera.js';

async function cameraFixture() {
  const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: 'red' } }).jpeg().toBuffer();
  const other = await sharp({ create: { width: 32, height: 24, channels: 3, background: 'blue' } }).jpeg().toBuffer();
  const files = [{ FileName: 'old.jpg', Original: '/image/old.jpg' }];
  const requests: string[] = [];
  let shutter = 0; let polls = 0; let pending = ''; let failList = false; let failDownload = false; let delay = 2;
  let invalidJpeg = false; let failCommand = false;
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === '/filelist.json') {
      if (failList) { failList = false; res.writeHead(503); res.end(); return; }
      if (pending && ++polls > delay) { files.push({ FileName: pending, Original: `/image/${pending}` }); pending = ''; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(files));
    } else if (req.url?.startsWith('/?CMD=')) {
      shutter++; pending = `new-${shutter}.jpg`; polls = 0;
      if (failCommand) { failCommand = false; res.destroy(); return; }
      res.end('OK');
    } else if (req.url?.startsWith('/image/') || req.url === '/liveview.jpg') {
      if (failDownload) { failDownload = false; res.writeHead(503); res.end(); return; }
      res.setHeader('content-type', 'application/octet-stream'); // DCC can serve generic bytes.
      res.end(invalidJpeg ? '<html>not a jpeg</html>' : req.url?.includes('new-2') ? other : jpeg);
    } else res.end('OK');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const fetcher: typeof fetch = (url, init) => fetch(new URL(String(url), `http://127.0.0.1:${address.port}`), init);
  return {
    camera: new DigiCamControl(fetcher, 1000, 5), fetcher, jpeg, other, requests,
    get shutter() { return shutter; }, get polls() { return polls; },
    failList() { failList = true; }, failDownload() { failDownload = true; },
    invalid(value: boolean) { invalidJpeg = value; }, delay(value: number) { delay = value; },
    loseCommandResponse() { failCommand = true; },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
const signal = () => new AbortController().signal;

test('new JPEG waits for file-list difference; preserves original bytes across two sessions and shutter modes', async t => {
  const f = await cameraFixture(); t.after(() => f.close());
  await f.camera.startLiveView(signal());
  assert.deepEqual(Buffer.from(await (await f.camera.preview(signal())).arrayBuffer()), f.jpeg);
  const a = await f.camera.capture('session-a', 0, true, signal());
  assert.equal(a.type, 'image/jpeg'); assert.deepEqual(Buffer.from(await a.arrayBuffer()), f.jpeg);
  assert.ok(f.polls >= 3); assert.equal(f.shutter, 1);
  const b = await f.camera.capture('session-b', 0, false, signal());
  assert.deepEqual(Buffer.from(await b.arrayBuffer()), f.other);
  assert.equal(f.shutter, 2);
  assert.ok(f.requests.includes('/?CMD=LiveView_Capture')); assert.ok(f.requests.includes('/?CMD=Capture'));
  assert.ok(!f.requests.includes('/image/old.jpg'));
});

test('retry recovers list/download errors at current pose and never replaces earlier Blobs', async t => {
  const f = await cameraFixture(); t.after(() => f.close());
  f.failList();
  await assert.rejects(f.camera.capture('a', 0, false, signal()), /Повторить/);
  assert.equal(f.shutter, 0);
  const first = await f.camera.capture('a', 0, false, signal());
  f.failDownload();
  await assert.rejects(f.camera.capture('a', 1, false, signal()), /Повторить/);
  assert.equal(f.shutter, 2);
  await assert.rejects(f.camera.capture('b', 0, false, signal()), /текущего снимка/);
  const second = await f.camera.capture('a', 1, false, signal());
  assert.equal(f.shutter, 2);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), f.jpeg);
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), f.other);
});

test('timeout or lost shutter response resumes the pending exposure; overlapping commands are refused', async t => {
  const f = await cameraFixture(); t.after(() => f.close());
  const camera = new DigiCamControl(f.fetcher, 80, 5);
  f.delay(1000);
  const pending = camera.capture('a', 0, false, signal());
  await assert.rejects(camera.capture('a', 0, false, signal()), /текущего снимка/);
  await assert.rejects(pending, /этого кадра/);
  assert.equal(f.shutter, 1);
  f.delay(0);
  const jpeg = await camera.capture('a', 0, false, signal());
  assert.deepEqual(Buffer.from(await jpeg.arrayBuffer()), f.jpeg); assert.equal(f.shutter, 1);
  f.loseCommandResponse();
  await assert.rejects(camera.capture('a', 1, false, signal()), /этого кадра/);
  const second = await camera.capture('a', 1, false, signal());
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), f.other); assert.equal(f.shutter, 2);
});

test('invalid JPEG can be downloaded again without another exposure; abort stops polling', async t => {
  const f = await cameraFixture(); t.after(() => f.close());
  f.invalid(true);
  await assert.rejects(f.camera.capture('a', 0, false, signal()), /JPEG/);
  f.invalid(false);
  await f.camera.capture('a', 0, false, signal()); assert.equal(f.shutter, 1);
  const controller = new AbortController(); f.delay(1000);
  const capture = f.camera.capture('a', 1, false, controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(capture, { name: 'AbortError' });
  const count = f.requests.length;
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(f.requests.length, count);
});
