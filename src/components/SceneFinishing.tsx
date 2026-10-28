import ColorReview from './ColorReview';
import {aiProcessingLabel} from '../ai-processing';
import {useEffect,useState} from 'react';
import {Gauge,ImageUpscale,LoaderCircle,Palette,Undo2} from 'lucide-react';
import type {Asset,EnhancementPreset,Job,Project,Scene} from '../types';
import AiUpscaleControls from './AiUpscaleControls';
import EnhancementReview from './EnhancementReview';
import ColorControls from './ColorControls';
import './finishing.css';

type Props={project:Project;scene:Scene;asset?:Asset;jobs:Job[];bypass:boolean;onBypass:(value:boolean)=>void;onChange:(patch:Partial<Scene>)=>void;onEnhance:(assetId:string,preset:EnhancementPreset,strength?:number,processingProfile?:'conservative'|'restore'|'temporal')=>Promise<void>;onJob:(job:Job)=>void;onPause:()=>void;onSave:()=>Promise<void>;busy:boolean};
export default function SceneFinishing({project,scene,asset,jobs,bypass,onBypass,onChange,onEnhance,onJob,onPause,onSave,busy}:Props) {
  const [colorReview,setColorReview]=useState(false);
  const [reviewId,setReviewId]=useState<string|null>(null);
  useEffect(()=>setReviewId(null),[scene.id]);
  const review=project.assets.find(item=>item.id===reviewId);
  const index=project.scenes.findIndex(item=>item.id===scene.id),previous=project.scenes[index-1];
  const original=project.assets.find(item=>item.id===(asset?.enhancement?.sourceAssetId??asset?.id));
  const versions=project.assets.filter(item=>item.enhancement?.sourceAssetId===original?.id);
  const failed=jobs.find(job=>job.type==='enhance')?.status==='failed'?jobs.find(job=>job.type==='enhance'):undefined;
  const active=jobs.find(job=>job.type==='enhance'&&['running','queued'].includes(job.status));
  const characters=project.characters.filter(item=>scene.characterIds.includes(item.id));
  return <div className="scene-finishing">
    <div className="finishing-heading"><Palette size={17}/><h3>El acabado del plano</h3></div>
    <p>Estos ajustes acompañan a «{scene.title}» al reordenarlo. {characters.length?`Elementos: ${characters.map(item=>item.name).join(', ')}.`:'El guion y la duración del montaje se conservan.'}</p>
    <button className="quiet-button" onClick={()=>{onPause();setColorReview(true)}}>Scopes y comparación entre planos</button>
    <ColorControls color={scene.color} onChange={color=>onChange({color})}/>
    <div className="finishing-actions"><button className="quiet-button" aria-pressed={bypass} onClick={()=>onBypass(!bypass)}>{bypass?'Ver color editado':'Comparar sin corrección'}</button>
    <button className="text-button" disabled={!previous} onClick={()=>onChange({color:{...previous?.color},look:previous?.look})}>Copiar color del plano anterior</button></div>
    <label className="field"><span>Tratamiento de película</span><select value={scene.look??'original'} onChange={e=>onChange({look:e.target.value as Scene['look']})}><option value="original">Original</option><option value="warm">Cálido analógico</option><option value="noir">Cine negro</option></select><small>Los tratamientos de película mantienen su aproximación en el visor; la corrección se exporta con el plano.</small></label>
    <section className="finishing-section"><h3><Gauge size={16}/>Velocidad de la toma</h3><label className="field"><span>Reproducción del original</span><select aria-label="Velocidad de la toma" disabled={asset?.type!=='video'} value={scene.speed??1} onChange={e=>onChange({speed:Number(e.target.value)})}>{[.25,.5,.75,1,1.25,1.5,2,3,4].map(rate=><option key={rate} value={rate}>{rate}×{rate===1?' · Normal':rate<1?' · Cámara lenta':''}</option>)}{![.25,.5,.75,1,1.25,1.5,2,3,4].includes(scene.speed??1)&&<option value={scene.speed}>{scene.speed}×</option>}</select></label><p>La duración del plano sigue siendo {scene.duration.toFixed(2)} s. Cambia el recorrido por el original; las voces conservan su tono. Al agotarse la toma, se mantiene el último fotograma en silencio.</p>{asset?.type!=='video'&&<p>Asigna un video para cambiar su velocidad.</p>}</section>
    <AiUpscaleControls sceneId={scene.id} hasVideo={original?.type==='video'} busy={busy} jobs={jobs} previousStrength={project.assets.find(item=>item.id===previous?.videoAssetId)?.enhancement?.strength} previousProcessingProfile={project.assets.find(item=>item.id===previous?.videoAssetId)?.enhancement?.profile} onStart={(strength,processingProfile)=>original?onEnhance(original.id,'ai-4k',strength,processingProfile):Promise.resolve()} onJob={onJob}/>
    {failed&&!active&&<p role="alert" className="danger">Última mejora: {failed.message} Puedes reintentar o elegir otro archivo.</p>}
    {active&&<div className="enhancement-progress" role="status"><LoaderCircle size={15} className="spin"/><span>{active.message}</span><progress max={100} value={active.progress}/></div>}
    <section className="finishing-section"><h3><ImageUpscale size={16}/>Mejorar imagen</h3><p>Crea otra versión con limpieza suave y enfoque. El reescalado amplía hasta 2×, con un máximo de 4K, conservando el encuadre y el audio.</p><div className="finishing-actions"><button className="quiet-button" disabled={busy||!!active||original?.type!=='video'} onClick={()=>original&&void onEnhance(original.id,'clean')}>Limpiar imagen</button><button className="quiet-button" disabled={busy||!!active||original?.type!=='video'} onClick={()=>original&&void onEnhance(original.id,'upscale')}><ImageUpscale size={14}/>Reescalar 2×</button></div><p className="finishing-detail">Proceso local convencional. Mejora la presentación; no recupera detalles reales que la toma no contiene.</p>
    </section>
    <section className="finishing-section"><h3>Versiones y continuidad</h3>
    {!versions.length&&<p>Las mejoras aparecerán aquí para compararlas con la toma original antes de incorporarlas al montaje.</p>}
    {asset?.enhancement&&<p className="version-current">Usando versión mejorada · {asset.enhancement.width} × {asset.enhancement.height}</p>}
    {!!versions.length&&<div className="enhancement-versions"><h4>Versiones de esta toma</h4>{versions.map(version=><div key={version.id}><span>{version.enhancement?.preset==='ai-4k'?aiProcessingLabel(version.enhancement.profile)+' · '+Math.round((version.enhancement.strength??.35)*100)+' %':version.enhancement?.preset==='upscale'?'Reescalada':'Limpieza'}<small>{version.enhancement?.width} × {version.enhancement?.height}</small></span><button className="text-button" onClick={()=>{onPause();setReviewId(version.id)}}>Comparar</button><button className="text-button" disabled={asset?.id===version.id} onClick={()=>onChange({videoAssetId:version.id})}>{asset?.id===version.id?'En uso':'Usar versión'}</button></div>)}</div>}
    {asset?.enhancement&&original&&<button className="text-button" onClick={()=>onChange({videoAssetId:original.id})}><Undo2 size={14}/>Usar original</button>}
    </section>
    {colorReview&&<ColorReview project={project} sceneId={scene.id} onChange={onChange} onSave={onSave} onClose={()=>setColorReview(false)}/>}
    {review&&original&&<EnhancementReview key={review.id} original={original} version={review} characters={characters.map(item=>item.name)} applied={asset?.id===review.id} onApply={()=>onChange({videoAssetId:review.id})} onClose={()=>setReviewId(null)}/>}
  </div>;
}
