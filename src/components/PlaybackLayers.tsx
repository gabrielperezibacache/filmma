import {useEffect,useId,useMemo,useRef,useState} from 'react';
import type {Project} from '../types';
import{audibleInSolo,type AudioSolo}from'../audio-mixer';
import {audioGainAt,resolveTimelineClips} from '../multitrack';
import {resolveSubtitleCues} from '../subtitles';
import {audioOnFrameGrid,syncMediaClock} from '../playback';
import './playback-layers.css';
import {evaluateLayerTransform,playbackSpeed} from '../visual-effects';
import ColorFilter from './ColorFilter';
import {layerMediaLayout,layerRectStyle} from '../layer-layout';
import {projectAspectRatio} from '../export-resolution';

type ResolvedClip = ReturnType<typeof resolveTimelineClips>[number];
type Props = {project:Project;playhead:number;playing:boolean;onBlocked:()=>void;solo?:AudioSolo};

function MediaLayer({item,playhead,playing,fps,aspect,onBlocked,audible=true}:{item:ResolvedClip;playhead:number;playing:boolean;fps:number;aspect:number;onBlocked:()=>void;audible?:boolean}) {
  const ref=useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const colorId=`layer-color-${useId().replace(/[^a-zA-Z0-9_-]/g,'')}`;
  useEffect(()=>{const media=ref.current;return()=>media?.pause()},[]);
  const [failed,setFailed]=useState(false);
  const [dimensions,setDimensions]=useState<{assetId:string;url:string;width:number;height:number}|null>(null);
  const currentDimensions=dimensions?.assetId===item.asset.id&&dimensions.url===item.asset.url?dimensions:null;
  const geometry=layerMediaLayout(currentDimensions?.width??0,currentDimensions?.height??0,aspect);
  const measure=(width:number,height:number)=>setDimensions({assetId:item.asset.id,url:item.asset.url,width,height});
  const letterbox=geometry.bars.map((bar,index)=><span key={index} className="composite-letterbox" aria-hidden="true" style={layerRectStyle(bar)}/>);
  useEffect(()=>setFailed(false),[item.asset.id]);
  const local=playhead-item.startFrame/fps, rate=playbackSpeed(item.clip.speed);
  const pose=evaluateLayerTransform(item.clip,local,fps);
  const style={opacity:pose.opacity,transform:`translate(${pose.x}%,${pose.y}%) scale(${pose.scale})`};
  const mediaStyle={filter:item.clip.color?`url(#${colorId})`:undefined};
  const gain=(!audible||item.track.muted?0:item.track.volume)*audioGainAt(local,Math.round(item.clip.duration*fps)/fps,audioOnFrameGrid(item.clip,fps));
  const current=useRef({time:Math.max(0,local)*rate+item.clip.trimStart,playing,volume:gain,fps,rate});
  current.current={time:Math.max(0,local)*rate+item.clip.trimStart,playing,volume:gain,fps,rate};
  const sync=()=>{if(ref.current)syncMediaClock(ref.current,current.current,onBlocked)};
  useEffect(sync,[playhead,playing,gain,item.clip.trimStart,fps,rate]);
  if(item.asset.type==='image')return <div className="composite-layer" style={style}><ColorFilter color={item.clip.color} id={colorId}/>{letterbox}<div className="composite-media" style={layerRectStyle(geometry.media)}><img src={item.asset.url} alt="" style={mediaStyle} onLoad={event=>measure(event.currentTarget.naturalWidth,event.currentTarget.naturalHeight)} onError={()=>setFailed(true)}/></div>{failed&&<span className="layer-error">No se pudo leer {item.asset.name}. Comprueba el original en la biblioteca.</span>}</div>;
  if(item.track.type==='audio')return <><audio ref={ref} src={item.asset.url} preload="auto" onLoadedMetadata={sync} onCanPlay={sync} onError={()=>setFailed(true)}/>{failed&&<span className="layer-error">No se pudo leer {item.asset.name}. Comprueba el original en la biblioteca.</span>}</>;
  return <div className="composite-layer" style={style}><ColorFilter color={item.clip.color} id={colorId}/>{letterbox}<div className="composite-media" style={layerRectStyle(geometry.media)}><video style={mediaStyle} ref={ref} src={item.asset.url} playsInline preload="auto" onLoadedMetadata={event=>{measure(event.currentTarget.videoWidth,event.currentTarget.videoHeight);sync()}} onCanPlay={sync} onError={()=>setFailed(true)}/></div>{failed&&<span className="layer-error">No se pudo leer {item.asset.name}. Comprueba el original en la biblioteca.</span>}</div>;
}

/** Same frame intervals and order as the export. The last visual track is on top. */
export default function PlaybackLayers({project,playhead,playing,onBlocked,solo=null}:Props) {
  const clips=useMemo(()=>resolveTimelineClips(project),[project]);
  const cues=useMemo(()=>resolveSubtitleCues(project),[project]);
  const frame=Math.floor(Math.max(0,playhead)*project.fps+1e-6);
  const active=clips.filter(item=>frame>=item.startFrame&&frame<item.endFrame);
  const subtitles=cues.filter(item=>frame>=item.startFrame&&frame<item.endFrame);
  return <>
    {active.map(item=><MediaLayer key={`${project.id}:${item.track.id}:${item.clip.id}`} item={item} playhead={playhead} playing={playing} fps={project.fps} aspect={projectAspectRatio(project.format)} audible={audibleInSolo(solo,`track:${item.track.id}`)} onBlocked={onBlocked}/>)}
    {!!subtitles.length&&<div className="viewer-subtitles" aria-label="Subtítulos en el visor">{subtitles.map(({cue})=><span key={cue.id}>{cue.text}</span>)}</div>}
  </>;
}
