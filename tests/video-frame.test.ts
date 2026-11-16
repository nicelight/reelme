import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { cardFrameTime, prepareVideo } from '../src/server/sessions/video.js';

test('card time selects 5–12 seconds, backs off 1–3 from short or exact-end clips and clamps tiny clips', () => {
  for (let selected = 5; selected <= 12; selected++) {
    assert.equal(cardFrameTime(13, (min, max) => { assert.deepEqual([min, max], [5,13]); return selected; }), selected);
    for (let backoff = 1; backoff <= 3; backoff++) {
      for (const duration of [selected, 4.5, .2]) {
        const calls: number[][] = [];
        const actual = cardFrameTime(duration, (min, max) => { calls.push([min,max]); return min === 5 ? selected : backoff; });
        assert.equal(actual, Math.max(0, duration - backoff));
        assert.ok(actual >= 0 && actual < duration);
        assert.deepEqual(calls, [[5,13],[1,4]]);
      }
    }
  }
});

test('real FFmpeg extracts the later blue segment and supports sub-second clips without changing MP4', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'reelme-frame-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'source.mp4');
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=64x64:r=10:d=4','-f','lavfi','-i','color=c=blue:s=64x64:r=10:d=9','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]','-c:v','libx264','-pix_fmt','yuv420p',path]);
  const bytes = await readFile(path);
  const download: typeof fetch = async () => new Response(bytes);
  const result = await prepareVideo(dir, 'long', 'https://fixture.invalid/video.mp4', download);
  const stats = await sharp(join(dir, 'media', result.frame_path)).stats();
  assert.ok(stats.channels[2].mean > 200 && stats.channels[0].mean < 20, 'frame must come from the blue segment after 4s');
  assert.deepEqual(await readFile(join(dir, 'media', result.video_path)), bytes);
  const tinyPath = join(dir, 'tiny.mp4');
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=green:s=64x64:r=10','-t','0.2','-c:v','libx264','-pix_fmt','yuv420p',tinyPath]);
  const tiny = await readFile(tinyPath);
  const short = await prepareVideo(dir, 'tiny', 'https://fixture.invalid/tiny.mp4', async () => new Response(tiny));
  assert.equal((await sharp(join(dir, 'media', short.frame_path)).metadata()).format, 'jpeg');
  assert.deepEqual(await readFile(join(dir, 'media', short.video_path)), tiny);
});
