import { useEffect, useRef, useState } from 'react';
import { Check, Chrome, Clipboard, Download, ExternalLink, LoaderCircle, Square, Unplug } from 'lucide-react';
import { api } from '../api';
import { tr } from '../i18n';
import './google-browser.css';
type Run = {
    id: string;
    requestId: string;
    profileId?:string;
    modelLabel?:string;
    projectId: string;
    sceneId: string;
    phase: string;
    message: string;
    bytes: number;
    pageUrl?: string;
    assetId?: string;
    submittedAt?: string;
    canRecoverDownload?: boolean;
};
export type GoogleProfileStatus={id:string;alias:string;connected:boolean;selected:boolean;version?:string;directory:string};
type Status = {
    selectedProfileId?:string;
    profiles?:GoogleProfileStatus[];
    configured: boolean;
    connected: boolean;
    extensionVersion?: string;
    discovery?:{active:boolean;expiresAt:string|null;devices:{id:string;extensionId:string;version:string;lastSeen:string}[]};
    runs: Run[];
};
export function useGoogleBrowser() { const [status, setStatus] = useState<Status>(), [error, setError] = useState(''); useEffect(() => { let alive = true; const load = () => api<Status>('/google-browser/status').then(value => { if (alive) {
    setStatus(value);
    setError('');
} }).catch(e => { if (alive)
    setError(e.message); }); void load(); const timer = setInterval(() => void load(), 3000); return () => { alive = false; clearInterval(timer); }; }, []); return { status, error }; }
