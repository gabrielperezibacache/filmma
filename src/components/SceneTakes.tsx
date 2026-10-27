import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,Clapperboard,Columns2,Play,X} from 'lucide-react';
import type {Asset,Job,Project,Scene} from '../types';
import {listSceneTakes} from '../takes';
import './cinema-tools.css';

type Props={project:Project;scene:Scene;jobs:Job[];busy:boolean;modelName:string;needsPreparation:boolean;onGenerate:(count:number)=>Promise<void>;onSelect:(assetId:string)=>void;onPause:()=>void};
function TakeVideo({asset,label,onPlay}:{asset:Asset;label:string;onPlay?:()=>void}){
 const [failed,setFailed]=useState(false);
 return failed?<p role="alert" className="take-media-error">No se pudo abrir esta toma. Comprueba el archivo en Biblioteca antes de seleccionarlo.</p>:<video src={asset.url} controls muted playsInline preload="metadata" aria-label={label} onPlay={onPlay} onError={()=>setFailed(true)}/>;
}
function TakeComparison({assets,currentId,characters,onSelect,onClose}:{assets:Asset[];currentId?:string;characters:string[];onSelect:(id:string)=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [leftId,setLeftId]=useState(currentId??assets[0]?.id??''),[rightId,setRightId]=useState(assets.find(asset=>asset.id!==(currentId??assets[0]?.id))?.id??'');
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close()},[]);
 return createPortal(<dialog ref={dialog} className="take-comparison" aria-labelledby="take-comparison-title" onCancel={e=>{e.preventDefault();onClose()}} onKeyDown={e=>e.stopPropagation()}>
  <header><div><h2 id="take-comparison-title">Encuentra la toma.</h2><p>{characters.length?characters.join(', '):'Alternativas del mismo plano'} · Revisa actuación, movimiento y continuidad.</p></div><button className="icon-button" aria-label="Cerrar comparación de tomas" onClick={onClose}><X size={18}/></button></header>
  <div className="take-compare-grid">{([{id:leftId,set:setLeftId,label:'Toma izquierda'},{id:rightId,set:setRightId,label:'Toma derecha'}]).map(side=>{const asset=assets.find(item=>item.id===side.id);return <section key={side.label}><label className="field"><span>{side.label}</span><select value={side.id} onChange={e=>side.set(e.target.value)}>{assets.map((item,index)=><option key={item.id} value={item.id}>{index+1}. {item.name}{item.id===currentId?' · En montaje':''}</option>)}</select></label>{asset&&<><TakeVideo key={asset.id} asset={asset} label={`Reproducir ${side.label.toLowerCase()}`}/><p className="take-source-note">{asset.generation?`${asset.generation.model} · Semilla ${asset.generation.seed}`:asset.lipSync?'MuseTalk · copia sincronizada':asset.enhancement?'Versión mejorada de una toma':'Archivo importado o anterior al historial de tomas'}</p><button className="quiet-button" disabled={asset.id===currentId} onClick={()=>{onSelect(asset.id);onClose()}}><Check size={15}/>{asset.id===currentId?'En el montaje':'Usar esta toma'}</button></>}</section>})}</div>
  <footer><p>Cada toma se reproduce por separado, con sus tiempos originales y sin el acabado del montaje. Seleccionar una alternativa conserva el guion y los personajes; una fuente distinta comienza desde el inicio, a velocidad normal.</p></footer>
 </dialog>,document.body);
}
export default function SceneTakes({project,scene,jobs,busy,modelName,needsPreparation,onGenerate,onSelect,onPause}:Props){
 const gallery=useRef<HTMLDivElement>(null);
 const [count,setCount]=useState(2),[comparing,setComparing]=useState(false),[shown,setShown]=useState(6);
 const takes=listSceneTakes(project,scene.id);
 const active=jobs.filter(job=>job.type==='generate'&&job.result?.projectId===project.id&&job.result?.sceneId===scene.id&&['running','queued'].includes(job.status));
 useEffect(()=>setComparing(false),[project.id,scene.id]);
 return <section className="scene-takes" aria-labelledby="scene-takes-title">
  <h3 id="scene-takes-title"><Clapperboard size={17}/>Tomas de este plano</h3>
  <p>Explora alternativas sin añadir planos al montaje. El guion y los personajes siguen vinculados a «{scene.title}».</p>
  <div className="take-create"><label className="field"><span>Nuevas tomas</span><select value={count} onChange={e=>setCount(Number(e.target.value))} disabled={busy}>{[1,2,3,4].map(n=><option key={n} value={n}>{n} {n===1?'toma':'tomas'}</option>)}</select></label><button className="primary" disabled={busy} onClick={()=>void onGenerate(count)}><Play size={15}/>{needsPreparation?'Preparar el modelo':`Generar ${count} ${count===1?'toma':'tomas'}`}</button></div>
  <p className="take-create-note">{modelName}. Usa la duración y calidad del panel de generación. Cambia la semilla de cada toma y procesa una a la vez. Elige después cuál usar.</p>
  {!!active.length&&<div className="take-queue" role="status"><p>{active.length} {active.length===1?'toma en preparación':'tomas en preparación'}. Puedes seguir editando y cancelar desde Actividad.</p>{active.filter(job=>job.status==='running').map(job=><div key={job.id}><p>{job.message}</p><progress max={100} value={job.progress}/></div>)}</div>}
  <button className="quiet-button take-compare-open" disabled={takes.length<2} onClick={()=>{onPause();gallery.current?.querySelectorAll('video').forEach(video=>video.pause());setComparing(true)}}><Columns2 size={15}/>Comparar dos tomas</button>
  {!takes.length&&<div className="takes-empty"><Clapperboard size={24}/><p>Las nuevas tomas aparecerán aquí. Los archivos anteriores siguen disponibles en Biblioteca.</p></div>}
  <div className="takes-list" ref={gallery}>{takes.slice(0,shown).map(({asset,originalAsset,generation,selected,isDerivative},index)=><article key={asset.id} className={selected?'take-in-use':''}>
   <div className="take-heading"><strong>{String(index+1).padStart(2,'0')} · {isDerivative?'Versión mejorada':asset.lipSync?'Labios sincronizados':'Toma'}</strong>{selected&&<span><Check size={13}/>En montaje</span>}</div>
   <TakeVideo asset={asset} label={`Vista previa de ${asset.name}`} onPlay={onPause}/>
   <h4>{asset.name}</h4><p>{generation?`${generation.model} · Semilla ${generation.seed}`:originalAsset.lipSync?`MuseTalk · ${originalAsset.lipSync.fps} fps · original conservado`:'Archivo sin parámetros de generación registrados'}</p>
   {generation&&<details className="take-details"><summary>Cómo se creó</summary><dl><div><dt>Tamaño de generación</dt><dd>{generation.width} × {generation.height}</dd></div><div><dt>Fotogramas</dt><dd>{generation.numFrames} · {generation.fps} fps</dd></div></dl><h5>Prompt enviado</h5><pre>{generation.prompt}</pre></details>}
   <button className="text-button" disabled={selected||busy} onClick={()=>{onPause();onSelect(asset.id)}}>{selected?'Toma seleccionada':'Usar en este plano'}</button>
  </article>)}</div>
  {takes.length>shown&&<button className="quiet-button" onClick={()=>setShown(value=>value+6)}>Mostrar más tomas · {takes.length-shown} restantes</button>}
  {comparing&&<TakeComparison assets={takes.map(t=>t.asset)} currentId={scene.videoAssetId} characters={project.characters.filter(c=>scene.characterIds.includes(c.id)).map(c=>c.name)} onSelect={onSelect} onClose={()=>setComparing(false)}/>}
 </section>;
}
