/** Loopback-only SMTP fixture. Captures actual Nodemailer MIME and controls the
 * final DATA acknowledgement; never relays mail or connects to external hosts. */
import { createServer, type Socket } from 'node:net';
import nodemailer from 'nodemailer';
export interface CapturedMail { raw: string; recipient: string }
export async function smtpFixture(socketTimeout = 2000) {
  const messages: CapturedMail[] = []; const sockets = new Set<Socket>();
  let action: (message: CapturedMail) => Promise<string | null> = async () => '250 2.0.0 Accepted';
  let authRefused = false;
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.write('220 local.test ESMTP\r\n');
    let pending = ''; let data: string[] | undefined; let recipient = '';
    socket.on('data', chunk => {
      pending += chunk.toString('latin1');
      let pos: number;
      while ((pos = pending.indexOf('\r\n')) !== -1) {
        const line = pending.slice(0, pos); pending = pending.slice(pos + 2);
        if (data) {
          if (line !== '.') { data.push(line.startsWith('..') ? line.slice(1) : line); continue; }
          const message = { raw: data.join('\r\n'), recipient }; data = undefined; messages.push(message);
          void action(message).then(reply => { if (reply === null) socket.destroy(); else socket.write(reply + '\r\n'); });
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250-local.test\r\n250 AUTH PLAIN\r\n');
        else if (line === 'STARTTLS') socket.write('454 TLS unavailable in local fixture\r\n');
        else if (/^AUTH/.test(line)) socket.write(authRefused ? '535 5.7.8 Authentication failed\r\n' : '235 2.7.0 Authenticated\r\n');
        else if (/^RCPT TO:/.test(line)) { recipient = line.slice(8).replace(/[<>]/g, ''); socket.write('250 OK\r\n'); }
        else if (line === 'DATA') { data = []; socket.write('354 Send message\r\n'); }
        else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true,
    auth: { user: 'local-test', pass: 'local-secret' }, connectionTimeout: 1000, socketTimeout, greetingTimeout: 1000 });
  return { port, transport, messages, setAction(value: typeof action) { action = value; }, rejectAuth() { authRefused = true; },
    async close() { transport.close(); for (const socket of sockets) socket.destroy(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); } };
}
export function attachedBytes(raw: string): Buffer {
  const match = raw.match(/Content-Type: video\/mp4[^]*?Content-Transfer-Encoding: base64[^]*?\r\n\r\n([^]*?)\r\n--/i);
  if (!match) throw new Error('MP4 MIME part missing');
  return Buffer.from(match[1].replace(/\s/g, ''), 'base64');
}
export function mailText(raw: string) {
  const boundary = raw.match(/boundary="([^"]+)"/i)?.[1];
  const parts = boundary ? raw.split('--' + boundary) : [raw];
  for (const part of parts) {
    const pos = part.indexOf('\r\n\r\n'); if (pos === -1) continue;
    const headers = part.slice(0, pos); if (!/Content-Type: text\/plain/i.test(headers)) continue;
    const body = part.slice(pos + 4).trimEnd();
    if (/Content-Transfer-Encoding: base64/i.test(headers)) return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
    return Buffer.from(body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16))), 'latin1').toString('utf8');
  }
  throw new Error('Text MIME part missing');
}
