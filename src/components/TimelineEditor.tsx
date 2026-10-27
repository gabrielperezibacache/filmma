import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, AudioLines, ChevronLeft, ChevronRight, Copy, Film, Image, Keyboard, Maximize2, Minus, Plus, Redo2, Scissors, SkipBack, SkipForward, Trash2, Undo2, Video, X } from 'lucide-react';
import type { Asset, Project } from '../types';
import { adjacentCutFrame, buildTimeline, frameFromSeconds, frameToTimecode, segmentAtFrame, timelineDropIndex, timelineRulerTicks } from '../timeline';
import type { TimelineSegment } from '../timeline';
import './timeline-editor.css';
import AudioWaveform from './AudioWaveform';
import TransitionControls from './TransitionControls';
import {resolveSceneTransitions} from '../transitions';
import {playbackSpeed} from '../visual-effects';
import {trimProjectScene} from '../scene-trim';

export type TimelineEditorProps = {
  project: Project;
  selectedSceneId: string;
  playhead: number;
  playing?: boolean;
  disabled?: boolean;
  onSeek: (seconds: number, sceneId?: string) => void;
  onTrimScene?: (sceneId:string,edge:'start'|'end',deltaFrames:number)=>void;
  onUpdateProject?: (fn:(p:Project)=>Project,group?:string)=>void;
  onSelectScene: (sceneId: string) => void;
  /** Receives the index in the array after moving the shot. */
  onReorderScene: (sceneId: string, targetIndex: number) => void;
  /** The callback applies splitProjectScene and owns save/undo handling. */
  onSplitScene: (sceneId: string, offsetSeconds: number) => void;
  onDuplicateScene: (sceneId: string) => void;
  onDeleteScene: (sceneId: string) => void;
  onAddScene?: () => void;
  onManageAudio?: () => void;
  onRemoveAudio?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
};

