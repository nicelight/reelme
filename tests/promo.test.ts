/** Public promotion must expose only current visible card material, never
 * editor settings, installation access or capture mutations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, imageBytes, seedLegacySlot } from './helpers.js';
import { openDatabase } from '../src/server/db.js';

test('public promo is read-only and hides private, replaced and hidden materials', async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    const bytes = await imageBytes();
    const cover = await f.upload(cookie, bytes);
    const reference = await f.upload(cookie, bytes);
    const db = openDatabase(f.config.dataDir);
    const config = { description: 'Киноистория для промо', visible: true, thumbnailId: cover.id,
      mode: 'P2V', model: 'minimax/h3-max/reference-to-video', duration: 5, resolution: '768P',
      prompt: 'Private generation instructions', promptExpansionMode: 'disabled', referenceIds: [reference.id] };
    try {
      const slot = seedLegacySlot(db, config);
      const hidden = seedLegacySlot(db, { ...config, visible: false });
      const draft = seedLegacySlot(db, { ...config });
      // New Recast drafts may be visible before a template is imported.
      db.prepare('UPDATE slots SET config=? WHERE id=?').run(JSON.stringify({
        description: 'Черновик', visible: true, thumbnailId: cover.id,
        mode: 'V2V', model: 'minimax/h3-max/recast', resolution: '768P', recastShotsConfirmed: true,
      }), draft.id);
      const list = await f.app.inject('/api/public/catalog');
      assert.equal(list.statusCode, 200);
      assert.equal(list.json().total, 1);
      assert.equal(list.json().items[0].id, slot.id);
      assert.doesNotMatch(list.body, /Private generation|prompt|referenceIds|simulateGeneration/);
      const image = await f.app.inject({ url: `/api/public/catalog/${slot.id}/media/${cover.id}`, headers: { range: 'bytes=0-7' } });
      assert.equal(image.statusCode, 206);
      assert.deepEqual(image.rawPayload, bytes.subarray(0, 8));
      for (const path of [
        `/api/public/catalog/${slot.id}/media/${reference.id}`,
        `/api/public/catalog/${hidden.id}/media/${cover.id}`,
      ]) assert.equal((await f.app.inject(path)).statusCode, 404);
      for (const path of ['/api/catalog', '/api/admin/slots', '/api/display/today']) {
        assert.equal((await f.app.inject(path)).statusCode, 401);
      }
      assert.equal((await f.app.inject({ method: 'POST', url: '/api/capture/sessions', payload: { slotId: slot.id } })).statusCode, 401);
      assert.equal(db.prepare('SELECT count(*) AS n FROM capture_sessions').get()!.n, 0);
      db.prepare('UPDATE slots SET config=? WHERE id=?').run(JSON.stringify({ ...config, thumbnailId: reference.id }), slot.id);
      assert.equal((await f.app.inject(`/api/public/catalog/${slot.id}/media/${cover.id}`)).statusCode, 404);
      db.prepare('UPDATE slots SET config=? WHERE id=?').run(JSON.stringify({ ...config, visible: false }), slot.id);
      assert.equal((await f.app.inject('/api/public/catalog')).json().total, 0);
    } finally { db.close(); }
  } finally { await f.close(); }
});

test('page routes serve the client and old results links redirect to /results', async () => {
  const f = await fixture();
  try {
    for (const url of ['/', '/admin', '/operator', '/results', '/statuses']) {
      const page = await f.app.inject(url);
      assert.equal(page.statusCode, 200);
      assert.equal(page.headers['cache-control'], 'no-cache');
    }
    const legacy = await f.app.inject('/?screen=results');
    assert.equal(legacy.statusCode, 308);
    assert.equal(legacy.headers.location, '/results');

    f.config.origin = 'http://localhost:3000';
    await f.restart();
    const camera = await f.app.inject('/');
    assert.equal(camera.statusCode, 302);
    assert.equal(camera.headers.location, 'http://localhost:5513/reelme.html');
  } finally { await f.close(); }
});
