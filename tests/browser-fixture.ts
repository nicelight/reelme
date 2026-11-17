/** Module contract: isolated browser servers and media fixtures; no real fal or camera.
 * Landscape source supports the two-orientation editor. Source: docs/slot-setup/matrix.md. */
import { test as base, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import sharp from 'sharp';
import Database from 'better-sqlite3';

type StoredPhoto = { session_id: string; pose_index: number; path: string; size: number; width: number; height: number; bytes: Buffer };
type App = { photos: (sessionId: string) => Promise<StoredPhoto[]>; origin: string; dataDir: string; captureOrigin: string; password: string; image: string; jpeg: string; video: string; templateVideosDir: string; prepareTemplate: (slotId: string, orientation?: 'landscape' | 'portrait', file?: string) => Promise<void>; installationKey: string; sessionCount: () => number; restart: () => Promise<void> };
export const test = base.extend<{ app: App; capturePort: number; runGeneration: boolean; testVideoOnly: boolean; smtpPort: number }>({
  capturePort: [5513, { option: true }],
  runGeneration: [false, { option: true }],
  testVideoOnly: [false, { option: true }],
  smtpPort: [0, { option: true }],
  app: [async ({ capturePort, runGeneration, testVideoOnly, smtpPort }, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'reelme-browser-'));
    // Find a free port; IPC readiness below also detects any bind race instead
    // of accepting an HTTP response from another task's server.
    const probe = createServer();
    await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const port = (probe.address() as import('node:net').AddressInfo).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const origin = `http://localhost:${port}`;
    const password = randomUUID();
    const templateVideosDir = join(dir, 'templates');
    const env = { ...process.env, TEMPLATE_VIDEOS_DIR: templateVideosDir, RUN_GENERATION: String(runGeneration), TEST_VIDEO_ONLY: String(testVideoOnly), EMAIL_TEST_SMTP_PORT: String(smtpPort), FIXTURE_VIDEO: join(dir, 'fixture.mp4'), CAPTURE_TEST_ORIGIN: '', FAL_KEY: '', SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: '', APP_ORIGIN: origin, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir, ADMIN_PASSWORD: password, OPERATOR_PASSWORD: password };
    const image = join(dir, 'fixture.png');
    const jpeg = join(dir, 'fixture.jpg');
    const video = join(dir, 'fixture.mp4');
    let child: ChildProcess | undefined;
    const capture = createServer(async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end((await readFile('WebServer/reelme.html', 'utf8')).replaceAll('https://reelme.natureonzoom.win', origin));
    });
    async function stop() {
      if (child && child.exitCode === null) {
        const runningChild = child;
        const stopped = new Promise<void>(resolve => runningChild.once('exit', () => resolve()));
        // This isolated fixture must terminate even when graceful HTTP shutdown
        // waits on a browser connection. Never applies to a production process.
        const deadline = setTimeout(() => runningChild.kill('SIGKILL'), 5000);
        runningChild.kill('SIGTERM');
        try { await stopped; } finally { clearTimeout(deadline); }
      }
    }
    async function start() {
      execFileSync(process.execPath, ['--import', 'tsx', 'src/server/setup.ts'], { env, stdio: 'pipe' });
      child = spawn(process.execPath, ['--import', 'tsx', 'tests/browser-server.ts'], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      await new Promise<void>((resolve, reject) => {
        const current = child!;
        const ready = (message: unknown) => { if ((message as { ready?: string })?.ready === origin) { cleanup(); resolve(); } };
        const failed = () => { cleanup(); reject(new Error('Browser fixture server exited before listening')); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Browser fixture server did not start')); }, 10_000);
        function cleanup() { clearTimeout(timer); current.off('message', ready); current.off('exit', failed); current.off('error', failed); }
        current.on('message', ready); current.once('exit', failed); current.once('error', failed);
      });
    }
    try {
      await sharp({ create: { width: 512, height: 512, channels: 3, background: '#d0b8ff' } }).png().toFile(image);
      await sharp(image).jpeg().toFile(jpeg);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=purple:s=640x360:d=5:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { stdio: 'pipe' });
      await new Promise<void>((resolve, reject) => { capture.once('error', reject); capture.listen(capturePort, resolve); });
      env.CAPTURE_TEST_ORIGIN = `http://localhost:${(capture.address() as import('node:net').AddressInfo).port}`;
      await start();
      const installationKey = (await readFile(join(dir, 'installation-key.txt'), 'utf8')).trim();
      const sessionCount = () => { const db = new Database(join(dir, 'reelme.sqlite'), { readonly: true }); try { return (db.prepare('SELECT COUNT(*) AS total FROM capture_sessions').get() as { total: number }).total; } finally { db.close(); } };
      const photos = async (sessionId: string): Promise<StoredPhoto[]> => {
        const db = new Database(join(dir, 'reelme.sqlite'), { readonly: true });
        let rows: Omit<StoredPhoto, 'bytes'>[];
        try { rows = db.prepare('SELECT * FROM capture_photos WHERE session_id=? ORDER BY pose_index').all(sessionId) as Omit<StoredPhoto, 'bytes'>[]; } finally { db.close(); }
        return Promise.all(rows.map(async row => ({ ...row, bytes: await readFile(join(dir, 'media', row.path)) })));
      };
      const captureOrigin = `http://localhost:${(capture.address() as import('node:net').AddressInfo).port}`;
      const prepareTemplate = async (slotId: string, orientation: 'landscape' | 'portrait' = 'landscape', file = video) => { await mkdir(templateVideosDir, { recursive: true }); await copyFile(file, join(templateVideosDir, `${slotId}__${orientation}.mp4`)); };
      await use({ templateVideosDir, prepareTemplate, origin, dataDir: dir, captureOrigin, password, image, jpeg, video, installationKey, sessionCount, photos, restart: async () => { await stop(); await start(); } });
    } finally {
      await stop();
      if (capture.listening) await new Promise<void>(resolve => { capture.close(() => resolve()); capture.closeAllConnections(); });
      await rm(dir, { recursive: true, force: true });
    }
  }, { scope: 'test' }],
});
export { expect };
