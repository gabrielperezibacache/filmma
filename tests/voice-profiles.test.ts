import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createApp} from '../server/app.js';
import {runProcess} from '../server/process.js';
import {dialogueLinesFromScene,dialogueVoice,speechIsCurrent,applyDialogueAudio,applyDialogueSubtitle} from '../src/dialogue.js';
import {resolveVoiceReference} from '../server/voice-profiles.js';
const sha=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'filmma-profiles-')),data=join(dir,'data'),qwenPath=join(dir,'qwen.cjs'),calls=join(dir,'calls.jsonl');await mkdir(join(data,'media'),{recursive:true});
  for(const [id,frequency] of [['source',340],['second',650]] as const){const r=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i',`sine=frequency=${frequency}:sample_rate=48000:duration=6`,'-ac','2',join(data,'media',`${id}.wav`)]);assert.equal(r.code,0,r.stderr);}
  await writeFile(qwenPath,`const fs=require('node:fs'),cp=require('node:child_process');if(process.argv[2]==='doctor'){console.log(JSON.stringify({ready:true,modelReady:true,referenceSha256:'${'a'.repeat(64)}'}));process.exit(0)}const r=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--request')+1]));fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(r)+'\\n');const p=cp.spawnSync('ffmpeg',['-v','error','-i',r.referencePath,'-t','0.5',r.outputPath]);if(p.status)process.exit(1);console.log(JSON.stringify({ok:true,model:'qwen-fixture'}));`);
  const f=await createApp({dataDirectory:data,qwenPath,python:process.execPath,skipDiagnostics:true});
  f.store.project.assets=f.store.project.assets.filter(a=>a.type==='image');for(const id of ['source','second'])f.store.project.assets.push({id,name:id,type:'audio',url:`/api/media/${id}.wav`,mime:'audio/wav',size:(await readFile(join(data,'media',`${id}.wav`))).length});
  f.store.project.scenes=f.store.project.scenes.slice(0,2);for(const scene of f.store.project.scenes){scene.duration=6;scene.dialogue='ELENA: Mira la luz.';scene.characterIds=['elena'];}
  f.store.project.dialogueLines=f.store.project.scenes.flatMap(scene=>dialogueLinesFromScene(f.store.project,scene.id));await f.store.save();
  const server=f.app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  const request=(path:string,body:unknown,method='POST')=>fetch(base+path,{method,headers:{'content-type':'application/json','X-Filmma-Client':'filmma'},body:JSON.stringify(body)});
  const wait=async(id:string)=>{for(let n=0;n<1000;n++){const job=f.store.jobs.find(j=>j.id===id)!;if(['completed','failed','cancelled'].includes(job.status))return job;await new Promise(done=>setTimeout(done,15));}throw Error('timeout');};
  const profile=(sourceAssetId='source')=>request('/api/speech/qwen/profiles',{projectId:f.store.project.id,characterId:'elena',sourceAssetId,start:1,duration:3,name:'Elena propia'});
  return {...f,dir,data,base,calls,request,wait,profile,close:async()=>{await f.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(dir,{recursive:true,force:true});}};
}

test('reference profiles preserve original audio and remain the same character voice in every scene',async()=>{const f=await fixture();try{
  const before=await readFile(join(f.data,'media/source.wav')),scenes=structuredClone(f.store.project.scenes),response=await f.profile();assert.equal(response.status,201,await response.clone().text());const result=await response.json(),reference=result.asset;
  assert.deepEqual(await readFile(join(f.data,'media/source.wav')),before);assert.deepEqual(f.store.project.scenes,scenes);assert.equal(reference.voiceReference.sourceSha256,sha(before));assert.equal(reference.voiceReference.duration,3);assert.equal(reference.voiceReference.sampleRate,24000);assert.notEqual(reference.id,'source');
  const stored=Buffer.from(await(await fetch(f.base+reference.url)).arrayBuffer());assert.equal(reference.voiceReference.outputSha256,sha(stored));for(const line of f.store.project.dialogueLines!)assert.equal(dialogueVoice(f.store.project,line).voiceId,`profile-${reference.id}`);
  const speech=await f.request('/api/speech/generate',{projectId:f.store.project.id,lineId:f.store.project.dialogueLines![0]!.id}),job=await f.wait((await speech.json()).job.id);assert.equal(job.status,'completed',job.message);const asset=f.store.project.assets.find(a=>a.id===job.result?.assetId)!,line=f.store.project.dialogueLines![0]!;assert(speechIsCurrent(f.store.project,line,asset));assert.equal(asset.speech!.voice.engine,'qwen');
  assert.equal(applyDialogueSubtitle(applyDialogueAudio(f.store.project,line.id,asset.id),line.id,asset.id).subtitleCues![0]!.end,.5);
  const requests=(await readFile(f.calls,'utf8')).trim().split('\n').map(x=>JSON.parse(x));assert.equal(requests[0].referencePath,join(f.data,'media',`${reference.id}.wav`));assert.equal(requests[0].expectedReferenceSha256,sha(stored));
  const second=await f.profile('second');assert.equal(second.status,201);assert.equal(speechIsCurrent(f.store.project,line,asset),false);assert(f.store.project.assets.some(a=>a.id===reference.id));
}finally{await f.close();}});

