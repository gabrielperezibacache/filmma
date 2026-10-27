import type{Project,TimelineClip}from'./types';
import{resolveTimelineClips}from'./multitrack';
import{rebaseLayerKeyframes}from'./layer-editing';
import{playbackSpeed}from'./visual-effects';

function selected(project:Project,trackId:string,clipId:string){
 const item=resolveTimelineClips(project).find(x=>x.track.id===trackId&&x.clip.id===clipId);
 if(!item)throw new Error('El clip no está disponible en el montaje.');
 if(item.track.locked)throw new Error('Desbloquea la pista antes de editar sus clips.');
 if((project.tracks??[]).flatMap(t=>t.clips).length>=500)throw new Error('Se alcanzó el límite de 500 clips.');
 const keys=(project.tracks??[]).flatMap(t=>t.clips).reduce((n,c)=>n+(c.keyframes?.length??0),0);
 if(keys+(item.clip.keyframes?.length??0)>2000)throw new Error('La operación superaría los 2.000 fotogramas clave.');
 return item;
}
const freshKeys=(clip:TimelineClip,newId:()=>string)=>clip.keyframes?.map(k=>({...k,id:newId()}));

/** Preserve source, narrative anchor, voice provenance and the full animation curve.
 * Splitting an audio fade retains its original clock on both sides of the cut. */
export function splitTimelineClip(project:Project,trackId:string,clipId:string,seconds:number,newId:()=>string=()=>crypto.randomUUID()):Project{
 const item=selected(project,trackId,clipId),frame=Math.round(seconds*project.fps);
 if(frame<=item.startFrame||frame>=item.endFrame)throw new Error('Sitúa el cabezal dentro del clip para dividirlo.');
 const delta=(frame-item.startFrame)/project.fps,c=item.clip,duration=Math.round(c.duration*project.fps)/project.fps;
 const envelope=c.envelope??{offset:0,duration};
 const left={...c,duration:delta,envelope};
 const right={...c,id:newId(),offset:c.offset+delta,duration:duration-delta,trimStart:item.asset.type==='image'?0:c.trimStart+delta*playbackSpeed(c.speed),envelope:{...envelope,offset:envelope.offset+delta},keyframes:freshKeys({...c,keyframes:rebaseLayerKeyframes(c,delta)},newId)};
 return{...project,tracks:project.tracks!.map(t=>t.id!==trackId?t:{...t,clips:t.clips.flatMap(x=>x.id===clipId?[left,right]:[x])})};
}

/** A deliberate copy at the playhead; overlaps are allowed, originals are shared.
 * Keep the narrative anchor rather than silently assigning a different character. */
export function duplicateTimelineClip(project:Project,trackId:string,clipId:string,seconds:number,newId:()=>string=()=>crypto.randomUUID()):Project{
 const item=selected(project,trackId,clipId),anchor=project.scenes.findIndex(s=>s.id===item.clip.sceneId);
 const start=project.scenes.slice(0,anchor).reduce((n,s)=>n+Math.round(s.duration*project.fps),0),frame=Math.round(seconds*project.fps);
 const total=project.scenes.reduce((n,s)=>n+Math.round(s.duration*project.fps),0);
 if(frame<start||frame>=total)throw new Error('Sitúa el cabezal desde el inicio del plano de referencia hasta el final de la película.');
 const copy={...structuredClone(item.clip),id:newId(),offset:(frame-start)/project.fps,keyframes:freshKeys(item.clip,newId)};
 return{...project,tracks:project.tracks!.map(t=>t.id!==trackId?t:{...t,clips:[...t.clips,copy]})};
}
