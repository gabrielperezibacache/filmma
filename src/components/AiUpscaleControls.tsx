import {defaultAiStrength,maxAiStrength} from '../ai-processing';
import {useEffect,useState} from 'react';
import {Download,ImageUpscale,LoaderCircle,RefreshCw} from 'lucide-react';
import type {AiUpscalerStatus,Job} from '../types';
import {api} from '../api';

type ProcessingProfile='conservative'|'restore'|'temporal';
type Props={sceneId:string;hasVideo:boolean;busy:boolean;jobs:Job[];previousStrength?:number;previousProcessingProfile?:ProcessingProfile;onStart:(strength:number,processingProfile:ProcessingProfile)=>Promise<void>;onJob:(job:Job)=>void};
export default function AiUpscaleControls({sceneId,hasVideo,busy,jobs,previousStrength,previousProcessingProfile,onStart,onJob}:Props){
  const [status,setStatus]=useState<AiUpscalerStatus|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[strength,setStrength]=useState(35),[preparing,setPreparing]=useState(false);
  const [processingProfile,setProcessingProfile]=useState<ProcessingProfile>('conservative');
  const active=jobs.find(job=>job.type==='enhance'&&['running','queued'].includes(job.status));
  const latest=jobs.find(job=>job.type==='enhance');
  const refresh=async()=>{setLoading(true);try{setStatus(await api<AiUpscalerStatus>('/upscaler'));setError('')}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo comprobar el motor.')}finally{setLoading(false)}};
  useEffect(()=>{let active=true;setLoading(true);void api<AiUpscalerStatus>('/upscaler').then(value=>{if(active){setStatus(value);setError('')}}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo comprobar el motor.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[latest?.id,latest?.status]);
  useEffect(()=>{setStrength(35);setProcessingProfile('conservative')},[sceneId]);
  const setup=async()=>{setPreparing(true);setError('');try{const result=await api<{job:Job}>('/upscaler/setup',{temporal:processingProfile==='temporal'});onJob(result.job)}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo preparar el motor.')}finally{setPreparing(false)}};
  return <section className="finishing-section ai-upscale-controls" aria-labelledby="ai-upscale-title">
    <h3 id="ai-upscale-title"><ImageUpscale size={16}/>Reescalado con IA local</h3>
    <p>Real-ESRGAN amplía la imagen y conserva una copia del original. La ganancia visible depende de la fuente: una toma pequeña o borrosa seguirá limitada, aunque se exporte en 4K.</p>
    {loading&&!status?<p role="status"><LoaderCircle size={13} className="spin"/> Comprobando el motor…</p>:status?.ready?<p className="ai-runtime-state">Motor local preparado · una toma a la vez</p>:!error&&<p>{status?.message||'El motor se prepara una vez en este Mac.'} {status?.downloadBytes?`Descarga aproximada: ${Math.ceil(status.downloadBytes/1e6)} MB.`:''}</p>}
    {error&&<p className="danger" role="alert">{error}</p>}
    {status?.ready?<>
      <label className="field"><span>Tratamiento de la copia</span><select aria-label="Tratamiento de la copia" value={processingProfile} onChange={event=>{const mode=event.target.value as ProcessingProfile;setProcessingProfile(mode);setStrength(defaultAiStrength(mode)*100)}} disabled={busy||!!active}><option value="conservative">Conservar textura</option><option value="restore">Restaurar definición</option><option value="temporal">Restauración estable · entre fotogramas</option></select></label>
      <div className="color-control"><label htmlFor="ai-detail-strength">Intensidad del tratamiento</label><output htmlFor="ai-detail-strength">{strength} %</output><input id="ai-detail-strength" type="range" min="15" max={maxAiStrength(processingProfile)*100} step="5" value={strength} onChange={event=>setStrength(Number(event.target.value))} disabled={busy||!!active}/></div>
      <p className="finishing-detail">{processingProfile==='temporal'?'Estabiliza sólo el detalle de IA entre fotogramas con movimiento compatible. Protege los cortes y las zonas nuevas; empieza al 65 % y revisa posibles estelas.':processingProfile==='restore'?'La restauración aplica más intervención de IA. Puede cambiar texturas y rasgos; compara al 100 % y revisa varios fotogramas antes de usarla.':'El 35 % inicial aplica un tratamiento suave, sin reconstrucción facial. Usa el mismo tratamiento entre planos y compara al 100 % antes de elegir una versión.'}</p>
      {previousStrength!=null&&<button className="text-button" disabled={busy||!!active} onClick={()=>{const mode=previousProcessingProfile??'conservative';setProcessingProfile(mode);setStrength(Math.min(maxAiStrength(mode)*100,Math.round(previousStrength*100)))}}>Igualar tratamiento del plano anterior</button>}
      {processingProfile==='temporal'&&!status.temporalAvailable&&<div className="finishing-actions"><button className="quiet-button" disabled={preparing||busy||!!active} onClick={()=>void setup()}><Download size={15}/>Preparar acabado estable · 38 MB</button></div>}
      <div className="finishing-actions"><button className="primary" disabled={busy||!!active||!hasVideo||(processingProfile==='temporal'&&!status.temporalAvailable)} onClick={()=>void onStart(strength/100,processingProfile)}><ImageUpscale size={15}/>Crear copia reescalada con IA</button></div>
    </>:<div className="finishing-actions"><button className="quiet-button" disabled={preparing||busy||!!active||loading||status?.supported===false} onClick={()=>void setup()}>{preparing?<LoaderCircle size={15} className="spin"/>:<Download size={15}/>}Preparar IA local</button>{error&&<button className="text-button" disabled={loading} onClick={()=>void refresh()}><RefreshCw size={14}/>Reintentar comprobación</button>}</div>}
    <p className="finishing-detail">Tomas de hasta 15 s, SDR y hasta 1080p de origen. Conserva encuadre, fotogramas y audio; la exportación termina de ajustar el lienzo 4K. La revisión permite detectar cambios de textura entre fotogramas.</p>
  </section>;
}