function GoogleProfileRow({profile,act,busy}:{profile:GoogleProfileStatus;act:(path:string,body?:unknown)=>Promise<void>;busy:boolean}){
 const [alias,setAlias]=useState(profile.alias);
 return <li className="google-profile-row"><div><label>{tr('Nombre local del perfil','Local profile name')}<input aria-label={tr('Nombre del perfil','Profile name')+' '+profile.alias} value={alias} maxLength={80} onChange={e=>setAlias(e.target.value)}/></label><button className="text-button" disabled={busy||!alias.trim()||alias.trim()===profile.alias} onClick={()=>void act(`/google-browser/profiles/${profile.id}/rename`,{alias:alias.trim()})}>{tr('Guardar nombre','Save name')}</button><span>{profile.connected?tr('Chrome conectado','Chrome connected'):tr('Abre este perfil en Chrome','Open this Chrome profile')}{profile.selected?' · '+tr('Predeterminado','Default'):''}</span></div><div className="google-profile-actions"><button className="quiet-button" disabled={busy||!profile.connected} onClick={()=>void act(`/google-browser/profiles/${profile.id}/open`,{provider:'flow'})}>{tr('Abrir Flow en este perfil','Open Flow in this profile')}<ExternalLink size={14}/></button><button className="text-button" disabled={busy||profile.selected} onClick={()=>void act(`/google-browser/profiles/${profile.id}/select`)}>{tr('Usar por defecto','Use by default')}</button><button className="text-button" disabled={busy} onClick={()=>void act(`/google-browser/profiles/${profile.id}/revoke`)}><Unplug size={14}/>{tr('Revocar enlace','Revoke pairing')}</button></div><details><summary>{tr('Datos locales de este enlace','Local pairing data')}</summary><p>{tr('Las cookies permanecen en el perfil de Chrome. Esta carpeta sólo identifica el enlace de Filmma; no contiene tu sesión Google.','Cookies remain in the Chrome profile. This folder only identifies the Filmma pairing; it does not contain your Google session.')}</p><code>{profile.directory}</code></details></li>;
}
export default function GoogleBrowserConnection({headingLevel=3}:{headingLevel?:2|3}={}){
 const Heading=headingLevel===2?'h2':'h3',SubHeading=headingLevel===2?'h3':'h4';
 const {status,error:loadError}=useGoogleBrowser(),[pair,setPair]=useState<{code:string;expiresAt:string}>(),[alias,setAlias]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
 useEffect(()=>{if(!pair)return;const timer=setTimeout(()=>setPair(undefined),Math.max(0,Date.parse(pair.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[pair]);
 async function act(path:string,body:unknown={}){setBusy(true);setError('');setMessage('');try{const result=await api(path,body);if(result.message)setMessage(result.message);}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 async function createPair(){setBusy(true);setError('');try{setPair(await api('/google-browser/pairing',alias.trim()?{alias:alias.trim()}:{}));setCopied(false);}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 return <section className="google-browser-connection" aria-label={tr('Perfiles de Google en Chrome','Google profiles in Chrome')}><div className="google-browser-title"><Chrome size={23}/><div><Heading>{tr('Tus cuentas de Google, en este equipo','Your Google accounts, on this computer')}</Heading><span role="status">{status?.profiles?.length?tr(`${status.profiles.length} perfiles enlazados`,`${status.profiles.length} paired profiles`):tr('Añade tu primer perfil de Chrome','Add your first Chrome profile')}</span></div></div><p>{tr('Usa un perfil de Chrome distinto para cada cuenta de Google. Filmma dirige cada toma al perfil que eliges; Chrome conserva la sesión y las cookies localmente. No se exportan ni se suben a Filmma.','Use a separate Chrome profile for each Google account. Filmma routes each shot to the profile you choose; Chrome retains the session and cookies locally. They are never exported or uploaded to Filmma.')}</p>
 <ol className="google-profile-steps"><li>{tr('En Chrome, crea o abre un perfil e inicia sesión en Flow con su cuenta. Puedes dejar desactivada la sincronización de Chrome.','In Chrome, create or open a profile and sign in to Flow with its account. Chrome sync can stay disabled.')}</li><li>{tr('Carga Filmma Bridge 0.3.0 en ese perfil. La misma extensión puede instalarse en cada perfil; no necesita permisos nuevos.','Load Filmma Bridge 0.3.0 in that profile. The same extension can be installed in every profile; it needs no new permissions.')}</li><li>{tr('Detecta el perfil, ponle un nombre local y autoriza su enlace. Repite con tus otras cuentas.','Detect the profile, give it a local name and approve its pairing. Repeat for your other accounts.')}</li></ol>
 {status?.profiles&&status.profiles.length>0&&<ul className="google-profile-list">{status.profiles.map(profile=><GoogleProfileRow key={profile.id} profile={profile} act={act} busy={busy}/>)}</ul>}
 <div className="google-browser-discovery"><SubHeading>{tr('Añadir o reconectar un perfil','Add or reconnect a profile')}</SubHeading><label>{tr('Nombre local para el próximo enlace','Local name for the next pairing')}<input value={alias} onChange={e=>setAlias(e.target.value)} maxLength={80} placeholder={tr('Por ejemplo: Personal o Estudio','For example: Personal or Studio')}/></label><button className="primary" disabled={busy||status?.discovery?.active} onClick={()=>void act('/google-browser/discovery')}>{status?.discovery?.active?<LoaderCircle size={15} className="spin"/>:<Chrome size={15}/>} {status?.discovery?.active?tr('Buscando perfiles…','Looking for profiles…'):tr('Detectar Chrome','Detect Chrome')}</button>{status?.discovery?.devices.map(device=><div key={device.id} className="google-browser-device"><strong>Chrome · Filmma Bridge {device.version}</strong><small>{device.id.slice(0,8)}</small><button className="quiet-button" disabled={busy} onClick={()=>void act('/google-browser/approve-device',{id:device.id,...(alias.trim()?{alias:alias.trim()}:{})})}>{tr('Enlazar este perfil','Pair this profile')}</button></div>)}{status?.discovery?.active&&!status.discovery.devices.length&&<p role="status">{tr('Esperando a la extensión. Mantén abierto el perfil de Chrome; la detección puede tardar 30 segundos.','Waiting for the extension. Keep the Chrome profile open; detection may take 30 seconds.')}</p>}</div>
 <details><summary>{tr('Instalar extensión o enlazar por código','Install extension or pair with a code')}</summary><a className="text-button" href="/api/google-browser/extension" download><Download size={15}/>{tr('Descargar extensión local','Download local extension')}</a><p>{tr('Descomprime el ZIP. En chrome://extensions activa Modo desarrollador, elige Cargar descomprimida y selecciona Filmma-Google-Bridge. Si ya la tienes, recárgala una vez desde public/google-browser. Hazlo en cada perfil que quieras enlazar.','Unzip the ZIP. In chrome://extensions enable Developer mode, choose Load unpacked and select Filmma-Google-Bridge. If already installed, reload it once from public/google-browser. Repeat in each profile you want to pair.')}</p><button className="quiet-button" disabled={busy} onClick={()=>void createPair()}>{tr('Crear código de enlace','Create pairing code')}</button>{pair&&<div className="google-browser-pair"><label>{tr('Código local · caduca en dos minutos','Local code · expires in two minutes')}<output>{pair.code}</output></label><button className="quiet-button" onClick={async()=>{try{await navigator.clipboard.writeText(pair.code);setCopied(true);}catch{setError(tr('Selecciona y copia el código manualmente.','Select and copy the code manually.'));}}}>{copied?<Check size={15}/>:<Clipboard size={15}/>} {tr('Copiar código','Copy code')}</button><button className="text-button" onClick={()=>setPair(undefined)}>{tr('Ocultar','Hide')}</button></div>}</details>
 <details><summary>{tr('Sesiones, modelos y créditos','Sessions, models and credits')}</summary><p>{tr('Filmma identifica el perfil de Chrome, no verifica el titular de la cuenta Google. Comprueba la cuenta, el modelo y el coste en Flow antes de enviar. Una cuenta por perfil evita mezclar sesiones; cada cuenta conserva su propia cuota. No hay rotación automática ni reenvío al agotarse los créditos.','Filmma identifies the Chrome profile, not the Google account owner. Check the account, model and cost in Flow before submitting. One account per profile avoids mixed sessions; every account retains its own quota. There is no automatic rotation or resubmission when credits run out.')}</p><p>{tr('Revocar un enlace no borra cookies, cuentas, resultados ni originales. Ante login, CAPTCHA o acuerdos, el puente espera tu intervención.','Revoking a pairing does not delete cookies, accounts, results or originals. Login, CAPTCHA or agreements require your intervention.')}</p></details>
 {message&&<p role="status">{message}</p>}{(error||loadError)&&<p role="alert" className="google-video-message">{error||loadError}</p>}
 </section>;
}
export function GoogleBrowserRun({ requestId, disabled, onFinished, onPrepare }: {
    requestId: string;
    disabled?: boolean;
    onFinished: () => void;
    onPrepare: () => Promise<void>;
}) {
    const { status, error: loadError } = useGoogleBrowser(), [busy, setBusy] = useState(false), [error, setError] = useState(''),[apply,setApply]=useState(true),[existingPage,setExistingPage]=useState(''),[profileId,setProfileId]=useState(''), seen = useRef('');
    useEffect(()=>{if(status?.profiles&&!status.profiles.some(p=>p.id===profileId))setProfileId(status.selectedProfileId??'');},[status?.selectedProfileId,status?.profiles,profileId]);
    const run = status?.runs.find(r => r.requestId === requestId), active = !!run && !['completed', 'attention', 'cancelled'].includes(run.phase);
    useEffect(() => { if (run?.phase === 'completed' && run.id !== seen.current) {
        seen.current = run.id;
        onFinished();
    } }, [run?.phase, run?.id, onFinished]);
    async function action(path: string, body: unknown = {}) { setBusy(true); setError(''); try {
        if(path==='/google-browser/runs')await onPrepare();
        await api(path, body);
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }
    return <section className="google-browser-run"><h4><Chrome size={17}/>{tr('Generar y descargar desde Filmma', 'Generate and download from Filmma')}</h4><p>{tr('Utiliza la cuota y los límites de tu suscripción en una pestaña de Chrome. Una generación por plano, sin reintentos automáticos. Verifica primero en Google que tu plan y la configuración estén disponibles.', 'Uses your subscription quota and limits in a Chrome tab. One generation per shot, without automatic retries. First verify in Google that your plan and settings are available.')}</p>
 <label className="google-profile-select">{tr('Perfil de Google para esta toma','Google profile for this shot')}<select aria-label={tr('Perfil de Google para esta toma','Google profile for this shot')} value={run?.profileId??profileId} disabled={busy||active||!!run?.submittedAt} onChange={e=>setProfileId(e.target.value)}><option value="">{tr('Selecciona un perfil enlazado','Select a paired profile')}</option>{status?.profiles?.map(p=><option key={p.id} value={p.id}>{p.alias} · {p.connected?tr('conectado','connected'):tr('esperando a Chrome','waiting for Chrome')}</option>)}</select></label>
 <p>{tr('El modelo y el coste se revisan en la ventana de Google de ese perfil. Cambiar el perfil predeterminado no mueve una toma ya enviada.','Review the model and cost in that profile’s Google window. Changing the default profile never moves a submitted shot.')}</p>
 <label className="google-apply"><input type="checkbox" checked={apply} disabled={busy||active||!!run?.submittedAt} onChange={e=>setApply(e.target.checked)}/><span>{tr('Usar en el montaje si el guion y la selección siguen coincidiendo','Use in the edit if screenplay and selection still match')}</span></label>
 <button className="primary" disabled={disabled || busy || active || !status?.configured || !profileId || !!run?.submittedAt} onClick={() => void action('/google-browser/runs', { requestId, profileId,confirmSubscriptionUse: true, apply })}>{busy ? <LoaderCircle className="spin" size={16}/> : <Chrome size={16}/>} {tr('Generar con mi cuota en Chrome', 'Generate with my Chrome quota')}</button>
 <details><summary>{tr('Ya tengo el video en Google','I already have the video in Google')}</summary><p>{tr('Pega la dirección de la conversación de Gemini o del video en Flow. Sólo recupera el resultado; nunca vuelve a generar. Comprueba que corresponde a este plano.','Paste the Gemini conversation or Flow video page address. This only recovers the result; it never regenerates. Verify it belongs to this shot.')}</p><label>{tr('Página del resultado','Result page')}<input type="url" value={existingPage} onChange={e=>setExistingPage(e.target.value)} placeholder="https://…" disabled={busy||active}/></label><button className="quiet-button" disabled={busy||active||!status?.profiles?.some(p=>p.id===profileId&&p.connected)||!existingPage} onClick={()=>void action('/google-browser/recover-page',{requestId,profileId,pageUrl:existingPage,apply})}>{tr('Descargar resultado existente','Download existing result')}</button></details>
 {!status?.configured && <p>{tr('Enlaza la extensión en Configuración → Conexiones. También puedes continuar con los botones manuales de arriba.', 'Pair the extension in Settings → Connections. You can also continue with the manual buttons above.')}</p>}
 {run && <div className="google-browser-progress"><p role="status">{run.message}</p><small>{status?.profiles?.find(p=>p.id===run.profileId)?.alias??tr('Perfil original de la toma','Original shot profile')}{run.modelLabel?` · ${run.modelLabel}`:''}</small>{run.pageUrl && <a className="text-button" href={run.pageUrl} target="_blank" rel="noreferrer">{tr('Abrir la pestaña del trabajo', 'Open job page')}<ExternalLink size={13}/></a>}{active && <button className="text-button" disabled={busy} onClick={() => void action(`/google-browser/runs/${run.id}/stop`)}><Square size={13}/>{tr('Detener automatización', 'Stop automation')}</button>}{['attention','cancelled'].includes(run.phase) && <>{run.canRecoverDownload&&<button className="quiet-button" disabled={busy} onClick={() => void action(`/google-browser/runs/${run.id}/recover`)}>{tr('Incorporar descarga conservada', 'Import retained download')}</button>}{!run.canRecoverDownload&&run.submittedAt && run.pageUrl && <button className="quiet-button" disabled={busy} onClick={() => void action(`/google-browser/runs/${run.id}/continue`)}>{tr('Recuperar de Google sin generar otra vez', 'Recover from Google without regenerating')}</button>}</>}<small>{tr('Una solicitud ya enviada puede seguir generándose en Google aunque detengas el puente.', 'A submitted request may continue generating in Google after stopping the bridge.')}</small></div>}
 {(error || loadError) && <p role="alert" className="google-video-message">{error || loadError}</p>}</section>;
}
