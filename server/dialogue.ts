import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {createVoiceReference,resolveVoiceReference,voiceProfileInput} from './voice-profiles.js';
import {createElevenLabsProvider} from './speech-providers.js';
import type {CharacterVoice} from '../src/types.js';
import type { Store } from './store.js';
import { faceROISchema, type Asset, type Job, type Project } from './types.js';
import { runProcess, parseJsonOutput } from './process.js';
import { enhancementSha256 } from './ai-enhance.js';
import { inspectEnhancementMedia } from './enhance.js';
import { dialogueScriptChanged, dialogueSnapshot, dialogueVoice, resolveLipSyncAsset, speechIsCurrent } from '../src/dialogue.js';

type Work=(signal:AbortSignal,update:(message:string,progress?:number,result?:Job['result'])=>void)=>Promise<Job['result']>;
type Context={app:Express;store:Store;root:string;dataDirectory:string;python:string;speechPath:string;lipSyncPath:string;qwenPath:string;credentialsDirectory?:string;providerFetch?:typeof fetch;ffmpeg:string;ffprobe:string;mediaPath:(asset:Asset)=>Promise<string>;enqueue:(type:Job['type'],message:string,work:Work,result?:Job['result'])=>Promise<Job>;currentTarget:(snapshot:Project)=>Promise<Project>;saveTarget:(target:Project)=>Promise<void>};
const route=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
const id=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const base=z.object({projectId:id,lineId:id}).strict();
const processFailure=(stdout:string,stderr:string,fallback:string)=>{try{const result=parseJsonOutput(stdout);if(result.ok===false||result.error)return new Error(String(result.message??result.error??fallback));}catch{}return new Error(stderr.slice(-1800)||fallback);};
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function audioInfo(path:string,ffprobe:string,signal?:AbortSignal){
  const probe=await runProcess(ffprobe,['-v','error','-show_streams','-show_format','-of','json',path],{signal,timeoutMs:30000});
  if(probe.code)throw new Error('No se pudo verificar el audio local.');
  const data=parseJsonOutput(probe.stdout),audio=data.streams?.find((s:any)=>s.codec_type==='audio');
  const duration=Number(audio?.duration??data.format?.duration),sampleRate=Number(audio?.sample_rate);
  if(!audio||!Number.isFinite(duration)||duration<=0||!sampleRate)throw new Error('El archivo de voz no contiene audio válido.');
  return {duration,sampleRate};
}

