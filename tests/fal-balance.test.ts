import test from 'node:test';
import assert from 'node:assert/strict';
import { createBalanceReader } from '../src/server/sessions/fal-balance.js';

test('credit checks are lazy and shared for 60 seconds; failures retain the last confirmed amount', async () => {
  let calls = 0, time = 0;
  const read = createBalanceReader('billing-test', async (url, init) => {
    assert.equal(String(url), 'https://api.fal.ai/v1/account/billing?expand=credits');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Key billing-test');
    return ++calls === 1 ? Response.json({ credits: { current_balance: 0, currency: 'USD' } }) : new Response(null, { status: 403 });
  }, () => time);
  assert.equal(calls, 0);
  const [first, second] = await Promise.all([read(), read()]);
  assert.deepEqual(first, { credits: { amount: 0, currency: 'USD', checkedAt: 0 }, error: null });
  assert.deepEqual(second, first);
  time = 59999; await read(); assert.equal(calls, 1);
  time++; const stale = await read(); assert.deepEqual(stale.credits, first.credits); assert.ok(stale.error);
  await read(); assert.equal(calls, 2);
});
