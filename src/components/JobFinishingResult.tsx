import type {Job} from '../types';
export default function JobFinishingResult({job}:{job:Job}){
 const result=job.result?.finishing;
 if(!result)return null;
 return <details className="job-finishing-items"><summary>{result.created} nuevas · {result.reused} reutilizadas{result.errors?` · ${result.errors} con incidencias`:''} · Ver fuentes</summary><ul>{result.items.map((item,index)=><li key={`${item.sourceAssetId}:${index}`}><strong>{item.name}</strong> — {{created:'Copia creada',reused:'Copia reutilizada',skipped:'Original conservado',error:'No se pudo mejorar'}[item.status]||item.status}{item.message?`: ${item.message}`:''}</li>)}</ul>{['failed','cancelled'].includes(job.status)&&<p>Los originales y las copias terminadas se conservan. Vuelve a preparar la película o exportarla para continuar con las fuentes pendientes.</p>}</details>;
}
