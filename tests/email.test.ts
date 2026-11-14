import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server/app.js';
import { openDatabase } from '../src/server/db.js';
import { readConfig } from '../src/server/config.js';
import { createEmailWorker, createSmtpTransport } from '../src/server/sessions/email.js';
import { publishReady } from '../src/server/sessions/receive.js';
import { preparedSession } from './receive-fixture.js';
import { videoBytes } from './helpers.js';
import { attachedBytes, mailText, smtpFixture } from './email-smtp.js';

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'reelme-email-'));
  const config = { dataDir: join(root, 'data'), clientDir: join(root, 'client'), origin: 'https://reelme.test', host: '127.0.0.1', port: 3000 };
  await mkdir(config.clientDir); await writeFile(join(config.clientDir, 'index.html'), '<html>Test</html>');
  const bytes = await videoBytes(root, 1); const session = await preparedSession(config.dataDir, bytes);
  const db = openDatabase(config.dataDir); await publishReady(db, config.dataDir, session.id);
  const smtp = await smtpFixture(); const app = await createApp(config); await app.ready();
  let now = 100; let attempts = 0;
  const worker = createEmailWorker(db, config.dataDir, config.origin, app.log, { from: 'sender@example.test', transport: {
    async sendMail(message) { attempts++; return smtp.transport.sendMail(message); },
  } }, () => now);
  const row = () => db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(session.id) as { email_state: string; email_error: string | null; email_confirmed_at: number; sent_at: number | null; receive_token: string; download_token: string; email: string };
  const url = `/api/receive/${row().receive_token}`;
  const post = (email = 'visitor@example.test') => app.inject({ method: 'POST', url: url + '/email', payload: { email } });
  t.after(async () => { await worker.stop(); await app.close(); await smtp.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  return { root, config, bytes, session, db, smtp, app, worker, row, url, post, attempts: () => attempts, advance() { now += 100; } };
}

test('real Nodemailer SMTP: pending/sending/sent, one atomic handler, byte-identical MP4 and no resubmission', async t => {
  const f = await fixture(t); let release!: () => void;
  f.smtp.setAction(async () => { await new Promise<void>(r => { release = r; }); return '250 Accepted'; });
  assert.equal((await f.post()).json().emailState, 'pending'); const confirmed = f.row().email_confirmed_at;
  const work = f.worker.runOnce(); assert.equal(f.worker.runOnce(), work);
  assert.equal(f.row().email_state, 'sending');
  assert.equal((await f.app.inject(f.url)).json().emailState, 'sending');
  assert.equal((await f.post()).statusCode, 409);
  for (let i = 0; i < 100 && !release; i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(release); assert.equal(f.row().sent_at, null); release(); await work;
  assert.equal(f.row().email_state, 'sent'); assert.equal(f.row().sent_at, 100); assert.equal(f.attempts(), 1);
  assert.deepEqual(attachedBytes(f.smtp.messages[0].raw), f.bytes);
  assert.match(f.smtp.messages[0].raw, /filename=reelme-1.mp4/); assert.match(mailText(f.smtp.messages[0].raw), /№ 1/);
  assert.equal(f.smtp.messages[0].recipient, 'visitor@example.test');
  await f.worker.runOnce(); assert.equal((await f.post()).statusCode, 409); assert.equal(f.attempts(), 1);
  assert.equal(f.row().email_confirmed_at, confirmed);
  assert.deepEqual((await f.app.inject(`/download/${f.row().download_token}`)).rawPayload, f.bytes);
  assert.deepEqual(await readFile(join(f.config.dataDir, 'media', f.session.video_path)), f.bytes);
});

test('size/type refusals send exactly one link fallback for the same result; generic DATA errors do not', async t => {
  for (const [response, fallback] of [
    ['552 5.3.4 Message size exceeds limit', true],
    ['554 5.7.1 Attachment type not allowed', true],
    ['552 Message size exceeds limit', true],
    ['552 5.2.2 Mailbox full', false],
    ['552 5.2.2 Mailbox size limit exceeded', false],
    ['552 Mailbox size limit exceeded', false],
    ['552 Requested mail action aborted: mailbox size limit exceeded', false],
    ['552 5.2.2 Message too large for mailbox quota', false],
    ['554 5.7.1 Policy rejected', false],
  ] as const) {
    await t.test(response, async t => {
      const f = await fixture(t); let calls = 0;
      f.smtp.setAction(async () => ++calls === 1 ? response : '250 Accepted');
      await f.post(); await f.worker.runOnce();
      assert.equal(f.attempts(), fallback ? 2 : 1); assert.equal(f.row().email_state, fallback ? 'sent' : 'failed');
      if (fallback) {
        const raw = f.smtp.messages[1].raw; assert.doesNotMatch(raw, /video\/mp4/);
        const text = mailText(raw); assert.ok(text.includes(`${f.config.origin}/download/${f.row().download_token}`));
        assert.match(text, /№ 1/); assert.doesNotMatch(text, /receive|fixture.test/);
        assert.deepEqual((await f.app.inject(`/download/${f.row().download_token}`)).rawPayload, f.bytes);
      }
    });
  }
});

test('file stream failure falls back; failure of both variants allows corrected manual retry without changing first confirmation', async t => {
  const f = await fixture(t);
  f.smtp.setAction(async () => f.smtp.messages.length === 1 ? '552 5.3.4 Message too large' : '550 5.1.1 Recipient rejected');
  await f.post(); const confirmed = f.row().email_confirmed_at; await f.worker.runOnce();
  assert.equal(f.attempts(), 2); assert.equal(f.row().email_state, 'failed'); assert.equal(f.row().sent_at, null);
  await f.worker.runOnce(); assert.equal(f.attempts(), 2);
  f.smtp.setAction(async () => '250 Accepted'); f.advance();
  await f.post('corrected@example.test'); await f.worker.runOnce();
  assert.equal(f.row().email_state, 'sent'); assert.equal(f.smtp.messages.at(-1)!.recipient, 'corrected@example.test');
  assert.equal(f.row().email_confirmed_at, confirmed);
  const second = await preparedSession(f.config.dataDir, f.bytes, 2); await publishReady(f.db, f.config.dataDir, second.id);
  const delivery = f.db.prepare('SELECT receive_token,download_token FROM session_delivery WHERE session_id=?').get(second.id) as { receive_token: string; download_token: string };
  // The local stream fails before SMTP can accept DATA. No complete first message.
  await rm(join(f.config.dataDir, 'media', second.video_path));
  await f.app.inject({ method: 'POST', url: `/api/receive/${delivery.receive_token}/email`, payload: { email: 'file@example.test' } });
  await f.worker.runOnce(); assert.equal(f.attempts(), 5);
  assert.ok(mailText(f.smtp.messages.at(-1)!.raw).includes(`/download/${delivery.download_token}`));
  assert.equal((f.db.prepare('SELECT email_state FROM session_delivery WHERE session_id=?').get(second.id) as { email_state: string }).email_state, 'sent');
});

test('authentication, connection and lost DATA acknowledgement never trigger fallback or automatic retry', async t => {
  for (const mode of ['auth', 'connection', 'lost'] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === 'auth') f.smtp.rejectAuth();
    if (mode === 'connection') await f.smtp.close();
    if (mode === 'lost') f.smtp.setAction(async () => null);
    await f.post(); await f.worker.runOnce();
    assert.equal(f.attempts(), 1); assert.equal(f.row().email_state, 'failed'); assert.equal(f.row().sent_at, null);
    if (mode === 'lost') assert.equal(f.row().email_error, 'EMAIL_UNCERTAIN');
    await f.worker.runOnce(); assert.equal(f.attempts(), 1);
    const view = await f.app.inject(f.url); assert.equal(view.json().canSubmit, true);
    assert.doesNotMatch(view.body, /local-secret|visitor@|Authentication|SMTP|EMAIL_UNCERTAIN/);
  });
});

