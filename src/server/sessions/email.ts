/** Module contract: Sessions owns the single-process email queue in session_delivery.
 * Claims pending before I/O; only SMTP acceptance marks sent. A file/size refusal
 * permits one link fallback; connection/auth/unknown outcomes never auto-retry.
 * Restarted sending requires manual retry. No raw addresses/provider errors in logs.
 * Generation, capabilities, files and first confirmation times remain unchanged. */
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db.js';
import type { SmtpConfig } from '../config.js';

export interface EmailTransport {
  sendMail(message: SendMailOptions): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  close?(): void;
}
export interface EmailOptions { transport: EmailTransport; from: string; intervalMs?: number }
interface Job { session_id: string; number: number; email: string; download_token: string; video_path: string }
interface MailError { code?: string; command?: string; responseCode?: number; response?: string; message?: string }

export function createSmtpTransport(config: SmtpConfig): EmailTransport {
  return nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.port === 465, requireTLS: true,
    auth: { user: config.user, pass: config.password }, tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000,
    logger: false, debug: false, disableUrlAccess: true,
  });
}
function attachmentRefused(error: unknown): boolean {
  const e = (error ?? {}) as MailError;
  // Nodemailer's own stream failure aborts DATA without its terminating dot.
  // It cannot represent an accepted SMTP message. Here only the MP4 is streamed.
  if (e.code === 'ESTREAM' && e.command === 'API') return true;
  if (!['DATA', 'MAIL FROM'].includes(e.command ?? '')) return false;
  if (e.code === 'EMESSAGE' && !e.responseCode && /^Message size larger than allowed /i.test(e.message ?? '')) return true;
  if (!e.responseCode || e.responseCode < 400 || e.responseCode > 599) return false;
  const response = e.response ?? '';
  // A mailbox quota is never a file refusal, even if the text mentions message size.
  if (/\b[45]\.2\.2\b/.test(response)) return false;
  if (/\b[45]\.(?:3\.4|2\.3)\b/.test(response)) return true;
  // Without an explicit message-size code, mailbox wording is not safe to infer.
  if (/\bmailbox\b/i.test(response)) return false;
  return /\b(?:message|mail|attachment)\b.*(?:too (?:large|big)|size.*(?:exceed|limit)|(?:type|format).*(?:reject|block|not (?:allow|support)))|\battachment\b.*(?:reject|block|not (?:allow|support))/i.test(response);
}
function failureCode(error: unknown) {
  const e = (error ?? {}) as MailError;
  return e.responseCode && e.responseCode >= 400 && e.responseCode <= 599 || ['EAUTH', 'EDNS', 'EENVELOPE'].includes(e.code ?? '')
    ? 'EMAIL_FAILED' : 'EMAIL_UNCERTAIN';
}
export function recoverEmail(db: DB) {
  db.prepare("UPDATE session_delivery SET email_state='failed',email_error='EMAIL_UNCERTAIN' WHERE email_state='sending'").run();
}
export function createEmailWorker(db: DB, dataDir: string, origin: string, log: FastifyBaseLogger, options: EmailOptions, now = Date.now) {
  let stopped = false; let active: Promise<void> | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
  const claim = db.transaction(() => {
    const job = db.prepare(`SELECT d.session_id,d.email,d.download_token,s.number,g.video_path FROM session_delivery d
      JOIN capture_sessions s ON s.id=d.session_id JOIN generation_jobs g ON g.session_id=s.id
      WHERE d.email_state='pending' AND s.state='ready' ORDER BY d.email_confirmed_at,s.id LIMIT 1`).get() as Job | undefined;
    if (job) db.prepare("UPDATE session_delivery SET email_state='sending',email_error=NULL WHERE session_id=? AND email_state='pending'").run(job.session_id);
    return job;
  });
  async function send(job: Job, attachment: boolean) {
    const info = await options.transport.sendMail({
      from: { name: 'ReelMe', address: options.from }, to: { address: job.email, name: '' },
      subject: `Ваша видеоистория № ${job.number} — ReelMe`,
      text: attachment ? `Ваша видеоистория № ${job.number} готова. Видео — во вложении.\nСпасибо за участие!`
        : `Ваша видеоистория № ${job.number} готова.\nСкачать видео: ${origin}/download/${job.download_token}\nСсылка доступна до удаления мероприятия.`,
      attachments: attachment ? [{ filename: `reelme-${job.number}.mp4`, path: join(dataDir, 'media', job.video_path), contentType: 'video/mp4' }] : [],
      disableUrlAccess: true,
    });
    // A resolved custom/test transport without an SMTP acknowledgement is not sent.
    if (info.accepted?.length !== 1 || info.rejected?.length) throw new Error('Missing SMTP acceptance');
  }
  async function pass() {
    while (!stopped) {
      const job = claim.immediate(); if (!job) break;
      try {
        try { await send(job, true); }
        catch (error) { if (!attachmentRefused(error)) throw error; await send(job, false); }
        db.prepare("UPDATE session_delivery SET email_state='sent',sent_at=?,email_error=NULL WHERE session_id=? AND email_state='sending'").run(now(), job.session_id);
      } catch (error) {
        const code = failureCode(error);
        db.prepare("UPDATE session_delivery SET email_state='failed',email_error=?,sent_at=NULL WHERE session_id=? AND email_state='sending'").run(code, job.session_id);
        log.warn({ sessionId: job.session_id, code }, 'Не удалось подтвердить отправку письма');
      }
    }
  }
  function runOnce(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (!active) active = pass().finally(() => { active = undefined; });
    return active;
  }
  async function loop() {
    try { await runOnce(); } catch { log.error({ code: 'EMAIL_WORKER_FAILED' }, 'Сбой обработчика писем'); }
    if (!stopped) { timer = setTimeout(loop, options.intervalMs ?? 1000); timer.unref(); }
  }
  return { runOnce, start() { if (!timer && !stopped) { timer = setTimeout(loop, 0); timer.unref(); } },
    async stop() { stopped = true; clearTimeout(timer); await active; options.transport.close?.(); } };
}
