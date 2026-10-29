import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createApp} from '../server/app.js';
import {runProcess} from '../server/process.js';
import {applyDialogueAudio,applyDialogueSubtitle,defaultDialogueVoice,dialogueLinesFromScene,speechIsCurrent} from '../src/dialogue.js';

const KEY='sk_test_filmma_private_123456789',BAD_KEY='sk_test_filmma_rejected_987654321',REFERENCE='a'.repeat(64);
const digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const pcm=Buffer.alloc(24000);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i/24000*440*2*Math.PI)*3000),i*2);
function wav(){const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);}
async function until(condition:()=>boolean|Promise<boolean>){for(let n=0;n<500;n++){if(await condition())return;await new Promise(done=>setTimeout(done,10));}throw new Error('Timed out waiting for provider test');}

async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'filmma-provider-routes-')),data=join(directory,'data'),credentials=join(directory,'private-credentials');
  const qwenPath=join(directory,'qwen.cjs'),speechPath=join(directory,'kokoro.cjs'),referencePath=join(directory,'reference.json'),callsPath=join(directory,'runtime-calls.jsonl');
  await mkdir(join(data,'media'),{recursive:true});const originalPath=join(data,'media','original.wav');await writeFile(originalPath,wav());await writeFile(referencePath,JSON.stringify({referenceSha256:REFERENCE}));
  const localRuntime=(engine:string)=>`const fs=require('node:fs');const state=JSON.parse(fs.readFileSync(${JSON.stringify(referencePath)},'utf8'));if(process.argv[2]==='doctor'){console.log(JSON.stringify({ok:true,ready:true,engine:${JSON.stringify(engine)},model:${JSON.stringify(engine+'-test')},referenceSha256:state.referenceSha256}));process.exit(0)}const r=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--request')+1],'utf8'));fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify({engine:${JSON.stringify(engine)},...r})+'\\n');if(${JSON.stringify(engine)}==='qwen'&&r.expectedReferenceSha256!==state.referenceSha256){console.log(JSON.stringify({ok:false,error:'La referencia cambió antes de generar.'}));process.exit(1)}fs.copyFileSync(${JSON.stringify(originalPath)},r.outputPath);console.log(JSON.stringify({ok:true,model:${JSON.stringify(engine+'-test')}}));`;
  // The subprocess log is JSONL, not a shell command or a real model invocation.
  await writeFile(qwenPath,localRuntime('qwen'));await writeFile(speechPath,localRuntime('kokoro'));
  const calls:{path:string;method:string;body?:any}[]=[];let blocked:Promise<void>|undefined,release:(()=>void)|undefined;
  const providerFetch:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://api.elevenlabs.io');const headers=new Headers(init?.headers),key=headers.get('xi-api-key');
    calls.push({path:url.pathname,method:init?.method??'GET',...(init?.body?{body:JSON.parse(String(init.body))}:{})});
    if(key===BAD_KEY)return Response.json({detail:{message:`Rejected ${BAD_KEY}`}}, {status:401});
    assert.equal(key,KEY);
    if(url.pathname==='/v2/voices')return Response.json({voices:[{voice_id:'account-voice',name:`Voz ${KEY}`,category:'personal',labels:{language:'es'}}],has_more:false});
    if(url.pathname==='/v1/models')return Response.json([{model_id:'eleven_multilingual_v2',name:'Multilingual',can_do_text_to_speech:true,languages:[{language_id:'es'},{language_id:'en'}]},{model_id:'eleven_flash_v2_5',name:'Flash',can_do_text_to_speech:true,languages:[{language_id:'es'}]}]);
    if(url.pathname==='/v1/user/subscription')return Response.json({tier:'creator',character_count:10,character_limit:1000});
    if(url.pathname.startsWith('/v1/text-to-speech/')){
      assert.equal(url.searchParams.get('output_format'),'pcm_24000');
      if(blocked)await Promise.race([blocked,new Promise<never>((_resolve,reject)=>{if(init?.signal?.aborted)reject(new Error('aborted'));else init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})]);
      return Response.json({audio_base64:pcm.toString('base64'),alignment:{characters:Array.from(JSON.parse(String(init?.body)).text),character_start_times_seconds:Array.from(JSON.parse(String(init?.body)).text,(_c,i)=>.05+i*.35/Array.from(JSON.parse(String(init?.body)).text).length),character_end_times_seconds:Array.from(JSON.parse(String(init?.body)).text,(_c,i)=>.05+(i+1)*.35/Array.from(JSON.parse(String(init?.body)).text).length)}},{headers:{'request-id':'fixture-request-id'}});
    }
    throw new Error(`Unexpected mocked provider route ${url.pathname}`);
  };
  const app=await createApp({dataDirectory:data,credentialsDirectory:credentials,qwenPath,speechPath,python:process.execPath,providerFetch,skipDiagnostics:true});
  app.store.project.scenes=app.store.project.scenes.slice(0,1);const scene=app.store.project.scenes[0]!;scene.dialogue='ELENA: Una más.';scene.duration=2;scene.assetId=undefined;scene.endAssetId=undefined;scene.videoAssetId=undefined;scene.characterIds=['elena'];
  app.store.project.characters=app.store.project.characters.filter(c=>c.id==='elena');app.store.project.characters[0]!.assetId=undefined;app.store.project.characters[0]!.voice=defaultDialogueVoice('elevenlabs','account-voice');
  app.store.project.assets=[{id:'original',name:'Original conservado',type:'audio',url:'/api/media/original.wav',mime:'audio/wav',size:wav().length}];
  app.store.project.dialogueLines=dialogueLinesFromScene(app.store.project,scene.id);await app.store.save();
  const server=app.app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  const post=(path:string,body:unknown={},method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:JSON.stringify(body)});
  const wait=async(id:string)=>{await until(()=>app.store.jobs.some(j=>j.id===id&&['completed','failed','cancelled'].includes(j.status)));return app.store.jobs.find(j=>j.id===id)!};
  return {...app,directory,data,credentials,base,post,wait,calls,callsPath,originalPath,referencePath,params:()=>({projectId:app.store.project.id,lineId:app.store.project.dialogueLines![0]!.id}),
    connect:()=>post('/api/speech/elevenlabs/connect',{apiKey:KEY}),
    block:()=>{blocked=new Promise<void>(done=>{release=done});},release:()=>{release?.();blocked=undefined;},
    close:async()=>{release?.();await app.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(directory,{recursive:true,force:true});}};
}

