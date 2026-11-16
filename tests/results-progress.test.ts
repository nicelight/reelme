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
