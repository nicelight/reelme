import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { models, slotSchema, titleFrom, videoProblem, type Media } from '../src/shared/scenarios.js';

test('video limits include boundary values and provider file size limits', () => {
  const video: Media = { id: randomUUID(), kind: 'video', mime: 'video/mp4', size: 100, duration: 10, width: 320, height: 240 };
  const expected: Array<[string, number, number, number | undefined]> = [
    ['minimax/h3-max/recast', 5, 30, undefined],
    ['fal-ai/kling-video/o1/video-to-video/edit', 3, 10, 200],
    ['fal-ai/kling-video/o3/pro/video-to-video/edit', 3, 15, 200],
    ['kling/v4/video-to-video/edit', 3, 30, 300],
    ['kling/v4/flash/video-to-video', 3, 20, 300],
  ];
  for (const [id, min, max, mb] of expected) {
    const model = models.find(m => m.id === id)!;
    for (const duration of [min, max]) assert.equal(videoProblem(model, { ...video, duration }), undefined, id);
    for (const duration of [min - 0.01, max + 0.01]) assert.ok(videoProblem(model, { ...video, duration }), id);
    if (mb) {
      assert.equal(videoProblem(model, { ...video, size: mb * 1_000_000 }), undefined, id);
      assert.ok(videoProblem(model, { ...video, size: mb * 1_000_000 + 1 }), id);
    }
  }
});

test('P2V permits optional demo and fractional H3 duration, rejects unexpected provider settings', () => {
  const slot = { description: '  Первые   три слова и ещё  ', visible: true, thumbnailId: randomUUID(), mode: 'P2V', model: 'minimax/h3-max/reference-to-video', prompt: 'Image 1 visits Image 5', promptExpansionMode: 'disabled', duration: 0.92, resolution: '768P' };
  assert.equal(slotSchema.safeParse(slot).success, true);
  assert.equal(slotSchema.safeParse({ ...slot, demoId: randomUUID() }).success, true);
  for (const change of [{ duration: 0.91 }, { duration: 15.01 }, { promptExpansionMode: 'enabled' }, { promptExpansionMode: undefined }, { role: 'admin' }, { model: 'unknown' }]) assert.equal(slotSchema.safeParse({ ...slot, ...change }).success, false);
  assert.equal(titleFrom(slot.description), 'Первые три слова');
});