test('provider routes validate connection and return a secret-free catalog with private credentials outside the movie',async()=>{
  const f=await fixture();try{
    const empty=await fetch(f.base+'/api/speech/elevenlabs');assert.equal((await empty.json()).configured,false);
    const connected=await f.connect();assert.equal(connected.status,200);assert.equal(connected.headers.get('cache-control'),'no-store');const connectedText=await connected.text();assert(!connectedText.includes(KEY));assert(!connectedText.includes('apiKey'));assert.equal(JSON.parse(connectedText).ready,true);
    assert.equal((await stat(join(f.credentials,'elevenlabs.json'))).mode&0o777,0o600);assert.equal((await stat(f.credentials)).mode&0o777,0o700);
    const status=await fetch(f.base+'/api/speech/elevenlabs');assert.equal(status.headers.get('cache-control'),'no-store');assert(!(await status.text()).includes(KEY));
    assert.equal((await f.post('/api/speech/elevenlabs/refresh')).status,200);assert(!(await readFile(join(f.data,'project.json'),'utf8')).includes(KEY));assert(!(await readFile(join(f.data,'jobs.json'),'utf8')).includes(KEY));
    const disconnected=await f.post('/api/speech/elevenlabs/disconnect');assert.equal((await disconnected.json()).configured,false);assert.equal((await f.post('/api/speech/generate',f.params())).status,409);
    assert.equal(f.calls.filter(c=>c.path.startsWith('/v1/text-to-speech/')).length,0);
  }finally{await f.close();}
});

