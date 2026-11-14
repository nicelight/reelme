/** Module contract: Access owns account login sessions and installation auth.
 * Roles come only from verified DB credentials. Admin expiry is fixed at 30 days;
 * operator sessions have no server expiry. Account mutations require cloud Origin.
 * Installation actions require the separate bearer context, never account cookies.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Config } from '../config.js';
import { HttpError } from '../errors.js';
import { digest, hashPassword, token, verifyPassword } from './credentials.js';
const DAY = 86_400_000;
export type Role = 'admin' | 'operator' | 'installation';
interface Session { role: 'admin' | 'operator'; expires_at: number | null }
export async function createAccess(app: FastifyInstance, db: DB, config: Config, now: () => number) {
  const cookieName = config.origin.startsWith('https:') ? '__Host-reelme' : 'reelme';
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'strict' as const, secure: config.origin.startsWith('https:') };
  const dummyHash = await hashPassword(token());
  function setSession(reply: FastifyReply, secret: string, session: Session) {
    const seconds = session.expires_at === null ? 400 * DAY / 1000 : Math.max(0, Math.floor((session.expires_at - now()) / 1000));
    reply.setCookie(cookieName, secret, { ...cookieOptions, maxAge: seconds });
  }
  function account(request: FastifyRequest, reply: FastifyReply): Session | undefined {
    const secret = request.cookies[cookieName];
    if (!secret) return;
    const session = db.prepare(`SELECT a.role, s.expires_at FROM auth_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=?`).get(digest(secret)) as Session | undefined;
    if (!session) return;
    if (session.expires_at !== null && session.expires_at <= now()) {
      db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(secret));
      reply.clearCookie(cookieName, cookieOptions); return;
    }
    if (session.role === 'operator') setSession(reply, secret, session);
    return session;
  }
  function context(request: FastifyRequest, reply: FastifyReply): Role {
    // An explicitly supplied bearer credential cannot fall back to a different cookie role.
    if (request.headers.authorization) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization);
      if (match && db.prepare('SELECT 1 FROM installation_keys WHERE token_hash=?').get(digest(match[1]))) return 'installation';
      throw new HttpError(401, 'UNAUTHENTICATED', 'Требуется вход');
    }
    const session = account(request, reply);
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Требуется вход');
    return session.role;
  }
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    if (context(request, reply) !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Нужны права администратора');
  }
  async function requireInstallation(request: FastifyRequest, reply: FastifyReply) {
    if (context(request, reply) !== 'installation') throw new HttpError(403, 'FORBIDDEN', 'Требуется ключ съёмочной установки');
  }
  async function requireOrigin(request: FastifyRequest) {
    if (request.headers.origin !== config.origin) throw new HttpError(403, 'ORIGIN_REJECTED', 'Запрос разрешён только из интерфейса ReelMe');
  }
  const loginSchema = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(256) }).strict();
  app.post('/api/auth/login', { preHandler: requireOrigin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { username, password } = loginSchema.parse(request.body);
    const row = db.prepare('SELECT id, role, password_hash FROM accounts WHERE username=?').get(username) as { id: number; role: 'admin' | 'operator'; password_hash: string } | undefined;
    const valid = await verifyPassword(password, row?.password_hash ?? dummyHash);
    if (!row || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль');
    const old = request.cookies[cookieName];
    const secret = token();
    const expires_at = row.role === 'admin' ? now() + 30 * DAY : null;
    db.transaction(() => {
      if (old) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(old));
      db.prepare('INSERT INTO auth_sessions(token_hash,account_id,expires_at) VALUES (?,?,?)').run(digest(secret), row.id, expires_at);
    })();
    setSession(reply, secret, { role: row.role, expires_at });
    return { role: row.role };
  });
  app.get('/api/auth/session', (request, reply) => {
    const session = account(request, reply);
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Требуется вход');
    return { role: session.role };
  });
  app.post('/api/auth/logout', { preHandler: requireOrigin }, (request, reply) => {
    const secret = request.cookies[cookieName];
    if (secret) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(secret));
    reply.clearCookie(cookieName, cookieOptions); return { ok: true };
  });
  return { context, requireAdmin, requireInstallation, requireOrigin };
}
export type Access = Awaited<ReturnType<typeof createAccess>>;
