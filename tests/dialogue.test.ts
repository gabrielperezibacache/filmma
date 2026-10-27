import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app.js';
import { runProcess } from '../server/process.js';
import { characterVoiceSchema, projectSchema, validateEditingReferences } from '../server/types.js';
import { applyDialogueAudio, applyDialogueSubtitle, applyLipSyncTake, defaultDialogueVoice, dialogueLinesFromScene, dialogueSnapshot, dialogueSourceSignature, dialogueVoice, lipSyncIsCurrent, speechIsCurrent } from '../src/dialogue.js';
import { subtitleSourceChanged } from '../src/subtitles.js';
import type { Asset, CharacterVoice, Project } from '../src/types.js';

const sha=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'filmma-dialogue-')),data=join(dir,'data'),speechPath=join(dir,'speech.cjs'),lipSyncPath=join(dir,'lipsync.cjs'),calls=join(dir,'calls'),lock=join(dir,'active');
  await mkdir(join(data,'media'),{recursive:true});
  const source=join(data,'media','source.mp4'),audio=join(dir,'voice.wav');
  const video=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x160:rate=24:duration=3','-c:v','libx264','-threads','2',source]);assert.equal(video.code,0,video.stderr);
  assert.equal((await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=0.8',audio])).code,0);
  const prefix=`const fs=require('node:fs'),{spawnSync}=require('node:child_process');if(process.argv[2]==='doctor'||process.argv[2]==='setup'){console.log(JSON.stringify({ok:true,ready:true,installed:true,model:'test-local'}));process.exit(0)}const r=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--request')+1]));fs.writeFileSync(${JSON.stringify(lock)},'lock',{flag:'wx'});fs.appendFileSync(${JSON.stringify(calls)},process.argv[2]+'\\n');`;
  await writeFile(speechPath,prefix+`setTimeout(()=>{fs.copyFileSync(${JSON.stringify(audio)},r.outputPath);fs.unlinkSync(${JSON.stringify(lock)});console.log(JSON.stringify({ok:true,model:'kokoro-test'}))},200);`);
  await writeFile(lipSyncPath,prefix+`const p=spawnSync('ffmpeg',['-v','error','-ss',String(r.trimStart),'-i',r.sourcePath,'-i',r.audioPath,'-vf','setpts=(PTS-STARTPTS)/'+r.speed,'-t',String(r.duration),'-r','25','-map','0:v','-map','1:a','-c:v','libx264','-c:a','aac','-threads','2',r.outputPath],{encoding:'utf8'});fs.unlinkSync(${JSON.stringify(lock)});if(p.status){console.error(p.stderr);process.exit(1)}console.log(JSON.stringify({ok:true,model:'musetalk-test',elapsedSeconds:.1}));`);
  const f=await createApp({dataDirectory:data,speechPath,lipSyncPath,python:process.execPath,skipDiagnostics:true});
  f.store.project.scenes=f.store.project.scenes.slice(0,1);const scene=f.store.project.scenes[0]!;scene.duration=2;scene.videoAssetId='source';scene.trimStart=.25;scene.speed=1.2;scene.dialogue='ELENA (susurra): Una más.';
  f.store.project.assets.push({id:'source',name:'Original',type:'video',url:'/api/media/source.mp4',mime:'video/mp4',size:(await readFile(source)).length});
  f.store.project.characters.find(c=>c.id==='elena')!.voice={engine:'kokoro',voiceId:'ef_dora',language:'es',speed:1};
  f.store.project.dialogueLines=dialogueLinesFromScene(f.store.project,scene.id);f.store.project.dialogueLines[0]!.offset=.25;await f.store.save();
  const server=f.app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  const request=(path:string,body:unknown,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:JSON.stringify(body)});
  const wait=async(id:string)=>{for(let n=0;n<1000;n++){const job=f.store.jobs.find(j=>j.id===id)!;if(['completed','failed','cancelled'].includes(job.status))return job;await new Promise(done=>setTimeout(done,15));}throw Error('timeout');};
  return {...f,dir,source,base,request,wait,params:()=>({projectId:f.store.project.id,lineId:f.store.project.dialogueLines![0]!.id}),close:async()=>{await f.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(dir,{recursive:true,force:true});}};
}

