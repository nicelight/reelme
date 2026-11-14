/** Archive fixtures own temporary SQLite/media only; real FFmpeg output, no network. */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/server/db.js';
import { publishReady } from '../src/server/sessions/receive.js';
import { preparedSession } from './receive-fixture.js';

export async function seedArchive(dataDir: string, firstVideo: Buffer, secondVideo: Buffer) {
  const first = await preparedSession(dataDir, firstVideo, 1);
  const second = await preparedSession(dataDir, secondVideo, 2);
  const db = openDatabase(dataDir);
  try {
    const thumb = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#326448' } }).png().toBuffer();
    const changed = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#b44736' } }).png().toBuffer();
    const thumbnailId = randomUUID(); const changedId = randomUUID();
    for (const [id, bytes] of [[thumbnailId, thumb], [changedId, changed]] as const) {
      await writeFile(join(dataDir, 'media', id), bytes);
      db.prepare("INSERT INTO slot_media(id,path,kind,mime,size,width,height) VALUES (?,?,'image','image/png',?,320,240)").run(id, id, bytes.length);
    }
    const firstRow = db.prepare('SELECT slot_id,snapshot FROM capture_sessions WHERE id=?').get(first.id) as { slot_id: string; snapshot: string };
    const snapshot = { ...JSON.parse(firstRow.snapshot), thumbnailId, description: 'Зелёная история', slotId: firstRow.slot_id };
    db.prepare('UPDATE capture_sessions SET snapshot=?').run(JSON.stringify(snapshot));
    db.prepare('UPDATE capture_sessions SET snapshot=? WHERE id=?').run(JSON.stringify({ ...snapshot, thumbnailId: changedId, description: 'Красная история' }), second.id);
    // Current editor config has another image; historical snapshots must win.
    db.prepare('UPDATE slots SET config=?').run(JSON.stringify({ ...snapshot.generation, visible: true, thumbnailId: changedId, description: 'Новый сюжет' }));
    const partialId = randomUUID(); const emptyId = randomUUID();
    for (const [id, number] of [[partialId, 3], [emptyId, 4]] as const) {
      db.prepare("INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at) VALUES (?,?,'2026-11-14',?,?,?,'capturing',0)").run(id, randomUUID(), number, firstRow.slot_id, JSON.stringify(snapshot));
    }
    await mkdir(join(dataDir, 'media', 'sessions', partialId));
    const partialPath = `sessions/${partialId}/partial.jpg`;
    await writeFile(join(dataDir, 'media', partialPath), first.photo);
    db.prepare('INSERT INTO capture_photos(session_id,pose_index,path,size,width,height) VALUES (?,0,?,?,400,500)').run(partialId, partialPath, first.photo.length);
    // Multiple photos on one completed session guard against multiplied result sizes.
    const extraPath = `sessions/${first.id}/extra.jpg`;
    await writeFile(join(dataDir, 'media', extraPath), second.photo);
    db.prepare('INSERT INTO capture_photos(session_id,pose_index,path,size,width,height) VALUES (?,1,?,?,400,500)').run(first.id, extraPath, second.photo.length);
    db.prepare("INSERT INTO events(date,next_number) VALUES ('2026-11-13',2),('2026-11-15',1)").run();
    db.prepare("INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at) VALUES (?,?,'2026-11-13',1,?,?,'capturing',0)").run(randomUUID(), randomUUID(), firstRow.slot_id, JSON.stringify(snapshot));
    await publishReady(db, dataDir, first.id); await publishReady(db, dataDir, second.id);
    return { first, second, partialId, emptyId, thumbnailId, changedId, thumb, changed,
      expected: { date: '2026-11-14', photoBytes: 2 * first.photo.length + 2 * second.photo.length + first.frame_size + second.frame_size, videoBytes: firstVideo.length + secondVideo.length } };
  } finally { db.close(); }
}
