import {speechBounds} from './elevenlabs';
import type { Asset, CharacterVoice, DialogueEngine, DialogueLine, DialogueSnapshot, ElevenLabsVoice, KokoroVoice, Project, QwenVoice } from './types';
import { resolveContinuity } from './continuity';

export const DIALOGUE_VOICES = [
  {id:'ef_dora',name:'Dora',language:'es'}, {id:'em_alex',name:'Alex',language:'es'}, {id:'em_santa',name:'Santa',language:'es'},
  {id:'af_heart',name:'Heart',language:'en'}, {id:'am_michael',name:'Michael',language:'en'},
] as const;
export const DIALOGUE_ENGINES = [
  {id:'kokoro',name:'Kokoro local',minSpeed:.5,maxSpeed:2},
  {id:'elevenlabs',name:'ElevenLabs',minSpeed:.7,maxSpeed:1.2},
  {id:'qwen',name:'Qwen · Hermes local',minSpeed:.7,maxSpeed:1.3},
] as const;
export const DEFAULT_DIALOGUE_VOICE:KokoroVoice={engine:'kokoro',voiceId:'ef_dora',language:'es',speed:1};
export const ELEVENLABS_DEFAULT_MODEL='eleven_multilingual_v2';
export function defaultDialogueVoice(engine:'kokoro'):KokoroVoice;
export function defaultDialogueVoice(engine:'elevenlabs',voiceId?:string):ElevenLabsVoice;
export function defaultDialogueVoice(engine:'qwen',voiceId?:string):QwenVoice;
export function defaultDialogueVoice(engine:DialogueEngine,voiceId?:string):CharacterVoice;
export function defaultDialogueVoice(engine:DialogueEngine,voiceId?:string):CharacterVoice {
  if(engine==='elevenlabs')return {engine,voiceId:voiceId??'pending-selection',modelId:ELEVENLABS_DEFAULT_MODEL,language:'es',speed:1};
  if(engine==='qwen')return {engine,voiceId:voiceId??'hermes-default',language:'es',speed:1};
  return {...DEFAULT_DIALOGUE_VOICE};
}

import { dialogueSourceSignature } from './subtitles';
export { dialogueSourceSignature } from './subtitles';

