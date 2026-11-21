import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';

test('mail settings guard all routes, retain profiles across restart and never return secrets', async t => {
  const f = await fixture(); t.after(() => f.close());
  const admin = await f.login();
  const operator = await f.login('operator');
  const url = '/api/admin/email-settings';
  const headers = { cookie: admin, origin: f.config.origin };
  const mail = { provider: 'mailru', user: 'studio@mail.ru', password: 'mail-secret' };
  const bz = { provider: 'smtpbz', user: 'studio', password: 'bz-secret', host: 'connect.smtp.bz', port: 587, from: 'studio@example.test' };
  const put = (payload: object) => f.app.inject({ method: 'PUT', url, headers, payload });
  const get = () => f.app.inject({ url, headers });
  assert.deepEqual((await get()).json(), { active: null, profiles: {} });
  for (const [method, path, payload] of [['GET', url, undefined], ['PUT', url, mail],
    ['POST', url + '/test', { profile: mail, to: 'test@example.test' }]] as const) {
    for (const [user, status] of [['', 401], [operator, 403]] as const) {
      assert.equal((await f.app.inject({ method, url: path, payload, headers: { origin: f.config.origin, cookie: user } })).statusCode, status);
    }
    if (method !== 'GET') assert.equal((await f.app.inject({ method, url: path, payload, headers: { cookie: admin } })).statusCode, 403);
  }
  assert.equal((await put({ ...mail, password: undefined })).statusCode, 400);
  const response = await put(mail);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().profiles.mailru, { host: 'smtp.mail.ru', port: 465, user: mail.user, from: mail.user, hasPassword: true });
  assert.equal((await put(bz)).json().active, 'smtpbz');
  assert.equal((await put({ ...bz, password: undefined, host: 'other.test' })).statusCode, 400);
  await f.restart();
  assert.equal((await get()).json().active, 'smtpbz');
  assert.equal((await put({ ...mail, password: undefined })).json().active, 'mailru');
  const result = await get();
  assert.doesNotMatch(result.body, /mail-secret|bz-secret|"password"/i);
  assert.equal(result.json().profiles.smtpbz.port, 587);
});
