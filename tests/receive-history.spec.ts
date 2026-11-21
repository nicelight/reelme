import { test, expect } from './browser-fixture.js';
import { readFile } from 'node:fs/promises';
import { openDatabase } from '../src/server/db.js';
import { publishReady } from '../src/server/sessions/receive.js';
import { preparedSession } from './receive-fixture.js';

test.use({ capturePort: 0 });
test('browser reports explicit download and Web Share outcomes separately from preparing the file', async ({ page, app, browser }) => {
  const bytes = await readFile(app.video);
  const session = await preparedSession(app.dataDir, bytes);
  const db = openDatabase(app.dataDir);
  try {
    await publishReady(db, app.dataDir, session.id, app.origin);
    const { receive_token } = db.prepare('SELECT receive_token FROM session_delivery WHERE session_id=?').get(session.id) as { receive_token: string };
    const url = app.origin + '/receive/' + receive_token;
    const count = (event: string) => (db.prepare('SELECT COUNT(*) AS n FROM session_history WHERE session_id=? AND event=?').get(session.id,event) as { n: number }).n;
    await page.addInitScript(() => {
      let attempts = 0;
      Object.defineProperty(navigator, 'canShare', { value: () => true });
      Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => {
        if (!navigator.userActivation.isActive || !data.files?.[0]?.size) throw new Error('Missing file or user gesture');
        if (++attempts === 1) throw new DOMException('Cancelled', 'AbortError');
      } });
    });
    await page.goto(url);
    const share = page.getByRole('button', {name: 'Поделиться видео', exact: true});
    await expect(share).toBeEnabled();
    expect(count('download_clicked')).toBe(0);
    expect(db.prepare("SELECT event FROM session_history WHERE step='delivery.download' AND json_extract(detail,'$.method')='share_preload'").all()).toEqual([{event:'response_finished'}]);
    await share.click();
    await expect.poll(() => count('share_cancelled')).toBe(1);
    await share.click();
    await expect.poll(() => count('share_returned')).toBe(1);
    const download = page.waitForEvent('download');
    await page.getByRole('link', {name:'Скачать видео'}).click();
    expect((await download).suggestedFilename()).toBe('reelme-1.mp4');
    await expect.poll(() => count('download_clicked')).toBe(1);

    const second = await browser.newContext();
    try {
      const other = await second.newPage();
      await other.goto(url);
      await other.getByRole('link', {name:'Скачать видео'}).click();
      await expect.poll(() => count('download_clicked')).toBe(2);
      expect(db.prepare("SELECT DISTINCT json_extract(detail,'$.profile') AS profile FROM session_history WHERE event='download_clicked'").all()).toHaveLength(2);
    } finally { await second.close(); }
    const history = JSON.stringify(db.prepare('SELECT step,event,outcome,detail FROM session_history WHERE session_id=?').all(session.id));
    expect(history).not.toContain(receive_token);
    expect(history).not.toContain(app.origin);
  } finally { db.close(); }
});
