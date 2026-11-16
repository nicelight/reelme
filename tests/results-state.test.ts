import test from 'node:test';
import assert from 'node:assert/strict';
import { ResultsQueue, perimeter, hatchTiming } from '../src/client/cloud/results/state.js';
const ids = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));
function finish(queue: ResultsQueue) { const at = queue.hatch!.started + hatchTiming.done; queue.advance(at); return at; }

test('initial fill: centre hold, ordered perimeter, hatch is not circular display, ninth starts timer', () => {
  const queue = new ResultsQueue(); queue.bootstrap([], 0); queue.duration = 20000; queue.sync(ids(11), 0);
  assert.equal(queue.cells[4], '1'); assert.equal(queue.pageDue, null);
  let at = finish(queue);
  assert.equal(queue.circular[0], '1'); assert.equal(queue.phase, 'result');
  for (let n = 1; n < 9; n++) {
    queue.advance(at + 1999); assert.equal(queue.cells[4], String(n)); assert.equal(queue.movingUntil, null);
    queue.advance(at + 2000); assert.equal(queue.movingUntil, at + 2280);
    queue.advance(at + 2280); assert.equal(queue.cells[perimeter[n - 1]], String(n)); assert.equal(queue.cells[4], String(n + 1));
    at = finish(queue);
  }
  assert.equal(new Set(queue.cells).size, 9); assert.equal(queue.paged, true); assert.equal(queue.pageDue, at + 20000);
  assert.deepEqual(queue.circular, ['9','1','2','3','4','5','6','7','8']);
  assert.deepEqual(queue.pending, ['10','11']);
});

test('paged FIFO and circular queue: one hatch per page, newly hatched first ordinary next page', () => {
  const queue = new ResultsQueue(); queue.bootstrap(ids(9), 0); queue.sync(ids(11), 100);
  assert.equal(queue.hatch, null); assert.equal(queue.pageDue, 10000);
  queue.advance(10000); queue.advance(10280);
  assert.equal(queue.cells[4], '10'); assert.equal(queue.pageDue, 20280);
  assert.equal(new Set(queue.cells).size, 9); finish(queue);
  assert.equal(queue.circular[0], '10'); assert.deepEqual(queue.pending, ['11']);
  queue.sync(ids(12), 17000); assert.equal(queue.cells[4], '10');
  queue.advance(20280); queue.advance(20560);
  assert.equal(queue.cells[4], '11'); assert.ok(queue.cells.includes('10'));
  assert.deepEqual(queue.pending, ['12']);
});

test('expiry prunes future eligibility but keeps the complete current snapshot till page boundary', () => {
  const queue = new ResultsQueue(); queue.bootstrap(ids(9), 0);
  const original = [...queue.cells]; queue.sync(['7','8','9'], 5000);
  assert.deepEqual(queue.cells, original); assert.deepEqual(queue.circular, ['7','8','9']);
  queue.advance(10000); queue.advance(10280);
  assert.deepEqual(queue.cells.filter(Boolean), ['7','8','9']);
  assert.equal(queue.cells.filter(Boolean).length, new Set(queue.cells.filter(Boolean)).size);
  queue.sync([], 11000); queue.advance(20280); queue.advance(20560);
  assert.equal(queue.cells.filter(Boolean).length, 0); assert.equal(queue.paged, false);
  queue.sync(['10'], 22000); assert.equal(queue.cells[4], '10'); assert.equal(queue.phase, 'egg');
});

test('an expired hatching card remains on the page, but cannot reenter the circular queue', () => {
  const queue = new ResultsQueue(); queue.bootstrap(ids(9), 0); queue.sync(ids(10), 100);
  queue.advance(10000); queue.advance(10280); queue.sync(ids(9), 11000); finish(queue);
  assert.equal(queue.cells[4], '10'); assert.ok(!queue.circular.includes('10'));
});

test('changing duration applies at the next page and sparse arrival waits only remaining centre hold', () => {
  const queue = new ResultsQueue(); queue.bootstrap([], 0); queue.sync(['1'], 0); const at = finish(queue);
  queue.advance(at + 9000); assert.equal(queue.pageDue, null);
  queue.sync(['1','2'], at + 10000); assert.equal(queue.movingUntil, at + 10280);
  const full = new ResultsQueue(); full.bootstrap(ids(9), 0); full.duration = 60000;
  assert.equal(full.pageDue, 10000); full.advance(10000); full.advance(10280); assert.equal(full.pageDue, 70280);
});

test('snapshot bootstrap avoids replay; hidden updates preserve deadlines and reduced motion has no shake', () => {
  const queue = new ResultsQueue(); queue.bootstrap(ids(8), 0); assert.equal(queue.hatch, null);
  queue.sync(ids(9), 100, false); assert.equal(queue.movingUntil, null);
  queue.advance(100); queue.advance(380); queue.reduced = true;
  queue.advance(1780); assert.equal(queue.phase, 'reveal'); queue.advance(2230); assert.equal(queue.phase, 'result');
  const due = queue.pageDue!; queue.shiftTime(1000); assert.equal(queue.pageDue, due + 1000);
});
