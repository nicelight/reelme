import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { inspectJpeg } from '../src/server/sessions/jpeg.js';
import { jpegFixtures } from './jpeg-fixture.js';

test('JPEG scanline validation preserves stats acceptance for baseline/progressive late-body damage', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'reelme-jpeg-')); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const progressive of [false, true]) {
    const sample = await jpegFixtures(progressive);
    const path = join(dir, `valid-${progressive}.jpg`);
    await writeFile(path, sample.valid);
    await sharp(path, { limitInputPixels: 40_000_000, failOn: 'warning' }).stats();
    assert.deepEqual(await inspectJpeg(path, 40_000_000), { width: sample.width, height: sample.height });
    assert.deepEqual(await readFile(path), sample.valid);
    for (const [kind, bytes] of Object.entries(sample.broken)) {
      const brokenPath = join(dir, `${kind}-${progressive}.jpg`);
      await writeFile(brokenPath, bytes);
      assert.equal((await sharp(brokenPath, { failOn: 'warning' }).metadata()).height, sample.height, `${kind}: header remains readable`);
      await assert.rejects(sharp(brokenPath, { failOn: 'warning' }).stats(), undefined, `${kind}: previous validation rejects`);
      await assert.rejects(inspectJpeg(brokenPath, 40_000_000), undefined, `${kind}: scanline validation rejects`);
    }
  }
});

test('capture pixel limit is enforced without lowering the publication default', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'reelme-jpeg-limit-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: 'red' } }).jpeg().toBuffer();
  const path = join(dir, 'photo.jpg'); await writeFile(path, bytes);
  await assert.rejects(inspectJpeg(path, 100), /pixel limit/);
  assert.deepEqual(await inspectJpeg(path), { width: 32, height: 24 });
  const oversized = Buffer.from(bytes); const sof = oversized.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof >= 0); oversized.writeUInt16BE(5000, sof + 5); oversized.writeUInt16BE(9000, sof + 7);
  const oversizedPath = join(dir, 'over-40mp.jpg'); await writeFile(oversizedPath, oversized);
  await assert.rejects(inspectJpeg(oversizedPath, 40_000_000), /pixel limit/);
});