test('screenplay proposal links character headings, preserves original and marks offscreen dialogue',async()=>{
  const f=await fixture();try{const project=structuredClone(f.store.project),scene=project.scenes[0]!;scene.dialogue='ELENA (susurra): Una más.\nELENA (V.O.): Recuerdo la luz.\n\nELENA (O.S.)\n(La puerta se cierra)\nNo te vayas.';const before=structuredClone(project),lines=dialogueLinesFromScene(project,scene.id);assert.deepEqual(project,before);assert.deepEqual(lines.map(l=>[l.characterId,l.delivery,l.text]),[['elena','dialogue','Una más.'],['elena','voiceover','Recuerdo la luz.'],['elena','voiceover','No te vayas.']]);assert(lines.every(l=>l.sourceDialogue===dialogueSourceSignature(scene.dialogue)));}finally{await f.close();}
});

test('speech creates immutable provenance and manual linked audio/subtitles without modifying montage or original',async()=>{
  const f=await fixture();try{
    const original=sha(await readFile(f.source)),before=structuredClone(f.store.project.scenes),response=await f.request('/api/speech/generate',f.params());assert.equal(response.status,202);const submitted=(await response.json()).job;
    const duplicate=await f.request('/api/speech/generate',f.params());assert.equal((await duplicate.json()).job.id,submitted.id);
    const job=await f.wait(submitted.id);assert.equal(job.status,'completed',job.message);assert.equal(job.result?.stale,false);assert.deepEqual(f.store.project.scenes,before);assert.equal(sha(await readFile(f.source)),original);
    const asset=f.store.project.assets.find(a=>a.id===job.result?.assetId)!,line=f.store.project.dialogueLines![0]!;assert.equal(asset.speech?.characterId,'elena');assert.equal(asset.speech?.text,'Una más.');assert.equal(asset.speech?.duration,.8);assert.equal(speechIsCurrent(f.store.project,line,asset),true);
    const mixed=applyDialogueAudio(f.store.project,line.id,asset.id);assert.equal(mixed.tracks?.[0]?.clips[0]?.offset,.25);assert.equal(mixed.tracks?.[0]?.clips[0]?.duration,.8);assert.equal(applyDialogueAudio(mixed,line.id,asset.id).tracks?.[0]?.clips.length,1);
    const subtitled=applyDialogueSubtitle(mixed,line.id,asset.id);assert.equal(subtitled.subtitleCues?.[0]?.end,1.05);assert.equal(subtitleSourceChanged(subtitled.subtitleCues![0]!,subtitled.scenes[0]!),false);
    const forged=structuredClone(f.store.project);forged.assets.find(a=>a.id===asset.id)!.speech!.text='Altered';assert.equal((await f.request('/api/project',forged,'PUT')).status,200);assert.equal(f.store.project.assets.find(a=>a.id===asset.id)!.speech!.text,'Una más.');
  }finally{await f.close();}
});

