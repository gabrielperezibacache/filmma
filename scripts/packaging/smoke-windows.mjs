import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readdir,access,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const work=await mkdtemp(join(tmpdir(),'filmma-windows-smoke-'));
const installer=(await readdir('release')).find(n=>n.endsWith('-win-x64-Setup.exe'));
assert(installer,'NSIS installer missing');
const destination=join(work,'installed');
execFileSync(resolve('release',installer),['/S',`/D=${destination}`],{timeout:180000});
const exe=join(destination,'Filmma.exe');await access(exe);
const resources=join(destination,'resources'),bin=join(resources,'bin');
execFileSync(join(resources,'python/python.exe'),['-m','unittest','discover','-s','runtime/tests','-p','test_portable_lock.py'],{stdio:'inherit'});
const movie=join(work,'original.mp4');
execFileSync(join(bin,'ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=1','-c:v','libx264','-threads','2',movie]);
const media=JSON.parse(execFileSync(join(bin,'ffprobe.exe'),['-v','error','-count_frames','-show_streams','-of','json',movie],{encoding:'utf8'}));
assert.equal(media.streams[0].nb_read_frames,'24');
execFileSync(join(bin,'ffmpeg.exe'),['-v','error','-i',movie,'-f','null','-']);
let child;const userData=join(work,'studio');
try{
 child=spawn(exe,[],{env:{...process.env,FILMMA_DESKTOP_TEST_DATA:userData},stdio:'ignore'});
 let state;
 for(let i=0;i<90;i++){
  state=await fetch('http://127.0.0.1:4320/api/application',{signal:AbortSignal.timeout(2000)}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(state)break;await new Promise(r=>setTimeout(r,1000));
 }
 if(!state){let log='';try{log=await readFile(join(userData,'logs/application.log'),'utf8')}catch{}throw Error('Installed application failed to start: '+log)}
 assert.equal(state.platform,'win32');assert.equal(state.architecture,'x64');assert.equal(state.desktop,true);
 assert.equal(resolve(state.dataDirectory),join(userData,'data'));
 const system=await fetch('http://127.0.0.1:4320/api/system').then(r=>r.json());
 assert.equal(system.runtime.hardware.platform,'Windows');assert(system.runtime.hardware.memoryGB>0);assert.equal(system.runtime.hardware.appleSilicon,false);
 const manager=await fetch('http://127.0.0.1:4320/api/models/manager').then(r=>r.json());
 assert(manager.installation.options.some(o=>o.id==='cuda-int8-offload'&&!o.integrated));
 assert(manager.models.every(m=>!m.available),'Apple engines must not be reported ready on Windows');
 await writeFile('release/windows-smoke.json',JSON.stringify({version:state.version,platform:state.platform,architecture:state.architecture,nsisInstalled:true,installedAppStarted:true,ffmpegDecode:true,frames:24,pythonDoctor:true,memoryGB:system.runtime.hardware.memoryGB,modelAvailability:'Apple engines correctly unavailable; external CUDA recipes documented',gpuInferenceTested:false,testedAt:new Date().toISOString()},null,2));
 console.log('NSIS install + installed app + media roundtrip + Python model diagnosis verified');
}finally{if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'})}catch(error){let alive=false;try{process.kill(child.pid,0);alive=true}catch(probe){if(probe.code!=='ESRCH')throw probe}if(alive)throw error;console.log('Installed process already exited during teardown.')}}}