test('restart processes saved pending, quarantines sending, and preserves confirmed time/files/ready', async t => {
  const f = await fixture(t); await f.post(); const confirmed = f.row().email_confirmed_at;
  await f.app.close();
  const app = await createApp(f.config, { email: { from: 'sender@example.test', transport: f.smtp.transport, intervalMs: 20 } });
  await app.ready();
  for (let i = 0; i < 100 && f.row().email_state !== 'sent'; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(f.row().email_state, 'sent'); await app.close();
  f.db.prepare("UPDATE session_delivery SET email_state='sending',sent_at=NULL WHERE session_id=?").run(f.session.id);
  const restarted = await createApp(f.config, { email: { from: 'sender@example.test', transport: f.smtp.transport, intervalMs: 20 } });
  await restarted.ready();
  assert.equal(f.row().email_state, 'failed'); assert.equal(f.row().email_error, 'EMAIL_UNCERTAIN');
  await new Promise(r => setTimeout(r, 80)); assert.equal(f.smtp.messages.length, 1);
  assert.equal(f.row().email_confirmed_at, confirmed);
  const retry = await restarted.inject({ method: 'POST', url: f.url + '/email', payload: { email: 'manual@example.test' } });
  assert.equal(retry.statusCode, 200);
  for (let i = 0; i < 100 && f.row().email_state !== 'sent'; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(f.row().email_state, 'sent'); assert.equal(f.smtp.messages.length, 2); assert.equal(f.row().email_confirmed_at, confirmed);
  assert.equal((f.db.prepare('SELECT state FROM capture_sessions WHERE id=?').get(f.session.id) as { state: string }).state, 'ready');
  assert.deepEqual((await restarted.inject(`/download/${f.row().download_token}`)).rawPayload, f.bytes);
  assert.deepEqual((await restarted.inject(`${f.url}/photo`)).rawPayload, f.session.photo);
  await restarted.close();
});

test('SMTP configuration requires complete credentials, TLS transport refuses plaintext-only SMTP', async t => {
  const env = { ...process.env }; t.after(() => { process.env = env; });
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'FAL_KEY']) delete process.env[key];
  assert.equal(readConfig().smtp, undefined);
  process.env.SMTP_HOST = 'smtp.example.test'; assert.throws(readConfig, /Задайте SMTP/);
  process.env.SMTP_USER = 'user'; process.env.SMTP_PASSWORD = 'secret'; process.env.SMTP_FROM = 'sender@example.test';
  assert.equal(readConfig().smtp?.port, 465);
  process.env.SMTP_PORT = '587'; assert.equal(readConfig().smtp?.port, 587);
  process.env.SMTP_PORT = '0'; assert.throws(readConfig, /SMTP/);
  const smtp = await smtpFixture(); t.after(() => smtp.close());
  const transport = createSmtpTransport({ host: '127.0.0.1', port: smtp.port, user: 'local', password: 'secret', from: 'sender@example.test' });
  await assert.rejects(transport.sendMail({ from: 'sender@example.test', to: 'visitor@example.test', text: 'TLS required' }));
  assert.equal(smtp.messages.length, 0);
});