test('lip sync is a separate take with baked source clock, retained originals and only its voice track silenced',async()=>{
  const f=await fixture();try{
    const before=sha(await readFile(f.source)),speechResponse=await f.request('/api/speech/generate',f.params()),speechJob=await f.wait((await speechResponse.json()).job.id);assert.equal(speechJob.status,'completed',speechJob.message);
    const audioId=speechJob.result!.assetId!,line=f.store.project.dialogueLines![0]!,scene=f.store.project.scenes[0]!,baseline=structuredClone(scene);
    const response=await f.request('/api/lipsync/generate',{...f.params(),sourceAssetId:'source',audioAssetId:audioId});assert.equal(response.status,202,await response.clone().text());
    const job=await f.wait((await response.json()).job.id);assert.equal(job.status,'completed',job.message);assert.deepEqual(f.store.project.scenes[0],baseline);assert.equal(sha(await readFile(f.source)),before);
    const asset=f.store.project.assets.find(a=>a.id===job.result?.assetId)!;assert.equal(asset.enhancement,undefined);assert.equal(asset.lipSync?.frames,50);assert.equal(asset.lipSync?.sourceSha256,before);assert.equal(asset.lipSync?.trimStart,.25);assert(lipSyncIsCurrent(f.store.project,line,asset));
    const audioApplied=applyDialogueAudio(f.store.project,line.id,audioId);audioApplied.tracks![0]!.clips.push({...audioApplied.tracks![0]!.clips[0]!,id:'unrelated',dialogueLineId:undefined});
    const applied=applyLipSyncTake(audioApplied,line.id,asset.id);assert.equal(applied.scenes[0]!.videoAssetId,asset.id);assert.equal(applied.scenes[0]!.trimStart,0);assert.equal(applied.scenes[0]!.speed,1);assert.equal(applied.tracks![0]!.clips[0]!.muted,true);assert.equal(applied.tracks![0]!.clips[1]!.muted,false);assert.throws(()=>applyDialogueAudio(applied,line.id,audioId),/ya contiene/);
    const trimmed=structuredClone(applied);trimmed.scenes[0]!.trimStart=.1;assert(!lipSyncIsCurrent(trimmed,line,asset));
    const fourth={...asset,id:'four-k',url:'/api/media/four-k.mp4',lipSync:undefined,enhancement:{sourceAssetId:asset.id,preset:'ai-4k' as const,method:'realesrgan-ncnn' as const,createdAt:new Date().toISOString(),width:3840,height:2160,duration:2,fps:25}};
    const withFourth=structuredClone(applied);withFourth.assets.push(fourth);withFourth.scenes[0]!.videoAssetId=fourth.id;assert(lipSyncIsCurrent(withFourth,line,fourth));
    const switched=structuredClone(withFourth);switched.dialogueLines![0]!.audioAssetId='another';assert(!lipSyncIsCurrent(switched,switched.dialogueLines![0]!,fourth));assert(applied.scenes[0]!.takeAssetIds?.includes('source'));
    assert.equal((await f.request('/api/project',applied,'PUT')).status,200);assert.equal(f.store.project.scenes[0]!.videoAssetId,asset.id);assert.equal(f.store.project.assets.find(a=>a.id===asset.id)!.lipSync?.audioAssetId,audioId);
  }finally{await f.close();}
});

test('queued historical voice is kept stale and incompatible current source, script and timing are rejected',async()=>{
  const f=await fixture();try{
    const response=await f.request('/api/speech/generate',f.params());for(let n=0;n<100&&!f.store.jobs.some(j=>j.message.startsWith('Interpretando'));n++)await new Promise(done=>setTimeout(done,5));f.store.project.characters.find(c=>c.id==='elena')!.voice!.speed=1.2;
    const job=await f.wait((await response.json()).job.id);assert.equal(job.status,'completed');assert.equal(job.result?.stale,true);const asset=f.store.project.assets.find(a=>a.id===job.result?.assetId)!;assert.throws(()=>applyDialogueAudio(f.store.project,f.params().lineId,asset.id),/ya no corresponde/);
    f.store.project.scenes[0]!.dialogue+=' Changed';assert.equal((await f.request('/api/speech/generate',f.params())).status,409);
    f.store.project.dialogueLines![0]!.sourceDialogue=dialogueSourceSignature(f.store.project.scenes[0]!.dialogue);const voice=await f.request('/api/speech/generate',f.params()),latest=await f.wait((await voice.json()).job.id);assert.equal(latest.status,'completed');
    const params={...f.params(),sourceAssetId:'source',audioAssetId:latest.result!.assetId};f.store.project.dialogueLines![0]!.offset=1.5;assert.equal((await f.request('/api/lipsync/generate',params)).status,400);
    f.store.project.dialogueLines![0]!.offset=.25;f.store.project.scenes[0]!.speed=4;assert.equal((await f.request('/api/lipsync/generate',params)).status,400);
    assert.equal((await f.request('/api/lipsync/generate',{...params,faceROI:{x:.8,y:0,width:.5,height:1}})).status,400);
    const invalid=structuredClone(f.store.project);invalid.dialogueLines![0]!.characterId='missing';assert.throws(()=>validateEditingReferences(projectSchema.parse(invalid)),/personaje/);
  }finally{await f.close();}
});

