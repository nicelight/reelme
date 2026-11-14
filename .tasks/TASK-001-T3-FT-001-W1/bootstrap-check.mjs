import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const source = process.cwd();
const root = await mkdtemp(join(tmpdir(), 'reelme-clean-'));
let child;
async function stop() {
  if (!child || child.exitCode !== null) return;
  const target = child;
  await new Promise(resolve => { target.once('exit', resolve); target.kill('SIGTERM'); });
  child = undefined;
}
try {
  for (const name of ['package.json','package-lock.json','tsconfig.json','tsconfig.server.json','vite.config.ts','index.html','.env.example','src','WebServer']) await cp(join(source,name),join(root,name),{recursive:true});
  console.log('Clean source snapshot copied; node_modules/dist/data absent.');
  for (const args of [['ci']]) {
    execFileSync('npm',args,{cwd:root,stdio:'pipe',timeout:180000});
    console.log(`npm ${args.join(' ')}: PASS`);
  }
  const server = createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const origin = `http://localhost:${port}`;
  const password = randomBytes(24).toString('base64url');
  const dataDir = join(root,'persistent-data');
  const basicEnv = `APP_ORIGIN=${origin}\nPORT=${port}\nHOST=127.0.0.1\nDATA_DIR=${dataDir}\n`;
  await writeFile(join(root,'.env'),basicEnv+`ADMIN_PASSWORD=${password}\nOPERATOR_PASSWORD=${randomBytes(24).toString('base64url')}\n`,{mode:0o600});
  execFileSync('npm',['run','setup'],{cwd:root,stdio:'pipe',timeout:30000});
  console.log('npm run setup with empty data directory: PASS');
  for (const args of [['run','check'],['run','build']]) {
    execFileSync('npm',args,{cwd:root,stdio:'pipe',timeout:180000});
    console.log(`npm ${args.join(' ')} with server credentials in .env: PASS`);
  }
  const key = await readFile(join(dataDir,'installation-key.txt'),'utf8');
  await writeFile(join(root,'.env'),basicEnv,{mode:0o600});
  async function start() {
    child = spawn(process.execPath,['--env-file=.env','dist/server/main.js'],{cwd:root,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',()=>{}); child.stderr.on('data',()=>{});
    for(let n=0;n<100;n++) {
      if(child.exitCode!==null) throw new Error('Server exited during startup');
      try { if ((await fetch(origin)).status===200) return; } catch{}
      await new Promise(r=>setTimeout(r,50));
    }
    throw new Error('Server startup timeout');
  }
  await start(); console.log('Built server startup + cloud HTML: HTTP 200');
  const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});
  assert.equal(login.status,200); const cookie=login.headers.get('set-cookie').split(';')[0];
  const require=createRequire(join(root,'package.json')); const sharp=require('sharp');
  const png=await sharp({create:{width:64,height:64,channels:3,background:'#73866d'}}).png().toBuffer();
  const videoPath=join(root,'test.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=10','-t','10','-c:v','libx264','-pix_fmt','yuv420p','-y',videoPath]);
  const video=await readFile(videoPath);
  async function upload(bytes,mime,name) {
    const body=new FormData(); body.append('file',new Blob([bytes],{type:mime}),name);
    const res=await fetch(origin+'/api/admin/slot-media',{method:'POST',headers:{Origin:origin,Cookie:cookie},body});
    assert.equal(res.status,201); return res.json();
  }
  const image=await upload(png,'image/png','image.png');const clip=await upload(video,'video/mp4','video.mp4');
  const slots=[];
  for(const input of [
    {description:'Первый сюжет с видео',visible:true,thumbnailId:image.id,mode:'V2V',model:'minimax/h3-max/recast',resolution:'768P',referenceIds:[],videoId:clip.id,recastShotsConfirmed:true},
    {description:'Второй сюжет без демо',visible:false,thumbnailId:image.id,mode:'P2V',model:'kling/v4/reference-to-video',resolution:'720p',referenceIds:[image.id],prompt:'@Element1 in @Image1',duration:10}
  ]) {
    const res=await fetch(origin+'/api/admin/slots',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(input)});
    assert.equal(res.status,201); slots.push(await res.json());
  }
  await stop();
  execFileSync('npm',['run','setup'],{cwd:root,stdio:'pipe',timeout:30000});
  assert.equal(await readFile(join(dataDir,'installation-key.txt'),'utf8'),key);
  console.log('Repeated setup without password env: PASS; installation key unchanged.');
  await start();
  for(const slot of slots) {
    const res=await fetch(origin+`/api/admin/slots/${slot.id}`,{headers:{Cookie:cookie}});
    assert.equal(res.status,200); assert.deepEqual(await res.json(),slot);
  }
  for(const [id,bytes] of [[image.id,png],[clip.id,video]]) {
    const res=await fetch(origin+`/api/admin/slot-media/${id}`,{headers:{Cookie:cookie}});
    assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),bytes);
  }
  console.log('V2V + P2V, image + video, admin session after real process restart: HTTP 200, bytes/config unchanged.');
  const invalid=await fetch(origin+'/api/admin/slots',{headers:{Authorization:`Bearer ${key.trim()}`}});
  assert.equal(invalid.status,403);
  const clientText=execFileSync('rg',['--files','--hidden','dist/client'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  for(const file of clientText){const content=await readFile(join(root,file),'utf8');assert.ok(!content.includes(password));assert.ok(!content.includes(key.trim()));}
  console.log('Installation denied editor: HTTP 403. Generated credentials absent from client assets.');
  console.log('BOOTSTRAP PASS');
} finally {await stop(); await rm(root,{recursive:true,force:true});}
