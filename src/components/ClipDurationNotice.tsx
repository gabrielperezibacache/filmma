import {useEffect,useState} from 'react';
import type {Asset,Scene} from '../types';
import {knownVideoDuration,secondsLabel,sourceCoverage} from '../generation-profile';

export default function ClipDurationNotice({asset,scene,fps,onFit}:{asset?:Asset;scene:Scene;fps:number;onFit:(seconds:number)=>void}){
 const known=knownVideoDuration(asset);
 const [measured,setMeasured]=useState<{url:string;seconds:number}|null>(null);
 useEffect(()=>{
  if(asset?.type!=='video'||known!==undefined)return;
  const video=document.createElement('video');video.preload='metadata';
  const url=asset.url;
  const loaded=()=>{if(Number.isFinite(video.duration)&&video.duration>0)setMeasured({url,seconds:video.duration})};
  video.addEventListener('loadedmetadata',loaded);video.src=url;
  return()=>{video.removeEventListener('loadedmetadata',loaded);video.removeAttribute('src');video.load()};
 },[asset?.type,asset?.url,known]);
 const duration=known??(measured?.url===asset?.url?measured?.seconds:undefined);
 if(duration===undefined)return null;
 const coverage=sourceCoverage(scene,duration,fps);
 if(!coverage.short)return null;
 return <div className="clip-duration-notice" role="status"><p>La toma cubre <strong>{secondsLabel(coverage.available)} s</strong> con este recorte y velocidad. El montaje dura {secondsLabel(scene.duration)} s: al agotarse la toma, se mantendrá el último fotograma en silencio.</p>{coverage.canFit?<button className="text-button" onClick={()=>onFit(coverage.fitted)}>Ajustar montaje a {secondsLabel(coverage.fitted)} s</button>:<p>Elige una toma más larga o reduce el recorte. Este fragmento no alcanza el mínimo de un segundo del montaje.</p>}</div>;
}
