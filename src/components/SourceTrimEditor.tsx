import {useEffect,useRef,useState} from 'react';
import {Check,Scissors,RotateCcw} from 'lucide-react';
import type {Asset,Scene} from '../types';
import {playbackSpeed} from '../visual-effects';
import {sourceTrim} from '../sourceTrim';
import './source-trim.css';

type Props={scene:Scene;asset:Asset;fps:number;onPreview?:()=>void;onApply:(patch:Pick<Scene,'trimStart'|'duration'>)=>void};
export default function SourceTrimEditor({scene,asset,fps,onApply,onPreview}:Props){
 const video=useRef<HTMLVideoElement>(null);
 const [seconds,setSeconds]=useState(0),[position,setPosition]=useState(0),[entry,setEntry]=useState(0),[exit,setExit]=useState(0),[message,setMessage]=useState('');
 const speed=playbackSpeed(scene.speed);
 const max=Math.floor(seconds*fps+1e-6);
 const stamp=(frame:number)=>`${Math.floor(frame/fps/60).toString().padStart(2,'0')}:${Math.floor(frame/fps%60).toString().padStart(2,'0')}:${Math.max(0,frame%fps).toString().padStart(2,'0')}`;
 const reset=(duration=seconds)=>{setEntry(Math.min(Math.max(0,Math.round((scene.trimStart||0)*fps)),Math.floor(duration*fps)));setExit(Math.min(Math.floor(duration*fps),Math.round(((scene.trimStart||0)+scene.duration*speed)*fps)));setMessage('')};
 useEffect(()=>{setSeconds(0);setPosition(0);setMessage('')},[asset.id]);
 useEffect(()=>{if(seconds)reset()},[scene.id,scene.trimStart,scene.duration,scene.speed,seconds,fps]);
 const seek=(frame:number)=>{if(video.current)video.current.currentTime=Math.min(frame/fps,Math.max(0,seconds-1/fps));setPosition(frame)};
 const apply=()=>{try{const patch=sourceTrim(entry,exit,seconds,fps,speed);video.current?.pause();onApply(patch);setMessage('Recorte aplicado al montaje. El original se conserva.')}catch(e){setMessage((e as Error).message)}};
 return <details className="source-trim" onToggle={e=>{if(!e.currentTarget.open)video.current?.pause()}}><summary><Scissors size={15}/>Recortar la toma original<span>{scene.trimStart?`Entrada ${stamp(Math.round(scene.trimStart*fps))}`:'Entrada al inicio'}</span></summary>
  <div className="source-trim-body"><p>Elige la entrada y la salida viendo el original. El recorte cambia la duración del plano; puedes deshacerlo.</p>
   <video key={asset.id} ref={video} src={asset.url} controls preload="metadata" playsInline onPlay={onPreview} aria-label="Video original para recortar" onLoadedMetadata={e=>{const duration=e.currentTarget.duration;if(Number.isFinite(duration)){setSeconds(duration);reset(duration)}}} onTimeUpdate={e=>setPosition(Math.floor(e.currentTarget.currentTime*fps))} onError={()=>setMessage('No se pudo abrir el original. Revisa el archivo en Biblioteca.')}/>
   <div className="source-position"><span>Original · {stamp(position)}</span><span>Duración · {stamp(max)}</span></div>
   <div className="source-ranges"><label>Entrada <strong>{stamp(entry)}</strong><input aria-label="Fotograma de entrada" type="range" min={0} max={max} step={1} value={entry} disabled={!max} onChange={e=>{setEntry(+e.target.value);setMessage('');seek(+e.target.value)}}/></label><label>Salida <strong>{stamp(exit)}</strong><input aria-label="Fotograma de salida" type="range" min={0} max={max} step={1} value={exit} disabled={!max} onChange={e=>{setExit(+e.target.value);setMessage('');seek(Math.max(0,+e.target.value-1))}}/></label></div>
   <div className="source-markers"><button className="quiet-button" disabled={!max} onClick={()=>{setEntry(position);setMessage('')}}>Marcar entrada aquí</button><button className="quiet-button" disabled={!max} onClick={()=>{setExit(Math.min(max,position+1));setMessage('')}}>Marcar salida aquí</button><span>{Math.max(0,(exit-entry)/fps/speed).toFixed(2)} s de montaje a {speed}×</span></div>
   {seconds>0&&(scene.trimStart||0)+scene.duration*speed>seconds+.05&&<p>El montaje actual prolonga el último fotograma del original. Aplicar este recorte termina el plano en la salida elegida.</p>}
   <div className="source-apply"><button className="text-button" onClick={()=>reset()} disabled={!max}><RotateCcw size={14}/>Restablecer selección</button><button className="primary small" onClick={apply} disabled={!max||exit-entry<fps*speed||exit-entry>120*fps*speed}><Check size={14}/>Aplicar recorte</button></div>
   {max>0&&exit-entry<fps*speed&&<p role="status">Conserva al menos un segundo entre entrada y salida.</p>}{message&&<p role="status">{message}</p>}
  </div>
 </details>
}
