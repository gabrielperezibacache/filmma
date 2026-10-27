import type{Project}from'./types';
import{speechIsCurrent}from'./dialogue';
export type AudioSolo='base'|'soundtrack'|`track:${string}`|null;
export const audibleInSolo=(solo:AudioSolo,bus:Exclude<AudioSolo,null>)=>!solo||solo===bus;
export const gainDecibels=(gain:number)=>gain>0?`${(20*Math.log10(gain)).toFixed(1)} dB`:'−∞ dB';
export function voiceEditingIssues(project:Project){
 return(project.tracks??[]).flatMap(t=>t.clips.flatMap(c=>{
  if(!c.dialogueLineId)return[];
  const line=project.dialogueLines?.find(l=>l.id===c.dialogueLineId),a=project.assets.find(a=>a.id===c.assetId);
  const scene=project.scenes.find(s=>s.id===c.sceneId),character=project.characters.find(x=>x.id===line?.characterId);
  const stale=!line||!a||!speechIsCurrent(project,line,a),moved=!!line&&c.sceneId!==line.sceneId;
  return stale||moved?[{trackId:t.id,clipId:c.id,sceneId:c.sceneId,character:character?.name,scene:scene?.title,kind:moved?'moved':'stale'}]:[];
 }));
}
