import {useRef,useState} from 'react';
import type {PointerEvent} from 'react';
import {Crosshair,RotateCcw} from 'lucide-react';
import type {VisualRegion,VisualSample} from '../visual-continuity';
import {boundedRegion,normalizedRegion} from '../visual-review';

type Props={sample:VisualSample;name:string;region?:VisualRegion;manual:boolean;disabled:boolean;time:number;maxTime:number;onTime:(time:number)=>void;onRegion:(region:VisualRegion|undefined)=>void};
export default function ContinuityFrame({sample,name,region,manual,disabled,time,maxTime,onTime,onRegion}:Props){
 const [drawing,setDrawing]=useState(false),[draft,setDraft]=useState<VisualRegion|null>(null),[failed,setFailed]=useState(false);
 const start=useRef<{x:number;y:number}|null>(null),active=useRef<VisualRegion|null>(null);
 const point=(event:PointerEvent<HTMLDivElement>)=>{const b=event.currentTarget.getBoundingClientRect();return{x:(event.clientX-b.left)/b.width,y:(event.clientY-b.top)/b.height}};
 const cancel=()=>{start.current=null;active.current=null;setDraft(null)};
 const shown=draft??region;
 const names={x:'Posición horizontal',y:'Posición vertical',width:'Ancho',height:'Alto'};
 return <figure className="continuity-frame"><figcaption><strong>{sample.sceneTitle}</strong><span>{name} · {sample.sourceTime===undefined?'imagen fija':`fuente ${sample.sourceTime.toFixed(2)} s`}</span></figcaption>
  {sample.url&&!failed?<div className={`continuity-frame-image ${drawing?'drawing':''}`} onPointerDown={event=>{if(!drawing||disabled||event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);start.current=point(event);active.current=normalizedRegion(start.current,start.current);setDraft(active.current)}} onPointerMove={event=>{if(!start.current)return;active.current=normalizedRegion(start.current,point(event));setDraft(active.current)}} onPointerUp={event=>{const value=active.current;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);cancel();if(value&&value.width>=.02&&value.height>=.02){onRegion(value);setDrawing(false)}}} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event=>{if(event.key==='Escape'){cancel();setDrawing(false)}}} tabIndex={drawing?0:undefined} aria-label={drawing?`Dibuja una zona en ${name}. Escape cancela.`:undefined}>
   <img src={sample.url} draggable={false} alt={`Fotograma de ${sample.sceneTitle}, ${name.toLowerCase()}`} onError={()=>setFailed(true)}/>
   {shown&&<span title={manual?'Zona elegida':'Zona estimada'} className={`continuity-region ${manual?'manual':'automatic'}`} style={{left:`${shown.x*100}%`,top:`${shown.y*100}%`,width:`${shown.width*100}%`,height:`${shown.height*100}%`}}></span>}
  </div>:<div className="continuity-frame-missing">{sample.error||'Fotograma no disponible. Vuelve a analizar la película.'}</div>}
  <div className="continuity-frame-tools">{shown&&<small>{manual?'Zona elegida':'Zona estimada'}</small>}<button className="text-button" disabled={disabled||!sample.url||failed} aria-pressed={drawing} onClick={()=>{cancel();setDrawing(!drawing)}}><Crosshair size={15}/>{drawing?'Cancelar selección':'Delimitar zona'}</button>{manual&&<button className="text-button" disabled={disabled} onClick={()=>onRegion(undefined)}><RotateCcw size={13}/>Restablecer</button>}</div>
  <details className="continuity-frame-coordinates"><summary>Instante y coordenadas</summary><label>Instante dentro del plano (s)<input type="number" min="0" max={maxTime} step="0.01" value={Number(time.toFixed(3))} disabled={disabled} onChange={event=>onTime(Math.max(0,Math.min(maxTime,Number(event.target.value)||0)))}/></label><p>Cambiar el instante requiere analizar de nuevo para actualizar la imagen.</p><div>{(Object.keys(names) as (keyof VisualRegion)[]).map(key=><label key={key}>{names[key]} (%)<input aria-label={`${names[key]} de ${name.toLowerCase()} (%)`} type="number" min={key==='x'||key==='y'?0:2} max="100" step="1" disabled={disabled||!sample.url} value={Math.round((shown??{x:.2,y:.2,width:.6,height:.6})[key]*100)} onChange={event=>onRegion(boundedRegion({...shown??{x:.2,y:.2,width:.6,height:.6},[key]:Number(event.target.value)/100}))}/></label>)}</div></details>
 </figure>;
}
