import {AlertCircle,CheckCheck,LoaderCircle} from 'lucide-react';
import {tr} from '../i18n';

export default function SaveStatus({state,onRetry}:{state:string;onRetry:()=>void}){
 const error=state==='error',saved=state==='saved';
 const label=error?tr('Error al guardar','Save failed'):saved?tr('Guardado','Saved'):tr('Guardando…','Saving…');
 return <div className="studio-save-status" data-state={error?'error':saved?'saved':'pending'}>
  <span role="status" aria-live="polite" aria-atomic="true" aria-label={label} title={label}>{error?<AlertCircle size={15}/>:saved?<CheckCheck size={15}/>:<LoaderCircle size={15} className="spin"/>}<span>{label}</span></span>
  {error&&<button type="button" onClick={onRetry}>{tr('Reintentar','Retry')}</button>}
 </div>;
}
