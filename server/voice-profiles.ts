import {randomUUID} from 'node:crypto';
import {mkdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {Asset,Project} from './types.js';
import type {QwenVoice} from '../src/types.js';
import {runProcess,parseJsonOutput} from './process.js';
import {enhancementSha256} from './ai-enhance.js';

const id=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const voiceProfileInput=z.object({projectId:id,characterId:id,sourceAssetId:id,start:z.number().min(0).max(86400),duration:z.number().min(3).max(30),name:z.string().trim().min(1).max(200).optional()}).strict();
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
type Context={dataDirectory:string;ffmpeg:string;ffprobe:string;mediaPath:(asset:Asset)=>Promise<string>};

/** A movie owns immutable, portable reference audio; Hermes is never reconfigured. */
export async function createVoiceReference(c:Context,project:Project,input:z.infer<typeof voiceProfileInput>){
  const character=project.characters.find(item=>item.id===input.characterId),source=project.assets.find(item=>item.id===input.sourceAssetId);
  if(!character)throw fail('El personaje ya no está en esta película.',404);
  if(source?.type!=='audio')throw fail('Selecciona un audio de referencia de la biblioteca.');
  if(project.assets.length>=2000)throw fail('La biblioteca alcanzó 2000 recursos.');
  const sourcePath=await c.mediaPath(source),originalSha=await enhancementSha256(sourcePath);
  const probe=await runProcess(c.ffprobe,['-v','error','-show_streams','-show_format','-of','json',sourcePath],{timeoutMs:30000});
  if(probe.code)throw fail('No se pudo leer el audio de referencia.');
  const info=parseJsonOutput(probe.stdout),stream=info.streams?.find((item:any)=>item.codec_type==='audio'),duration=Number(stream?.duration??info.format?.duration);
  if(!stream||!Number.isFinite(duration)||input.start+input.duration>duration+.001)throw fail('El fragmento elegido supera la duración real del audio. Ajusta su inicio o su duración.');
  const assetId=randomUUID(),outputPath=join(c.dataDirectory,'media',`${assetId}.wav`);await mkdir(join(c.dataDirectory,'media'),{recursive:true});
  try{
    const normalized=await runProcess(c.ffmpeg,['-hide_banner','-nostdin','-v','error','-n','-i',sourcePath,'-ss',String(input.start),'-t',String(input.duration),'-map','0:a:0','-vn','-ar','24000','-ac','1','-c:a','pcm_s16le',outputPath],{timeoutMs:60000});
    if(normalized.code)throw fail('No se pudo preparar la referencia. El audio original se conserva.');
    const checked=await runProcess(c.ffprobe,['-v','error','-show_streams','-of','json',outputPath],{timeoutMs:30000}),audio=parseJsonOutput(checked.stdout).streams?.[0];
    if(checked.code||audio?.codec_name!=='pcm_s16le'||audio.channels!==1||Number(audio.sample_rate)!==24000||Math.abs(Number(audio.duration)-input.duration)>.001)throw fail('La copia de referencia no conserva el fragmento solicitado.');
    const decoded=await runProcess(c.ffmpeg,['-hide_banner','-nostdin','-v','info','-xerror','-i',outputPath,'-af','volumedetect','-f','null','-'],{timeoutMs:30000});
    const mean=Number(/mean_volume:\s*([-\w.]+)\s*dB/.exec(decoded.stderr)?.[1]);
    if(decoded.code||!Number.isFinite(mean)||mean< -55)throw fail('La referencia está en silencio o demasiado baja. Elige una grabación con voz clara.');
    if(await enhancementSha256(sourcePath)!==originalSha)throw fail('El audio original cambió durante la preparación. Vuelve a seleccionar la referencia.',409);
    const outputSha256=await enhancementSha256(outputPath),name=input.name??`Voz de ${character.name}`;
    const asset:Asset={id:assetId,name:`${name} · referencia`,type:'audio',url:`/api/media/${assetId}.wav`,mime:'audio/wav',size:(await stat(outputPath)).size,
      voiceReference:{projectId:project.id,characterId:character.id,sourceAssetId:source.id,sourceSha256:originalSha,outputSha256,start:input.start,duration:input.duration,sampleRate:24000,createdAt:new Date().toISOString(),name}};
    const prior=character.voice,voice:QwenVoice={engine:'qwen',voiceId:`profile-${asset.id}`,language:prior?.language??'es',speed:prior?.engine==='qwen'?prior.speed:1,referenceAssetId:asset.id,referenceSha256:outputSha256};
    return {asset,voice,outputPath};
  }catch(error){await rm(outputPath,{force:true});throw error;}
}

export async function resolveVoiceReference(c:Pick<Context,'mediaPath'>,project:Project,voice:QwenVoice){
  if(!voice.referenceAssetId){if(voice.voiceId!=='hermes-default')throw fail('El perfil de voz Qwen no tiene una referencia conservada en esta película.',409);return undefined;}
  const asset=project.assets.find(item=>item.id===voice.referenceAssetId),meta=asset?.voiceReference;
  if(asset?.type!=='audio'||!meta||meta.projectId!==project.id||voice.voiceId!==`profile-${asset.id}`||voice.referenceSha256!==meta.outputSha256)throw fail('La referencia de este personaje ya no coincide con su perfil de voz. Selecciónala de nuevo.',409);
  const path=await c.mediaPath(asset);
  if(await enhancementSha256(path)!==meta.outputSha256)throw fail('La referencia de voz cambió en el disco. Crea una copia nueva a partir del original conservado.',409);
  return {path,sha256:meta.outputSha256};
}
