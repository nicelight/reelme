/** Private SQLite/file fixture for issuance checks; no provider or email calls. */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/server/db.js';
import { prepareVideo } from '../src/server/sessions/video.js';

export async function preparedSession(dataDir: string, bytes: Buffer, number = 1) {
  const id = randomUUID(); const slotId = randomUUID();
  const db = openDatabase(dataDir);
  const photo = await sharp({ create: { width: 400, height: 500, channels: 3, background: number === 1 ? '#b7c9bc' : '#e7c0a8' } }).jpeg().toBuffer();
  const photoPath = `sessions/${id}/photo.jpg`;
  try {
    await mkdir(join(dataDir, 'media', 'sessions', id), { recursive: true });
    await writeFile(join(dataDir, 'media', photoPath), photo);
    db.prepare('INSERT INTO slots(id,config) VALUES (?,?)').run(slotId, '{}');
    db.prepare("INSERT INTO events(date,next_number) VALUES ('2026-11-14',?) ON CONFLICT(date) DO UPDATE SET next_number=excluded.next_number").run(number + 1);
    const snapshot = { expectedPhotos: 1, generation: { model: 'minimax/h3-max/recast', mode: 'V2V', videoId: randomUUID(), resolution: '768P', referenceIds: [] }, description: 'Fixture', thumbnailId: randomUUID() };
    db.prepare("INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at) VALUES (?,?,'2026-11-14',?,?,?,'preparing',?)").run(id, randomUUID(), number, slotId, JSON.stringify(snapshot), Date.now());
    db.prepare('INSERT INTO capture_photos(session_id,pose_index,path,size,width,height) VALUES (?,0,?,?,400,500)').run(id, photoPath, photo.length);
    const prepared = await prepareVideo(dataDir, id, 'https://fixture.test/video.mp4', async () => new Response(bytes));
    db.prepare(`INSERT INTO generation_jobs(session_id,request_id,result_url,video_path,frame_path,video_size,frame_size,width,height,duration)
      VALUES (@id,'fixture-request','https://fixture.test/private.mp4',@video_path,@frame_path,@video_size,@frame_size,@width,@height,@duration)`).run({ id, ...prepared });
    return { id, photo, ...prepared };
  } finally { db.close(); }
}