type ToolProps = { label: string; children: ReactNode; disabled?: boolean; active?: boolean; onClick: () => void; className?: string };
function Tool({ label, children, disabled, active, onClick, className = '' }: ToolProps) {
  return <button type="button" className={`tl-tool ${active ? 'is-active' : ''} ${className}`} title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

function ClipImage({ asset, fallback, selected, trimStart }: { asset?: Asset; fallback?: Asset; selected: boolean; trimStart?: number }) {
  if (asset?.type === 'image') return <img src={asset.url} alt="" loading="lazy" draggable={false} />;
  if (fallback?.type === 'image') return <img src={fallback.url} alt="" loading="lazy" draggable={false} />;
  if (selected && asset?.type === 'video') return <video src={`${asset.url}#t=${Math.max(0, trimStart ?? 0)}`} muted preload="metadata" playsInline aria-hidden="true" />;
  return <span className="tl-clip-placeholder">{asset?.type === 'video' ? <Video size={20} /> : <Image size={20} />}</span>;
}

export default function TimelineEditor({ project, selectedSceneId, playhead, playing = false, disabled = false, onSeek, onTrimScene, onUpdateProject, onSelectScene, onReorderScene, onSplitScene, onDuplicateScene, onDeleteScene, onAddScene, onManageAudio, onRemoveAudio, onUndo, onRedo, canUndo = false, canRedo = false }: TimelineEditorProps) {
  const [trimGhost,setTrimGhost]=useState<{id:string;edge:'start'|'end';delta:number}|null>(null);
  const trimGesture=useRef<{id:string;edge:'start'|'end';pointer:number;x:number;scroll:number;scale:number;snapshot:Project;delta:number}|null>(null);
  const layout = useMemo(() => buildTimeline(project), [project.scenes, project.fps]);
  const [zoom, setZoom] = useState(0), [viewport, setViewport] = useState({ width: 640, left: 0 });
  const [dragging, setDragging] = useState<string | null>(null), [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false), [announcement, setAnnouncement] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null), clipRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrubPointer = useRef<number | null>(null), scrollAnimation = useRef<number | null>(null);
  const zoomAnchor = useRef<{ frame: number; x: number } | null>(null);
  const helpId = useId(), selectionId = useId();
  const fitScale = Math.max(1, viewport.width - 22) / Math.max(1, layout.totalSeconds);
  const maxScale = Math.max(fitScale, layout.fps * 8);
  const pixelsPerSecond = fitScale * Math.pow(maxScale / fitScale, zoom / 100);
  const contentWidth = Math.max(viewport.width, layout.totalSeconds * pixelsPerSecond + 22);
  const frame = frameFromSeconds(playhead, layout.fps, layout.totalFrames);
  const selected = layout.segments.find((segment) => segment.scene.id === selectedSceneId);
  const selectedIndex = selected?.index ?? -1;
  const firstVisibleFrame = viewport.left / pixelsPerSecond * layout.fps;
  const lastVisibleFrame = (viewport.left + viewport.width) / pixelsPerSecond * layout.fps;
  const ticks = timelineRulerTicks(layout, pixelsPerSecond, firstVisibleFrame, lastVisibleFrame);
  const offsetFrames = selected ? frame - selected.startFrame : 0;
  const canSplit = !!selected && project.scenes.length < 100 && offsetFrames >= layout.fps && selected.durationFrames - offsetFrames >= layout.fps && (!selected.scene.videoAssetId || (selected.scene.trimStart ?? 0) + offsetFrames / layout.fps * playbackSpeed(selected.scene.speed) <= 86400);
  const transitions=useMemo(()=>resolveSceneTransitions(project),[project.scenes,project.fps]);
  const audio = project.assets.find((asset) => asset.id === project.audioAssetId);
  const assets = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets]);
  const tc = (value: number) => frameToTimecode(value, layout.fps);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => setViewport({ width: Math.max(1, node.clientWidth), left: node.scrollLeft });
    update();
    const observer = new ResizeObserver(update); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { if (scrollAnimation.current != null) cancelAnimationFrame(scrollAnimation.current); }, []);
  useLayoutEffect(() => {
    const node = scrollRef.current, anchor = zoomAnchor.current;
    if (!node || !anchor) return;
    node.scrollLeft = Math.max(0, anchor.frame / layout.fps * pixelsPerSecond - anchor.x);
    setViewport((previous) => ({ ...previous, left: node.scrollLeft }));
    zoomAnchor.current = null;
  }, [pixelsPerSecond, layout.fps]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !playing) return;
    const x = frame / layout.fps * pixelsPerSecond;
    if (x < node.scrollLeft + 12 || x > node.scrollLeft + node.clientWidth - 24) node.scrollLeft = Math.max(0, x - node.clientWidth * .2);
  }, [frame, playing, pixelsPerSecond, layout.fps]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !selected) return;
    const start = selected.startFrame / layout.fps * pixelsPerSecond, end = selected.endFrame / layout.fps * pixelsPerSecond;
    if (end < node.scrollLeft || start > node.scrollLeft + node.clientWidth) node.scrollLeft = Math.max(0, start - 12);
  // Only selecting another shot scrolls it into view; inspecting another area remains possible.
  }, [selectedSceneId, project.id]);

  const seek = (target: number) => {
    if (disabled || !layout.totalFrames) return;
    const bounded = Math.min(layout.totalFrames, Math.max(0, Math.round(target)));
    onSeek(bounded / layout.fps, segmentAtFrame(layout, bounded)?.scene.id);
  };
  const changeZoom = (value: number) => {
    const node = scrollRef.current;
    if (node) {
      const playheadX = frame / layout.fps * pixelsPerSecond - node.scrollLeft;
      const x = playheadX >= 0 && playheadX <= node.clientWidth ? playheadX : node.clientWidth / 2;
      zoomAnchor.current = { frame: (node.scrollLeft + x) / pixelsPerSecond * layout.fps, x };
    }
    setZoom(Math.max(0, Math.min(100, value)));
  };
  const select = (segment: TimelineSegment, focus = false) => {
    if (disabled) return;
    onSelectScene(segment.scene.id); onSeek(segment.startFrame / layout.fps, segment.scene.id);
    if (focus) clipRefs.current.get(segment.scene.id)?.focus();
  };
  const split = () => {
    if (!disabled && selected && canSplit) { onSplitScene(selected.scene.id, offsetFrames / layout.fps); setAnnouncement('Plano dividido en la posición del cabezal.'); }
  };
  const reorder = (id: string, finalIndex: number) => {
    const segment = layout.segments.find((item) => item.scene.id === id);
    if (disabled || !segment) return;
    const target = Math.max(0, Math.min(layout.segments.length - 1, finalIndex));
    if (segment.index === target) return;
    onReorderScene(id, target); setAnnouncement(`«${segment.scene.title}» movido a la posición ${target + 1}.`);
  };
  const rulerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let target: number | undefined;
    if (event.key === 'ArrowLeft') target = event.ctrlKey || event.metaKey ? adjacentCutFrame(layout, frame, -1) : frame - (event.shiftKey ? 10 : 1);
    if (event.key === 'ArrowRight') target = event.ctrlKey || event.metaKey ? adjacentCutFrame(layout, frame, 1) : frame + (event.shiftKey ? 10 : 1);
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = layout.totalFrames;
    if (event.key === 'PageUp') target = adjacentCutFrame(layout, frame, -1);
    if (event.key === 'PageDown') target = adjacentCutFrame(layout, frame, 1);
    if (target != null) { event.preventDefault(); event.stopPropagation(); seek(target); }
    if (event.key.toLowerCase() === 's' && !event.metaKey && !event.ctrlKey) { event.preventDefault(); event.stopPropagation(); split(); }
  };
  const seekPointer = (event: PointerEvent<HTMLDivElement>) => {
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    seek(x / pixelsPerSecond * layout.fps);
  };
  const clipKey = (event: KeyboardEvent<HTMLButtonElement>, segment: TimelineSegment) => {
    if (disabled) return;
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (direction) {
      event.preventDefault(); event.stopPropagation();
      if (event.altKey) reorder(segment.scene.id, segment.index + direction);
      else { const next = layout.segments[segment.index + direction]; if (next) select(next, true); }
    }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); event.stopPropagation(); const next = event.key === 'Home' ? layout.segments[0] : layout.segments[layout.segments.length - 1]; if (next) select(next, true); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onDeleteScene(segment.scene.id); }
  };
  const cancelTrim=()=>{trimGesture.current=null;setTrimGhost(null)};
  const trimContext=(p:Project)=>JSON.stringify([p.id,p.fps,p.scenes.map(s=>[s.id,s.duration,s.trimStart,s.videoAssetId,s.speed]),p.tracks,p.subtitleCues]);
  useEffect(()=>{const key=(event:globalThis.KeyboardEvent)=>{if(!trimGesture.current)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelTrim();setAnnouncement('Recorte cancelado.')}else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z')cancelTrim()};const blur=()=>cancelTrim();window.addEventListener('keydown',key,true);window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('blur',blur)}},[]);
  useEffect(()=>{if(trimGesture.current&&trimContext(project)!==trimContext(trimGesture.current.snapshot)){cancelTrim();setAnnouncement('El montaje cambió. Vuelve a recortar el plano.')}},[project]);
  const beginTrim=(event:PointerEvent<HTMLButtonElement>,segment:TimelineSegment,edge:'start'|'end')=>{
    if(disabled||!onTrimScene||event.button!==0)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus();onSeek(playhead,segment.scene.id);
    trimGesture.current={id:segment.scene.id,edge,pointer:event.pointerId,x:event.clientX,scroll:scrollRef.current?.scrollLeft??0,scale:pixelsPerSecond,snapshot:project,delta:0};
    setTrimGhost({id:segment.scene.id,edge,delta:0});event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveTrim=(event:PointerEvent<HTMLButtonElement>)=>{
    const gesture=trimGesture.current,node=scrollRef.current;if(!gesture||gesture.pointer!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();
    if(node){const rect=node.getBoundingClientRect();if(event.clientX>rect.right-24)node.scrollLeft+=12;else if(event.clientX<rect.left+24)node.scrollLeft-=12}
    const original=buildTimeline(gesture.snapshot),segment=original.segments.find(s=>s.scene.id===gesture.id)!;
    let delta=Math.round((event.clientX-gesture.x+(node?.scrollLeft??0)-gesture.scroll)/gesture.scale*original.fps);
    if(!event.altKey){const edge=gesture.edge==='start'?segment.startFrame:segment.endFrame,target=edge+delta,tolerance=7/gesture.scale*original.fps;const candidates=[frame,...original.segments.flatMap(s=>[s.startFrame,s.endFrame])].filter(f=>f!==edge);const closest=candidates.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0];if(closest!==undefined&&Math.abs(closest-target)<=tolerance)delta=closest-edge;}
    try{const preview=trimProjectScene(gesture.snapshot,gesture.id,gesture.edge,delta),shot=preview.scenes.find(s=>s.id===gesture.id)!;
    gesture.delta=Math.round((shot.duration-segment.scene.duration)*original.fps)*(gesture.edge==='start'?-1:1);setTrimGhost({id:gesture.id,edge:gesture.edge,delta:gesture.delta});}catch(error){cancelTrim();setAnnouncement(error instanceof Error?error.message:'No se pudo recortar el plano.')}
  };
  const finishTrim=(event:PointerEvent<HTMLButtonElement>)=>{const g=trimGesture.current;if(!g||g.pointer!==event.pointerId)return;event.stopPropagation();if(trimContext(project)!==trimContext(g.snapshot)){cancelTrim();setAnnouncement('El montaje cambió. Vuelve a recortar el plano.');return;}cancelTrim();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(g.delta){onTrimScene?.(g.id,g.edge,g.delta);setAnnouncement('Recorte aplicado. Los planos siguientes se desplazan; el guion y los personajes se conservan. Puedes deshacer.')}};
  const trimKey=(event:KeyboardEvent<HTMLButtonElement>,id:string,edge:'start'|'end')=>{if(!['ArrowLeft','ArrowRight'].includes(event.key)||disabled)return;event.preventDefault();event.stopPropagation();onTrimScene?.(id,edge,(event.key==='ArrowRight'?1:-1)*(event.shiftKey?layout.fps:1))};
  const dragOver = (event: DragEvent<HTMLButtonElement>, segment: TimelineSegment) => {
    if (!dragging || disabled) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect(); setDrop({ id: segment.scene.id, after: event.clientX > bounds.left + bounds.width / 2 });
  };

  return <section className={`tl-editor ${disabled ? 'is-disabled' : ''}`} aria-label="Mesa de montaje" aria-busy={disabled} onKeyDown={(event) => {
    // Space/Enter activate editor buttons without also toggling the app's player.
    if ((event.key === ' ' || event.key === 'Enter') && (event.target as HTMLElement).closest('button')) event.stopPropagation();
  }}>
    <div className="tl-header">
      <div className="tl-heading"><h2><Scissors size={15} />Montaje</h2><span>{layout.segments.length} {layout.segments.length === 1 ? 'plano' : 'planos'}<span className="tl-separator">·</span>{tc(layout.totalFrames)}</span></div>
      <div className="tl-view-tools">
        <Tool label="Reducir zoom del montaje" disabled={!layout.totalFrames || zoom === 0} onClick={() => changeZoom(zoom - 15)}><Minus size={15} /></Tool>
        <input className="tl-zoom" type="range" aria-label="Zoom del montaje" min="0" max="100" step="1" disabled={!layout.totalFrames || maxScale === fitScale} value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} />
        <Tool label="Aumentar zoom del montaje" disabled={!layout.totalFrames || zoom === 100 || maxScale === fitScale} onClick={() => changeZoom(zoom + 15)}><Plus size={15} /></Tool>
        <Tool label="Ajustar toda la película" disabled={!layout.totalFrames || zoom === 0} onClick={() => changeZoom(0)}><Maximize2 size={15} /></Tool>
      </div>
    </div>
    <div className="tl-toolbar">
      <div className="tl-tool-group tl-transport" role="group" aria-label="Navegar por fotogramas y cortes">
        <Tool label="Corte anterior" disabled={disabled || frame === 0} onClick={() => seek(adjacentCutFrame(layout, frame, -1))}><SkipBack size={15} /></Tool>
        <Tool label="Fotograma anterior" disabled={disabled || frame === 0} onClick={() => seek(frame - 1)}><ChevronLeft size={17} /></Tool>
        <output className="tl-position" aria-label="Posición actual del cabezal">{tc(frame)}</output>
        <Tool label="Fotograma siguiente" disabled={disabled || frame >= layout.totalFrames} onClick={() => seek(frame + 1)}><ChevronRight size={17} /></Tool>
        <Tool label="Corte siguiente" disabled={disabled || frame >= layout.totalFrames} onClick={() => seek(adjacentCutFrame(layout, frame, 1))}><SkipForward size={15} /></Tool>
      </div>
      <div className="tl-tool-group tl-edit-tools" role="group" aria-label="Editar el plano seleccionado">
        <Tool label={canSplit ? 'Dividir plano en el cabezal' : 'Dividir: deja al menos un segundo a cada lado'} disabled={disabled || !canSplit} onClick={split} className="tl-split"><Scissors size={15} /><span>Dividir</span></Tool>
        <Tool label="Duplicar plano seleccionado" disabled={disabled || !selected || project.scenes.length >= 100} onClick={() => selected && onDuplicateScene(selected.scene.id)}><Copy size={15} /></Tool>
        <Tool label="Eliminar plano seleccionado" disabled={disabled || !selected} onClick={() => selected && onDeleteScene(selected.scene.id)} className="tl-delete"><Trash2 size={15} /></Tool>
        <span className="tl-tool-divider" />
        <Tool label="Mover plano antes" disabled={disabled || selectedIndex <= 0} onClick={() => selected && reorder(selected.scene.id, selectedIndex - 1)}><ArrowLeft size={15} /></Tool>
        <Tool label="Mover plano después" disabled={disabled || selectedIndex < 0 || selectedIndex >= layout.segments.length - 1} onClick={() => selected && reorder(selected.scene.id, selectedIndex + 1)}><ArrowRight size={15} /></Tool>
      </div>
      {(onUndo || onRedo) && <div className="tl-tool-group tl-history" role="group" aria-label="Historial de montaje">
        {onUndo && <Tool label="Deshacer cambio" disabled={disabled || !canUndo} onClick={onUndo}><Undo2 size={15} /></Tool>}
        {onRedo && <Tool label="Rehacer cambio" disabled={disabled || !canRedo} onClick={onRedo}><Redo2 size={15} /></Tool>}
      </div>}
    </div>
    <div className="tl-track-area">
      <div className="tl-lane-labels" aria-hidden="true"><div className="tl-lane-ruler">{layout.fps}</div><div className="tl-lane-video"><Video size={14} /><span>V1</span></div><div className="tl-lane-audio"><AudioLines size={14} /><span>A1</span></div></div>
      <div ref={scrollRef} className="tl-scroll" onScroll={() => {
        if (scrollAnimation.current != null) return;
        scrollAnimation.current = requestAnimationFrame(() => { scrollAnimation.current = null; const node = scrollRef.current; if (node) setViewport({ width: node.clientWidth, left: node.scrollLeft }); });
      }}>
        <div className="tl-canvas" style={{ width: contentWidth }}>
          <div className="tl-ruler" role="slider" tabIndex={disabled || !layout.totalFrames ? -1 : 0} aria-label="Posición del cabezal en el montaje" aria-valuemin={0} aria-valuemax={layout.totalFrames} aria-valuenow={frame} aria-valuetext={`${tc(frame)}, ${segmentAtFrame(layout, frame)?.scene.title ?? 'sin planos'}`} aria-disabled={disabled || !layout.totalFrames} aria-orientation="horizontal" onKeyDown={rulerKey} onPointerDown={(event) => {
            if (disabled || !layout.totalFrames || event.button !== 0) return;
            scrubPointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); seekPointer(event);
          }} onPointerMove={(event) => { if (scrubPointer.current === event.pointerId) seekPointer(event); }} onPointerUp={(event) => { if (scrubPointer.current === event.pointerId) { scrubPointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => { scrubPointer.current = null; }}>
            {ticks.map((tick) => <span className="tl-tick" key={tick.frame} style={{ left: tick.frame / layout.fps * pixelsPerSecond }}><span>{tick.label}</span></span>)}
          </div>
          <div className="tl-video-lane" role="listbox" aria-label="Planos del montaje" aria-orientation="horizontal">
            {layout.segments.map((segment) => {
              const { scene } = segment, width = segment.durationFrames / layout.fps * pixelsPerSecond;
              const media = assets.get(scene.videoAssetId ?? scene.assetId ?? ''), reference = assets.get(scene.assetId ?? '');
              const isSelected = scene.id === selectedSceneId;
              const ghost=trimGhost?.id===scene.id?trimGhost:null,shift=ghost?.edge==='start'?ghost.delta/layout.fps*pixelsPerSecond:0,visibleWidth=width+(ghost?(ghost.edge==='start'?-1:1)*ghost.delta/layout.fps*pixelsPerSecond:0);
              return <div key={scene.id} className={`tl-clip-shell ${isSelected?'is-selected':''} ${ghost?'is-trimming':''}`} style={{left:segment.startFrame/layout.fps*pixelsPerSecond+shift,width:Math.max(1,visibleWidth-2)}}><button type="button" role="option" aria-selected={isSelected} aria-label={`Plano ${segment.index + 1}: ${scene.title}. Duración ${tc(segment.durationFrames)}. ${media?.type === 'video' ? 'Video' : media ? 'Imagen fija' : 'Sin material'}.`} title={`${scene.title}\n${tc(segment.startFrame)} — ${tc(segment.endFrame)}\nArrastra para reordenar`} tabIndex={isSelected || (!selected && segment.index === 0) ? 0 : -1} disabled={disabled} key={scene.id} ref={(node) => { if (node) clipRefs.current.set(scene.id, node); else clipRefs.current.delete(scene.id); }} className={`tl-clip ${isSelected ? 'is-selected' : ''} ${dragging === scene.id ? 'is-dragging' : ''} ${!media ? 'is-empty' : ''} ${width < 84 ? 'is-compact' : ''} ${drop?.id === scene.id ? drop.after ? 'drop-after' : 'drop-before' : ''}`} style={{ left:0,width:'100%' }} draggable={!disabled&&!trimGhost} onKeyDown={(event) => clipKey(event, segment)} onClick={(event) => {
                if (disabled) return; onSelectScene(scene.id);
                const ratio = event.detail === 0 ? 0 : Math.max(0, Math.min(1, (event.clientX - event.currentTarget.getBoundingClientRect().left) / Math.max(1, width)));
                const target = Math.min(segment.endFrame - 1, segment.startFrame + Math.round(ratio * segment.durationFrames));
                onSeek(target / layout.fps, scene.id);
              }} onDragStart={(event) => { setDragging(scene.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-filmma-scene', scene.id); }} onDragOver={(event) => dragOver(event, segment)} onDrop={(event) => {
                if (!dragging || disabled) return; event.preventDefault();
                const source = layout.segments.find((item) => item.scene.id === dragging), bounds = event.currentTarget.getBoundingClientRect();
                if (source) reorder(source.scene.id, timelineDropIndex(source.index, segment.index, event.clientX > bounds.left + bounds.width / 2));
                setDragging(null); setDrop(null);
              }} onDragEnd={() => { setDragging(null); setDrop(null); }}>
                <span className="tl-clip-visual" aria-hidden="true"><ClipImage asset={media} fallback={reference} selected={isSelected} trimStart={scene.trimStart} /></span>
                {media?.type==='video'&&<AudioWaveform asset={media} trimStart={scene.trimStart??0} duration={scene.duration} audio={scene.audio} speed={scene.speed} fps={layout.fps} compact/>}
                <span className="tl-clip-number" aria-hidden="true">{String(segment.index + 1).padStart(2, '0')}</span>
                <span className="tl-clip-copy" aria-hidden="true"><strong>{scene.title}</strong><span>{media?.type === 'video' ? <Video size={10} /> : <Image size={10} />}{tc(segment.durationFrames)}{scene.look && scene.look !== 'original' && <span className="tl-clip-look">{scene.look === 'noir' ? 'B/N' : 'Cálido'}</span>}</span></span>
              </button>{onTrimScene&&(['start','end'] as const).map(edge=><button key={edge} type="button" className={`tl-trim-handle is-${edge}`} aria-label={`${edge==='start'?'Recortar entrada':'Recortar salida'} de ${scene.title}`} title="Arrastra para recortar · flechas: un fotograma · Mayús: un segundo" disabled={disabled} onClick={event=>event.stopPropagation()} onPointerDown={event=>beginTrim(event,segment,edge)} onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={cancelTrim} onLostPointerCapture={cancelTrim} onKeyDown={event=>trimKey(event,scene.id,edge)}><span/></button>)}{ghost&&<output className="tl-trim-readout">{tc(segment.durationFrames+(ghost.edge==='start'?-ghost.delta:ghost.delta))}</output>}</div>;
            })}
            {transitions.map(t=><button key={t.incoming.id} type="button" className="tl-transition-marker" aria-label={`Transición a ${t.incoming.title}`} title={`${t.kind==='dip'?'Paso por negro':'Fundido encadenado'} · ${(t.durationFrames/layout.fps).toFixed(2)} s`} style={{left:t.boundaryFrame/layout.fps*pixelsPerSecond}} onClick={()=>{onSelectScene(t.incoming.id);onSeek(t.boundaryFrame/layout.fps,t.incoming.id)}}><span>{t.kind==='dip'?'N':'D'}</span></button>)}
            {!layout.segments.length && <div className="tl-empty"><Film size={18} /><span>Añade un plano para empezar el montaje.</span>{onAddScene && <button type="button" onClick={onAddScene} disabled={disabled}><Plus size={14} />Añadir plano</button>}</div>}
          </div>
          <div className="tl-audio-lane">
            {audio ? <div className="tl-audio-clip" style={{ width: Math.max(1, layout.totalFrames ? layout.totalSeconds * pixelsPerSecond : viewport.width - 22) }}><AudioWaveform asset={audio} trimStart={0} duration={layout.totalSeconds} audio={{volume:Math.min(1,project.audioVolume??.5)}} fps={layout.fps} compact/><AudioLines size={14} /><span>{audio.name}</span><small>Banda sonora</small></div> : <button className="tl-audio-empty" type="button" disabled={disabled || !onManageAudio} onClick={onManageAudio}><Plus size={13} /><span>Añadir banda sonora</span></button>}
          </div>
          {!!layout.totalFrames && <div className="tl-playhead" aria-hidden="true" style={{ left: frame / layout.fps * pixelsPerSecond }}><span /></div>}
        </div>
      </div>
    </div>
    <div className="tl-footer">
      <div className="tl-selection" id={selectionId}>{selected ? <><strong>{String(selected.index + 1).padStart(2, '0')}<span>{selected.scene.title}</span></strong><span>{tc(selected.startFrame)} — {tc(selected.endFrame)}</span></> : <span>Selecciona un plano para editarlo.</span>}</div>
      <div className="tl-footer-actions">{audio && onRemoveAudio && <Tool label="Quitar banda sonora del montaje" disabled={disabled} onClick={onRemoveAudio}><AudioLines size={13} /><X size={11} /></Tool>}<button type="button" className={`tl-tool ${helpOpen ? 'is-active' : ''}`} aria-label="Atajos de teclado del montaje" title="Atajos de teclado" aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen(!helpOpen)}><Keyboard size={16} /></button></div>
    </div>
    {onUpdateProject&&<TransitionControls project={project} sceneId={selectedSceneId} onUpdate={onUpdateProject} onPreview={onSeek}/>}
    <p className="tl-gesture-hint">Arrastra un plano para reordenarlo o sus bordes para recortar. Alt evita el ajuste automático. El recorte desplaza los planos siguientes; puedes deshacerlo.</p>
    {helpOpen && <div className="tl-help" id={helpId}><span><strong>Regla</strong> ← / → fotograma · Mayús diez fotogramas · Av / Re Pág corte · S dividir</span><span><strong>Planos</strong> ← / → seleccionar · Alt + ← / → reordenar · Supr eliminar</span><span>Acerca el montaje para trabajar con más precisión. Cada división conserva al menos un segundo a cada lado.</span></div>}
    <span className="tl-sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}