test('ElevenLabs route creates a separate linked voice and project export/import preserves bytes and provenance without credentials',async()=>{
  const f=await fixture();try{
    assert.equal((await f.connect()).status,200);const before=structuredClone(f.store.project.scenes),original=digest(await readFile(f.originalPath));
    const submitted=await f.post('/api/speech/generate',f.params());assert.equal(submitted.status,202);const job=await f.wait((await submitted.json()).job.id);assert.equal(job.status,'completed',job.message);
    const asset=f.store.project.assets.find(a=>a.id===job.result?.assetId)!,line=f.store.project.dialogueLines![0]!;assert.equal(asset.speech?.voice.engine,'elevenlabs');assert.equal(asset.speech?.model,'eleven_multilingual_v2');assert.equal(asset.speech?.duration,.5);assert(speechIsCurrent(f.store.project,line,asset));assert.deepEqual(f.store.project.scenes,before);assert.equal(digest(await readFile(f.originalPath)),original);
    const requests=f.calls.filter(c=>c.path.startsWith('/v1/text-to-speech/'));assert.equal(requests.length,1);assert.equal(requests[0]!.body.text,line.text);assert.equal(requests[0]!.body.model_id,'eleven_multilingual_v2');assert.equal(requests[0]!.body.voice_settings.speed,1);
    const edited=applyDialogueSubtitle(applyDialogueAudio(f.store.project,line.id,asset.id),line.id,asset.id);assert.equal((await f.post('/api/project',edited,'PUT')).status,200);
    const exported=await f.post('/api/export',{format:'project'}),archive=await f.wait((await exported.json()).job.id);assert.equal(archive.status,'completed',archive.message);
    const downloaded=Buffer.from(await (await fetch(f.base+archive.result!.url)).arrayBuffer()),archivePath=join(f.directory,'movie.zip');await writeFile(archivePath,downloaded);
    const content=await runProcess('unzip',['-p',archivePath,'project.json']);assert.equal(content.code,0);assert(!content.stdout.includes(KEY));assert(!content.stdout.includes('apiKey'));assert(!content.stdout.includes(f.credentials));
    const manifest=JSON.parse(content.stdout);assert.equal(manifest.project.assets.find((a:any)=>a.id===asset.id).speech.voice.engine,'elevenlabs');assert.equal(manifest.project.assets.find((a:any)=>a.id===asset.id).speech.alignment.source,'elevenlabs');assert.equal(edited.subtitleCues![0]!.start,.05);assert(Math.abs(edited.subtitleCues![0]!.end-.4)<1e-9);
    const form=new FormData();form.append('projectFile',new Blob([new Uint8Array(downloaded)]),'voices.filmma.zip');const imported=await fetch(f.base+'/api/projects/import',{method:'POST',headers:{'X-Filmma-Client':'filmma'},body:form});assert.equal(imported.status,201,await imported.clone().text());
    const project=(await imported.json()).project,importedLine=project.dialogueLines[0],importedAudio=project.assets.find((a:any)=>a.id===importedLine.audioAssetId);assert(speechIsCurrent(project,importedLine,importedAudio));assert.equal(project.tracks[0].clips[0].dialogueLineId,importedLine.id);assert.equal(project.subtitleCues[0].characterId,importedLine.characterId);
    assert.equal(digest(Buffer.from(await (await fetch(f.base+importedAudio.url)).arrayBuffer())),asset.speech!.outputSha256);assert.equal(digest(await readFile(f.originalPath)),original);
  }finally{await f.close();}
});

