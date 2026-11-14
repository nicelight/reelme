import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { DigiCamControl } from '../../src/client/capture/camera.ts';
const origin = 'http://localhost:5513';
const camera = new DigiCamControl((path, init) => fetch(new URL(path, origin), init));
const signal = new AbortController().signal;
const health = await (await fetch(origin + '/health')).json();
assert.equal(health.simulated, false);
assert.equal(health.features.live_view, true);
const before = await (await fetch(origin + '/filelist.json')).json();
const report = { camera: health.camera.id, session: health.session, frames: [], previewCount: 0, errors: [] };
await camera.startLiveView(signal);
let stop = false;
const preview = (async () => {
  while (!stop) {
    const blob = await camera.preview(signal);
    const { info } = await sharp(Buffer.from(await blob.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1280); assert.equal(info.height, 720);
    report.previewCount++;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
})();
try {
  for (const [session, count] of [['live-one', 1], ['live-four', 4]]) {
    for (let pose = 0; pose < count; pose++) {
      const start = performance.now();
      const blob = await camera.capture(session, pose, true, signal);
      const bytes = Buffer.from(await blob.arrayBuffer());
      const { info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, 1280); assert.equal(info.height, 720);
      const files = await (await fetch(origin + '/filelist.json')).json();
      assert.equal(createHash('sha256').update(bytes).digest('hex'), files.at(-1).Sha256);
      report.frames.push({ session, pose: pose + 1, width: info.width, height: info.height, elapsedMs: Math.round(performance.now() - start) });
    }
  }
} finally { stop = true; await preview; }
const files = await (await fetch(origin + '/filelist.json')).json();
assert.equal(files.length - before.length, 5);
assert.equal(new Set(files.map(x => x.Original)).size, files.length);
assert.equal((await fetch(origin + '/liveview.html?CMD=LiveViewWnd_Hide')).status, 200);
assert.equal((await fetch(origin + '/liveview.jpg')).status, 503);
const normal = await camera.capture('after-live', 0, false, signal);
assert.equal((await sharp(Buffer.from(await normal.arrayBuffer())).metadata()).width, 1280);
report.normalCaptureAfterStop = true;
report.pass = true;
await writeFile(new URL('./adapter-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
