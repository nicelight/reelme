import { test as base, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import sharp from 'sharp';
import Database from 'better-sqlite3';

type App = { origin: string; password: string; image: string; video: string; installationKey: string; sessionCount: () => number; restart: () => Promise<void> };
export const test = base.extend<{ app: App }>({
  app: [async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'reelme-browser-'));
    const port = 3197;
    const origin = `http://localhost:${port}`;
    const password = randomUUID();
    const env = { ...process.env, APP_ORIGIN: origin, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir, ADMIN_PASSWORD: password, OPERATOR_PASSWORD: password };
    const image = join(dir, 'fixture.png');
    const video = join(dir, 'fixture.mp4');
    let child: ChildProcess | undefined;
    const capture = createServer(async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end((await readFile('WebServer/reelme.html', 'utf8')).replaceAll('https://reelme.natureonzoom.win', origin));
    });
    async function stop() {
      if (child && child.exitCode === null) {
        const stopped = new Promise<void>(resolve => child!.once('exit', () => resolve()));
        child.kill('SIGTERM'); await stopped;
      }
    }
    async function start() {
      execFileSync(process.execPath, ['--import', 'tsx', 'src/server/setup.ts'], { env, stdio: 'pipe' });
      child = spawn(process.execPath, ['dist/server/main.js'], { env, stdio: 'ignore' });
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw new Error('Browser fixture server exited');
        try { if ((await fetch(origin)).ok) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Browser fixture server did not start');
    }
    try {
      await sharp({ create: { width: 512, height: 512, channels: 3, background: '#d0b8ff' } }).png().toFile(image);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=purple:s=512x512:d=5:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { stdio: 'pipe' });
      await start();
      await new Promise<void>((resolve, reject) => { capture.once('error', reject); capture.listen(5513, resolve); });
      const installationKey = (await readFile(join(dir, 'installation-key.txt'), 'utf8')).trim();
      const sessionCount = () => { const db = new Database(join(dir, 'reelme.sqlite'), { readonly: true }); try { return (db.prepare('SELECT COUNT(*) AS total FROM capture_sessions').get() as { total: number }).total; } finally { db.close(); } };
      await use({ origin, password, image, video, installationKey, sessionCount, restart: async () => { await stop(); await start(); } });
    } finally {
      await stop();
      if (capture.listening) await new Promise<void>(resolve => capture.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  }, { scope: 'test' }],
});
export { expect };