test('rejected credentials and unavailable voice, model or language never leak secrets or send paid synthesis',async()=>{
  const f=await fixture();try{
    const invalid=await f.post('/api/speech/elevenlabs/connect',{apiKey:BAD_KEY});assert.equal(invalid.status,401);assert(!(await invalid.text()).includes(BAD_KEY));assert.equal((await (await fetch(f.base+'/api/speech/elevenlabs')).json()).configured,false);
    const malformed=await f.post('/api/speech/elevenlabs/connect',{apiKey:KEY,endpoint:`https://evil.test/${KEY}`});assert.equal(malformed.status,400);assert(!(await malformed.text()).includes(KEY));
    await f.connect();for(const voice of [{...defaultDialogueVoice('elevenlabs','not-in-account')},{...defaultDialogueVoice('elevenlabs','account-voice'),modelId:'unknown_model'},{...defaultDialogueVoice('elevenlabs','account-voice'),modelId:'eleven_flash_v2_5',language:'en' as const}]){
      f.store.project.characters[0]!.voice=voice;const submitted=await f.post('/api/speech/generate',f.params());assert.equal(submitted.status,202);const job=await f.wait((await submitted.json()).job.id);assert.equal(job.status,'failed');assert(!job.message.includes(KEY));
    }
    assert.equal(f.calls.filter(c=>c.path.startsWith('/v1/text-to-speech/')).length,0);assert.equal(f.store.project.assets.length,1);assert.deepEqual(await readdir(join(f.data,'media')),['original.wav']);
  }finally{await f.close();}
});