test('ZIP round trip preserves both source bytes and remaps dialogue, character, track and lip associations',async()=>{
  const f=await fixture();try{
    const voice=await f.request('/api/speech/generate',f.params()),speech=await f.wait((await voice.json()).job.id);assert.equal(speech.status,'completed',speech.message);
    const synced=await f.request('/api/lipsync/generate',{...f.params(),sourceAssetId:'source',audioAssetId:speech.result!.assetId}),lip=await f.wait((await synced.json()).job.id);assert.equal(lip.status,'completed',lip.message);
    f.store.project=applyLipSyncTake(applyDialogueAudio(f.store.project,f.params().lineId,speech.result!.assetId!),f.params().lineId,lip.result!.assetId!) as typeof f.store.project;await f.store.save();
    const oldProject=f.store.project.id,exported=await f.request('/api/export',{format:'project'}),archive=await f.wait((await exported.json()).job.id);assert.equal(archive.status,'completed',archive.message);
    const form=new FormData();form.append('projectFile',await (await fetch(f.base+archive.result!.url)).blob(),'dialogue.filmma.zip');const imported=await fetch(f.base+'/api/projects/import',{method:'POST',headers:{'X-Filmma-Client':'filmma'},body:form});assert.equal(imported.status,201,await imported.clone().text());
    const project=(await imported.json()).project,line=project.dialogueLines[0],audio=project.assets.find((a:any)=>a.id===line.audioAssetId),video=project.assets.find((a:any)=>a.id===project.scenes[0].videoAssetId);
    assert.notEqual(project.id,oldProject);assert.equal(line.sceneId,project.scenes[0].id);assert.equal(line.characterId,project.scenes[0].characterIds[0]);assert.equal(audio.speech.lineId,line.id);assert.equal(video.lipSync.lineId,line.id);assert.equal(video.lipSync.audioAssetId,audio.id);assert.equal(video.lipSync.dialogue.characterId,line.characterId);assert.equal(project.tracks[0].clips[0].dialogueLineId,line.id);assert(speechIsCurrent(project,line,audio));assert(lipSyncIsCurrent(project,line,video));
    const original=project.assets.find((a:any)=>a.id===video.lipSync.sourceAssetId);assert.equal(sha(Buffer.from(await (await fetch(f.base+original.url)).arrayBuffer())),sha(await readFile(f.source)));
  }finally{await f.close();}
});

test('local voices run serially and generated audio cannot be applied after a script revision',async()=>{
  const f=await fixture();try{
    const first=f.store.project.dialogueLines![0]!,second={...first,id:'second',text:'La función continúa.'};f.store.project.dialogueLines!.push(second);
    const submitted=await Promise.all([f.request('/api/speech/generate',f.params()),f.request('/api/speech/generate',{...f.params(),lineId:'second'})]);
    for(const response of submitted){assert.equal(response.status,202);const job=await f.wait((await response.json()).job.id);assert.equal(job.status,'completed',job.message);}
    const asset=f.store.project.assets.find(a=>a.speech?.lineId===first.id)!;f.store.project.scenes[0]!.dialogue+=' Otra frase.';assert(!speechIsCurrent(f.store.project,first,asset));assert.throws(()=>applyDialogueSubtitle(f.store.project,first.id,asset.id),/vigente/);
    const invalid=applyDialogueAudio({...f.store.project,scenes:f.store.project.scenes.map(s=>({...s,dialogue:'ELENA (susurra): Una más.'}))},first.id,asset.id);invalid.tracks![0]!.clips[0]!.dialogueLineId='missing';assert.throws(()=>validateEditingReferences(projectSchema.parse(invalid)),/intervención/);
  }finally{await f.close();}
});

