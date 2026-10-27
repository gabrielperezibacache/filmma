import {defaultAiStrength,maxAiStrength,aiProcessingLabel} from '../ai-processing';
import {useEffect,useState} from 'react';
import {Check,ChevronDown,Download,ImageUpscale,LoaderCircle,Undo2} from 'lucide-react';
import type {AiUpscalerStatus,FinishingSummary,Job,Project} from '../types';
import {api} from '../api';
import {originalAssetId} from '../film-finishing';
import EnhancementReview from './EnhancementReview';
import './film-finishing.css';

type Props={project:Project;jobs:Job[];busy:boolean;onChange:(value:{enabled:boolean;strength:number;processingProfile?:'conservative'|'restore'|'temporal'})=>void;onPrepare:()=>Promise<void>;onRestore:()=>void;onJob:(job:Job)=>void;onCancel:(id:string)=>void;onReview:(id:string)=>void;onPause:()=>void};
export default function FilmFinishing({project,jobs,busy,onChange,onPrepare,onRestore,onJob,onCancel,onReview,onPause}:Props){
 const [status,setStatus]=useState<AiUpscalerStatus|null>(null),[error,setError]=useState(''),[preparing,setPreparing]=useState(false);
 const [review,setReview]=useState<{assetId:string;sceneId:string}|null>(null);
 useEffect(()=>setReview(null),[project.id]);
 const reviewAsset=project.assets.find(asset=>asset.id===review?.assetId);
 const reviewOriginal=reviewAsset&&project.assets.find(asset=>asset.id===originalAssetId(reviewAsset.id,project.assets));
 const reviewScene=project.scenes.find(scene=>scene.id===review?.sceneId);
 const settings=project.aiFinishing??{enabled:false,strength:.35};
 const processingProfile=settings.processingProfile??'conservative';
 const active=jobs.find(job=>['enhance','generate','export'].includes(job.type)&&['running','queued'].includes(job.status));
 const latest=jobs.find(job=>job.result?.projectId===project.id&&job.result?.finishing);
 const summary:FinishingSummary|undefined=latest?.result?.finishing;
 const latestEnhance=jobs.find(job=>job.type==='enhance');
 const refresh=async()=>{try{setStatus(await api('/upscaler'));setError('')}catch(e){setError(e instanceof Error?e.message:'No se pudo comprobar la IA local.')}};
 useEffect(()=>{let alive=true;void api<AiUpscalerStatus>('/upscaler').then(value=>{if(alive){setStatus(value);setError('')}}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'No se pudo comprobar la IA local.')});return()=>{alive=false}},[latestEnhance?.id,latestEnhance?.status]);
 const setup=async()=>{setPreparing(true);try{const result=await api<{job:Job}>('/upscaler/setup',{temporal:processingProfile==='temporal'});onJob(result.job);setError('')}catch(e){setError(e instanceof Error?e.message:'No se pudo preparar la IA local.')}finally{setPreparing(false)}};
 const videos=project.scenes.filter(scene=>project.assets.find(asset=>asset.id===scene.videoAssetId)?.type==='video');
 const images=project.scenes.filter(scene=>!scene.videoAssetId&&project.assets.find(asset=>asset.id===scene.assetId)?.type==='image');
 const layers=(project.tracks??[]).filter(track=>track.type==='video').flatMap(track=>track.clips).filter(clip=>project.assets.find(asset=>asset.id===clip.assetId)?.type==='video');
 const selected=[...videos.map(scene=>scene.videoAssetId!),...layers.map(clip=>clip.assetId)];
 const applied=selected.filter(id=>project.assets.find(asset=>asset.id===id)?.enhancement?.preset==='ai-4k').length;
 const ownActive=active?.result?.projectId===project.id?active:undefined;
 return <details className="film-finishing">
  <summary><ImageUpscale size={18}/><span><strong>Acabado de la película</strong><small>{settings.enabled?'IA después de generar':'IA local para toda la secuencia'} · {aiProcessingLabel(processingProfile)} · {Math.round(settings.strength*100)} %</small></span><ChevronDown size={16}/></summary>
  <div className="film-finishing-body">
   <p className="film-finishing-intro">Una misma intensidad para tus planos y capas de video. Se conserva cada original y se reutilizan las copias compatibles que ya estén terminadas.</p>
   <div className="film-finishing-counts"><span>{videos.length} {videos.length===1?'plano':'planos'} con video</span><span>{layers.length} {layers.length===1?'capa':'capas'} de video</span><span>{images.length} {images.length===1?'imagen fija':'imágenes fijas'}</span>{project.scenes.length>videos.length+images.length&&<span>{project.scenes.length-videos.length-images.length} planos sin material</span>}</div>
   <div className="film-finishing-settings">
    <label className="film-finishing-toggle"><input type="checkbox" checked={settings.enabled} onChange={event=>onChange({...settings,enabled:event.target.checked})}/><span>Mejorar cada toma después de generarla<small>También al generar los planos pendientes. La toma original se guarda primero.</small></span></label>
    <label className="field"><span>Tratamiento de toda la película</span><select aria-label="Tratamiento de toda la película" value={processingProfile} onChange={event=>{const mode=event.target.value as 'conservative'|'restore'|'temporal';onChange({...settings,processingProfile:mode,strength:defaultAiStrength(mode)})}} disabled={!!active||busy}><option value="conservative">Conservar textura</option><option value="restore">Restaurar definición</option><option value="temporal">Restauración estable · entre fotogramas</option></select></label>
    <label className="film-finishing-strength"><span>Intensidad de toda la película<output>{Math.round(settings.strength*100)} %</output></span><input type="range" aria-label="Intensidad de toda la película" min="15" max={maxAiStrength(processingProfile)*100} step="5" value={Math.round(settings.strength*100)} onChange={event=>onChange({...settings,strength:Number(event.target.value)/100})} disabled={!!active||busy}/></label>
   </div>
   {processingProfile==='temporal'&&<p className="film-finishing-note">Estabiliza sólo el detalle añadido por IA donde coincida el movimiento. Descarta referencias en cortes y zonas nuevas. Empieza con 65 %; revisa varios fotogramas para comprobar textura y posibles estelas.</p>}
   {processingProfile==='restore'&&<p className="film-finishing-note">La restauración puede cambiar texturas y rasgos. Compara las copias al 100 % y revisa varios fotogramas; aplicar la misma intensidad no garantiza continuidad.</p>}
   <div className="film-finishing-actions">{status?.ready&&(processingProfile!=='temporal'||status.temporalAvailable)?<button className="primary" disabled={busy||!!active||!selected.length} onClick={()=>void onPrepare()}><ImageUpscale size={16}/>Preparar y usar versiones IA</button>:<button className="quiet-button" disabled={busy||preparing||!!active||!status||status.supported===false} onClick={()=>void setup()}>{preparing?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>}{processingProfile==='temporal'?'Preparar acabado estable':'Preparar IA local'}</button>}
    <button className="text-button" disabled={!applied||busy||!!active} onClick={onRestore}><Undo2 size={14}/>Volver a originales</button>
   </div>
   {error?<p role="alert" className="danger">{error} <button className="text-button" onClick={()=>void refresh()}>Reintentar comprobación</button></p>:!status?<p role="status">Comprobando el motor local…</p>:!status.ready?<p>{status.message||'Prepara el motor antes de mejorar los planos.'}</p>:null}
   <p className="film-finishing-note">Se aplicarán las copias al montaje conservando guion, personajes, recortes, color, velocidad y sonido. Revisa rostro y vestuario en Acabado → Comparar. Las imágenes fijas mantienen su original; los videos admiten hasta 15 s, SDR y Full HD de origen.</p>
   {ownActive&&<div className="film-finishing-progress" role="status"><LoaderCircle size={15} className="spin"/><span>{ownActive.message}</span><button className="text-button" onClick={()=>onCancel(ownActive.id)}>Cancelar</button><progress max="100" value={ownActive.progress}/></div>}
   {summary&&latest&&<div className="film-finishing-result"><p>{latest.status==='completed'&&!summary.errors&&<Check size={14}/>} {summary.created} copias nuevas · {summary.reused} reutilizadas{summary.errors?` · ${summary.errors} con incidencias`:''}</p>{['failed','cancelled'].includes(latest.status)&&<p role="status">{latest.status==='cancelled'?'Proceso cancelado.':'La preparación quedó incompleta.'} Las copias terminadas se conservan. Puedes volver a preparar la película para continuar.</p>}{summary.items.filter(item=>item.status==='error').map(item=><p className="danger" key={item.sourceAssetId}>{item.name}: {item.message}</p>)}</div>}
   {!!applied&&<div className="film-finishing-review"><span>Revisar continuidad de las versiones en uso</span>{videos.filter(scene=>project.assets.find(asset=>asset.id===scene.videoAssetId)?.enhancement?.preset==='ai-4k').map(scene=><button className="text-button" key={scene.id} onClick={()=>onReview(scene.id)}>{scene.title}</button>)}{layers.filter(clip=>project.assets.find(asset=>asset.id===clip.assetId)?.enhancement?.preset==='ai-4k').map(clip=><button className="text-button" key={clip.id} onClick={()=>{onPause();setReview({assetId:clip.assetId,sceneId:clip.sceneId})}}>Capa · {project.scenes.find(scene=>scene.id===clip.sceneId)?.title??'Video'}</button>)}</div>}
   {reviewAsset&&reviewOriginal&&<EnhancementReview key={reviewAsset.id} original={reviewOriginal} version={reviewAsset} applied={true} characters={project.characters.filter(character=>reviewScene?.characterIds.includes(character.id)).map(character=>character.name)} onApply={()=>{}} onClose={()=>setReview(null)}/>}
  </div>
 </details>;
}
