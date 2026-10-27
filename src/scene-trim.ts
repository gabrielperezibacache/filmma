import type {Project,Scene} from './types';
import {playbackSpeed} from './visual-effects';
import {rebaseLayerKeyframes} from './layer-editing';
import {isProjectFrameRate} from './export-resolution';

/** Ripple trims a base shot without modifying its screenplay or identity.
 * Left trims move attached content with the retained source; removed intervals
 * remain recoverable through the editor's single undo transaction. */
export function trimProjectScene(project:Project,sceneId:string,edge:'start'|'end',deltaFrames:number):Project {
  if(!Number.isFinite(deltaFrames)||!isProjectFrameRate(project.fps))throw new Error('El recorte necesita una posición y velocidad válidas.');
  const scene=project.scenes.find(s=>s.id===sceneId);if(!scene)return project;
  const fps=project.fps,duration=Math.round(scene.duration*fps),source=(scene.trimStart??0)*fps,speed=playbackSpeed(scene.speed);
  let delta=Math.round(deltaFrames);
  if(edge==='start')delta=Math.max(Math.max(duration-120*fps,scene.videoAssetId?Math.ceil(-source/speed):-120*fps),Math.min(duration-fps,delta,Math.floor((86400*fps-source)/speed)));
  else delta=Math.max(fps-duration,Math.min(120*fps-duration,delta));
  if(!delta)return project;
  const scenes=project.scenes.map(s=>s.id===sceneId?{...s,duration:(duration+(edge==='start'?-delta:delta))/fps,...(edge==='start'&&scene.videoAssetId?{trimStart:Math.max(0,(source+delta*speed)/fps)}:{})}:s);
  if(edge==='end')return {...project,scenes};
  return shiftSceneAttachments({...project,scenes},sceneId,delta);
}

/** Apply a selection from the original while keeping anchored content with it. */
export function applySceneSourceTrim(project:Project,sceneId:string,patch:Pick<Scene,'trimStart'|'duration'>):Project {
  const scene=project.scenes.find(item=>item.id===sceneId);if(!scene)return project;
  if(!Number.isFinite(patch.trimStart)||patch.trimStart!<0||patch.trimStart!>86400||!Number.isFinite(patch.duration)||patch.duration<1||patch.duration>120)throw new Error('El recorte original está fuera del rango permitido.');
  const delta=Math.round(((patch.trimStart??0)-(scene.trimStart??0))/playbackSpeed(scene.speed)*project.fps);
  return shiftSceneAttachments({...project,scenes:project.scenes.map(item=>item.id===sceneId?{...item,...patch}:item)},sceneId,delta);
}

function shiftSceneAttachments(project:Project,sceneId:string,delta:number):Project {
  const fps=project.fps;
  const assets=new Map(project.assets.map(a=>[a.id,a]));
  const tracks=project.tracks?.map(track=>({...track,clips:track.clips.flatMap(clip=>{
    if(clip.sceneId!==sceneId)return [clip];
    const offset=Math.round(clip.offset*fps)-delta,frames=Math.round(clip.duration*fps),cut=Math.max(0,-offset);
    if(cut>=frames)return [];
    const media=assets.get(clip.assetId),trimStart=media?.type==='image'?clip.trimStart:clip.trimStart+cut/fps*playbackSpeed(clip.speed);
    if(trimStart>86400||Math.max(0,offset)/fps>86400)throw new Error('El recorte excede el rango de una pista vinculada. Recorta primero ese clip.');
    return [{...clip,offset:Math.max(0,offset)/fps,duration:(frames-cut)/fps,trimStart,keyframes:rebaseLayerKeyframes(clip,cut/fps),...(clip.envelope?{envelope:{...clip.envelope,offset:clip.envelope.offset+cut/fps}}:{})}];
  })}));
  const subtitleCues=project.subtitleCues?.flatMap(cue=>{
    if(cue.sceneId!==sceneId)return [cue];
    const start=Math.max(0,Math.round(cue.start*fps)-delta),end=Math.round(cue.end*fps)-delta;
    if(end<=start)return [];
    if(end>86400*fps)throw new Error('El recorte excede el rango de un subtítulo. Revisa sus tiempos.');
    return [{...cue,start:start/fps,end:end/fps}];
  });
  // Spoken text is retained even when its previous audio is trimmed out.
  const dialogueLines=project.dialogueLines?.map(line=>line.sceneId===sceneId?{...line,offset:Math.min(120,Math.max(0,Math.round(line.offset*fps)-delta)/fps)}:line);
  return {...project,tracks,subtitleCues,dialogueLines};
}