test('profile ranges, silent sources and arbitrary paths are rejected before assigning a voice',async()=>{const f=await fixture();try{
  const input={projectId:f.store.project.id,characterId:'elena',sourceAssetId:'source',start:0,duration:3};
  for(const change of [{duration:2.99},{duration:31},{start:5},{sourceAssetId:'missing'},{referencePath:'/tmp/private.wav'},{characterId:'missing'}]){const response=await f.request('/api/speech/qwen/profiles',{...input,...change});assert(response.status>=400);}
  const source=join(f.data,'media/source.wav');await rm(source);assert.equal((await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=24000:cl=mono','-t','6',source])).code,0);
  const response=await f.profile();assert.equal(response.status,400);assert.match(await response.text(),/silencio|baja/);assert(!f.store.project.assets.some(a=>a.voiceReference));
}finally{await f.close();}});

test('project saves cannot forge immutable voice reference provenance and disk modifications stop inference',async()=>{const f=await fixture();try{
  const response=await f.profile(),result=await response.json(),asset=result.asset;const forged=structuredClone(f.store.project);forged.assets.find(a=>a.id===asset.id)!.voiceReference!.outputSha256='f'.repeat(64);assert.equal((await f.request('/api/project',forged,'PUT')).status,200);assert.equal(f.store.project.assets.find(a=>a.id===asset.id)!.voiceReference!.outputSha256,asset.voiceReference.outputSha256);
  const path=join(f.data,'media',`${asset.id}.wav`);await writeFile(path,Buffer.from('changed'));const generation=await f.request('/api/speech/generate',{projectId:f.store.project.id,lineId:f.store.project.dialogueLines![0]!.id});assert.equal(generation.status,409);assert.match(await generation.text(),/cambió en el disco/);
  await assert.rejects(resolveVoiceReference({mediaPath:async()=>path},f.store.project,{...result.voice,referenceAssetId:undefined,voiceId:'unknown'}),/perfil/);
}finally{await f.close();}});

test('ZIP roundtrip remaps Qwen profiles, speech snapshots and reference originals without changing bytes',async()=>{const f=await fixture();try{
  const response=await f.profile(),profile=await response.json(),line=f.store.project.dialogueLines![0]!;const speech=await f.request('/api/speech/generate',{projectId:f.store.project.id,lineId:line.id}),job=await f.wait((await speech.json()).job.id);assert.equal(job.status,'completed',job.message);f.store.project=applyDialogueAudio(f.store.project,line.id,job.result!.assetId!) as typeof f.store.project;await f.store.save();
  const exported=await f.request('/api/export',{format:'project'}),archive=await f.wait((await exported.json()).job.id);assert.equal(archive.status,'completed',archive.message);
  const form=new FormData();form.append('projectFile',await(await fetch(f.base+archive.result!.url)).blob(),'profiles.filmma.zip');const imported=await fetch(f.base+'/api/projects/import',{method:'POST',headers:{'X-Filmma-Client':'filmma'},body:form});assert.equal(imported.status,201,await imported.clone().text());const project=(await imported.json()).project,character=project.characters.find((c:any)=>c.name==='Elena'),asset=project.assets.find((a:any)=>a.id===character.voice.referenceAssetId),newLine=project.dialogueLines[0],audio=project.assets.find((a:any)=>a.id===newLine.audioAssetId);
  assert.notEqual(asset.id,profile.asset.id);assert.equal(character.voice.voiceId,`profile-${asset.id}`);assert.equal(asset.voiceReference.projectId,project.id);assert.equal(asset.voiceReference.characterId,character.id);assert.equal(audio.speech.voice.referenceAssetId,asset.id);assert(speechIsCurrent(project,newLine,audio));assert.equal(asset.voiceReference.outputSha256,sha(Buffer.from(await(await fetch(f.base+asset.url)).arrayBuffer())));assert(project.assets.some((a:any)=>a.id===asset.voiceReference.sourceAssetId));
}finally{await f.close();}});
