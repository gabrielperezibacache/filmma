import { useEffect, useRef, useState } from 'react';
import { Check, Chrome, Clipboard, Download, ExternalLink, LoaderCircle, Square, Unplug } from 'lucide-react';
import { api } from '../api';
import { tr } from '../i18n';
import './google-browser.css';
type Run = {
    id: string;
    requestId: string;
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
type Status = {
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
export default function GoogleBrowserConnection() {
    const { status, error: loadError } = useGoogleBrowser(), [pair, setPair] = useState<{
        code: string;
        expiresAt: string;
    }>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
    useEffect(() => { if (!pair)
        return; const timer = setTimeout(() => setPair(undefined), Math.max(0, Date.parse(pair.expiresAt) - Date.now())); return () => clearTimeout(timer); }, [pair]);
    async function createPair() { setBusy(true); setError(''); try {
        setPair(await api('/google-browser/pairing', {}));
        setCopied(false);
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }
    return <section className="google-browser-connection" aria-label={tr('Enlace con Chrome', 'Chrome connection')}><div className="google-browser-title"><Chrome size={23}/><div><h3>{tr('Automatización con tu sesión de Chrome', 'Automation with your Chrome session')}</h3><span role="status">{status?.connected ? tr('Chrome conectado', 'Chrome connected') : status?.configured ? tr('Enlazado · esperando a Chrome', 'Paired · waiting for Chrome') : tr('Extensión pendiente de enlazar', 'Extension not paired yet')}</span></div></div><p>{tr('El puente local prepara el plano, utiliza los controles de Gemini o Flow y descarga el original. No copia tu sesión, no usa claves API y no compra créditos. Es experimental: los cambios de Google pueden requerir intervención.', 'The local bridge prepares the shot, uses Gemini or Flow controls and downloads the original. It does not copy your session, use API keys or buy credits. It is experimental: Google interface changes may require intervention.')}</p>
 <div className="google-browser-discovery"><h4>{tr('Enlazar desde Filmma','Pair from Filmma')}</h4><p>{tr('Con la extensión 0.2.0 instalada, pulsa Detectar Chrome y autoriza el navegador que aparezca aquí. El enlace se conserva al reiniciar; no necesitas copiar códigos.','With extension 0.2.0 installed, select Detect Chrome and approve the browser shown here. Pairing survives restarts; no codes to copy.')}</p><button className="primary" disabled={busy||status?.discovery?.active} onClick={async()=>{setBusy(true);setError('');try{await api('/google-browser/discovery',{})}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>{status?.discovery?.active?<LoaderCircle size={15} className="spin"/>:<Chrome size={15}/>} {status?.discovery?.active?tr('Buscando Chrome…','Looking for Chrome…'):tr('Detectar Chrome','Detect Chrome')}</button>{status?.discovery?.devices.map(device=><div key={device.id} className="google-browser-device"><strong>Chrome · Filmma Bridge {device.version}</strong><small>{device.extensionId}</small><button className="quiet-button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api('/google-browser/approve-device',{id:device.id})}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>{tr('Enlazar este Chrome','Pair this Chrome')}</button></div>)}{status?.discovery?.active&&!status.discovery.devices.length&&<p role="status">{tr('La detección tarda hasta 30 segundos. Si no aparece, recarga una vez la extensión desde chrome://extensions. La versión anterior sólo admite el enlace por código.','Detection takes up to 30 seconds. If it does not appear, reload the extension once from chrome://extensions. Older versions only support code pairing.')}</p>}</div>
 <details><summary>{tr('Instalación y enlace por código','Installation and code pairing')}</summary><ol><li><a className="text-button" href="/api/google-browser/extension" download><Download size={15}/>{tr('Descargar extensión local', 'Download local extension')}</a><p>{tr('Descomprime el ZIP. En chrome://extensions activa Modo desarrollador, elige Cargar descomprimida y selecciona la carpeta Filmma-Google-Bridge. Si ya usas la carpeta public/google-browser de este proyecto, basta con recargarla. Chrome muestra los permisos.', 'Unzip the file. In chrome://extensions enable Developer mode, choose Load unpacked and select Filmma-Google-Bridge. If you already use this project’s public/google-browser folder, reload it. Chrome shows the permissions.')}</p></li><li><button className="quiet-button" disabled={busy} onClick={() => void createPair()}>{busy ? <LoaderCircle size={15} className="spin"/> : <Chrome size={15}/>} {tr('Crear código para enlazar', 'Create pairing code')}</button><p>{tr('Alternativa para extensiones anteriores: escribe el código en sus opciones. Caduca en dos minutos.','Fallback for older extensions: enter the code in their options. It expires in two minutes.')}</p></li></ol></details>
 {pair && <div className="google-browser-pair"><label>{tr('Código local de un solo uso', 'One-time local code')}<output>{pair.code}</output></label><button className="quiet-button" onClick={async () => { try {
        await navigator.clipboard.writeText(pair.code);
        setCopied(true);
    }
    catch {
        setError(tr('Selecciona el código y cópialo manualmente.', 'Select the code and copy it manually.'));
    } }}>{copied ? <Check size={15}/> : <Clipboard size={15}/>} {tr('Copiar código', 'Copy code')}</button><button className="text-button" onClick={() => setPair(undefined)}>{tr('Ocultar', 'Hide')}</button></div>}
 {(error || loadError) && <p role="alert" className="google-video-message">{error || loadError}</p>}
 <details><summary>{tr('Permisos y límites del puente', 'Bridge permissions and limits')}</summary><p>{tr('Sólo accede a Gemini, Flow, sus archivos multimedia y Filmma en 127.0.0.1. Mantiene un token local de enlace, nunca cookies o contraseñas de Google. Los originales descargados y los parciales se conservan. Una solicitud enviada no se repite automáticamente. Ante CAPTCHA, login, acuerdos o cuota insuficiente, se detiene.', 'It only accesses Gemini, Flow, their media and Filmma on 127.0.0.1. It keeps a local pairing token, never Google cookies or passwords. Downloaded originals and partial files are retained. Submitted generations are never repeated automatically. CAPTCHA, login, agreements or insufficient quota stop the job.')}</p><a className="text-button" href="https://github.com/gabrielperezibacache/filmma/tree/main/public/google-browser" target="_blank" rel="noreferrer">{tr('Revisar el código de la extensión', 'Review extension source')}<ExternalLink size={13}/></a></details>
 {status?.configured && <button className="text-button" onClick={async () => { setBusy(true); try {
        await api('/google-browser/disconnect', {});
        setPair(undefined);
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }} disabled={busy}><Unplug size={14}/>{tr('Revocar el enlace con Chrome', 'Revoke Chrome pairing')}</button>}</section>;
}
export function GoogleBrowserRun({ requestId, disabled, onFinished, onPrepare }: {
    requestId: string;
    disabled?: boolean;
    onFinished: () => void;
    onPrepare: () => Promise<void>;
}) {
    const { status, error: loadError } = useGoogleBrowser(), [busy, setBusy] = useState(false), [error, setError] = useState(''),[apply,setApply]=useState(true),[existingPage,setExistingPage]=useState(''), seen = useRef('');
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
 <label className="google-apply"><input type="checkbox" checked={apply} disabled={busy||active||!!run?.submittedAt} onChange={e=>setApply(e.target.checked)}/><span>{tr('Usar en el montaje si el guion y la selección siguen coincidiendo','Use in the edit if screenplay and selection still match')}</span></label>
 <button className="primary" disabled={disabled || busy || active || !status?.configured || !!run?.submittedAt} onClick={() => void action('/google-browser/runs', { requestId, confirmSubscriptionUse: true, apply })}>{busy ? <LoaderCircle className="spin" size={16}/> : <Chrome size={16}/>} {tr('Generar con mi cuota en Chrome', 'Generate with my Chrome quota')}</button>
 <details><summary>{tr('Ya tengo el video en Google','I already have the video in Google')}</summary><p>{tr('Pega la dirección de la conversación de Gemini o del video en Flow. Sólo recupera el resultado; nunca vuelve a generar. Comprueba que corresponde a este plano.','Paste the Gemini conversation or Flow video page address. This only recovers the result; it never regenerates. Verify it belongs to this shot.')}</p><label>{tr('Página del resultado','Result page')}<input type="url" value={existingPage} onChange={e=>setExistingPage(e.target.value)} placeholder="https://…" disabled={busy||active}/></label><button className="quiet-button" disabled={busy||active||!status?.connected||!existingPage} onClick={()=>void action('/google-browser/recover-page',{requestId,pageUrl:existingPage,apply})}>{tr('Descargar resultado existente','Download existing result')}</button></details>
 {!status?.configured && <p>{tr('Enlaza la extensión en Configuración → Conexiones. También puedes continuar con los botones manuales de arriba.', 'Pair the extension in Settings → Connections. You can also continue with the manual buttons above.')}</p>}
 {run && <div className="google-browser-progress"><p role="status">{run.message}</p>{run.pageUrl && <a className="text-button" href={run.pageUrl} target="_blank" rel="noreferrer">{tr('Abrir la pestaña del trabajo', 'Open job page')}<ExternalLink size={13}/></a>}{active && <button className="text-button" disabled={busy} onClick={() => void action(`/google-browser/runs/${run.id}/stop`)}><Square size={13}/>{tr('Detener automatización', 'Stop automation')}</button>}{['attention','cancelled'].includes(run.phase) && <>{run.canRecoverDownload&&<button className="quiet-button" disabled={busy} onClick={() => void action(`/google-browser/runs/${run.id}/recover`)}>{tr('Incorporar descarga conservada', 'Import retained download')}</button>}{!run.canRecoverDownload&&run.submittedAt && run.pageUrl && <button className="quiet-button" disabled={busy} onClick={() => void action(`/google-browser/runs/${run.id}/continue`)}>{tr('Recuperar de Google sin generar otra vez', 'Recover from Google without regenerating')}</button>}</>}<small>{tr('Una solicitud ya enviada puede seguir generándose en Google aunque detengas el puente.', 'A submitted request may continue generating in Google after stopping the bridge.')}</small></div>}
 {(error || loadError) && <p role="alert" className="google-video-message">{error || loadError}</p>}</section>;
}
