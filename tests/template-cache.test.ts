import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../src/server/db.js';
import { createTemplateCache, falTemplateUpload } from '../src/server/sessions/template-cache.js';

async function until(condition: () => boolean) {
  const end = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < end, 'Timed out waiting for upload');
    await delay(5);
  }
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'template-cache-'));
  const db = openDatabase(dir);
  for (const id of ['video', 'ref1', 'ref2']) {
    await writeFile(join(dir, 'media', id), id);
    db.prepare('INSERT INTO slot_media(id,path,kind,mime,size,width,height) VALUES (?,?,?,?,?,1,1)')
      .run(id, id, id === 'video' ? 'video' : 'image', id === 'video' ? 'video/mp4' : 'image/jpeg', id.length);
  }
  return { dir, db, async close() { db.close(); await rm(dir, { recursive: true, force: true }); } };
}
test('concurrent cache lookups share two transfer slots, renew expired URLs and repair only confirmed misses', async t => {
  const f = await fixture();
  let time = Date.now(), uploads = 0, active = 0, probes = 0;
  const input = { videoId: 'video', referenceIds: ['ref2', 'ref1'] };
  const cache = createTemplateCache(f.db, f.dir, async file => {
    const n = ++uploads;
    assert.ok(++active <= 2);
    await delay(10);
    active--;
    return 'https://cdn.test/' + await file.text() + '/' + n;
  }, { now: () => time, fetch: async url => {
    probes++;
    return new Response(null, { status: String(url).includes('ref2') ? 410 : 503 });
  } });
  t.after(async () => { await cache.stop(); await f.close(); });
  for (let i = 0; i < 5; i++) cache.warm(input);
  await until(() => !!cache.resolveInputs(input));
  assert.equal(uploads, 3); assert.equal(probes, 0);
  assert.equal(await cache.invalidateMissing(input), true);
  await until(() => !!cache.resolveInputs(input));
  assert.equal(uploads, 4); assert.equal(probes, 3);
  assert.equal(cache.resolveInputs(input)?.get('ref2'), 'https://cdn.test/ref2/4');
  time += 365 * 86400_000;
  await until(() => !!cache.resolveInputs(input));
  assert.equal(uploads, 7);
});

test('SDK upload passes a deadline to the stalled PUT, backs off, then reports exhaustion without saving a URL', async t => {
  const f = await fixture();
  let aborts = 0, starts = 0, failures = 0;
  const upload = falTemplateUpload('test-key', async (url, init) => {
    if (String(url).includes('/initiate')) {
      starts++;
      assert.equal(new Headers(init?.headers).get('x-fal-object-lifecycle'), JSON.stringify({ expiration_duration_seconds: 31536000 }));
      return Response.json({ file_url: 'https://cdn.test/file', upload_url: 'https://cdn.test/put' });
    }
    assert.equal(init?.method, 'PUT'); assert.ok(init?.body instanceof ReadableStream);
    const signal = init?.signal!;
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => { aborts++; reject(signal.reason); };
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
  });
  const cache = createTemplateCache(f.db, f.dir, upload, { timeoutMs: 40, backoffMs: 5, onFailure: () => failures++ });
  t.after(async () => { await cache.stop(); await f.close(); });
  const inputs = { videoId: 'video', referenceIds: [] };
  cache.warm(inputs);
  await until(() => failures > 0);
  assert.equal(starts, 3); assert.equal(aborts, 3);
  assert.match(cache.status()!.error!, /Не удалось загрузить/); assert.equal(cache.status()!.pending, false);
  assert.throws(() => cache.resolveInputs(inputs), { code: 'TEMPLATE_UPLOAD_FAILED' });
  assert.deepEqual(f.db.prepare('SELECT * FROM fal_template_cache').all(), []);
});

test('shutdown closes the HTTP connection of a stalled upload and restart can prepare the same ID', async t => {
  const f = await fixture();
  let receiving = false, disconnected = false;
  const server = createServer((request, response) => {
    request.on('data', () => { receiving = true; });
    response.on('close', () => { disconnected = true; });
    // Leave the PUT unanswered until shutdown cancels it.
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const upload = falTemplateUpload('test-key', (url, init) => {
    if (String(url).includes('/initiate')) return Promise.resolve(Response.json({
      file_url: 'https://cdn.test/video', upload_url: 'http://127.0.0.1:' + address.port + '/put',
    }));
    return fetch(url, init);
  });
  const cache = createTemplateCache(f.db, f.dir, upload);
  t.after(async () => {
    server.closeAllConnections(); server.close();
    await cache.stop(); await f.close();
  });
  const inputs = { videoId: 'video', referenceIds: [] };
  cache.warm(inputs);
  await until(() => receiving);
  assert.deepEqual(cache.status(), { batch: cache.status()!.batch, pending: true, error: null,
    readyFiles: 0, totalFiles: 1, sentBytes: 5, totalBytes: 5 });
  await cache.stop();
  await until(() => disconnected);
  assert.deepEqual(f.db.prepare('SELECT url FROM fal_template_cache').all(), []);
  const restarted = createTemplateCache(f.db, f.dir, async () => 'https://cdn.test/recovered');
  try {
    await until(() => restarted.status() === null);
    assert.equal(restarted.resolveInputs(inputs)?.get('video'), 'https://cdn.test/recovered');
    assert.deepEqual(f.db.prepare('SELECT * FROM fal_template_pending').all(), []);
  } finally { await restarted.stop(); }
});
