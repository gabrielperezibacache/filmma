import {speechBounds} from './elevenlabs';
import type{Project,SubtitleCue}from'./types';import{speechIsCurrent}from'./dialogue';
export function subtitleVoice(project:Project,cue:SubtitleCue){
 const lineId=cue.dialogueLineId??(cue.id.startsWith('dialogue-')?cue.id.slice(9):undefined),line=project.dialogueLines?.find(l=>l.id===lineId),asset=project.assets.find(a=>a.id===line?.audioAssetId);
 const current=!!line&&!!asset&&line.sceneId===cue.sceneId&&(!cue.characterId||cue.characterId===line.characterId)&&speechIsCurrent(project,line,asset);
 return{line,asset,current};
}
export function alignSubtitleToVoice(project:Project,cueId:string):Project{
 const cue=project.subtitleCues?.find(c=>c.id===cueId);if(!cue)throw new Error('El subtítulo ya no está disponible.');
 const{line,asset,current}=subtitleVoice(project,cue),scene=project.scenes.find(s=>s.id===cue.sceneId);
 if(!current||!line||!asset?.speech||!scene)throw new Error('Revisa la voz, su plano y el personaje antes de usar sus tiempos.');
 const bounds=speechBounds(asset.speech),start=Math.round((line.offset+bounds.start)*project.fps)/project.fps,end=Math.round((line.offset+bounds.end)*project.fps)/project.fps;
 if(start<0||end>Math.round(scene.duration*project.fps)/project.fps||end<=start)throw new Error('La voz no cabe en el plano. Ajusta el montaje antes de alinear el subtítulo.');
 return{...project,subtitleCues:project.subtitleCues!.map(c=>c.id===cueId?{...c,start,end,dialogueLineId:line.id}:c)};
}
