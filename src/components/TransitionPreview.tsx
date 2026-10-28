import {useEffect,useMemo,useRef,useState} from 'react';
import type {Asset,Project} from '../types';
import {resolveSceneTransitions,sceneTransitionGain,transitionOpacity} from '../transitions';
import type {SceneTransition} from '../transitions';
import {audioGainAt} from '../multitrack';
import {audioOnFrameGrid,syncMediaClock} from '../playback';
import {playbackSpeed,sourceTime} from '../visual-effects';
import ColorFilter from './ColorFilter';

function Handle({transition:t,asset,frame,fps,playing,onBlocked,audible=true,source=(a:Asset)=>a.url,onSourceError}:{transition:SceneTransition;asset:Asset;frame:number;fps:number;playing:boolean;onBlocked:()=>void;audible?:boolean;source?:(a:Asset)=>string;onSourceError?:(a:Asset,url:string)=>void}) {
  const ref=useRef<HTMLVideoElement>(null),[failed,setFailed]=useState(false);
  const elapsed=(frame-t.boundaryFrame)/fps,duration=Math.round(t.outgoing.duration*fps)/fps;
  const opacity=transitionOpacity(t,frame).outgoing;
  const gain=!audible||(t.outgoing.audio?.fadeOut??0)>0?0:audioGainAt(Math.max(0,duration-1/fps),duration,audioOnFrameGrid(t.outgoing.audio??{},fps));
  const state=useRef({time:sourceTime(t.outgoing.trimStart,duration+elapsed,t.outgoing.speed),rate:playbackSpeed(t.outgoing.speed),playing,volume:gain*opacity,fps});
  state.current={time:sourceTime(t.outgoing.trimStart,duration+elapsed,t.outgoing.speed),rate:playbackSpeed(t.outgoing.speed),playing,volume:gain*opacity,fps};
  const sync=()=>{if(ref.current)syncMediaClock(ref.current,state.current,onBlocked)};
  useEffect(sync,[frame,playing,asset.id,gain,fps]);
  useEffect(()=>{const media=ref.current;return()=>media?.pause()},[]);
  const filter=`${t.outgoing.look==='noir'?'grayscale(1) contrast(1.08) ':t.outgoing.look==='warm'?'sepia(.15) saturate(.85) ':''}url(#outgoing-color)`;
  return <div className="transition-handle" style={{opacity}} aria-hidden="true"><ColorFilter id="outgoing-color" color={t.outgoing.color}/>{asset.type==='image'?<img src={source(asset)} alt="" style={{filter}}/>:<video ref={ref} src={source(asset)} style={{filter}} playsInline preload="auto" onLoadedMetadata={sync} onCanPlay={sync} onError={()=>{onSourceError?.(asset,source(asset));if(source(asset)===asset.url)setFailed(true)}}/>} {failed&&<span className="layer-error">No se pudo leer la continuación del plano anterior.</span>}</div>;
}

export default function TransitionPreview({project,playhead,playing,onBlocked,audible=true,source=(a:Asset)=>a.url,onSourceError}:{project:Project;playhead:number;playing:boolean;onBlocked:()=>void;audible?:boolean;source?:(a:Asset)=>string;onSourceError?:(a:Asset,url:string)=>void}) {
  const transitions=useMemo(()=>resolveSceneTransitions(project),[project.scenes,project.fps]);
  const frame=Math.floor(playhead*project.fps+1e-6),t=transitions.find(t=>frame>=t.startFrame&&frame<t.endFrame);
  if(!t)return null;
  if(t.kind==='dip')return <div className="transition-black" style={{opacity:1-sceneTransitionGain([t],frame<t.boundaryFrame?t.outgoing.id:t.incoming.id,frame)}} aria-hidden="true"/>;
  const asset=project.assets.find(a=>a.id===(t.outgoing.videoAssetId??t.outgoing.assetId));
  return asset?<Handle key={`${project.id}:${t.incoming.id}:${asset.id}`} transition={t} asset={asset} frame={frame} fps={project.fps} playing={playing} onBlocked={onBlocked} audible={audible} source={source} onSourceError={onSourceError}/>:null;
}
