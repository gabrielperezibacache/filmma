import type {Project, Scene} from './types';
import {buildTimeline} from './timeline';

export type SceneTransition = {kind:'dissolve'|'dip'; incoming:Scene; outgoing:Scene; boundaryFrame:number;startFrame:number;endFrame:number;durationFrames:number;incomingFrames:number;outgoingFrames:number};

/** Transitions use source handles and never change screenplay/attachment times.
 * Reserving at most half a shot prevents adjacent transitions from overlapping. */
export function resolveSceneTransitions(project:Pick<Project,'scenes'|'fps'>):SceneTransition[] {
  const {segments,fps}=buildTimeline(project), result:SceneTransition[]=[];
  for(let i=1;i<segments.length;i++) {
    const next=segments[i]!,previous=segments[i-1]!,kind=next.scene.transition;
    if(kind!=='dissolve'&&kind!=='dip')continue;
    const requested=Math.max(1,Math.round(Math.min(2,Math.max(1/fps,next.scene.transitionDuration??.5))*fps));
    const durationFrames=kind==='dissolve'?Math.min(requested,Math.max(1,Math.floor(next.durationFrames/2))):Math.min(requested,previous.durationFrames,next.durationFrames);
    const outgoingFrames=kind==='dip'?Math.floor(durationFrames/2):0,incomingFrames=durationFrames-outgoingFrames;
    result.push({kind,incoming:next.scene,outgoing:previous.scene,boundaryFrame:next.startFrame,startFrame:next.startFrame-outgoingFrames,endFrame:next.startFrame+incomingFrames,durationFrames,incomingFrames,outgoingFrames});
  }
  return result;
}

const unit=(n:number)=>Math.min(1,Math.max(0,n));
export function transitionOpacity(t:SceneTransition,frame:number) {
  if(t.kind==='dissolve') {const incoming=t.durationFrames===1?1:unit((frame-t.boundaryFrame)/(t.durationFrames-1));return {incoming,outgoing:1-incoming};}
  return {incoming:t.incomingFrames<=1?(frame<t.endFrame?0:1):unit((frame-t.boundaryFrame)/(t.incomingFrames-1)),outgoing:t.outgoingFrames<=1?(frame<t.startFrame?1:0):unit((t.boundaryFrame-1-frame)/(t.outgoingFrames-1))};
}

/** Base audio follows the same envelope as the picture; extra tracks stay free. */
export function sceneTransitionGain(transitions:SceneTransition[],sceneId:string,frame:number) {
  let gain=1;
  for(const t of transitions) {
    if(frame<t.startFrame||frame>=t.endFrame)continue;
    if(t.incoming.id===sceneId&&frame>=t.boundaryFrame)gain*=transitionOpacity(t,frame).incoming;
    if(t.kind==='dip'&&t.outgoing.id===sceneId&&frame<t.boundaryFrame)gain*=transitionOpacity(t,frame).outgoing;
  }
  return gain;
}
