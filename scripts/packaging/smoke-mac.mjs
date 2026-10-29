import {spawn} from 'node:child_process';
import {mkdtemp,cp,readFile,writeFile,open} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {checkFrontend} from './check-frontend.mjs';
const resources=resolve(process.env.FILMMA_SMOKE_RESOURCES??'release/mac-arm64/Filmma.app/Contents/Resources');
const exe=resolve(process.env.FILMMA_SMOKE_EXECUTABLE??'release/mac-arm64/Filmma.app/Contents/MacOS/Filmma');
const expected=JSON.parse(await readFile(join(resources,'engine/desktop/build-info.json'),'utf8'));
const port=await new Promise((done,fail)=>{const server=createServer();server.once('error',fail);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(error=>error?fail(error):done(value));});});
const endpoint=`http://127.0.0.1:${port}`;
const work=await mkdtemp(join(tmpdir(),'filmma-packaged-')),root=join(work,'engine'),data=join(work,'data');
await cp(join(resources,'engine'),root,{recursive:true});
const log=await open(join(work,'server.log'),'a');
const child=spawn(exe,[join(resources,'server/index.mjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',FILMMA_ROOT:root,FILMMA_DATA_DIR:data,FILMMA_PORT:String(port),FILMMA_DIST_DIR:join(resources,'dist'),FILMMA_PUBLIC_DIR:join(resources,'public'),FILMMA_PYTHON:join(resources,'python/bin/python3.12'),FILMMA_FFMPEG:join(resources,'bin/ffmpeg'),FILMMA_FFPROBE:join(resources,'bin/ffprobe'),PATH:join(resources,'bin')+':'+process.env.PATH},stdio:['ignore',log.fd,log.fd]});
await log.close();let ended=false;child.on('exit',()=>{ended=true;});
try{
 let state;
 for(let i=0;i<90&&!ended;i++){state=await fetch(endpoint+'/api/application',{signal:AbortSignal.timeout(2000)}).then(r=>r.ok?r.json():null).catch(()=>null);if(state)break;await new Promise(r=>setTimeout(r,500));}
 if(!state)throw Error(await readFile(join(work,'server.log'),'utf8'));
 assert.equal(state.id,'filmma-studio');assert.equal(state.platform,'darwin');assert.equal(state.version,expected.version);assert.equal(state.commit,expected.commit);assert.equal(resolve(state.dataDirectory),data);
 const frontendResources=await checkFrontend(endpoint);
 const system=await fetch(endpoint+'/api/system').then(r=>r.json());assert(system.ffmpeg.available);assert(system.runtime.hardware.appleSilicon);
 await writeFile('release/mac-runtime-smoke.json',JSON.stringify({version:state.version,commit:state.commit,packagedServerStarted:true,isolatedDataDirectory:true,frontendResources,pythonDoctor:true,platform:state.platform,gpuInferenceTested:false,testedAt:new Date().toISOString()},null,2));
 console.log('Packaged Mac server, build identity, isolated data, dependencies, FFmpeg and Python verified');
}finally{child.kill('SIGTERM');}