test('a changed queued turn is rejected before inference while an already running turn remains valid',async()=>{
  const f=await fixture();try{
    const first=f.store.project.dialogueLines![0]!,second={...first,id:'queued-turn',text:'Mira la marquesina.'};f.store.project.dialogueLines!.push(second);
    const running=await f.request('/api/speech/generate',f.params()),firstJob=(await running.json()).job;
    for(let n=0;n<100&&!f.store.jobs.some(j=>j.message.startsWith('Interpretando'));n++)await new Promise(done=>setTimeout(done,5));
    const queued=await f.request('/api/speech/generate',{...f.params(),lineId:second.id}),secondJob=(await queued.json()).job;
    second.text='Texto corregido después de entrar en la cola.';
    assert.equal((await f.wait(firstJob.id)).status,'completed');const rejected=await f.wait(secondJob.id);assert.equal(rejected.status,'failed');assert.match(rejected.message,/esperaba en la cola/);assert(!f.store.project.assets.some(a=>a.speech?.lineId===second.id));
    assert.equal((await readFile(join(f.dir,'calls'),'utf8')).trim().split('\n').length,1);
  }finally{await f.close();}
});

test('runtime failures expose their actionable JSON message instead of progress stderr',async()=>{
  const f=await fixture();try{
    await writeFile(join(f.dir,'speech.cjs'),`if(process.argv[2]==='doctor'){console.log(JSON.stringify({ok:true,ready:true}));process.exit(0)}console.error(JSON.stringify({event:'progress',message:'Procesando'}));console.log(JSON.stringify({ok:false,error:'El diálogo supera 15 segundos: divide la intervención.',code:'DURATION_LIMIT'}));process.exit(1);`);
    const response=await f.request('/api/speech/generate',f.params()),job=await f.wait((await response.json()).job.id);assert.equal(job.status,'failed');assert.match(job.message,/supera 15 segundos: divide/);assert.doesNotMatch(job.message,/Procesando/);assert(!f.store.project.assets.some(a=>a.speech));
  }finally{await f.close();}
});

test('editing may retain out-of-range or detached dialogue, but generation waits for a valid link and time',async()=>{
  const f=await fixture();try{
    const project=structuredClone(f.store.project);project.dialogueLines![0]!.offset=10;project.scenes[0]!.characterIds=[];
    assert.equal((await f.request('/api/project',project,'PUT')).status,200);assert.equal((await f.request('/api/speech/generate',f.params())).status,400);
    f.store.project.dialogueLines![0]!.offset=0;assert.equal((await f.request('/api/speech/generate',f.params())).status,409);assert.equal(f.store.jobs.length,0);
  }finally{await f.close();}
});

