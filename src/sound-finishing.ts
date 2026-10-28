import type {Project} from './types';
import {buildTimeline} from './timeline';
import {resolveTimelineClips} from './multitrack';

export type AudioMix = {
  normalize:boolean; targetLufs:number; truePeakDb:number;
  ducking:boolean; reductionDb:number; attack:number; release:number; musicTrackIds:string[];
};
export const DEFAULT_AUDIO_MIX:AudioMix={normalize:false,targetLufs:-16,truePeakDb:-1.5,ducking:false,reductionDb:12,attack:.2,release:.6,musicTrackIds:[]};
export const audioMixSettings=(p:Pick<Project,'audioMix'>):AudioMix=>({...DEFAULT_AUDIO_MIX,...p.audioMix});
export type DuckWindow={start:number;end:number;lineIds:string[]};
/** Actual audible dialogue placements, not estimated reading time or caption time. */
export function dialogueWindows(p:Project):DuckWindow[]{
  const fps=p.fps, windows:DuckWindow[]=[];
  for(const item of resolveTimelineClips(p)){
    const {clip,track,asset}=item;
    if(!clip.dialogueLineId||!p.dialogueLines?.some(l=>l.id===clip.dialogueLineId)||track.muted||clip.muted||track.volume<=0||(clip.volume??1)<=0)continue;
    const speed=clip.speed??1,available=asset.speech?Math.max(0,(asset.speech.duration-clip.trimStart)/speed):clip.duration;
    const start=item.startFrame/fps,end=Math.min(item.endFrame/fps,start+available);
    if(end>start)windows.push({start,end,lineIds:[clip.dialogueLineId]});
  }
  return windows.sort((a,b)=>a.start-b.start);
}
export function duckingWindows(p:Project):DuckWindow[]{
  const settings=audioMixSettings(p),result:DuckWindow[]=[];
  for(const w of dialogueWindows(p)){
    const last=result.at(-1);
    // Hold through small pauses rather than pumping between adjacent words/lines.
    if(last&&w.start-last.end<=settings.attack+settings.release){last.end=Math.max(last.end,w.end);last.lineIds=[...new Set([...last.lineIds,...w.lineIds])];}
    else result.push({...w,lineIds:[...w.lineIds]});
  }
  return result;
}
export function duckGainAt(time:number,windows:DuckWindow[],settings:AudioMix):number{
  if(!settings.ducking)return 1;
  const floor=10**(-settings.reductionDb/20);
  for(const w of windows){
    if(time<w.start-settings.attack)break;
    if(time<w.start)return 1-(1-floor)*(time-w.start+settings.attack)/settings.attack;
    if(time<=w.end)return floor;
    if(time<w.end+settings.release)return floor+(1-floor)*(time-w.end)/settings.release;
  }
  return 1;
}
/** Balanced expression avoids parser recursion at the 500-clip project limit. */
export function duckingExpression(windows:DuckWindow[],s:AudioMix,localStart=0):string{
  if(!s.ducking||!windows.length)return '1';
  const n=(v:number)=>Number(v.toFixed(8)),clock=localStart?`(t+${n(localStart)})`:'t',floor=10**(-s.reductionDb/20);
  const one=(w:DuckWindow)=>`if(lt(${clock},${n(w.start-s.attack)}),1,if(lt(${clock},${n(w.start)}),1-${n(1-floor)}*(${clock}-${n(w.start-s.attack)})/${n(s.attack)},if(lte(${clock},${n(w.end)}),${n(floor)},if(lt(${clock},${n(w.end+s.release)}),${n(floor)}+${n(1-floor)}*(${clock}-${n(w.end)})/${n(s.release)},1))))`;
  const tree=(lo:number,hi:number):string=>lo===hi?one(windows[lo]!):(()=>{const mid=Math.floor((lo+hi)/2);return`if(lt(${clock},${n(windows[mid]!.end+s.release)}),${tree(lo,mid)},${tree(mid+1,hi)})`})();
  return tree(0,windows.length-1);
}
/** Only audio-affecting edits invalidate a measured mix; images and captions do not. */
export function audioMixFingerprint(p:Project):string{
  return JSON.stringify([p.id,p.fps,buildTimeline(p).totalFrames,audioMixSettings(p),p.audioAssetId,p.audioVolume,p.audioMuted,
    p.scenes.map(s=>[s.id,s.duration,s.videoAssetId,s.trimStart,s.speed,s.audio,s.transition,s.transitionDuration]),
    p.tracks?.map(t=>[t.id,t.type,t.volume,t.muted,t.clips.map(c=>[c.id,c.assetId,c.dialogueLineId,c.sceneId,c.offset,c.duration,c.trimStart,c.speed,c.volume,c.muted,c.fadeIn,c.fadeOut,c.envelope])]),
    p.dialogueLines,p.characters.map(c=>[c.id,c.voice,c.continuity]),p.assets.filter(a=>a.type!=='image').map(a=>[a.id,a.url,a.speech])]);
}
