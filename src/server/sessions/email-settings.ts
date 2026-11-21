/** Private admin profiles. Saving selects one profile atomically. A test uses the
 * submitted profile for a single message without changing queue or settings. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Access } from '../access/index.js';
import type { DB } from '../db.js';
import type { SmtpConfig } from '../config.js';
import { HttpError } from '../errors.js';
import { mailServers, type MailProvider, type MailSettings } from '../../shared/email-settings.js';
import { createSmtpTransport, type EmailSender } from './email.js';

const address = z.string().trim().max(254).pipe(z.email());
const password = z.string().min(1).max(2048).optional();
const profile = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('mailru'), user: address, password }).strict(),
  z.object({ provider: z.literal('smtpbz'), host: z.hostname(), port: z.number().int().min(1).max(65535),
    user: z.string().trim().min(1).max(320), from: address, password }).strict(),
]);
type ProfileRow = SmtpConfig & { provider: MailProvider; active: number };

export function registerEmailSettings(app: FastifyInstance, db: DB, access: Access, environment?: SmtpConfig,
  transportFor = createSmtpTransport) {
  const rows = db.prepare('SELECT * FROM mail_profiles');
  const saved = db.prepare('SELECT * FROM mail_profiles WHERE provider=?');
  const store = db.prepare(`INSERT INTO mail_profiles(provider,host,port,user,password,"from",active)
    VALUES (@provider,@host,@port,@user,@password,@from,1) ON CONFLICT(provider) DO UPDATE SET
    host=excluded.host,port=excluded.port,user=excluded.user,password=excluded.password,"from"=excluded."from",active=1`);
  function view(): MailSettings {
    const result: MailSettings = { active: environment ? 'environment' : null, profiles: {} };
    for (const row of rows.all() as ProfileRow[]) {
      result.profiles[row.provider] = { host: row.host, port: row.port, user: row.user, from: row.from, hasPassword: true };
      if (row.active) result.active = row.provider;
    }
    return result;
  }
  function resolve(input: z.infer<typeof profile>): SmtpConfig {
    const fields = input.provider === 'mailru' ? { host: mailServers.mailru, port: 465, user: input.user, from: input.user }
      : { host: input.host, port: input.port, user: input.user, from: input.from };
    const previous = saved.get(input.provider) as ProfileRow | undefined;
    const pass = input.password ?? (previous?.host === fields.host && previous.user === fields.user ? previous.password : undefined);
    if (!pass) throw new HttpError(400, 'PASSWORD_REQUIRED', 'Введите пароль для этого сервера и логина.');
    return { ...fields, password: pass };
  }
  const senderFor = (config: SmtpConfig): EmailSender => ({ transport: transportFor(config), from: config.from });
  const initial = db.prepare('SELECT * FROM mail_profiles WHERE active=1').get() as ProfileRow | undefined;
  const config = initial ?? environment;
  let sender = config && senderFor(config);
  const url = '/api/admin/email-settings';
  const write = { preHandler: [access.requireOrigin, access.requireAdmin] };
  app.get(url, { preHandler: access.requireAdmin }, view);
  app.put(url, write, request => {
    const input = profile.safeParse(request.body);
    if (!input.success) throw new HttpError(400, 'INVALID_INPUT', 'Проверьте параметры почты.');
    const config = resolve(input.data);
    const next = senderFor(config);
    db.transaction(() => {
      db.prepare('UPDATE mail_profiles SET active=0 WHERE active=1').run();
      store.run({ provider: input.data.provider, ...config });
    }).immediate();
    sender = next;
    return view();
  });
  const testMessage = z.object({ profile, to: address }).strict();
  app.post(url + '/test', write, async (request, reply) => {
    const input = testMessage.safeParse(request.body);
    if (!input.success) throw new HttpError(400, 'INVALID_INPUT', 'Проверьте параметры почты и адрес получателя.');
    const config = resolve(input.data.profile);
    const transport = transportFor(config);
    try {
      const info = await transport.sendMail({ from: { name: 'ReelMe', address: config.from }, to: input.data.to,
        subject: 'Проверка почты ReelMe', text: 'Это тестовое письмо из панели администратора ReelMe.' });
      if (info.accepted?.length !== 1 || info.rejected?.length) throw new Error('Missing SMTP acceptance');
    } catch (error) {
      const auth = (error as { code?: string } | null)?.code === 'EAUTH';
      return reply.code(502).send({ code: 'TEST_EMAIL_FAILED', message: auth
        ? 'Почтовый сервис отклонил логин или пароль.' : 'Сервис не подтвердил отправку. Проверьте подключение и адреса.' });
    } finally { transport.close?.(); }
    return reply.code(204).send();
  });
  return () => sender;
}
