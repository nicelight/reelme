import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressSlots } from '../src/client/cloud/results/progress.js';
import type { DisplaySession } from '../src/shared/display.js';
const item = (n: number, ready = false): DisplaySession => ({ id: String(n), number: n, stage: ready ? 4 : 2, label: '', error: null, simulation: null, hideAt: null, readyAt: ready ? n : null, card: ready ? { photoUrl: '', frameUrl: '', qrUrl: '' } : null });

test('ready header slot remains stable until oldest waiting preparation replaces it', () => {
  const state = new ProgressSlots(); const initial = Array.from({length: 8}, (_, index) => item(index + 1));
  state.sync(initial); initial[2] = item(3, true);
  assert.deepEqual(state.sync(initial).map(item => item?.number), [1,2,3,4,5,6,7,8]);
  assert.deepEqual(state.sync([...initial, item(10), item(9)]).map(item => item?.number), [1,2,10,4,5,6,7,8]);
  initial[5] = item(6, true);
  assert.deepEqual(state.sync([...initial, item(9), item(10)]).map(item => item?.number), [1,2,10,4,5,9,7,8]);
});

test('missing or terminal entries free their position, other slots never compact', () => {
  const state = new ProgressSlots(); state.sync([item(1), item(2), item(3)]);
  assert.deepEqual(state.sync([item(1), item(3)]).map(item => item?.number ?? null), [1,null,3,null,null,null,null,null]);
  assert.deepEqual(state.sync([item(1), item(3), item(4)]).map(item => item?.number ?? null), [1,4,3,null,null,null,null,null]);
});

test('already-ready bootstrap records never occupy preparing header slots', () => {
  const state = new ProgressSlots(); assert.deepEqual(state.sync([item(1,true),item(2)]).map(item => item?.number ?? null), [2,null,null,null,null,null,null,null]);
});

test('local failures enter once, retain their number and do not requeue after terminal slot reuse', () => {
  const state = new ProgressSlots(); const failed = new Set(['1']);
  assert.equal(state.sync([item(1, true)], failed)[0]?.number, 1);
  assert.equal(state.sync([item(1, true), item(2)], failed)[0]?.number, 2);
  assert.deepEqual(state.sync([item(1, true), item(2)], failed).filter(Boolean).map(value => value!.number), [2]);
  const many = Array.from({ length: 10 }, (_, index) => item(index + 1, true));
  const overflow = new ProgressSlots(); const failures = new Set(many.map(value => value.id));
  assert.equal(overflow.sync(many, failures).filter(Boolean).length, 8);
  const next = overflow.sync(many, failures).filter(Boolean);
  assert.equal(next.some(value => value!.number === 9), true);
  assert.equal(next.some(value => value!.number === 10), true);
  assert.equal(new Set(next.map(value => value!.id)).size, 8);
});
