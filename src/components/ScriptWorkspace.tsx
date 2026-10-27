import StoryStructureEditor from './StoryStructureEditor';
import ShotDependencies from './ShotDependencies';
import {storyContext,storyContextText} from '../story-structure';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, BookOpen, Check, ChevronDown, Clock3, Download, FileText, Film, PencilLine, Plus, Search, Sparkles, Upload, Users, X } from 'lucide-react';
import type { Project, Scene } from '../types';
import {cinemaDirectionLabel} from '../cinematography';
import { appendFountainScenes, exportFountain, formatScriptTime, MAX_FOUNTAIN_BYTES, MAX_SCRIPT_SCENES, normalizeScriptSearch, parseFountain, sceneTimings } from '../screenplay';
import type { FountainDocument } from '../screenplay';
import ProjectOutputSettings from './ProjectOutputSettings';
import CommitNumberInput from './CommitNumberInput';
import './ScriptWorkspace.css';

export type ScriptWorkspaceProps = {
  project: Project;
  updateProject: (updater: (current: Project) => Project) => void;
  onOpenScene: (sceneId: string) => void;
  onAskCodex?: () => void;
  onNavigate?:(page:string)=>void;
  selectedSceneId?: string;
  onSelectScene?: (sceneId: string) => void;
};
type ImportPreview = { projectId: string; filename: string; document: FountainDocument; selected: number[] };
const duration = (seconds: number) => `${new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(seconds)} s`;