function providerProject(voice:CharacterVoice=defaultDialogueVoice('kokoro')):Project {
  return {id:'voice-project',name:'Voces',logline:'Una prueba de continuidad',format:'16:9',fps:24,updatedAt:'2026-10-18T00:00:00Z',
    characters:[{id:'elena',name:'Elena',role:'Protagonista',description:'Proyeccionista',locked:true,voice}],
    scenes:[{id:'scene',title:'El ritual',description:'',dialogue:'ELENA: Una más.',prompt:'',negativePrompt:'',duration:2,seed:42,camera:'Fija',characterIds:['elena'],videoAssetId:'source'}],
    dialogueLines:[{id:'turn',sceneId:'scene',characterId:'elena',text:'Una más.',offset:0,delivery:'dialogue',sourceDialogue:dialogueSourceSignature('ELENA: Una más.')}],
    assets:[{id:'source',name:'Original',type:'video',url:'/api/media/source.mp4',mime:'video/mp4',size:100}]};
}
function attachProviderHistory(project:Project) {
  const line=project.dialogueLines![0]!,snapshot=dialogueSnapshot(project,line),digest='a'.repeat(64),createdAt='2026-10-18T00:00:00Z';
  const audio:Asset={id:'voice-result',name:'Interpretación',type:'audio',url:'/api/media/voice-result.wav',mime:'audio/wav',size:100,
    speech:{...snapshot,projectId:project.id,sceneId:line.sceneId,lineId:line.id,duration:1,sampleRate:24000,sourceFingerprint:digest,outputSha256:digest,createdAt,model:'verified-model'}};
  const video:Asset={id:'lip-result',name:'Copia sincronizada',type:'video',url:'/api/media/lip-result.mp4',mime:'video/mp4',size:100,
    lipSync:{projectId:project.id,sceneId:line.sceneId,lineId:line.id,sourceAssetId:'source',audioAssetId:audio.id,sourceSha256:digest,audioSha256:digest,outputSha256:digest,sourceFingerprint:digest,dialogue:snapshot,lineOffset:0,trimStart:0,speed:1,sceneDuration:2,duration:2,width:160,height:160,fps:25,frames:50,model:'musetalk-test',createdAt}};
  project.assets.push(audio,video);return {audio,video,line};
}

test('provider voice schema preserves old Kokoro and bounds identifiers, credentials and provider speeds',()=>{
  const old={engine:'kokoro',voiceId:'ef_dora',language:'es',speed:1};assert.deepEqual(characterVoiceSchema.parse(old),old);
  assert.deepEqual(characterVoiceSchema.parse({engine:'elevenlabs',voiceId:'account_voice-42',language:'es',speed:.7}),{engine:'elevenlabs',voiceId:'account_voice-42',modelId:'eleven_multilingual_v2',language:'es',speed:.7});
  assert(characterVoiceSchema.safeParse({...defaultDialogueVoice('qwen'),speed:1.3,referenceSha256:'b'.repeat(64)}).success);
  for(const engine of ['elevenlabs','qwen'] as const) {
    const voice=defaultDialogueVoice(engine);
    for(const voiceId of ['', '../secret', 'folder/voice','bad voice','voice\nheader','voice?key=value','a'.repeat(101)])assert(!characterVoiceSchema.safeParse({...voice,voiceId}).success,`${engine}: ${JSON.stringify(voiceId)}`);
    for(const forbidden of [{apiKey:'secret'},{token:'secret'},{endpoint:'https://other.test'},{modelPath:'/private/model'}])assert(!characterVoiceSchema.safeParse({...voice,...forbidden}).success);
    for(const speed of [.69,NaN,Infinity])assert(!characterVoiceSchema.safeParse({...voice,speed}).success);
  }
  assert(!characterVoiceSchema.safeParse({...defaultDialogueVoice('elevenlabs'),speed:1.21}).success);
  assert(!characterVoiceSchema.safeParse({...defaultDialogueVoice('elevenlabs'),modelId:'../../model'}).success);
  assert(!characterVoiceSchema.safeParse({...defaultDialogueVoice('qwen'),speed:1.31}).success);
  assert(!characterVoiceSchema.safeParse({...defaultDialogueVoice('qwen'),referenceSha256:'not-a-digest'}).success);
  assert(!characterVoiceSchema.safeParse({...old,language:'en'}).success);
  assert(!characterVoiceSchema.safeParse({...old,modelId:'unexpected'}).success);
  assert(!characterVoiceSchema.safeParse({...old,engine:'unsupported'}).success);
});

