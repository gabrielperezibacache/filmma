import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Download, FileSpreadsheet, ImageOff, RefreshCw, X } from 'lucide-react';
import type { Project } from '../types';
import { buildTimeline, frameToTimecode } from '../timeline';
import { buildStoryboard, captureStoryboardThumbnail, collectStoryboardThumbnails, storyboardCsv, storyboardDirection, storyboardHtml, storyboardImageData, storyboardLook } from '../storyboard';
import type { StoryboardThumbnails } from '../storyboard';
import ColorFilter from './ColorFilter';
import './storyboard.css';

type Props = { project: Project; onScene: (id: string) => void; onNotify?: (message: string) => void };
function download(content: string, mime: string, name: string) {
  const href = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = href; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

/** An extension of the existing viewing table: selected frames lead, screenplay follows. */
export default function StoryboardWorkspace({ project, onScene, onNotify }: Props) {
  const shots = useMemo(() => buildStoryboard(project), [project]);
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const [thumbnails, setThumbnails] = useState<StoryboardThumbnails>({});
  const [loadedKey, setLoadedKey] = useState('');
  const [completed, setCompleted] = useState(0), [working, setWorking] = useState(false);
  const [retry, setRetry] = useState(0), [cancelled, setCancelled] = useState(false), [downloadError, setDownloadError] = useState('');
  const controller = useRef<AbortController | null>(null);
  // Text edits update the sheet immediately; only source/timing changes decode another frame.
  const sourceKey = JSON.stringify([project.id, project.fps, shots.map(({ scene, source }) => [scene.id, scene.videoAssetId || scene.assetId, source?.url, source?.size, source?.type, source?.enhancement?.fps, scene.duration, scene.trimStart, scene.speed])]);
  const currentKey = useRef(sourceKey); currentKey.current = sourceKey;
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    setLoadedKey(sourceKey); setThumbnails({}); setCompleted(0); setWorking(shots.length > 0); setCancelled(false);
    void collectStoryboardThumbnails(shots, captureStoryboardThumbnail, abort.signal, (id, value, count) => {
      if (abort.signal.aborted || currentKey.current !== sourceKey) return;
      setThumbnails(previous => ({ ...previous, [id]: value })); setCompleted(count);
    }).then(() => { if (!abort.signal.aborted && currentKey.current === sourceKey) setWorking(false); });
    return () => abort.abort();
    // The serial run intentionally depends on media identity/timing, not narrative text edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, retry]);
  const visibleThumbnails = loadedKey === sourceKey ? thumbnails : {};
  const preparing = working || loadedKey !== sourceKey;
  const ready = Object.values(visibleThumbnails).filter(item => item.status === 'ready').length;
  const unavailable = Object.values(visibleThumbnails).filter(item => item.status === 'failed').length;
  const filename = (project.name.trim() || 'Filmma').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 90) || 'Filmma';
  const exportSheet = (format: 'html' | 'csv') => {
    setDownloadError('');
    try {
      const snapshot = Object.fromEntries(shots.map(shot => [shot.scene.id, visibleThumbnails[shot.scene.id] ?? { status: 'cancelled' as const, message: 'Miniatura no calculada' }]));
      download(format === 'html' ? storyboardHtml(project, snapshot) : storyboardCsv(project, snapshot), format === 'html' ? 'text/html;charset=utf-8' : 'text/csv;charset=utf-8', `${filename} - ${format === 'html' ? 'storyboard' : 'lista de planos'}.${format}`);
      onNotify?.(format === 'html' ? 'Hoja descargada con sus imágenes. Ábrela en el navegador para imprimir o guardar como PDF.' : 'Lista de planos descargada con guion, fuentes y continuidad.');
    } catch { setDownloadError('No se pudo preparar la descarga. Inténtalo otra vez; el proyecto sigue intacto.'); }
  };
  return <section className="storyboard-workspace" aria-labelledby="storyboard-title">
    <header className="storyboard-heading"><div><h1 id="storyboard-title">La película, <span>plano a plano.</span></h1><p>Una mesa de lectura para relacionar la imagen elegida, el guion y lo que permanece entre escenas.</p></div><div className="storyboard-actions">
      <button className="primary" onClick={() => exportSheet('html')} disabled={preparing || !shots.length}><Download size={16} />Descargar hoja imprimible</button>
      <button className="quiet-button" onClick={() => exportSheet('csv')} disabled={!shots.length}><FileSpreadsheet size={16} />Lista de planos · CSV</button>
    </div></header>
    <div className="storyboard-summary"><span>{shots.length} {shots.length === 1 ? 'plano' : 'planos'} · <time>{frameToTimecode(timeline.totalFrames, timeline.fps)}</time> · {timeline.fps} fps</span><span>{project.format} · fuentes seleccionadas</span></div>
    <div className="storyboard-preparation" aria-live="polite" aria-atomic="true"><span>{preparing ? `Preparando imágenes · ${loadedKey === sourceKey ? completed : 0} de ${shots.length}` : cancelled ? `Preparación detenida · ${ready} imágenes disponibles` : `${ready} ${ready === 1 ? 'imagen disponible' : 'imágenes disponibles'}${unavailable ? ` · ${unavailable} sin miniatura` : ''}`}</span>
      {preparing ? <button className="text-button" onClick={() => { controller.current?.abort(); setWorking(false); setCancelled(true); }}><X size={15} />Detener</button>
        : !!shots.length && <button className="text-button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} />Actualizar miniaturas</button>}
      {preparing && <progress aria-label="Preparación de miniaturas" value={completed} max={shots.length || 1} />}
    </div>
    {downloadError && <p className="storyboard-error" role="alert">{downloadError}</p>}
    {!shots.length ? <div className="storyboard-empty"><BookOpen size={30} /><h2>El guion abre la primera imagen.</h2><p>Añade un plano en Guion o Montaje. Su acción, personajes y fuente aparecerán aquí.</p></div> : <>
      <p className="storyboard-note">Cada video muestra una muestra de su punto medio editado; las imágenes de referencia se identifican. Se conservan el encuadre, el look y el color de previsualización. Las capas, transiciones y subtítulos se revisan en el montaje.</p>
      <ol className="storyboard-grid">{shots.map(shot => {
        const thumbnail = visibleThumbnails[shot.scene.id], data = storyboardImageData(thumbnail), filterId = `storyboard-color-${shot.index}`;
        const cinema = storyboardDirection(shot.scene);
        return <li key={shot.scene.id} className="storyboard-shot"><article aria-labelledby={`storyboard-shot-${shot.index}`}>
          <header><span>Plano {String(shot.index + 1).padStart(2, '0')}</span><span>{shot.duration.toFixed(2)} s</span></header>
          <figure><div className="storyboard-picture"><ColorFilter id={filterId} color={shot.scene.color} />{data ? <img src={data} alt={`Muestra de ${shot.scene.title || `plano ${shot.index + 1}`}`} style={{ filter: `${storyboardLook(shot.scene)}url(#${filterId})` }} />
            : <div className="storyboard-missing"><ImageOff size={25} /><p>{thumbnail?.message ?? (preparing ? 'Preparando esta imagen…' : cancelled ? 'Miniatura no calculada' : shot.sourceLabel)}</p></div>}</div>
            <figcaption><span>{shot.sourceLabel}</span>{shot.source && <span>{shot.source.name}{thumbnail?.sourceTime !== undefined ? ` · fuente ${thumbnail.sourceTime.toFixed(2)} s` : ''}</span>}</figcaption>
          </figure>
          <div className="storyboard-shot-title"><h2 id={`storyboard-shot-${shot.index}`}>{shot.scene.title || 'Plano sin título'}</h2><button className="storyboard-open" onClick={() => onScene(shot.scene.id)} aria-label={`Abrir ${shot.scene.title || `plano ${shot.index + 1}`} en el editor`} title="Abrir en el editor"><ArrowUpRight size={19} /></button></div>
          <p className="storyboard-time"><time>{shot.start}</time><span>—</span><time>{shot.end}</time></p>
          {cinema.length > 0 && <p className="storyboard-direction">{cinema.join(' · ')}</p>}
          <div className="storyboard-script">{shot.storyContext&&<><h3>Escena y secuencia</h3><p>{shot.storyContext}</p></>}<h3>Acción</h3><p>{shot.scene.description.trim() || 'Acción pendiente en el guion.'}</p>{shot.scene.dialogue.trim() && <><h3>Diálogo / voz</h3><p className="storyboard-dialogue">{shot.scene.dialogue}</p></>}</div>
          <div className="storyboard-characters"><h3>Personajes y objetos</h3><p>{shot.characters.length ? shot.characters.join(' · ') : 'Sin elementos vinculados'}</p></div>
          <details className="storyboard-continuity"><summary>Continuidad prevista<span>{shot.continuity.length ? `${shot.continuity.length} ${shot.continuity.length === 1 ? 'elemento' : 'elementos'}` : 'Sin notas'}</span></summary>
            {shot.continuity.length ? shot.continuity.map((note, index) => <p key={index}>{note}</p>) : <p>Las notas del personaje y los cambios del guion aparecerán aquí. Puedes editarlos en Continuidad dentro del editor.</p>}
            <button className="text-button" onClick={() => onScene(shot.scene.id)}>Abrir este plano<ArrowUpRight size={14} /></button>
          </details>
        </article></li>;
      })}</ol>
      <footer className="storyboard-footer"><BookOpen size={18} /><p>La hoja imprimible incluye sus imágenes y puede abrirse sin conexión. Usa Imprimir en el navegador para guardarla como PDF. Es una copia de consulta; los originales permanecen en tu biblioteca.</p></footer>
    </>}
  </section>;
}
