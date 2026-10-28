import {audioMixSettings,duckingWindows,duckGainAt} from '../sound-finishing';
import {subtitleStyle,subtitlePalette} from '../subtitle-style';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import type {Asset,Project} from '../types';
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
type Props = {project:Project;playhead:number;playing:boolean;onBlocked:()=>void;solo?:AudioSolo;source?:(a:Asset)=>string;onSourceError?:(a:Asset,url:string)=>void};

function MediaLayer({item,playhead,playing,fps,aspect,onBlocked,audible=true,duckGain=1,source=(a:Asset)=>a.url,onSourceError}:{item:ResolvedClip;playhead:number;playing:boolean;fps:number;aspect:number;onBlocked:()=>void;audible?:boolean;duckGain?:number;source?:(a:Asset)=>string;onSourceError?:(a:Asset,url:string)=>void}) {
  const ref=useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const colorId=`layer-color-${useId().replace(/[^a-zA-Z0-9_-]/g,'')}`;
  useEffect(()=>{const media=ref.current;return()=>media?.pause()},[]);
  const [failed,setFailed]=useState(false);
  const [dimensions,setDimensions]=useState<{assetId:string;url:string;width:number;height:number}|null>(null);
  const currentDimensions=dimensions?.assetId===item.asset.id&&dimensions.url===item.asset.url?dimensions:null;
  const geometry=layerMediaLayout(currentDimensions?.width??0,currentDimensions?.height??0,aspect);
  const measure=(width:number,height:number)=>setDimensions({assetId:item.asset.id,url:item.asset.url,width,height});
  const letterbox=geometry.bars.map((bar,index)=><span key={index} className="composite-letterbox" aria-hidden="true" style={layerRectStyle(bar)}/>);
  useEffect(()=>setFailed(false),[item.asset.id,source(item.asset)]);
  const local=playhead-item.startFrame/fps, rate=playbackSpeed(item.clip.speed);
  const pose=evaluateLayerTransform(item.clip,local,fps);
  const style={opacity:pose.opacity,transform:`translate(${pose.x}%,${pose.y}%) scale(${pose.scale})`};
  const mediaStyle={filter:item.clip.color?`url(#${colorId})`:undefined};
  const gain=duckGain*(!audible||item.track.muted?0:item.track.volume)*audioGainAt(local,Math.round(item.clip.duration*fps)/fps,audioOnFrameGrid(item.clip,fps));
  const current=useRef({time:Math.max(0,local)*rate+item.clip.trimStart,playing,volume:gain,fps,rate});
  current.current={time:Math.max(0,local)*rate+item.clip.trimStart,playing,volume:gain,fps,rate};
  const sync=()=>{if(ref.current)syncMediaClock(ref.current,current.current,onBlocked)};
  useEffect(sync,[playhead,playing,gain,item.clip.trimStart,fps,rate]);
  if(item.asset.type==='image')return <div className="composite-layer" style={style}><ColorFilter color={item.clip.color} id={colorId}/>{letterbox}<div className="composite-media" style={layerRectStyle(geometry.media)}><img src={source(item.asset)} alt="" style={mediaStyle} onLoad={event=>measure(event.currentTarget.naturalWidth,event.currentTarget.naturalHeight)} onError={()=>{onSourceError?.(item.asset,source(item.asset));if(source(item.asset)===item.asset.url)setFailed(true)}}/></div>{failed&&<span className="layer-error">No se pudo leer {item.asset.name}. Comprueba el original en la biblioteca.</span>}</div>;
  if(item.track.type==='audio')return <><audio ref={ref} src={source(item.asset)} preload="auto" onLoadedMetadata={sync} onCanPlay={sync} onError={()=>{onSourceError?.(item.asset,source(item.asset));if(source(item.asset)===item.asset.url)setFailed(true)}}/>{failed&&<span className="layer-error">No se pudo leer {item.asset.name}. Comprueba el original en la biblioteca.</span>}</>;
  return <div className="composite-layer" style={style}><ColorFilter color={item.clip.color} id={colorId}/>{letterbox}<div className="composite-media" style={layerRectStyle(geometry.media)}><video style={mediaStyle} ref={ref} src={source(item.asset)} playsInline preload="auto" onLoadedMetadata={event=>{measure(event.currentTarget.videoWidth,event.currentTarget.videoHeight);sync()}} onCanPlay={sync} onError={()=>{onSourceError?.(item.asset,source(item.asset));if(source(item.asset)===item.asset.url)setFailed(true)}}/></div>{failed&&<span className="layer-error">No se pudo leer {item.asset.name}. Comprueba el original en la biblioteca.</span>}</div>;
}

/** Same frame intervals and order as the export. The last visual track is on top. */
export default function PlaybackLayers({project,playhead,playing,onBlocked,solo=null,source,onSourceError}:Props) {
  const clips=useMemo(()=>resolveTimelineClips(project),[project]);
  const cues=useMemo(()=>resolveSubtitleCues(project),[project]);
  const mix=audioMixSettings(project),windows=useMemo(()=>duckingWindows(project),[project]);
  const captions=subtitleStyle(project),palette=subtitlePalette[captions.preset];
  const frame=Math.floor(Math.max(0,playhead)*project.fps+1e-6);
  const active=clips.filter(item=>frame>=item.startFrame&&frame<item.endFrame);
  const subtitles=cues.filter(item=>frame>=item.startFrame&&frame<item.endFrame);
  return <>
    {active.map(item=><MediaLayer source={source} onSourceError={onSourceError} key={`${project.id}:${item.track.id}:${item.clip.id}`} item={item} playhead={playhead} playing={playing} fps={project.fps} aspect={projectAspectRatio(project.format)} audible={audibleInSolo(solo,`track:${item.track.id}`)} duckGain={!item.clip.dialogueLineId&&mix.musicTrackIds.includes(item.track.id)?duckGainAt(playhead,windows,mix):1} onBlocked={onBlocked}/>)}
    {!!subtitles.length&&<div className="viewer-subtitles" style={{top:captions.position==='top'?`${captions.safeMargin}%`:undefined,bottom:captions.position==='bottom'?`${captions.safeMargin}%`:'auto',left:`${captions.safeMargin}%`,right:`${captions.safeMargin}%`,fontSize:`${captions.size}cqw`,color:palette.text,background:palette.plate+Math.round(palette.alpha*255).toString(16).padStart(2,'0'),textShadow:'none'}} aria-label="Subtítulos en el visor">{subtitles.map(({cue})=><span key={cue.id}>{cue.text}</span>)}</div>}
  </>;
}