test('Qwen routes use the Hermes adapter and expected reference while retaining Kokoro routing',async()=>{
  const f=await fixture();try{
    const doctor=await fetch(f.base+'/api/speech/qwen');assert.equal((await doctor.json()).referenceSha256,REFERENCE);
    f.store.project.characters[0]!.voice={...defaultDialogueVoice('qwen'),referenceSha256:REFERENCE};const submitted=await f.post('/api/speech/generate',f.params());assert.equal(submitted.status,202);const qwen=await f.wait((await submitted.json()).job.id);assert.equal(qwen.status,'completed',qwen.message);
    const asset=f.store.project.assets.find(a=>a.id===qwen.result?.assetId)!;assert.equal(asset.speech?.model,'qwen-test');assert.deepEqual(asset.speech?.voice,f.store.project.characters[0]!.voice);
    let calls=(await readFile(f.callsPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(calls[0].engine,'qwen');assert.equal(calls[0].expectedReferenceSha256,REFERENCE);
    await writeFile(f.referencePath,JSON.stringify({referenceSha256:'b'.repeat(64)}));const stale=await f.post('/api/speech/generate',f.params());assert.equal(stale.status,409);assert.match((await stale.json()).error,/referencia de voz de Hermes cambió/);
    f.store.project.characters[0]!.voice=defaultDialogueVoice('kokoro');const oldEngine=await f.post('/api/speech/generate',f.params());const kokoro=await f.wait((await oldEngine.json()).job.id);assert.equal(kokoro.status,'completed',kokoro.message);
    calls=(await readFile(f.callsPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(calls.map(c=>c.engine),['qwen','kokoro']);assert.equal(calls[1].expectedReferenceSha256,undefined);assert.equal(f.calls.length,0);assert.equal(digest(await readFile(f.originalPath)),digest(wav()));
  }finally{await f.close();}
});

test('Qwen requires an explicitly linked Hermes reference before generating an unpinned legacy voice',async()=>{
  const f=await fixture();try{
    f.store.project.characters[0]!.voice=defaultDialogueVoice('qwen');const before=structuredClone(f.store.project);
    const submitted=await f.post('/api/speech/generate',f.params());assert.equal(submitted.status,409);assert.match((await submitted.json()).error,/referencia/i);
    assert.deepEqual(f.store.project,before);assert.equal(f.store.jobs.length,0);assert.equal(await readFile(f.callsPath,'utf8').catch(()=>''),'');assert.equal(f.calls.length,0);assert.equal(digest(await readFile(f.originalPath)),digest(wav()));
  }finally{await f.close();}
});

test('mixed provider queue deduplicates cloud requests and rechecks Hermes reference before a queued local inference',async()=>{
  const f=await fixture();try{
    await f.connect();f.block();const first=await f.post('/api/speech/generate',f.params()),firstJob=(await first.json()).job;await until(()=>f.calls.some(c=>c.path.startsWith('/v1/text-to-speech/')));
    const duplicate=await f.post('/api/speech/generate',f.params());assert.equal((await duplicate.json()).job.id,firstJob.id);
    const second={...f.store.project.dialogueLines![0]!,id:'local-turn',characterId:undefined,delivery:'voiceover' as const,voice:{...defaultDialogueVoice('qwen'),referenceSha256:REFERENCE}};f.store.project.dialogueLines!.push(second);
    const queued=await f.post('/api/speech/generate',{...f.params(),lineId:second.id});assert.equal(queued.status,202);const localJob=(await queued.json()).job;assert.equal(f.store.jobs.find(j=>j.id===localJob.id)!.status,'queued');
    await writeFile(f.referencePath,JSON.stringify({referenceSha256:'b'.repeat(64)}));f.release();assert.equal((await f.wait(firstJob.id)).status,'completed');const failed=await f.wait(localJob.id);assert.equal(failed.status,'failed');assert.match(failed.message,/referencia de voz de Hermes cambió/);
    assert.equal(f.calls.filter(c=>c.path.startsWith('/v1/text-to-speech/')).length,1);assert(!f.store.project.assets.some(a=>a.speech?.lineId===second.id));assert.equal(await readFile(f.callsPath,'utf8').catch(()=>''),'');
  }finally{await f.close();}
});

test('cancelling a cloud voice sends no retry and publishes no partial audio',async()=>{
  const f=await fixture();try{
    await f.connect();f.block();const submitted=await f.post('/api/speech/generate',f.params()),job=(await submitted.json()).job;await until(()=>f.calls.some(c=>c.path.startsWith('/v1/text-to-speech/')));
    assert.equal((await f.post(`/api/jobs/${job.id}/cancel`)).status,200);await until(()=>f.store.jobs.find(j=>j.id===job.id)?.message==='Trabajo cancelado.');assert.equal((await f.wait(job.id)).status,'cancelled');
    assert.equal(f.store.project.assets.length,1);assert.deepEqual(await readdir(join(f.data,'media')),['original.wav']);assert.equal(f.calls.filter(c=>c.path.startsWith('/v1/text-to-speech/')).length,1);assert(!(await readFile(join(f.data,'jobs.json'),'utf8')).includes(KEY));
  }finally{await f.close();}
});

test('reconnecting ElevenLabs invalidates queued cloud work before it can consume the new connection',async()=>{
  const f=await fixture();try{
    const originalConnection=(await (await f.connect()).json()).connectionId;f.block();const first=await f.post('/api/speech/generate',f.params()),firstJob=(await first.json()).job;await until(()=>f.calls.some(c=>c.path.startsWith('/v1/text-to-speech/')));
    const second={...f.store.project.dialogueLines![0]!,id:'queued-cloud',text:'Otra intervención.'};f.store.project.dialogueLines!.push(second);
    const queued=await f.post('/api/speech/generate',{...f.params(),lineId:second.id});assert.equal(queued.status,202);const queuedJob=(await queued.json()).job;assert.equal(f.store.jobs.find(j=>j.id===queuedJob.id)!.status,'queued');
    const nextConnection=(await (await f.connect()).json()).connectionId;assert.notEqual(nextConnection,originalConnection);f.release();
    assert.equal((await f.wait(firstJob.id)).status,'failed');const failed=await f.wait(queuedJob.id);assert.equal(failed.status,'failed');assert.match(failed.message,/cuenta de ElevenLabs cambió/);
    assert.equal(f.calls.filter(c=>c.path.startsWith('/v1/text-to-speech/')).length,1);assert.equal(f.store.project.assets.length,1);assert.deepEqual(await readdir(join(f.data,'media')),['original.wav']);
  }finally{await f.close();}
});
