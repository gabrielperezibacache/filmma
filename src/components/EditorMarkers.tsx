import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bookmark, Download, Plus, Trash2 } from 'lucide-react';
import type { Project, TimelineMarker } from '../types';
import { addEditorMarker, markersCsv, resolveEditorMarkers, updateEditorMarker } from '../editor-markers';
import { frameToTimecode } from '../timeline';
import { tr } from '../i18n';
import './fifth-delivery.css';
export function MarkerPins({ project, pps, onMarker }: {
    project: Project;
    pps: number;
    onMarker?: (id: string) => void;
}) { return <div className="editor-marker-pins" aria-label={tr('Marcadores del montaje', 'Edit markers')}>{resolveEditorMarkers(project).filter(x => !x.outside).map(x => <button key={x.marker.id} className={`editor-marker-pin kind-${x.marker.kind}`} style={{ left: x.frame / project.fps * pps }} title={`${x.marker.title} · ${frameToTimecode(x.frame, project.fps)}`} aria-label={`${tr('Abrir marcador', 'Open marker')} ${x.marker.title}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onMarker?.(x.marker.id); }}><Bookmark size={13} fill="currentColor"/></button>)}</div>; }
export default function EditorMarkers({ project, playhead, selectedId, onSelect, onUpdate, onSeek }: {
    project: Project;
    playhead: number;
    selectedId?: string;
    onSelect: (id: string) => void;
    onUpdate: (f: (p: Project) => Project, group?: string) => void;
    onSeek: (seconds: number, sceneId?: string) => void;
}) {
    const items = resolveEditorMarkers(project), current = items.find(x => x.marker.id === selectedId) ?? items[0], marker = current?.marker;
    const [error, setError] = useState(''), [time, setTime] = useState(''), [titleDraft, setTitleDraft] = useState('');
    const title = useRef<HTMLInputElement>(null);
    useEffect(() => { if (selectedId)
        {title.current?.scrollIntoView({block:'center',behavior:'auto'});title.current?.focus({preventScroll:true});} }, [marker?.id, selectedId]);
    useEffect(() => setTime(String(marker?.offset ?? 0)), [marker?.id, marker?.offset]);
    useEffect(() => setTitleDraft(marker?.title ?? ''), [marker?.id, marker?.title]);
    const change = (patch: Partial<Pick<TimelineMarker, 'title' | 'note' | 'kind' | 'offset' | 'characterId'>>) => { if (!marker)
        return; try {
        updateEditorMarker(project, marker.id, patch);
        onUpdate(p => updateEditorMarker(p, marker.id, patch), `marker:${marker.id}:${Object.keys(patch).join(',')}`);
        setError('');
    }
    catch (e) {
        setError((e as Error).message);
    } };
    const add = () => { const id = crypto.randomUUID(); try {
        const next = addEditorMarker(project, playhead, id);
        onUpdate(p => addEditorMarker(p, playhead, id));
        if (next.markers?.some(m => m.id === id))
            onSelect(id);
        setError('');
    }
    catch (e) {
        setError((e as Error).message);
    } };
    const jump = (item: typeof current) => { if (!item)
        return; onSelect(item.marker.id); onSeek(Math.min(item.frame, item.shot.endFrame - 1) / project.fps, item.shot.scene.id); };
    return <section className="editor-markers"><header><div><h2>{tr('Deja una señal para el siguiente pase', 'Leave a cue for the next pass')}</h2><p>{tr('Los marcadores siguen a su plano al reorganizar el guion. Una nota de continuidad señala qué revisar; no cambia ni aprueba el material.', 'Markers follow their shot when the script is reordered. Continuity notes identify what to review; they do not change or approve the footage.')}</p></div><button className="quiet-button" disabled={!project.scenes.length || (project.markers?.length ?? 0) >= 1000} onClick={add}><Plus size={15}/>{tr('Marcar en el cabezal', 'Mark at playhead')}<kbd>M</kbd></button></header>
 {error && <p role="alert">{error}</p>}{!items.length ? <p className="editor-marker-empty">{tr('Marca una entrada de voz, un corte o un objeto que deba continuar. M añade una señal fuera de los campos de texto.', 'Mark a voice entrance, cut or prop that must carry through. Press M outside text fields to add a cue.')}</p> : <div className="editor-marker-layout"><nav aria-label={tr('Lista de marcadores', 'Marker list')}>{items.map(item => <button key={item.marker.id} aria-current={item.marker.id === marker?.id ? 'true' : undefined} onClick={() => jump(item)}><Bookmark size={14}/><span><strong>{item.marker.title}</strong><small>{item.shot.scene.title}{item.character ? ` · ${item.character.name}` : ''}{item.outside ? tr(' · Fuera del plano', ' · Outside shot') : ''}</small></span><time>{frameToTimecode(item.frame, project.fps)}</time></button>)}</nav>{marker && <form onSubmit={e => e.preventDefault()}><label>{tr('Título del marcador', 'Marker title')}<input ref={title} aria-label={tr('Título del marcador', 'Marker title')} value={titleDraft} maxLength={120} onChange={e => setTitleDraft(e.target.value)} onBlur={() => { if (titleDraft.trim())
        change({ title: titleDraft });
    else {
        setTitleDraft(marker.title);
        setError(tr('El título no puede estar vacío.', 'Title cannot be empty.'));
    } }}/></label><div className="editor-marker-fields"><label>{tr('Tipo de señal', 'Cue type')}<select aria-label={tr('Tipo de señal', 'Cue type')} value={marker.kind} onChange={e => change({ kind: e.target.value as TimelineMarker['kind'] })}><option value="edit">{tr('Montaje', 'Edit')}</option><option value="continuity">{tr('Continuidad', 'Continuity')}</option><option value="dialogue">{tr('Diálogo', 'Dialogue')}</option><option value="note">{tr('Nota de producción', 'Production note')}</option></select></label><label>{tr('Tiempo dentro del plano (s)', 'Time within shot (s)')}<input inputMode="decimal" aria-label={tr('Tiempo local del marcador', 'Marker local time')} value={time} onKeyDown={e => { if (e.key === 'Enter') {
        e.preventDefault();
        e.currentTarget.blur();
    } if (e.key === 'Escape') {
        e.stopPropagation();
        setTime(String(marker.offset));
        e.currentTarget.blur();
    } }} onChange={e => setTime(e.target.value)} onBlur={() => { const n = Number(time.replace(',', '.')); if (time.trim() && Number.isFinite(n))
        change({ offset: n });
    else {
        setError(tr('Escribe un tiempo válido.', 'Enter a valid time.'));
        setTime(String(marker.offset));
    } }}/></label></div><p className="editor-marker-context">{current!.shot.scene.title} · {frameToTimecode(current!.frame, project.fps)}{current!.outside && <strong>{tr(' Fuera del tramo actual: la señal se conserva; al abrirla se muestra el último fotograma del plano.', ' Outside the current span: the cue is retained; opening it shows the shot’s last frame.')}</strong>}</p><label>{tr('Personaje u objeto vinculado', 'Linked character or prop')}<select aria-label={tr('Personaje u objeto del marcador', 'Marker character or prop')} value={marker.characterId ?? ''} onChange={e => change({ characterId: e.target.value || undefined })}><option value="">{tr('Todo el plano', 'Whole shot')}</option>{project.characters.filter(c => current!.shot.scene.characterIds.includes(c.id) || c.id === marker.characterId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{current!.unlinked && <p>{tr('El elemento ya no aparece vinculado a este plano. Revisa el guion; la nota se conserva.', 'The element is no longer linked to this shot. Check the script; the note is retained.')}</p>}<label>{tr('Qué revisar', 'What to review')}<textarea aria-label={tr('Nota del marcador', 'Marker note')} rows={4} maxLength={2000} value={marker.note} onChange={e => change({ note: e.target.value })}/></label><div className="editor-marker-actions"><button className="quiet-button" onClick={() => jump(current)}>{tr('Ir a esta señal', 'Go to cue')}<ArrowRight size={14}/></button><button className="text-button" onClick={() => { onUpdate(p => ({ ...p, markers: p.markers?.filter(m => m.id !== marker.id) })); onSelect(''); }}><Trash2 size={15}/>{tr('Retirar marcador', 'Remove marker')}</button></div></form>}</div>}
 <footer><span>{items.length}/1000 · {tr('Se conservan al guardar y exportar Proyecto completo.', 'Retained when saving and exporting Full project.')}</span><button className="quiet-button" disabled={!items.length} onClick={() => { const url = URL.createObjectURL(new Blob([markersCsv(project)], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = 'Filmma - marcadores.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={14}/>{tr('Lista de marcadores · CSV', 'Marker list · CSV')}</button></footer>
 </section>;
}
