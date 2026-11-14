import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { DigiCamControl } from '../../src/client/capture/camera.ts';
const origin='http://localhost:5513';
const pid=process.env.SERVER_PID;
assert.match(pid,/^\d+$/);
const children=()=>{try{return execFileSync('pgrep',['-P',pid,'-x','ffmpeg'],{encoding:'utf8'}).trim().split(/\s+/).filter(Boolean);}catch(e){if(e.status===1)return [];throw e;}};
const health=await(await fetch(origin+'/health')).json();
const logPath=new URL('../../linux_digiCamControl/data/'+health.session+'/server.log',import.meta.url);
const logBefore=(await readFile(logPath,'utf8')).length;
const signal=new AbortController().signal;
const camera=new DigiCamControl((path,init)=>fetch(new URL(path,origin),init));
const report={serverPid:Number(pid),camera:health.camera.id,session:health.session,previewCount:0,maxConsecutiveSameHash:0,captures:[],pass:false};
let started,previousHash,same=0,nextCapture=10,nextProcessCheck=0;
try {
  await camera.startLiveView(signal);
  const processes=children();assert.equal(processes.length,1);report.ffmpegPid=Number(processes[0]);
  started=performance.now();
  while(performance.now()-started<120000) {
    const blob=await camera.preview(signal);
    const data=Buffer.from(await blob.arrayBuffer());
    const {info}=await sharp(data).raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,1280);assert.equal(info.height,720);
    const hash=createHash('sha256').update(data).digest('hex');
    same=hash===previousHash?same+1:0;previousHash=hash;
    report.maxConsecutiveSameHash=Math.max(report.maxConsecutiveSameHash,same);
    assert.ok(same<5,'Preview stayed byte-identical for five consecutive polls');
    report.previewCount++;
    const elapsed=(performance.now()-started)/1000;
    if(elapsed>=nextProcessCheck){assert.deepEqual(children(),processes,'FFmpeg PID changed or died');nextProcessCheck+=5;}
    if(elapsed>=nextCapture) {
      const capture=Buffer.from(await(await camera.capture('pts-endurance',report.captures.length,true,signal)).arrayBuffer());
      const {info:frame}=await sharp(capture).raw().toBuffer({resolveWithObject:true});
      assert.equal(frame.width,1280);assert.equal(frame.height,720);
      const files=await(await fetch(origin+'/filelist.json')).json();
      assert.equal(createHash('sha256').update(capture).digest('hex'),files.at(-1).Sha256);
      report.captures.push({atSeconds:Number(elapsed.toFixed(2)),name:files.at(-1).Name,bytes:capture.length});
      nextCapture+=20;
    }
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  report.pollingSeconds=Number(((performance.now()-started)/1000).toFixed(2));
  assert.deepEqual(children(),processes);report.aliveAfterPolling=true;
  const beforeIdle=(await readFile(logPath,'utf8')).slice(logBefore);
  assert.doesNotMatch(beforeIdle,/Invalid pts|Error encoding|поток FFmpeg завершился|перестала передавать/);
  // No stop call: release must be caused by inactivity, and proven by the journal.
  await new Promise(resolve=>setTimeout(resolve,17000));
  report.childrenAfterIdle=children();assert.deepEqual(report.childrenAfterIdle,[]);
  const log=(await readFile(logPath,'utf8')).slice(logBefore);
  assert.match(log,/Live View остановлен: нет запросов 15 с/);
  assert.doesNotMatch(log,/Invalid pts|Error encoding|поток FFmpeg завершился|перестала передавать/);
  report.idleMessageConfirmed=true;report.encoderErrors=false;report.pass=true;
  await writeFile(new URL('./endurance-server.log',import.meta.url),log);
} catch(error) {report.failure=String(error);throw error;}
finally {await writeFile(new URL('./endurance-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
