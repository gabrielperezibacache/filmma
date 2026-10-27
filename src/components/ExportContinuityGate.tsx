import {useEffect,useState} from 'react';
import {ArrowRight,CheckCheck,ScanEye} from 'lucide-react';
import type {Project} from '../types';
import type {VisualContinuityState} from '../visual-continuity';
import {visualReportReady} from '../visual-review';
import {api} from '../api';
import {aiCopyMatchesSettings} from '../film-finishing';
import './visual-continuity.css';
export type ContinuityExportApproval={continuityReportId:string;continuityFingerprint:string};
type Props={project:Project;aiEnhance:boolean;onReady:(value:ContinuityExportApproval|null)=>void;onOpen:()=>void;onPersist:()=>Promise<void>};
export default function ExportContinuityGate({project,aiEnhance,onReady,onOpen,onPersist}:Props){
 const [data,setData]=useState<VisualContinuityState|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const sources=[...project.scenes.map(scene=>scene.videoAssetId??scene.assetId),...(project.tracks??[]).filter(track=>track.type==='video').flatMap(track=>track.clips.map(clip=>clip.assetId))].map(id=>project.assets.find(asset=>asset.id===id)).filter(asset=>asset?.type==='video');
 const aiPrepared=!aiEnhance||sources.every(asset=>aiCopyMatchesSettings(asset,project.aiFinishing));
 const revision=JSON.stringify({id:project.id,scenes:project.scenes,characters:project.characters,assets:project.assets,tracks:project.tracks,fps:project.fps,format:project.format,aiFinishing:project.aiFinishing});
 useEffect(()=>{let alive=true;setLoading(true);setError('');onReady(null);void(async()=>{try{await onPersist();if(!alive)return;const value=await api<VisualContinuityState>(`/continuity?projectId=${encodeURIComponent(project.id)}`);if(!alive)return;setData(value);if(aiPrepared&&visualReportReady(value.report,value.stale)&&value.report)onReady({continuityReportId:value.report.id,continuityFingerprint:value.report.fingerprint})}catch(e){if(alive)setError(e instanceof Error?e.message:'No se pudo comprobar la revisión.')}finally{if(alive)setLoading(false)}})();return()=>{alive=false}},[revision,aiPrepared]);
 const ready=aiPrepared&&visualReportReady(data?.report,data?.stale??true);
 return <div className="export-continuity-gate"><h3>{ready?<CheckCheck size={16}/>:<ScanEye size={16}/>}Continuidad antes de exportar</h3><p role="status">{loading?'Comprobando la revisión de estas fuentes…':error||!aiPrepared&&'Prepara y usa las versiones IA en Acabado de la película; después revisa esas copias.'||ready&&'Las comparaciones y el visionado están revisados para este montaje.'||data?.stale&&'El montaje cambió. Actualiza la revisión de continuidad.'||'Analiza y revisa las apariciones de personajes y objetos antes de entregar en 4K.'}</p>{aiEnhance&&<p>Si usarás IA, prepara y aplica sus versiones antes de revisarlas. La exportación sólo reutilizará las copias revisadas.</p>}<button className="text-button" onClick={onOpen}>{ready?'Ver revisión':'Abrir revisión de continuidad'}<ArrowRight size={14}/></button></div>;
}