test('provider defaults do not invent an account voice or alter the existing Kokoro fingerprint',()=>{
  const first=defaultDialogueVoice('kokoro');first.speed=1.5;assert.equal(defaultDialogueVoice('kokoro').speed,1);
  assert.equal(defaultDialogueVoice('elevenlabs').voiceId,'pending-selection');assert.equal(defaultDialogueVoice('elevenlabs','my_voice').voiceId,'my_voice');
  assert.equal(defaultDialogueVoice('qwen').voiceId,'hermes-default');
  const project=providerProject(),line=project.dialogueLines![0]!,serialized=JSON.stringify(dialogueSnapshot(project,line));
  const legacy=JSON.stringify({text:'Una más.',sourceDialogue:line.sourceDialogue,delivery:'dialogue',voice:{engine:'kokoro',voiceId:'ef_dora',language:'es',speed:1},characterId:'elena',characterSnapshot:{name:'Elena',description:'Proyeccionista',continuity:{costume:'',appearance:'',props:'',notes:''}}});
  assert.equal(serialized,legacy);assert.equal(sha(Buffer.from(serialized)),sha(Buffer.from(legacy)));
  delete project.characters[0]!.voice;assert.deepEqual(dialogueVoice(project,line),defaultDialogueVoice('kokoro'));
});

test('provider, model, speaker and Hermes reference changes invalidate historical speech and lip sync without deleting copies',()=>{
  for(const voice of [defaultDialogueVoice('kokoro'),defaultDialogueVoice('elevenlabs','account-voice'),{...defaultDialogueVoice('qwen'),referenceSha256:'a'.repeat(64)}]) {
    const project=providerProject(voice),{audio,video,line}=attachProviderHistory(project),originals=structuredClone(project.assets);
    assert(speechIsCurrent(project,line,audio));assert(lipSyncIsCurrent(project,line,video));
    const changes:CharacterVoice[]=[{...voice,speed:1.1},voice.engine==='qwen'?defaultDialogueVoice('kokoro'):defaultDialogueVoice('qwen')];
    if(voice.engine==='elevenlabs')changes.push({...voice,modelId:'eleven_flash_v2_5'},{...voice,voiceId:'another-account-voice'});
    if(voice.engine==='qwen')changes.push({...voice,referenceSha256:'b'.repeat(64)},{...voice,voiceId:'another-reference'});
    for(const changed of changes) {
      project.characters[0]!.voice=changed;assert(!speechIsCurrent(project,line,audio));assert(!lipSyncIsCurrent(project,line,video));
      assert.throws(()=>applyDialogueAudio(project,line.id,audio.id),/ya no corresponde/);
    }
    project.characters[0]!.voice=voice;assert(speechIsCurrent(project,line,audio));assert(lipSyncIsCurrent(project,line,video));assert.deepEqual(project.assets,originals);
  }
});

for(const engine of ['kokoro','elevenlabs','qwen'] as const)test(`provider ${engine} survives movie JSON round trip with character, narration and immutable provenance`,()=>{
  const voice=defaultDialogueVoice(engine,engine==='elevenlabs'?'account-voice':undefined);if(voice.engine==='qwen')voice.referenceSha256='b'.repeat(64);
  const project=providerProject(voice),{audio,video,line}=attachProviderHistory(project);
  project.dialogueLines!.push({...line,id:'narrator',characterId:undefined,delivery:'voiceover',voice:structuredClone(voice)});
  const exported=JSON.stringify(project),restored=projectSchema.parse(JSON.parse(exported));validateEditingReferences(restored);
  assert.deepEqual(restored.characters[0]!.voice,voice);assert.deepEqual(restored.dialogueLines![1]!.voice,voice);
  assert.deepEqual(restored.assets.find(a=>a.id===audio.id)!.speech!.voice,voice);assert.deepEqual(restored.assets.find(a=>a.id===video.id)!.lipSync!.dialogue.voice,voice);
  assert(speechIsCurrent(restored,restored.dialogueLines![0]!,restored.assets.find(a=>a.id===audio.id)!));
  assert(lipSyncIsCurrent(restored,restored.dialogueLines![0]!,restored.assets.find(a=>a.id===video.id)!));
  assert.equal(JSON.stringify(project),exported);
});