export function registerDialogueRoutes(c:Context){
  const eleven=createElevenLabsProvider({credentialsDirectory:c.credentialsDirectory,fetch:c.providerFetch});
  const setup=new Map<string,Promise<Job>>(),pending=new Map<string,Promise<Job>>();
  const pathFor=(kind:'speech'|'lipsync')=>kind==='speech'?c.speechPath:c.lipSyncPath;
  async function doctor(kind:'speech'|'lipsync'){
    try {const result=await runProcess(c.python,[pathFor(kind),'doctor','--json'],{cwd:c.root,timeoutMs:30000});return {...parseJsonOutput(result.stdout),gpuBusy:c.store.jobs.some(j=>['generate','enhance','lipsync','speech'].includes(j.type)&&j.status==='running')};}
    catch(error){return {ok:false,ready:false,installed:false,message:error instanceof Error?error.message:String(error)};}
  }
  async function qwenDoctor(){
    try{const result=await runProcess(c.python,[c.qwenPath,'doctor','--json'],{cwd:c.root,timeoutMs:30000});return parseJsonOutput(result.stdout)}
    catch{return {ok:false,ready:false,message:'No se pudo comprobar el modelo de voz de Hermes.'}}
  }
  async function requireReady(kind:'speech'|'lipsync',voice?:CharacterVoice,project?:Project){
    const state=kind==='speech'&&voice?.engine==='elevenlabs'?await eleven.status():kind==='speech'&&voice?.engine==='qwen'?await qwenDoctor():await doctor(kind);
    if(!(voice?.engine==='qwen'&&voice.referenceAssetId?(state.modelReady??state.ready):state.ready))throw fail(state.message??state.reason??`Prepara primero el motor de ${kind==='speech'?'voces':'sincronización labial'}.`,409);
    if(voice?.engine==='qwen'&&voice.referenceAssetId){if(!project)throw fail('No se encontró la película de esta voz.',409);await resolveVoiceReference(c,project,voice);}
    if(voice?.engine==='qwen'&&!voice.referenceAssetId&&(!voice.referenceSha256||voice.referenceSha256!==state.referenceSha256))throw fail(voice.referenceSha256?'La referencia de voz de Hermes cambió. Revísala y vuelve a vincularla al personaje.':'Vincula la referencia actual de Hermes al personaje antes de generar su voz.',409);
    return state;
  }
  c.app.post('/api/speech/qwen/profiles',route(async(req,res)=>{
    const input=voiceProfileInput.parse(req.body);
    if(input.projectId!==c.store.project.id)throw fail('El proyecto abierto cambió. Actualiza Filmma antes de continuar.',409);
    const snapshot=structuredClone(c.store.project),before=snapshot.characters.find(character=>character.id===input.characterId),prepared=await createVoiceReference(c,snapshot,input);let saved=false;
    try{
      const target=await c.currentTarget(snapshot),character=target.characters.find(item=>item.id===input.characterId);
      if(!character||JSON.stringify(character.voice)!==JSON.stringify(before?.voice))throw fail('La voz del personaje cambió mientras se preparaba la referencia. Vuelve a crearla para la selección actual.',409);
      if(target.assets.length>=2000)throw fail('La biblioteca alcanzó 2000 recursos.');
      if(!target.assets.some(asset=>asset.id===input.sourceAssetId&&asset.url===snapshot.assets.find(a=>a.id===input.sourceAssetId)?.url))throw fail('La referencia original cambió durante la preparación.',409);
      const previousVoice=character.voice;
      target.assets.push(prepared.asset);character.voice=prepared.voice;
      try{await c.saveTarget(target);saved=true;}
      catch(error){target.assets=target.assets.filter(asset=>asset.id!==prepared.asset.id);if(character.voice===prepared.voice)character.voice=previousVoice;throw error;}
      return res.status(201).json({project:target,asset:prepared.asset,voice:prepared.voice});
    }finally{if(!saved)await rm(prepared.outputPath,{force:true});}
  }));
  c.app.get('/api/speech/qwen',route(async(_req,res)=>res.json(await qwenDoctor())));
  c.app.get('/api/speech/elevenlabs',route(async(_req,res)=>{res.setHeader('Cache-Control','no-store');return res.json(await eleven.status())}));
  c.app.post('/api/speech/elevenlabs/connect',route(async(req,res)=>{
    const input=z.object({apiKey:z.string().trim().min(1).max(512)}).strict().safeParse(req.body);
    if(!input.success)throw fail('Introduce una clave API válida de ElevenLabs.');
    res.setHeader('Cache-Control','no-store');return res.json(await eleven.connect(input.data.apiKey));
  }));
  c.app.post('/api/speech/elevenlabs/disconnect',route(async(req,res)=>{z.object({}).strict().parse(req.body??{});await eleven.disconnect();res.setHeader('Cache-Control','no-store');return res.json(await eleven.status())}));
  c.app.post('/api/speech/elevenlabs/refresh',route(async(req,res)=>{z.object({}).strict().parse(req.body??{});res.setHeader('Cache-Control','no-store');return res.json(await eleven.status({refresh:true}))}));
  function snapshotFor(projectId:string,lineId:string){
    if(projectId!==c.store.project.id)throw fail('El proyecto abierto cambió. Actualiza Filmma antes de continuar.',409);
    const project=structuredClone(c.store.project),line=project.dialogueLines?.find(l=>l.id===lineId),scene=project.scenes.find(s=>s.id===line?.sceneId);
    if(!line||!scene)throw fail('No se encontró la intervención del guion.',404);
    if(line.offset>=scene.duration)throw fail('El inicio de la intervención queda fuera del plano. Ajusta su tiempo o amplía el plano.');
    if(line.characterId&&!scene.characterIds.includes(line.characterId))throw fail('Vincula el personaje a este plano antes de generar su interpretación.',409);
    if(!line.text.trim())throw fail('Escribe el texto que debe pronunciar la voz.');
    if(dialogueScriptChanged(project,line))throw fail('El guion cambió. Revisa y actualiza el vínculo de esta intervención antes de generar.',409);
    return {project,line,scene};
  }
  async function dedupe(key:string,create:()=>Promise<Job>){
    const existing=pending.get(key);if(existing){const job=await existing;if(['queued','running'].includes(job.status))return job;}
    const next=create();pending.set(key,next);try{return await next;}catch(error){if(pending.get(key)===next)pending.delete(key);throw error;}
  }
  for(const kind of ['speech','lipsync'] as const){
    c.app.get(`/api/${kind}`,route(async(_req,res)=>res.json(await doctor(kind))));
    c.app.post(`/api/${kind}/setup`,route(async(req,res)=>{
      z.object({}).strict().parse(req.body??{});
      const existing=setup.get(kind);if(existing){try{const job=await existing;if(['queued','running'].includes(job.status))return res.status(202).json({job});}catch{setup.delete(kind);}}
      // Heavy setup shares the same serial lane as all inference. MiniMax's
      // existing download remains on its independent transfer lane.
      const request=c.enqueue(kind,`Preparando ${kind==='speech'?'las voces locales':'la sincronización labial local'}…`,async(signal,update)=>{
        update('Descargando y comprobando el motor local…',5);
        const result=await runProcess(c.python,[pathFor(kind),'setup','--json'],{cwd:c.root,signal,timeoutMs:60*60*1000});
        if(result.code)throw processFailure(result.stdout,result.stderr,'No se pudo preparar el motor local.');
        const state=await doctor(kind);if(!state.ready)throw new Error(state.message??state.reason??'El motor todavía no está listo.');
        return {text:kind==='speech'?'Voces locales listas.':'Sincronización labial local lista.'};
      });setup.set(kind,request);res.status(202).json({job:await request});
    }));
  }
  c.app.post('/api/speech/generate',route(async(req,res)=>{
    const input=base.parse(req.body),{project,line,scene}=snapshotFor(input.projectId,input.lineId);
    const snapshot=dialogueSnapshot(project,line),sourceFingerprint=fingerprint(snapshot),voice=dialogueVoice(project,line);
    const job=await dedupe(`speech:${project.id}:${line.id}:${sourceFingerprint}`,async()=>{
      const connection=await requireReady('speech',voice,project);
      return c.enqueue('speech',`Preparando la voz de «${scene.title}»…`,async(signal,update)=>{
        const assetId=randomUUID(),outputPath=join(c.dataDirectory,'media',`${assetId}.wav`),work=join(c.dataDirectory,'work',`speech-${assetId}`);let saved=false;
        try {
          const latest=await c.currentTarget(project),latestLine=latest.dialogueLines?.find(l=>l.id===line.id),latestScene=latest.scenes.find(s=>s.id===scene.id);
          if(!latestLine||!latestScene||dialogueScriptChanged(latest,latestLine)||fingerprint(dialogueSnapshot(latest,latestLine))!==sourceFingerprint||latestLine.offset>=latestScene.duration||latestLine.characterId&&!latestScene.characterIds.includes(latestLine.characterId))throw new Error('El guion, la voz o el personaje cambió mientras esperaba en la cola. Vuelve a generar la intervención actual.');
          const state=await requireReady('speech',voice,latest);await mkdir(work,{recursive:true});
          update(voice.engine==='elevenlabs'?'Generando el diálogo en tu cuenta de ElevenLabs…':voice.engine==='qwen'?'Interpretando el diálogo con Qwen y la voz de referencia…':'Interpretando el diálogo con la voz del personaje…',12);
          let result:any;
          if(voice.engine==='elevenlabs'){
            result=await eleven.synthesize({text:line.text,voiceId:voice.voiceId,modelId:voice.modelId,language:voice.language,speed:voice.speed,outputPath,signal,expectedConnectionId:connection.connectionId});
          }else{
            const request=join(work,'request.json'),reference=voice.engine==='qwen'?await resolveVoiceReference(c,latest,voice):undefined;
            await writeFile(request,JSON.stringify({text:line.text,voiceId:voice.voiceId,language:voice.language,speed:voice.speed,outputPath,maxDurationSeconds:15,...(voice.engine==='qwen'?{expectedReferenceSha256:voice.referenceSha256??state.referenceSha256,...(reference?{referencePath:reference.path}:{})}:{})}),{flag:'wx',mode:0o600});
            const runtime=await runProcess(c.python,[voice.engine==='qwen'?c.qwenPath:c.speechPath,'synthesize','--request',request,'--json'],{cwd:c.root,signal,timeoutMs:15*60*1000});
            if(runtime.code)throw processFailure(runtime.stdout,runtime.stderr,'No se pudo generar la voz local.');
            result=parseJsonOutput(runtime.stdout);
          }
          if(result.ok===false)throw new Error(result.message??'El motor rechazó la voz.');
          const media=await audioInfo(outputPath,c.ffprobe,signal);if(media.duration>15.001)throw new Error('La voz supera 15 segundos. Divide la intervención o ajusta su velocidad; no se ha recortado.');
          const decode=await runProcess(c.ffmpeg,['-v','error','-xerror','-i',outputPath,'-f','null','-'],{signal,timeoutMs:30000});if(decode.code)throw new Error('La voz creada no supera la validación de audio.');
          const asset:Asset={id:assetId,name:`${project.characters.find(p=>p.id===line.characterId)?.name??'Narración'} · ${scene.title}`,type:'audio',url:`/api/media/${assetId}.wav`,mime:'audio/wav',size:(await stat(outputPath)).size,
            speech:{...snapshot,projectId:project.id,sceneId:scene.id,lineId:line.id,...media,sourceFingerprint,outputSha256:await enhancementSha256(outputPath),createdAt:new Date().toISOString(),model:String(result.model??(voice.engine==='elevenlabs'?voice.modelId:voice.engine==='qwen'?'qwen3-tts':'kokoro-82m-v1.0'))}};
          const target=await c.currentTarget(project);if(target.assets.length>=2000)throw new Error('La biblioteca alcanzó 2000 recursos.');
          const currentLine=target.dialogueLines?.find(l=>l.id===line.id),stale=!currentLine||!speechIsCurrent(target,currentLine,asset);
          if(signal.aborted)throw new Error('Trabajo cancelado.');target.assets.push(asset);await c.saveTarget(target);saved=true;
          return {projectId:project.id,sceneId:scene.id,lineId:line.id,assetId,url:asset.url,stale,text:stale?'Voz conservada en la biblioteca. El guion o el personaje cambió durante la generación.':'Voz lista para escuchar y aplicar. El montaje no se ha modificado.'};
        }finally{if(!saved)await rm(outputPath,{force:true});await rm(work,{recursive:true,force:true});}
      },{projectId:project.id,sceneId:scene.id,lineId:line.id});
    });res.status(202).json({job});
  }));
  c.app.post('/api/lipsync/generate',route(async(req,res)=>{
    const input=base.extend({sourceAssetId:id,audioAssetId:id,faceROI:faceROISchema.optional()}).strict().parse(req.body),{project,line,scene}=snapshotFor(input.projectId,input.lineId);
    if(line.delivery!=='dialogue'||!line.characterId)throw fail('La sincronización requiere un diálogo asignado a un personaje visible.');
    if(scene.duration>15)throw fail('La sincronización admite planos de hasta 15 segundos. Divide el plano antes de continuar.');
    if(scene.videoAssetId!==input.sourceAssetId)throw fail('La toma seleccionada cambió. Actualiza el plano antes de sincronizar.',409);
    const source=project.assets.find(a=>a.id===input.sourceAssetId),audio=project.assets.find(a=>a.id===input.audioAssetId);
    if(source?.type!=='video'||audio?.type!=='audio')throw fail('Selecciona una toma de video y una voz de la biblioteca.');
    const priorLip=resolveLipSyncAsset(project,source);if(priorLip?.lipSync&&priorLip.lipSync.lineId!==line.id)throw fail('Divide el plano o vuelve a la toma original: esta sincronización procesa una intervención. Así se conservan las voces anteriores.');
    if(line.audioAssetId&&line.audioAssetId!==audio.id)throw fail('La voz elegida para esta intervención cambió. Actualiza la selección antes de sincronizar.',409);
    if(!speechIsCurrent(project,line,audio))throw fail('La voz no corresponde al diálogo actual. Genera una voz actualizada.',409);
    const sourcePath=await c.mediaPath(source),audioPath=await c.mediaPath(audio),audioMedia=await audioInfo(audioPath,c.ffprobe);
    if(line.offset+audioMedia.duration>scene.duration+.001)throw fail('La voz rebasa el final del plano. Amplía el plano o divide el diálogo; no se recortará el audio.');
    const sourceMedia=await inspectEnhancementMedia(sourcePath,c.ffprobe,new AbortController().signal),trimStart=scene.trimStart??0,speed=scene.speed??1;
    const renderedDuration=Math.ceil((scene.duration-1e-9)*25)/25;
    if(trimStart+renderedDuration*speed>sourceMedia.duration+.001)throw fail('El video no cubre todo el plano con este recorte y velocidad. Elige una toma más larga o acorta el plano.');
    if(['smpte2084','arib-std-b67'].includes(sourceMedia.video.color_transfer))throw fail('La sincronización local admite video SDR. Conserva el original HDR y prepara una copia SDR explícita antes de continuar.');
    if(/(?:p|le|be)(?:10|12|14|16)|(?:10|12|14|16)(?:le|be)$/.test(String(sourceMedia.video.pix_fmt??'')))throw fail('La sincronización local admite fuentes de 8 bits. Prepara una copia SDR de 8 bits conservando el original.');
    const rotation=Number(sourceMedia.video.side_data_list?.find((side:any)=>side.rotation!=null)?.rotation??sourceMedia.video.tags?.rotate??0);if(Math.abs(rotation)%360!==0)throw fail('Aplica explícitamente la orientación del video en una copia antes de sincronizar. El original se conserva.');
    if(Math.abs(sourceMedia.sar-1)>.001)throw fail('La sincronización requiere píxeles cuadrados para conservar la proporción. Prepara una copia corregida sin reemplazar el original.');
    const snapshot=dialogueSnapshot(project,line),sourceFingerprint=fingerprint({dialogue:snapshot,sourceAssetId:source.id,audioAssetId:audio.id,trimStart,speed,duration:scene.duration,offset:line.offset,faceROI:input.faceROI});
    const job=await dedupe(`lipsync:${project.id}:${line.id}:${sourceFingerprint}`,async()=>{
      await requireReady('lipsync');
      return c.enqueue('lipsync',`Sincronizando los labios en «${scene.title}»…`,async(signal,update)=>{
        const assetId=randomUUID(),outputPath=join(c.dataDirectory,'media',`${assetId}.mp4`),work=join(c.dataDirectory,'work',`lipsync-${assetId}`),sidecar=join(c.dataDirectory,'media',`${assetId}.lipsync.json`),audit=join(c.dataDirectory,'dialogue',`${assetId}.lipsync.json`);let saved=false;
        try {
          const queuedTarget=await c.currentTarget(project),queuedLine=queuedTarget.dialogueLines?.find(l=>l.id===line.id),queuedScene=queuedTarget.scenes.find(s=>s.id===scene.id);
          if(!queuedLine||!queuedScene||!speechIsCurrent(queuedTarget,queuedLine,audio)||queuedLine.offset!==line.offset||queuedLine.audioAssetId&&queuedLine.audioAssetId!==audio.id||queuedScene.videoAssetId!==source.id||(queuedScene.trimStart??0)!==trimStart||(queuedScene.speed??1)!==speed||queuedScene.duration!==scene.duration)throw new Error('El plano o el diálogo cambió mientras esperaba en la cola. Vuelve a sincronizar la versión actual.');
          await requireReady('lipsync');await mkdir(work,{recursive:true});const request=join(work,'request.json'),padded=join(work,'dialogue.wav');
          const [sourceSha256,audioSha256]=await Promise.all([enhancementSha256(sourcePath),enhancementSha256(audioPath)]);
          if(audio.speech!.outputSha256!==audioSha256)throw new Error('El archivo de voz cambió en el disco. Genera una versión nueva.');
          const delay=Math.round(line.offset*1000),pad=await runProcess(c.ffmpeg,['-v','error','-i',audioPath,'-af',`adelay=${delay}:all=1,apad,atrim=duration=${scene.duration}`,'-ar','24000','-ac','1','-c:a','pcm_s16le',padded],{signal,timeoutMs:30000});
          if(pad.code)throw new Error('No se pudo colocar la voz en el tiempo del plano.');
          await writeFile(request,JSON.stringify({sourcePath,audioPath:padded,outputPath,trimStart,speed,duration:scene.duration,...(input.faceROI?{faceROI:input.faceROI}:{})}),{flag:'wx',mode:0o600});
          update('Animando la boca sobre una copia de la toma…',12);
          const runtime=await runProcess(c.python,[c.lipSyncPath,'render','--request',request,'--json'],{cwd:c.root,signal,timeoutMs:90*60*1000});
          if(runtime.code)throw processFailure(runtime.stdout,runtime.stderr,'La sincronización labial no pudo completarse.');
          const result=parseJsonOutput(runtime.stdout);if(result.ok===false)throw new Error(result.message??'El motor rechazó la sincronización.');
          const media=await inspectEnhancementMedia(outputPath,c.ffprobe,signal),renderedAudio=await audioInfo(outputPath,c.ffprobe,signal);
          if(media.width!==sourceMedia.width||media.height!==sourceMedia.height||Math.abs(media.fps-25)>.001||media.frames!==Math.round(renderedDuration*25)||Math.abs(media.duration-renderedDuration)>.002||Math.abs(renderedAudio.duration-scene.duration)>.1||media.duration>15.05)throw new Error('La copia sincronizada no conserva la resolución o la duración del plano.');
          const decode=await runProcess(c.ffmpeg,['-v','error','-xerror','-i',outputPath,'-f','null','-'],{signal,timeoutMs:60000});if(decode.code)throw new Error('La copia sincronizada no supera la verificación de video y audio.');
          if(sourceSha256!==await enhancementSha256(sourcePath)||audioSha256!==await enhancementSha256(audioPath))throw new Error('Una fuente cambió durante el proceso; la copia no se incorporó.');
          const asset:Asset={id:assetId,name:`${source.name} · labios`,type:'video',url:`/api/media/${assetId}.mp4`,mime:'video/mp4',size:(await stat(outputPath)).size,
            lipSync:{projectId:project.id,sceneId:scene.id,lineId:line.id,sourceAssetId:source.id,audioAssetId:audio.id,sourceSha256,audioSha256,outputSha256:await enhancementSha256(outputPath),sourceFingerprint,dialogue:snapshot,lineOffset:line.offset,trimStart,speed,sceneDuration:scene.duration,duration:media.duration,width:media.width,height:media.height,fps:media.fps,frames:media.frames,model:String(result.model??'musetalk-1.5-mlx'),modelRevision:result.modelRevision,codeRevision:result.codeRevision,createdAt:new Date().toISOString(),faceROI:input.faceROI,metrics:{elapsedSeconds:result.elapsedSeconds,peakMemoryBytes:result.peakMemoryBytes,mlxPeakMemoryBytes:result.mlxPeakMemoryBytes,mlxMemoryLimitBytes:result.mlxMemoryLimitBytes,memoryMeasurement:result.memoryMeasurement}}};
          const target=await c.currentTarget(project);if(target.assets.length>=2000)throw new Error('La biblioteca alcanzó 2000 recursos.');
          if(await stat(sidecar).catch(()=>undefined)){await mkdir(join(c.dataDirectory,'dialogue'),{recursive:true});await rename(sidecar,audit);}
          const latest=target.scenes.find(s=>s.id===scene.id),currentLine=target.dialogueLines?.find(l=>l.id===line.id);
          const stale=!currentLine||!!currentLine.audioAssetId&&currentLine.audioAssetId!==audio.id||!speechIsCurrent(target,currentLine,audio)||latest?.videoAssetId!==source.id||(latest?.trimStart??0)!==trimStart||(latest?.speed??1)!==speed||latest?.duration!==scene.duration||currentLine.offset!==line.offset;
          if(signal.aborted)throw new Error('Trabajo cancelado.');target.assets.push(asset);await c.saveTarget(target);saved=true;
          return {projectId:project.id,sceneId:scene.id,lineId:line.id,assetId,url:asset.url,stale,text:stale?'Copia conservada. El plano o diálogo cambió durante el proceso; no se ha aplicado.':'Copia lista para revisar. Al aplicarla, su voz sustituye el audio de la toma; el original se conserva.'};
        }finally{if(!saved){await rm(outputPath,{force:true});await rm(audit,{force:true});}await rm(sidecar,{force:true});await rm(work,{recursive:true,force:true});}
      },{projectId:project.id,sceneId:scene.id,lineId:line.id});
    });res.status(202).json({job});
  }));
}
