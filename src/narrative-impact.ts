import type{Project}from'./types';import{resolveSceneContinuity}from'./continuity';import{speechIsCurrent,lipSyncIsCurrent,dialogueScriptChanged}from'./dialogue';import{dialogueSourceSignature}from'./subtitles';
const state=(p:Project,id:string)=>resolveSceneContinuity(p,id).map(({character,state})=>({id:character.id,values:state.values}));
export function narrativeImpact(before:Project,after:Project){
 const moved=after.scenes.filter((s,i)=>before.scenes.findIndex(x=>x.id===s.id)!==i).map(s=>s.id);
 const continuity=after.scenes.filter(s=>JSON.stringify(state(before,s.id))!==JSON.stringify(state(after,s.id))).map(s=>s.id);
 const voices=(before.dialogueLines??[]).flatMap(line=>{const old=before.assets.find(a=>a.id===line.audioAssetId),next=after.dialogueLines?.find(l=>l.id===line.id),asset=after.assets.find(a=>a.id===next?.audioAssetId);return old&&speechIsCurrent(before,line,old)&&(!next||!asset||!speechIsCurrent(after,next,asset))?[line.id]:[]});
 const lips=before.assets.filter(a=>{const meta=a.lipSync;if(!meta)return false;const line=before.dialogueLines?.find(l=>l.id===meta.lineId),next=after.dialogueLines?.find(l=>l.id===meta.lineId),copy=after.assets.find(x=>x.id===a.id);return !!line&&lipSyncIsCurrent(before,line,a)&&(!next||!copy||!lipSyncIsCurrent(after,next,copy))}).map(a=>a.id);
 const subtitleIds=(before.subtitleCues??[]).filter(c=>{const old=before.scenes.find(s=>s.id===c.sceneId),next=after.scenes.find(s=>s.id===c.sceneId);return old?.dialogue!==next?.dialogue}).map(c=>c.id);
 const changedShots=after.scenes.filter(s=>{const old=before.scenes.find(x=>x.id===s.id);return !old||old.description!==s.description||old.dialogue!==s.dialogue||old.duration!==s.duration||continuity.includes(s.id)}).map(s=>s.id);
 const media=after.scenes.filter(s=>changedShots.includes(s.id)&&(s.videoAssetId||s.assetId)).map(s=>s.id);
 return{moved,continuity,voices,lips,subtitleIds,media};
}
export function shotDependencies(project:Project,shotId:string){
 const scene=project.scenes.find(s=>s.id===shotId),lines=project.dialogueLines?.filter(l=>l.sceneId===shotId)??[],cues=project.subtitleCues?.filter(c=>c.sceneId===shotId)??[];
 return{lines:lines.length,cues:cues.length,clips:(project.tracks??[]).flatMap(t=>t.clips).filter(c=>c.sceneId===shotId).length,staleVoices:lines.filter(l=>{const a=project.assets.find(a=>a.id===l.audioAssetId);return a? !speechIsCurrent(project,l,a):dialogueScriptChanged(project,l)}).length,staleSubtitles:cues.filter(c=>c.sourceDialogue&&c.sourceDialogue!==dialogueSourceSignature(scene?.dialogue??'')).length};
}