export function dialogueVoice(project:Project,line:DialogueLine):CharacterVoice {
  return line.characterId ? project.characters.find(c=>c.id===line.characterId)?.voice??DEFAULT_DIALOGUE_VOICE : line.voice??DEFAULT_DIALOGUE_VOICE;
}
export function dialogueSnapshot(project:Project,line:DialogueLine):DialogueSnapshot {
  const character=project.characters.find(c=>c.id===line.characterId);
  return {text:line.text,...(line.direction?{direction:line.direction}:{}),sourceDialogue:line.sourceDialogue,delivery:line.delivery,voice:{...dialogueVoice(project,line)},
    ...(character?{characterId:character.id,characterSnapshot:{name:character.name,description:character.description,referenceAssetId:character.assetId,continuity:resolveContinuity(project,line.sceneId,character.id)?.values??character.continuity}}:{})};
}
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export function dialogueScriptChanged(project:Project,line:DialogueLine):boolean {
  const scene=project.scenes.find(s=>s.id===line.sceneId);
  return !scene||line.sourceDialogue!==dialogueSourceSignature(scene.dialogue);
}
export function speechIsCurrent(project:Project,line:DialogueLine,asset:Asset):boolean {
  const speech=asset.speech;
  const scene=project.scenes.find(s=>s.id===line.sceneId);if(!scene||line.characterId&&!scene.characterIds.includes(line.characterId))return false;
  if(!speech||speech.projectId!==project.id||speech.sceneId!==line.sceneId||speech.lineId!==line.id||dialogueScriptChanged(project,line))return false;
  const currentVoice=dialogueVoice(project,line);
  if(currentVoice.engine==='qwen'&&currentVoice.referenceAssetId){const reference=project.assets.find(a=>a.id===currentVoice.referenceAssetId);if(reference?.type!=='audio'||reference.voiceReference?.projectId!==project.id||reference.voiceReference?.outputSha256!==currentVoice.referenceSha256)return false;}
  const {text,direction,sourceDialogue,delivery,voice,characterId,characterSnapshot}=speech;
  return canonical({text,...(direction?{direction}:{}),sourceDialogue,delivery,voice,characterId,characterSnapshot})===canonical(dialogueSnapshot(project,line));
}
export function resolveLipSyncAsset(project:Project,asset:Asset):Asset|undefined {
  const visited=new Set<string>();let current:Asset|undefined=asset;
  while(current&&!visited.has(current.id)){visited.add(current.id);if(current.lipSync)return current;current=current.enhancement?project.assets.find(a=>a.id===current!.enhancement!.sourceAssetId&&a.type==='video'):undefined;}
  return undefined;
}
export function lipSyncIsCurrent(project:Project,line:DialogueLine,asset:Asset):boolean {
  const original=resolveLipSyncAsset(project,asset),meta=original?.lipSync,scene=project.scenes.find(s=>s.id===line.sceneId),audio=project.assets.find(a=>a.id===meta?.audioAssetId);
  if(!meta||!scene||meta.projectId!==project.id||meta.sceneId!==line.sceneId||meta.lineId!==line.id||dialogueScriptChanged(project,line))return false;
  if(canonical(meta.dialogue)!==canonical(dialogueSnapshot(project,line))||meta.lineOffset!==line.offset||meta.sceneDuration!==scene.duration)return false;
  if(line.audioAssetId&&line.audioAssetId!==meta.audioAssetId)return false;
  if(audio?.speech&&!speechIsCurrent(project,line,audio))return false;
  const selected=project.assets.find(a=>a.id===scene.videoAssetId),selectedOriginal=selected&&resolveLipSyncAsset(project,selected);
  const sameCopy=(scene.videoAssetId===asset.id||selectedOriginal?.id===original?.id)&&(scene.trimStart??0)===0&&(scene.speed??1)===1;
  return sameCopy||(scene.videoAssetId===meta.sourceAssetId&&(scene.trimStart??0)===meta.trimStart&&(scene.speed??1)===meta.speed);
}
export function applyDialogueAudio(project:Project,lineId:string,assetId:string):Project {
  const line=project.dialogueLines?.find(l=>l.id===lineId),asset=project.assets.find(a=>a.id===assetId);
  if(!line||!asset||asset.type!=='audio'||!speechIsCurrent(project,line,asset))throw new Error('La voz ya no corresponde al diálogo, al guion o al personaje. Genera una versión actualizada.');
  const scene=project.scenes.find(s=>s.id===line.sceneId)!;
  const selected=project.assets.find(a=>a.id===scene.videoAssetId),lip=selected&&resolveLipSyncAsset(project,selected);
  if(lip?.lipSync?.lineId===line.id)throw new Error('La toma sincronizada ya contiene la voz de esta intervención. Restaura la toma original antes de añadir una voz separada.');
  if(line.offset+asset.speech!.duration>scene.duration+.001)throw new Error('La voz supera la duración del plano. Amplía el plano o divide la intervención; no se recortará el audio.');
  const next=structuredClone(project);next.dialogueLines!.find(l=>l.id===lineId)!.audioAssetId=assetId;
  for(const track of next.tracks??[])track.clips=track.clips.filter(c=>c.dialogueLineId!==lineId);
  let track=next.tracks?.find(t=>t.type==='audio'&&t.id==='filmma-dialogue');
  if(!track){if((next.tracks?.length??0)>=8)throw new Error('El editor admite ocho pistas. Libera una pista para incorporar la voz.');track={id:'filmma-dialogue',name:'Voces del guion',type:'audio',muted:false,volume:1,clips:[]};(next.tracks??=[]).push(track);}
  if((next.tracks??[]).reduce((sum,item)=>sum+item.clips.length,0)>=500)throw new Error('El montaje alcanzó 500 clips adicionales. Libera un clip antes de incorporar la voz.');
  track.clips.push({id:crypto.randomUUID(),assetId,dialogueLineId:lineId,sceneId:line.sceneId,offset:line.offset,duration:asset.speech!.duration,trimStart:0,volume:1,muted:false});
  return next;
}
export function applyLipSyncTake(project:Project,lineId:string,assetId:string):Project {
  const line=project.dialogueLines?.find(l=>l.id===lineId),asset=project.assets.find(a=>a.id===assetId);
  if(!line||!asset||asset.type!=='video'||!lipSyncIsCurrent(project,line,asset))throw new Error('La sincronización pertenece a otra versión del plano, del guion o del personaje. Vuelve a generarla con la selección actual.');
  const next=structuredClone(project),scene=next.scenes.find(s=>s.id===line.sceneId)!;
  scene.takeAssetIds=[...new Set([...(scene.takeAssetIds??[]),scene.videoAssetId,assetId].filter((id):id is string=>!!id))];
  scene.videoAssetId=assetId;scene.trimStart=0;scene.speed=1;scene.clearVideoAsset=false;scene.audio={...scene.audio,muted:false,volume:1};
  for(const track of next.tracks??[])for(const clip of track.clips)if(clip.dialogueLineId===lineId)clip.muted=true;
  return next;
}
/** Proposal only: screenplay remains intact and existing lines are never removed. */
export function dialogueLinesFromScene(project:Project,sceneId:string):DialogueLine[] {
  const scene=project.scenes.find(s=>s.id===sceneId);if(!scene)return [];
  const result:DialogueLine[]=[];let speaker:string|undefined,delivery:DialogueLine['delivery']='voiceover';
  const nameKey=(value:string)=>value.replace(/\([^)]*\)|\[[^\]]*\]/g,' ').replace(/^@/,'').trim().normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();
  const findSpeaker=(value:string)=>project.characters.find(c=>scene.characterIds.includes(c.id)&&nameKey(c.name)===nameKey(value));
  const offscreen=(value:string)=>/\((?:v\.?\s*o\.?|o\.?\s*s\.?|voz\s+en\s+off)\)/i.test(value);
  for(const raw of scene.dialogue.split(/\n+/)){
    let text=raw.trim();if(!text)continue;
    const named=/^([^:]{1,100}):\s*(.*)$/.exec(text);
    if(named){const character=findSpeaker(named[1]!);speaker=character?.id;delivery=character&&!offscreen(named[1]!)?'dialogue':'voiceover';text=named[2]!;}
    else {const character=findSpeaker(text);if(character){speaker=character.id;delivery=offscreen(text)?'voiceover':'dialogue';continue;}}
    text=text.replace(/\([^)]*\)|\[[^\]]*\]/g,' ').replace(/\s+/g,' ').trim();if(!text)continue;
    // Long turns remain complete, split into speakable chunks without dropping words.
    const chunks:string[]=[];let chunk='';
    for(const word of text.split(' ')){if(chunk&&chunk.length+word.length+1>600){chunks.push(chunk);chunk='';}
      let remainder=word;while(remainder.length>600){let cut=600;if(/[\uD800-\uDBFF]/.test(remainder[cut-1]!))cut--;chunks.push(remainder.slice(0,cut));remainder=remainder.slice(cut);}
      chunk+=(chunk?' ':'')+remainder;}if(chunk)chunks.push(chunk);
    for(const spoken of chunks)result.push({...(!speaker&&project.production?{voice:defaultDialogueVoice(project.production.voiceEngine)}:{}),id:crypto.randomUUID(),sceneId,characterId:speaker,text:spoken,offset:0,delivery,sourceDialogue:dialogueSourceSignature(scene.dialogue)});
  }
  return result;
}
export function applyDialogueSubtitle(project:Project,lineId:string,assetId:string):Project {
  const line=project.dialogueLines?.find(l=>l.id===lineId),asset=project.assets.find(a=>a.id===assetId);
  if(!line||!asset||!speechIsCurrent(project,line,asset))throw new Error('Genera primero una voz vigente para usar su duración en el subtítulo.');
  const scene=project.scenes.find(s=>s.id===line.sceneId)!;
  if(line.offset+asset.speech!.duration>scene.duration+.001)throw new Error('El diálogo supera el final del plano. Amplíalo antes de crear el subtítulo.');
  const bounds=speechBounds(asset.speech!);
  const next=structuredClone(project),cue={id:`dialogue-${lineId}`,dialogueLineId:lineId,sceneId:line.sceneId,start:line.offset+bounds.start,end:line.offset+bounds.end,text:line.text,characterId:line.characterId,sourceDialogue:dialogueSourceSignature(scene.dialogue)};
  const existing=(next.subtitleCues??[]).filter(c=>c.id!==cue.id);if(existing.length>=1000)throw new Error('La película alcanzó 1.000 subtítulos. Libera uno antes de añadir esta intervención.');
  next.subtitleCues=[...existing,cue];next.subtitlesEnabled=true;return next;
}
