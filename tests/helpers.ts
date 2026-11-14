import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createApp } from '../src/server/app.js';
import { openDatabase } from '../src/server/db.js';
import { digest, hashPassword } from '../src/server/access/credentials.js';
import type { Media } from '../src/shared/scenarios.js';

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reelme-test-'));
  const config = { origin: 'https://reelme.test', host: '127.0.0.1', port: 3000, dataDir: join(root, 'data'), clientDir: join(root, 'client') };
  await mkdir(config.clientDir);
  await writeFile(join(config.clientDir, 'index.html'), '<html><body>Test entrypoint</body></html>');
  const db = openDatabase(config.dataDir);
  for (const role of ['admin', 'operator']) db.prepare('INSERT INTO accounts(username,role,password_hash) VALUES (?,?,?)').run(role, role, await hashPassword('test-password'));
  db.prepare('INSERT INTO installation_keys(token_hash) VALUES (?)').run(digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
  db.close();
  let now = Date.UTC(2026, 0, 1);
  let app = await createApp(config, { now: () => now, logger: false });
  return {
    config, root, get app() { return app; },
    advance(ms: number) { now += ms; },
    async restart() { await app.close(); const db = openDatabase(config.dataDir); db.close(); app = await createApp(config, { now: () => now, logger: false }); },
    async close() { await app.close(); await rm(root, { recursive: true, force: true }); },
    async login(role = 'admin') {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: config.origin }, payload: { username: role, password: 'test-password' } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().role, role);
      const raw = response.headers['set-cookie'];
      const cookie = (Array.isArray(raw) ? raw[0] : raw)!;
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /Secure/i);
      assert.match(cookie, /(?:Max-Age|Expires)=/i);
      return cookie.split(';')[0];
    },
    async upload(cookie: string, bytes: Buffer, mime = 'image/png', filename = 'fixture.png') {
      const part = multipart(bytes, mime, filename);
      const response = await app.inject({ method: 'POST', url: '/api/admin/slot-media', headers: { cookie, origin: config.origin, 'content-type': part.contentType }, payload: part.bytes });
      assert.equal(response.statusCode, 201, response.body);
      return response.json<Media>();
    },
  };
}

export function multipart(bytes: Buffer, mime: string, filename: string) {
  const boundary = 'reelme-test-boundary';
  return { contentType: `multipart/form-data; boundary=${boundary}`, bytes: Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) };
}
export const imageBytes = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#c55b39' } }).png().toBuffer();
export async function videoBytes(root: string, seconds = 10) {
  const path = join(root, `fixture-${seconds}.mp4`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=10', '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path]);
  return readFile(path);
}
