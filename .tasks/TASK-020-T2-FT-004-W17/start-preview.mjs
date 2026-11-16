// Isolated verification preview, not the real installation. No fal or SMTP calls.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { preparedSession } from '../../tests/receive-fixture.ts';
import { publishReady } from '../../src/server/sessions/receive.ts';
import { openDatabase } from '../../src/server/db.ts';
const root = await mkdtemp(join(tmpdir(), 'reelme-approved-preview-'));
const dataDir = join(root, 'data'); await mkdir(dataDir);
const now = Date.parse('2026-11-14T10:00:00Z');
await writeFile(join(dataDir, 'display-control.json'), JSON.stringify({now,fail:false}));
execFileSync(process.execPath, ['--import','tsx','src/server/setup.ts'], { env:{...process.env,DATA_DIR:dataDir,ADMIN_PASSWORD:'test-password',OPERATOR_PASSWORD:'test-password'}, stdio:'pipe' });
const video = join(root,'preview.mp4');
execFileSync('ffmpeg',['-v','error','-ss','4','-i','docs/video templates/1794213414058-yjz13u263xc.mp4','-t','1','-an','-c:v','libx264','-pix_fmt','yuv420p',video]);
const bytes = await readFile(video); const db = openDatabase(dataDir);
for(let n=1;n<=12;n++) {
  const seed = await preparedSession(dataDir, bytes, n);
  if(n<=9) {
    execFileSync('ffmpeg',['-v','error','-ss',String(n*2),'-i','docs/video templates/1794213414058-yjz13u263xc.mp4','-frames:v','1','-y',join(dataDir,'media',seed.frame_path)]);
    const frame=await readFile(join(dataDir,'media',seed.frame_path));
    db.prepare('UPDATE generation_jobs SET frame_size=? WHERE session_id=?').run(frame.length,seed.id);
    await publishReady(db,dataDir,seed.id,()=>now+n);
  } else db.prepare('UPDATE capture_sessions SET state=? WHERE id=?').run(n===10?'submit_pending':n===11?'observing':'capturing',seed.id);
}
db.close();
await writeFile('.tasks/TASK-020-T2-FT-004-W17/preview-info.json',JSON.stringify({dataDir,origin:'http://localhost:3197',accounts:['operator','admin'],password:'test-password',syntheticSessions:true,noExternalCalls:true},null,2));
process.env.DATA_DIR=dataDir;
await import('../../tests/display-browser-server.ts');
console.log('Isolated production preview: http://localhost:3197/?screen=results (operator / test-password)');