export default function ScriptWorkspace({ project, updateProject, onOpenScene, onAskCodex, selectedSceneId, onSelectScene,onNavigate }: ScriptWorkspaceProps) {
  const [selectedId, setSelectedId] = useState(selectedSceneId || project.scenes[0]?.id || '');
  const [view, setView] = useState<'edit' | 'read'>('edit');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null), fileRequest = useRef(0), previewRef = useRef<HTMLElement>(null);
  const lastProject = useRef(project.id), currentProject = useRef(project);
  currentProject.current = project;
  const instance = useId(), selected = project.scenes.find((scene) => scene.id === selectedId) ?? project.scenes[0];
  const selectedIndex = selected ? project.scenes.findIndex((scene) => scene.id === selected.id) : -1;
  const timings = useMemo(() => sceneTimings(project.scenes), [project.scenes]);
  const total = timings.at(-1)?.end ?? 0;
  const query = normalizeScriptSearch(search.trim());
  const filtered = project.scenes.filter((scene) => !query || normalizeScriptSearch([scene.title, scene.description, scene.dialogue,storyContextText(project,scene.id), ...scene.characterIds.map((id) => project.characters.find((item) => item.id === id)?.name ?? '')].join('\n')).includes(query));
  const available = Math.max(0, MAX_SCRIPT_SCENES - project.scenes.length);

  useEffect(() => {
    if (lastProject.current !== project.id) { lastProject.current = project.id; fileRequest.current++; setReadingFile(false); setPreview(null); setSearch(''); setError(''); setNotice(''); setSelectedId(selectedSceneId || project.scenes[0]?.id || ''); }
    else if (!project.scenes.some((scene) => scene.id === selectedId)) setSelectedId(project.scenes[0]?.id ?? '');
  }, [project.id, project.scenes, selectedId]);
  useEffect(() => { if (selectedSceneId && project.scenes.some((scene) => scene.id === selectedSceneId)) setSelectedId(selectedSceneId); }, [selectedSceneId, project.id]);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview?.filename]);

  const updateScene = (patch: Partial<Scene>) => {
    if (!selected) return;
    const id = selected.id;
    updateProject((current) => current.id === project.id ? { ...current, scenes: current.scenes.map((scene) => scene.id === id ? { ...scene, ...patch } : scene) } : current);
  };
  const chooseScene = (id: string) => {
    setSelectedId(id); onSelectScene?.(id);
    if (view === 'read') document.getElementById(`${instance}-read-${id}`)?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };
  const addScene = () => {
    if (project.scenes.length >= MAX_SCRIPT_SCENES) return;
    const id = crypto.randomUUID();
    const scene: Scene = { id, title: `Plano ${project.scenes.length + 1}`, description: '', dialogue: '', prompt: '', negativePrompt: '', storySceneId:selected?.storySceneId,duration: 5, seed: 42, camera: '', characterIds: [], look: 'original', transition: 'cut' };
    updateProject((current) => current.id === project.id && current.scenes.length < MAX_SCRIPT_SCENES ? { ...current, scenes: [...current.scenes, scene] } : current);
    setSelectedId(id); onSelectScene?.(id); setSearch(''); setView('edit');
  };
  const reorder = (direction: -1 | 1) => {
    if (!selected) return;
    updateProject((current) => {
      if (current.id !== project.id) return current;
      const index = current.scenes.findIndex((scene) => scene.id === selected.id), target = index + direction;
      if (index < 0 || target < 0 || target >= current.scenes.length) return current;
      const scenes = [...current.scenes]; [scenes[index], scenes[target]] = [scenes[target]!, scenes[index]!];
      return { ...current, scenes };
    });
  };
  const download = (text: string, extension: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Mi película'}.${extension}`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const readFountain = async (file: File) => {
    const request = ++fileRequest.current, projectId = project.id;
    setReadingFile(true); setError(''); setNotice('');
    try {
      if (file.size > MAX_FOUNTAIN_BYTES) throw new Error('El archivo supera los 8 MB. Divide el guion antes de importarlo.');
      const parsed = parseFountain(await file.text());
      if (request !== fileRequest.current || currentProject.current.id !== projectId) return;
      if (!parsed.scenes.length) throw new Error('No hay escenas para importar. Usa encabezados como INT. CINE - NOCHE o .Nombre del plano.');
      setPreview({ projectId, filename: file.name, document: parsed, selected: parsed.scenes.map((_, index) => index) });
    } catch (cause) { if (request === fileRequest.current) setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.'); }
    finally { if (request === fileRequest.current) setReadingFile(false); if (inputRef.current) inputRef.current.value = ''; }
  };
  const confirmImport = () => {
    if (!preview) return;
    try {
      const current = currentProject.current;
      if (current.id !== preview.projectId) throw new Error('Vuelve a abrir el proyecto donde revisaste esta importación.');
      // Validate against the latest project before scheduling an updater. The updater
      // rechecks capacity and identity, so previewing never mutates the live project.
      const prepared = appendFountainScenes(current, preview.document, preview.selected);
      const appended = prepared.scenes.slice(current.scenes.length);
      updateProject((latest) => latest.id === preview.projectId && latest.scenes.length + appended.length <= MAX_SCRIPT_SCENES ? { ...latest, scenes: [...latest.scenes, ...appended] } : latest);
      setSelectedId(appended[0]?.id ?? selectedId); if (appended[0]) onSelectScene?.(appended[0].id); setSearch(''); setView('edit'); setPreview(null); setError('');
      setNotice(`${appended.length} ${appended.length === 1 ? 'plano añadido' : 'planos añadidos'} al final del montaje. El guion anterior se conserva.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo añadir el guion.'); }
  };
  const setTab = (next: 'edit' | 'read') => { setView(next); document.getElementById(`${instance}-${next}-tab`)?.focus(); };

  return <section className="script-workspace" aria-labelledby={`${instance}-title`}>
    <header className="sw-heading">
      <div><h1 id={`${instance}-title`}>Primero, la historia<span>.</span></h1><p>Lo que escribes aquí da forma a cada plano del montaje.</p></div>
      <div className="sw-actions">
        <button className="quiet-button" onClick={() => inputRef.current?.click()} disabled={readingFile}><Upload size={16}/>{readingFile ? 'Leyendo…' : 'Importar Fountain'}</button>
        <button className="quiet-button" title="Fountain conserva texto y planos; usa Proyecto completo para guardar también la estructura, los estados y las referencias." onClick={() => download(exportFountain(project), 'fountain')}><Download size={16}/>Fountain</button>
        <button className="sw-text-button" onClick={() => download([project.name, project.logline, '', ...project.scenes.flatMap((scene, index) => [storyContextText(project,scene.id),`${index + 1}. ${scene.title}`, scene.description, '', scene.dialogue, '', `[${duration(scene.duration)}${cinemaDirectionLabel(scene) ? ` · ${cinemaDirectionLabel(scene)}` : ''}]`, ''])].join('\n'), 'txt')}>Guion TXT</button>
        {onAskCodex && <button className="primary" onClick={onAskCodex}><Sparkles size={16}/>Escribir con Codex</button>}
      </div>
      <input ref={inputRef} type="file" hidden accept=".fountain,.txt,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFountain(file); }}/>
    </header>

    {error && <div className="sw-message sw-error" role="alert"><p>{error}</p><button aria-label="Cerrar error de guion" onClick={() => setError('')}><X size={18}/></button></div>}
    {notice && <div className="sw-message" role="status"><Check size={18}/><p>{notice}</p><button aria-label="Cerrar aviso de guion" onClick={() => setNotice('')}><X size={18}/></button></div>}

    {preview && <section className="sw-import" ref={previewRef} tabIndex={-1} aria-labelledby={`${instance}-import-title`}>
      <div className="sw-import-heading"><div><h2 id={`${instance}-import-title`}>Revisa antes de añadir.</h2><p>{preview.document.title || preview.filename} · {preview.document.scenes.length} planos encontrados</p></div><button className="sw-icon-button" aria-label="Cancelar importación Fountain" onClick={() => { setPreview(null); setError(''); }}><X size={20}/></button></div>
      <p className="sw-import-intent">Se añadirán al final de <strong>{project.name}</strong>. El título, la premisa, los planos y los archivos actuales se conservan.</p>
      {preview.document.warnings.length > 0 && <details className="sw-import-notes"><summary>{preview.document.warnings.length} observaciones para revisar<ChevronDown size={16}/></summary><ul>{preview.document.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
      <div className="sw-import-selection"><span>{preview.selected.length} seleccionados · {available} espacios disponibles</span><button className="sw-text-button" onClick={() => setPreview((value) => value ? { ...value, selected: value.selected.length === value.document.scenes.length ? [] : value.document.scenes.map((_, index) => index) } : value)}>{preview.selected.length === preview.document.scenes.length ? 'Desmarcar todos' : 'Seleccionar todos'}</button></div>
      <div className="sw-import-scenes">{preview.document.scenes.map((scene, index) => <article key={index}>
        <label className="sw-import-check"><input type="checkbox" checked={preview.selected.includes(index)} onChange={(event) => setPreview((value) => value ? { ...value, selected: event.target.checked ? [...value.selected, index] : value.selected.filter((item) => item !== index) } : value)}/><span>{String(index + 1).padStart(2, '0')}</span><strong>{scene.title || 'Plano sin título'}</strong><small>{duration(scene.duration)}</small></label>
        <details><summary>Leer acción y diálogo<ChevronDown size={14}/></summary><div className="sw-import-text"><p>{scene.description || 'Sin acción escrita.'}</p>{scene.dialogue && <p className="sw-import-dialogue">{scene.dialogue}</p>}<small>{scene.characterNames.length ? `Nombres en el guion: ${scene.characterNames.join(', ')}. Sólo se vincularán elementos existentes con el mismo nombre.` : 'Sin personajes vinculados automáticamente.'}</small></div></details>
      </article>)}</div>
      <div className="sw-import-footer"><p>{preview.selected.length > available ? `Selecciona ${available} planos o menos; el proyecto admite hasta 100.` : 'No se crean voces, imágenes ni videos al importar.'}</p><button className="primary" disabled={!preview.selected.length || preview.selected.length > available || preview.projectId !== project.id} onClick={confirmImport}><Plus size={16}/>Añadir {preview.selected.length} {preview.selected.length === 1 ? 'plano' : 'planos'}</button></div>
    </section>}

    <details className="sw-project-brief">
      <summary><span><FileText size={17}/><strong>{project.name || 'Tu película'}</strong></span><span>Premisa, proporción y FPS<ChevronDown size={16}/></span></summary>
      <div className="sw-brief-fields"><label className="sw-project-title"><span>Título</span><input aria-label="Título" value={project.name} maxLength={250} onChange={(event) => updateProject((current) => ({ ...current, name: event.target.value }))}/></label><label className="sw-logline"><span>La historia en una frase</span><textarea aria-label="La historia en una frase" rows={2} maxLength={12000} value={project.logline} placeholder="Alguien quiere algo, pero…" onChange={(event) => updateProject((current) => ({ ...current, logline: event.target.value }))}/></label><ProjectOutputSettings format={project.format} fps={project.fps} onChange={patch => updateProject(current => current.id === project.id ? {...current, ...patch} : current)}/></div>
    </details>

    <StoryStructureEditor key={project.id} project={project} shotId={selected?.id} onUpdate={updateProject}/>
    <div className="sw-toolbar"><div className="sw-view-tabs" role="tablist" aria-label="Vista del guion">{([['edit', 'Escribir', PencilLine], ['read', 'Leer', BookOpen]] as const).map(([value, label, Icon]) => <button id={`${instance}-${value}-tab`} key={value} role="tab" aria-selected={view === value} aria-controls={`${instance}-panel`} tabIndex={view === value ? 0 : -1} onClick={() => setView(value)} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setTab(view === 'edit' ? 'read' : 'edit'); } }}><Icon size={16}/>{label}</button>)}</div><p><Film size={15}/>{project.scenes.length} {project.scenes.length === 1 ? 'plano' : 'planos'}<span aria-hidden="true">·</span><Clock3 size={15}/>{formatScriptTime(total)} de montaje</p></div>

    <div className="sw-layout">
      <aside className="sw-index" aria-label="Índice del guion">
        <label className="sw-search"><Search size={16}/><input type="search" aria-label="Buscar en el guion" placeholder="Buscar texto, escena o personaje…" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
        <p className="sw-index-count" aria-live="polite">{query ? `${filtered.length} coincidencias` : 'Tu secuencia'}</p>
        <nav aria-label="Escenas del guion">{filtered.map((scene) => { const timing = timings.find((item) => item.id === scene.id)!; return <button key={scene.id} className={selected?.id === scene.id ? 'is-current' : ''} aria-current={selected?.id === scene.id ? 'step' : undefined} onClick={() => chooseScene(scene.id)}><span className="sw-index-number">{String(timing.index + 1).padStart(2, '0')}</span><span className="sw-index-label">{storyContext(project,scene.id).path&&<span className="story-index-path">{storyContext(project,scene.id).path}</span>}<strong>{scene.title || 'Plano sin título'}</strong><small>{formatScriptTime(timing.start)} <span aria-hidden="true">/</span> {duration(scene.duration)}</small></span>{selected?.id === scene.id && <ArrowRight size={14}/>}</button>; })}</nav>
        {query && !filtered.length && <div className="sw-no-results"><p>No hay escenas que coincidan.</p><button className="sw-text-button" onClick={() => setSearch('')}>Limpiar búsqueda</button></div>}
        <button className="sw-add-scene" disabled={!available} onClick={addScene}><Plus size={17}/>Añadir plano</button>{!available && <p className="sw-limit">Límite de 100 planos alcanzado.</p>}
      </aside>

      <div id={`${instance}-panel`} className="sw-content" role="tabpanel" aria-labelledby={`${instance}-${view}-tab`}>
        {!project.scenes.length ? <div className="sw-empty"><BookOpen size={34}/><h2>Una primera escena.</h2><p>Escribe lo que vemos y lo que escuchamos. Su duración empezará a construir el montaje.</p><button className="primary" onClick={addScene}><Plus size={16}/>Crear plano</button><button className="sw-text-button" onClick={() => inputRef.current?.click()}>O importar un guion Fountain</button></div> : view === 'edit' && selected ? <article className="sw-editor" key={selected.id}>
          <header className="sw-scene-heading"><div><span className="sw-scene-number">{String(selectedIndex + 1).padStart(2, '0')}</span><label className="sw-title-field"><span>Nombre del plano</span><input aria-label={`Título del plano ${selectedIndex + 1}`} value={selected.title} maxLength={250} placeholder="El nombre de este momento" onChange={(event) => updateScene({ title: event.target.value })}/></label></div><button className="sw-text-button" onClick={() => onOpenScene(selected.id)}>Ver en el montaje<ArrowRight size={16}/></button></header>
          <div className="sw-scene-time"><span><Clock3 size={15}/>{formatScriptTime(timings[selectedIndex]!.start)} — {formatScriptTime(timings[selectedIndex]!.end)}</span><CommitNumberInput className="sw-duration-field" label="Duración en montaje" ariaLabel={`Duración en montaje del plano ${selectedIndex + 1}`} value={selected.duration} min={1} max={120} unit="s" normalize={value => Math.round(value * project.fps) / project.fps} onCommit={value => updateScene({duration:value})} hint={`De 1 a 120 s. Se ajusta al fotograma a ${project.fps} fps.`}/><div className="sw-order"><button className="sw-icon-button" aria-label="Mover plano antes" disabled={selectedIndex <= 0} onClick={() => reorder(-1)}><ArrowUp size={16}/></button><button className="sw-icon-button" aria-label="Mover plano después" disabled={selectedIndex >= project.scenes.length - 1} onClick={() => reorder(1)}><ArrowDown size={16}/></button></div></div>
          <label className="sw-writing-field"><span>Acción <small>Lo que vemos</small></span><textarea aria-label={`Acción del plano ${selectedIndex + 1}`} rows={6} maxLength={12000} value={selected.description} placeholder="Un lugar, un gesto, una decisión…" onChange={(event) => updateScene({ description: event.target.value })}/></label>
          <label className="sw-writing-field sw-dialogue-field"><span>Diálogo / voz en off <small>Lo que está escrito</small></span><textarea aria-label={`Diálogo del plano ${selectedIndex + 1}`} rows={6} maxLength={12000} value={selected.dialogue} placeholder={'PERSONAJE\nSus palabras…'} onChange={(event) => updateScene({ dialogue: event.target.value })}/></label>
          <div className="sw-linked-elements"><h3><Users size={16}/>Personajes y elementos en este plano</h3>{project.characters.length ? <div>{project.characters.map((character) => <button key={character.id} aria-pressed={selected.characterIds.includes(character.id)} disabled={!selected.characterIds.includes(character.id) && selected.characterIds.length >= 30} onClick={() => updateScene({ characterIds: selected.characterIds.includes(character.id) ? selected.characterIds.filter((id) => id !== character.id) : selected.characterIds.length < 30 ? [...selected.characterIds, character.id] : selected.characterIds })}>{selected.characterIds.includes(character.id) && <Check size={14}/>}<span>{character.name}</span></button>)}</div> : <p>Crea tus personajes y objetos en Elementos para vincularlos aquí.</p>}{selected.characterIds.length >= 30 && <p>Este plano ya tiene 30 elementos. Desvincula uno para añadir otro.</p>}</div>
          <ShotDependencies project={project} shotId={selected.id} onNavigate={onNavigate}/><footer className="sw-editor-footer"><p>Acción, diálogo y duración pertenecen al mismo plano del montaje.</p><button className="sw-text-button" onClick={() => { setView('read'); }}>Leer la secuencia<BookOpen size={15}/></button></footer>
        </article> : <div className="sw-reading-paper">
          <header><h2>{project.name || 'Una película por escribir'}</h2>{project.logline && <p>{project.logline}</p>}<span>{project.format} · {project.fps} fps · {formatScriptTime(total)}</span></header>
          {project.scenes.map((scene, index) => <article id={`${instance}-read-${scene.id}`} key={scene.id} className={selected?.id === scene.id ? 'sw-reading-scene is-current' : 'sw-reading-scene'}>
            {storyContext(project,scene.id).path&&<p className="story-index-path">{storyContext(project,scene.id).path}</p>}<div className="sw-reading-heading"><span>{String(index + 1).padStart(2, '0')}</span><h3>{scene.title || 'Plano sin título'}</h3><button aria-label={`Editar plano ${index + 1}`} onClick={() => { setSelectedId(scene.id); onSelectScene?.(scene.id); setView('edit'); }}><PencilLine size={16}/></button></div>
            {scene.description ? <p className="sw-reading-action">{scene.description}</p> : <p className="sw-reading-placeholder">Acción por escribir.</p>}
            {scene.dialogue && <p className="sw-reading-dialogue">{scene.dialogue}</p>}
            <footer><span>{formatScriptTime(timings[index]!.start)} — {formatScriptTime(timings[index]!.end)} · {duration(scene.duration)}</span><span>{scene.characterIds.map((id) => project.characters.find((item) => item.id === id)?.name).filter(Boolean).join(' · ')}</span><button onClick={() => onOpenScene(scene.id)}>Abrir plano<ArrowRight size={13}/></button></footer>
          </article>)}<p className="sw-reading-end">FIN · POR AHORA</p>
        </div>}
      </div>
    </div>
  </section>;
}
