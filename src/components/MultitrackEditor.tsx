import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { ArrowDown, ArrowUp, AudioLines, ChevronRight, Diamond, Film, Layers, Maximize2, Music2, Plus, Copy, Scissors, LockKeyhole, LockKeyholeOpen, Trash2, Upload, Volume2, VolumeX } from 'lucide-react';
import type { ClipAudio, EditorTrack, Project, TimelineClip } from '../types';
import { buildTimeline, frameFromSeconds, frameToTimecode, segmentAtFrame, timelineRulerTicks } from '../timeline';
import { resolveTimelineClips } from '../multitrack';
import { commitClipGesture, compatibleGestureTrack, createClipGesture, previewClipGesture } from '../clip-gestures';
import type { ClipGestureKind, ClipGesturePreview, ClipGestureSnapshot } from '../clip-gestures';
import AudioWaveform from './AudioWaveform';
import LayerAnimationControls from './LayerAnimationControls';
import ColorControls from './ColorControls';
import './multitrack-editor.css';
import './second-delivery.css';
import {tr} from '../i18n';
import {splitTimelineClip,duplicateTimelineClip} from '../clip-editing';

export type MultitrackEditorProps = {
  project: Project; selectedSceneId: string; playhead: number; playing?: boolean;
  onUpdate: (update: (project: Project) => Project, group?: string) => void;
  onSeek: (seconds: number, sceneId?: string) => void;
  onSelectScene?: (sceneId: string) => void;
  onUpload?: () => void;
};

type GestureSession = { snapshot: ClipGestureSnapshot; preview: ClipGesturePreview; pointerId: number; startX: number; startY: number; scrollStart: number; pps: number; moved: boolean; valid: boolean; clientX: number; clientY: number; altKey: boolean };

function Action({ label, children, disabled, onClick,pressed }: { label: string; children: ReactNode; disabled?: boolean; onClick: () => void;pressed?:boolean }) {
  return <button type="button" className="mt-action" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>;
}

/** Keep an editable decimal draft until commit; quantize once, on the frame grid. */
function SecondsField({ label, value, fps, min = 0, max = 86400, onChange, disabled = false }: { label: string; value: number; fps: number; min?: number; max?: number; onChange: (value: number) => void; disabled?: boolean }) {
  const format = (number: number) => String(Number(number.toFixed(5)));
  const [draft, setDraft] = useState(format(value));
  const skipCommit = useRef(false);
  useEffect(() => setDraft(format(value)), [value]);
  const commit = () => {
    if (skipCommit.current) { skipCommit.current = false; return; }
    const number = Number(draft.replace(',', '.'));
    const minimum = Math.ceil(min * fps), maximum = Math.max(minimum, Math.floor(max * fps));
    const next = draft.trim() && Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number * fps))) / fps : value;
    setDraft(format(next)); if (next !== value) onChange(next);
  };
  return <label className="mt-field"><span>{label} <small>s</small></span><input type="text" inputMode="decimal" value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); skipCommit.current = true; setDraft(format(value)); event.currentTarget.blur(); } }} /></label>;
}

function AudioControls({ audio, duration, fps, onChange, disabled = false, prefix }: { audio: ClipAudio; duration: number; fps: number; onChange: (change: Partial<ClipAudio>) => void; disabled?: boolean; prefix: string }) {
  const volume = audio.volume ?? 1;
  return <div className="mt-audio-controls">
    <label className="mt-range-field"><span>Volumen <output>{Math.round(volume * 100)}%</output></span><input aria-label={`Volumen ${prefix}`} type="range" min="0" max="1" step="0.01" value={volume} disabled={disabled} onChange={(event) => onChange({ volume: Number(event.target.value) })} /></label>
    <label className="mt-check"><input type="checkbox" checked={audio.muted ?? false} disabled={disabled} onChange={(event) => onChange({ muted: event.target.checked })} />Silenciar audio</label>
    <SecondsField label="Entrada suave" value={audio.fadeIn ?? 0} fps={fps} max={duration} disabled={disabled} onChange={(fadeIn) => onChange({ fadeIn })} />
    <SecondsField label="Salida suave" value={audio.fadeOut ?? 0} fps={fps} max={duration} disabled={disabled} onChange={(fadeOut) => onChange({ fadeOut })} />
  </div>;
}

export default function MultitrackEditor({ project, selectedSceneId, playhead, playing = false, onUpdate, onSeek, onSelectScene, onUpload }: MultitrackEditorProps) {
  const layout = useMemo(() => buildTimeline(project), [project.scenes, project.fps]);
  const resolved = useMemo(() => resolveTimelineClips(project), [project]);
  const [selection, setSelection] = useState<{ trackId: string; clipId?: string } | null>(null);
  const [assetChoice, setAssetChoice] = useState(''), [zoom, setZoom] = useState(0), [announcement, setAnnouncement] = useState(''),[operationError,setOperationError]=useState('');
  const [viewport, setViewport] = useState({ width: 700, left: 0 });
  const canvasRef = useRef<HTMLDivElement>(null), laneRefs = useRef(new Map<string, HTMLDivElement>());
  const gestureRef = useRef<GestureSession | null>(null), autoScroll = useRef<number | null>(null);
  const [gesture, setGesture] = useState<{ snapshot: ClipGestureSnapshot; preview: ClipGesturePreview; valid: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null), scrub = useRef<number | null>(null);
  const zoomAnchor = useRef<{ frame: number; x: number } | null>(null);
  const hintId = useId(), inspectorId = useId();
  const tracks = project.tracks ?? [], totalClips = tracks.reduce((sum, track) => sum + track.clips.length, 0);
  const track = tracks.find((item) => item.id === selection?.trackId), clip = track?.clips.find((item) => item.id === selection?.clipId);
  const scene = project.scenes.find((item) => item.id === selectedSceneId), anchor = clip ? layout.segments.find((item) => item.scene.id === clip.sceneId) : undefined;
  const resolvedClip = clip ? resolved.find((item) => item.track.id === track?.id && item.clip.id === clip.id) : undefined;
  const clipAsset = project.assets.find((asset) => asset.id === clip?.assetId);
  const availableAssets = track ? project.assets.filter((asset) => track.type === 'audio' ? asset.type === 'audio' : asset.type !== 'audio') : [];
  const assetToAdd = availableAssets.some((asset) => asset.id === assetChoice) ? assetChoice : availableAssets[0]?.id ?? '';
  const selectedAnchor = layout.segments.find((item) => item.scene.id === selectedSceneId) ?? layout.segments[0];
  const gutter = 148, laneViewport = Math.max(180, viewport.width - gutter - 18);
  const fit = laneViewport / Math.max(1, layout.totalSeconds), maximumScale = Math.max(fit, layout.fps * 5);
  const pps = fit * Math.pow(maximumScale / fit, zoom / 100), laneWidth = Math.max(laneViewport, layout.totalSeconds * pps);
  const frame = frameFromSeconds(playhead, layout.fps, layout.totalFrames);
  const ticks = timelineRulerTicks(layout, pps, Math.max(0, viewport.left) / pps * layout.fps, (viewport.left + laneViewport) / pps * layout.fps);
  const tc = (value: number) => frameToTimecode(value, layout.fps);

  useLayoutEffect(() => {
    const node = scrollRef.current; if (!node) return;
    const update = () => setViewport({ width: node.clientWidth, left: node.scrollLeft });
    update(); const observer = new ResizeObserver(update); observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => { setSelection(null); setAssetChoice(''); setZoom(0); }, [project.id]);
  useEffect(() => { if (selection && !track) setSelection(null); }, [selection, track]);
  useEffect(() => {
    const node = scrollRef.current; if (!node || !playing) return;
    const x = frame / layout.fps * pps;
    if (x < node.scrollLeft || x > node.scrollLeft + laneViewport - 20) node.scrollLeft = Math.max(0, x - laneViewport * .2);
  }, [frame, playing, pps, laneViewport, layout.fps]);
  useLayoutEffect(() => {
    const node = scrollRef.current, saved = zoomAnchor.current; if (!node || !saved) return;
    node.scrollLeft = Math.max(0, saved.frame / layout.fps * pps - saved.x); zoomAnchor.current = null;
  }, [pps, layout.fps]);
  const changeZoom = (next: number) => {
    if (gestureRef.current) return;
    const node = scrollRef.current;
    if (node) { const currentX = frame / layout.fps * pps - node.scrollLeft, x = currentX >= 0 && currentX <= laneViewport ? currentX : laneViewport / 2; zoomAnchor.current = { frame: (node.scrollLeft + x) / pps * layout.fps, x }; }
    setZoom(next);
  };
  const seek = (next: number) => { const target = Math.max(0, Math.min(layout.totalFrames, Math.round(next))); onSeek(target / layout.fps, segmentAtFrame(layout, target)?.scene.id); };
  const seekPointer = (event: PointerEvent<HTMLDivElement>) => seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / pps * layout.fps);
  const rulerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? layout.fps : 1;
    const next = event.key === 'ArrowRight' ? frame + step : event.key === 'ArrowLeft' ? frame - step : event.key === 'Home' ? 0 : event.key === 'End' ? layout.totalFrames : undefined;
    if (next !== undefined) { event.preventDefault(); event.stopPropagation(); seek(next); }
  };
  const editTrack = (id: string, patch: Partial<EditorTrack>, group = `track-${id}`) => onUpdate((current) => ({ ...current, tracks: (current.tracks ?? []).map((item) => item.id === id ? { ...item, ...patch } : item) }), group);
  const editClip = (id: string, clipId: string, patch: Partial<TimelineClip>, group = `clip-${clipId}`) => onUpdate((current) => ({ ...current, tracks: (current.tracks ?? []).map((item) => item.id === id && !item.locked ? { ...item, clips: item.clips.map((entry) => entry.id === clipId ? { ...entry, ...patch } : entry) } : item) }), group);
  const addTrack = (type: EditorTrack['type']) => {
    if (tracks.length >= 8) return;
    const id = crypto.randomUUID(), number = tracks.filter((item) => item.type === type).length + 1;
    onUpdate((current) => (current.tracks?.length ?? 0) >= 8 ? current : { ...current, tracks: [...current.tracks ?? [], { id, name: type === 'audio' ? `Audio ${number}` : `Capa ${number}`, type, muted: false, volume: 1, clips: [] }] });
    setSelection({ trackId: id }); setAssetChoice(''); setAnnouncement(type === 'audio' ? 'Pista de audio creada. Elige un archivo para empezar.' : 'Capa visual creada. Elige una imagen o un video.');
  };
  const addClip = () => {
    if (!track || track.locked || !assetToAdd || !selectedAnchor || totalClips >= 500) return;
    const id = crypto.randomUUID(), newClip: TimelineClip = { id, assetId: assetToAdd, sceneId: selectedAnchor.scene.id, offset: 0, duration: selectedAnchor.durationFrames / layout.fps, trimStart: 0, volume: 1, muted: track.type === 'video', fadeIn: 0, fadeOut: 0, ...(track.type === 'video' ? { opacity: 1 } : {}) };
    onUpdate((current) => (current.tracks ?? []).reduce((sum, item) => sum + item.clips.length, 0) >= 500 ? current : { ...current, tracks: (current.tracks ?? []).map((item) => item.id === track.id && !item.locked ? { ...item, clips: [...item.clips, newClip] } : item) });
    setSelection({ trackId: track.id, clipId: id }); onSeek(selectedAnchor.startFrame / layout.fps, selectedAnchor.scene.id); setAnnouncement('Clip añadido y vinculado al plano seleccionado.');
  };
  const selectClip = (trackId: string, clipId: string) => {
    setSelection({ trackId, clipId }); const item = resolved.find((entry) => entry.track.id === trackId && entry.clip.id === clipId);
    if (item) { onSelectScene?.(item.clip.sceneId); onSeek(item.startFrame / layout.fps, item.clip.sceneId); }
  };
  const reorderTrack = (id: string, delta: number) => onUpdate((current) => { const next = [...current.tracks ?? []], index = next.findIndex((item) => item.id === id), destination = index + delta; if (index < 0 || destination < 0 || destination >= next.length) return current; const [moving] = next.splice(index, 1); next.splice(destination, 0, moving!); return { ...current, tracks: next }; });
  const deleteClip = () => { if (!track || !clip || track.locked) return; editTrack(track.id, { clips: track.clips.filter((item) => item.id !== clip.id) }, `delete-${clip.id}`); setSelection({ trackId: track.id }); setAnnouncement('Clip retirado. El archivo original sigue en la biblioteca.'); };
  const selectedCharacters = project.characters.filter((character) => (anchor?.scene ?? scene)?.characterIds.includes(character.id));
  const baseHasVideo = !!scene?.videoAssetId && project.assets.some((asset) => asset.id === scene.videoAssetId && asset.type === 'video');
  const anchorRemaining = anchor ? Math.max(1 / layout.fps, layout.totalSeconds - anchor.startFrame / layout.fps - (clip?.offset ?? 0)) : layout.totalSeconds;
  const outOfRange = !!clip && !resolvedClip;


  const cancelGesture = (message = 'Arrastre cancelado. El clip conserva su posición.') => {
    const active = gestureRef.current; gestureRef.current = null; setGesture(null);
    if (autoScroll.current !== null) { cancelAnimationFrame(autoScroll.current); autoScroll.current = null; }
    if (active && canvasRef.current?.hasPointerCapture(active.pointerId)) canvasRef.current.releasePointerCapture(active.pointerId);
    if (active) setAnnouncement(message);
  };
  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => { if (gestureRef.current && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelGesture(); } };
    const blur = () => { if (gestureRef.current) cancelGesture(); };
    window.addEventListener('keydown', cancel, true); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', cancel, true); window.removeEventListener('blur', blur); if (autoScroll.current !== null) cancelAnimationFrame(autoScroll.current); gestureRef.current = null; };
  }, []);
  useEffect(() => { if (gestureRef.current) cancelGesture('El proyecto cambió. Arrastre cancelado.'); }, [project.id, project.fps]);
  const refreshGesture = () => {
    const active = gestureRef.current, node = scrollRef.current; if (!active || !node) return;
    const deltaPixels = active.clientX - active.startX + node.scrollLeft - active.scrollStart;
    const movement = active.snapshot.kind === 'move' ? Math.max(Math.abs(active.clientX - active.startX), Math.abs(active.clientY - active.startY)) : Math.abs(active.clientX - active.startX);
    if (!active.moved && movement < 3) return;
    active.moved = true;
    let targetTrackId = active.snapshot.trackId; active.valid = true;
    if (active.snapshot.kind === 'move') {
      const hovered = [...laneRefs.current].find(([, lane]) => { const bounds = lane.getBoundingClientRect(); return active.clientY >= bounds.top && active.clientY <= bounds.bottom; });
      active.valid = !!hovered && compatibleGestureTrack(active.snapshot, hovered[0]);
      if (active.valid) targetTrackId = hovered![0];
    }
    try {
      active.preview = previewClipGesture(active.snapshot, deltaPixels / active.pps * active.snapshot.fps, { snap: !active.altKey, snapThresholdFrames: 8 / active.pps * active.snapshot.fps, targetTrackId });
      setGesture({ snapshot: active.snapshot, preview: active.preview, valid: active.valid });
    } catch (error) { cancelGesture(error instanceof Error ? error.message : 'No se pudo recortar este clip.'); }
  };
  const scrollWhileDragging = () => {
    const active = gestureRef.current, node = scrollRef.current;
    if (!active || !node) { autoScroll.current = null; return; }
    const bounds = node.getBoundingClientRect(), leftEdge = bounds.left + gutter + 26, rightEdge = bounds.right - 26;
    const scrollBy = !active.moved ? 0 : active.clientX < leftEdge ? -Math.min(18, (leftEdge - active.clientX) * .35) : active.clientX > rightEdge ? Math.min(18, (active.clientX - rightEdge) * .35) : 0;
    if (scrollBy) { const previous = node.scrollLeft; node.scrollLeft += scrollBy; if (previous !== node.scrollLeft) refreshGesture(); }
    autoScroll.current = requestAnimationFrame(scrollWhileDragging);
  };
  const startGesture = (event: PointerEvent<HTMLElement>, trackId: string, clipId: string, kind: ClipGestureKind) => {
    if (event.button !== 0 || gestureRef.current) return; event.preventDefault(); event.stopPropagation();
    if(project.tracks?.find(t=>t.id===trackId)?.locked){selectClip(trackId,clipId);setAnnouncement(tr('Pista bloqueada. Desbloquéala para mover o recortar.','Track locked. Unlock it to move or trim.'));return;}
    const snapshot = createClipGesture(project, trackId, clipId, kind, playhead);
    const preview = previewClipGesture(snapshot, 0, { snap: false });
    gestureRef.current = { snapshot, preview, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollStart: scrollRef.current?.scrollLeft ?? 0, pps, moved: false, valid: true, clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
    event.currentTarget.focus(); setSelection({ trackId, clipId }); onSeek(snapshot.startFrame / layout.fps, snapshot.clip.sceneId);
    canvasRef.current?.setPointerCapture(event.pointerId); autoScroll.current = requestAnimationFrame(scrollWhileDragging);
  };
  const moveGesture = (event: PointerEvent<HTMLDivElement>) => {
    const active = gestureRef.current; if (!active || event.pointerId !== active.pointerId) return;
    active.clientX = event.clientX; active.clientY = event.clientY; active.altKey = event.altKey; refreshGesture();
  };
  const finishGesture = (event: PointerEvent<HTMLDivElement>) => {
    const active = gestureRef.current; if (!active || event.pointerId !== active.pointerId) return;
    active.clientX = event.clientX; active.clientY = event.clientY; active.altKey = event.altKey; refreshGesture();
    if (gestureRef.current !== active) return;
    if (!active.valid) { cancelGesture('Movimiento cancelado: el archivo necesita una pista compatible.'); return; }
    const moved = active.moved; cancelGesture('');
    if (!moved) return;
    try{onUpdate((current) => commitClipGesture(current, active.snapshot, active.preview));}catch(error){setAnnouncement((error as Error).message);return;}
    setSelection({ trackId: active.preview.trackId, clipId: active.snapshot.clip.id });
    setAnnouncement(`${active.snapshot.kind === 'move' ? 'Clip movido' : 'Recorte aplicado'}: ${tc(active.preview.startFrame)} a ${tc(active.preview.visibleEndFrame)}. Puedes deshacer el cambio.`);
  };
  const keyboardGesture = (event: KeyboardEvent<HTMLButtonElement>, trackId: string, clipId: string, kind: ClipGestureKind) => {
    const horizontal = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const vertical = kind === 'move' && event.altKey ? event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0 : 0;
    if ((!horizontal || (kind === 'move' && !event.altKey)) && !vertical) return;
    event.preventDefault(); event.stopPropagation();
    if(project.tracks?.find(t=>t.id===trackId)?.locked){setAnnouncement(tr('Desbloquea la pista para editar.','Unlock the track to edit.'));return;}
    const snapshot = createClipGesture(project, trackId, clipId, kind, playhead);
    let targetTrackId = trackId;
    if (vertical) {
      const compatible = tracks.filter((item) => compatibleGestureTrack(snapshot, item.id)), index = compatible.findIndex((item) => item.id === trackId);
      targetTrackId = compatible[index + vertical]?.id ?? trackId;
    }
    try {
      const preview = previewClipGesture(snapshot, horizontal * (event.shiftKey ? layout.fps : 1), { snap: false, targetTrackId });
      onUpdate((current) => commitClipGesture(current, snapshot, preview), `gesture-key-${kind}-${clipId}`);
      setSelection({ trackId: preview.trackId, clipId }); setAnnouncement(`${kind === 'move' ? 'Posición' : 'Recorte'}: ${tc(preview.startFrame)} a ${tc(preview.visibleEndFrame)}.`);
    } catch (error) { setAnnouncement(error instanceof Error ? error.message : 'No se pudo editar este clip.'); }
  };

  const clipOperation=(kind:'split'|'copy')=>{if(!track||!clip)return;setOperationError('');try{onUpdate(p=>kind==='split'?splitTimelineClip(p,track.id,clip.id,playhead):duplicateTimelineClip(p,track.id,clip.id,playhead));setAnnouncement(kind==='split'?tr('Clip dividido conservando fuente, fundidos y personaje.','Clip split while preserving source, fades and character.'):tr('Copia añadida en el cabezal, vinculada al mismo plano.','Copy added at the playhead, linked to the same shot.'))}catch(error){setOperationError((error as Error).message);setAnnouncement((error as Error).message)}};
  return <section className="mt-editor" aria-label="Pistas de audio y capas visuales">
    <div className="mt-topbar">
      <div className="mt-heading"><Layers size={17} /><span>Pistas adicionales</span><small>{tracks.length} / 8</small></div>
      <div className="mt-add-actions"><button type="button" className="mt-text-button" disabled={tracks.length >= 8 || !layout.totalFrames} onClick={() => addTrack('audio')}><Plus size={14} /><Music2 size={15} />Audio</button><button type="button" className="mt-text-button" disabled={tracks.length >= 8 || !layout.totalFrames} onClick={() => addTrack('video')}><Plus size={14} /><Film size={15} />Capa visual</button></div>
      <div className="mt-zoom"><label>Zoom<input aria-label="Zoom de las pistas adicionales" type="range" min="0" max="100" step="1" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} /></label><Action label="Ajustar pistas a la ventana" onClick={() => changeZoom(0)}><Maximize2 size={15} /></Action></div>
    </div>
    <p className="mt-explanation" id={hintId}>Arrastra un clip para moverlo; usa sus extremos para recortar. Se ajusta a cortes y bordes. Alt libera el ajuste; Escape cancela.</p>
    {operationError&&<p className="mt-operation-error" role="alert">{operationError}</p>}
    <div className="mt-scroll" ref={scrollRef} onScroll={(event) => setViewport((previous) => ({ ...previous, left: event.currentTarget.scrollLeft }))}>
      <div className={`mt-canvas ${gesture ? 'is-gesturing' : ''}`} ref={canvasRef} style={{ width: gutter + laneWidth + 18 }} onPointerMove={moveGesture} onPointerUp={finishGesture} onPointerCancel={() => cancelGesture()} onLostPointerCapture={() => { if (gestureRef.current) cancelGesture(); }}>
        <div className="mt-ruler-row"><div className="mt-lane-label mt-ruler-label">{tc(frame)}</div><div className="mt-ruler" style={{ width: laneWidth }} role="slider" tabIndex={layout.totalFrames ? 0 : -1} aria-label="Posición en las pistas adicionales" aria-valuemin={0} aria-valuemax={layout.totalFrames} aria-valuenow={frame} aria-valuetext={tc(frame)} aria-describedby={hintId} onKeyDown={rulerKey} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); scrub.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); seekPointer(event); }} onPointerMove={(event) => { if (scrub.current === event.pointerId) seekPointer(event); }} onPointerUp={(event) => { if (scrub.current === event.pointerId) { scrub.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => { scrub.current = null; }}>{ticks.map((tick) => <span key={tick.frame} style={{ left: tick.frame / layout.fps * pps }}>{tick.label}</span>)}</div></div>
        {[...tracks].reverse().map((item) => {
          const items = resolved.filter((entry) => entry.track.id === item.id), isSelected = track?.id === item.id;
          return <div key={item.id} className={`mt-row ${item.type} ${isSelected ? 'is-selected' : ''} ${gesture?.valid && gesture.preview.trackId === item.id ? 'is-drop-target' : ''}`}>
            <div className="mt-lane-label"><button type="button" className="mt-track-label" aria-pressed={isSelected} onClick={() => setSelection({ trackId: item.id })}>{item.type === 'audio' ? <AudioLines size={15} /> : <Film size={15} />}<span>{item.name}</span></button><Action label={`${item.muted ? 'Activar' : 'Silenciar'} audio de pista ${item.name}`} onClick={() => editTrack(item.id, { muted: !item.muted }, `mute-${item.id}`)}>{item.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</Action><Action label={`${item.locked?tr('Desbloquear pista','Unlock track'):tr('Bloquear pista','Lock track')} ${item.name}`} pressed={item.locked??false} onClick={()=>editTrack(item.id,{locked:!item.locked},`lock-${item.id}`)}>{item.locked?<LockKeyhole size={14}/>:<LockKeyholeOpen size={14}/>}</Action></div>
            <div className="mt-lane" ref={(node) => { if (node) laneRefs.current.set(item.id, node); else laneRefs.current.delete(item.id); }} style={{ width: laneWidth }} onClick={(event) => { if (event.target !== event.currentTarget) return; setSelection({ trackId: item.id }); seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / pps * layout.fps); }}>
              {!item.clips.length && <button className="mt-empty-lane" type="button" onClick={() => setSelection({ trackId: item.id })}>Elige un archivo para esta pista <ChevronRight size={14} /></button>}
              {items.map((entry) => {
                const selected = selection?.clipId === entry.clip.id && isSelected;
                const inGesture = gesture?.snapshot.trackId === item.id && gesture.snapshot.clip.id === entry.clip.id;
                const visible = entry.endFrame / layout.fps * pps >= viewport.left && entry.startFrame / layout.fps * pps <= viewport.left + laneViewport;
                const label = `${entry.asset.name}, ${tc(entry.startFrame)}, ${entry.durationFrames / layout.fps} segundos${entry.clip.keyframes?.length ? `, ${entry.clip.keyframes.length} fotogramas clave` : ''}`;
                return <div key={entry.clip.id} className={`mt-clip ${selected ? 'is-selected' : ''} ${item.muted || entry.clip.muted ? 'is-muted' : ''} ${item.locked?'is-locked':''} ${inGesture ? 'is-gesture-source' : ''}`} style={{ left: entry.startFrame / layout.fps * pps, width: Math.max(2, entry.durationFrames / layout.fps * pps) }}>
                  {entry.asset.type === 'image' && <img src={entry.asset.url} alt="" loading="lazy" draggable={false} />}
                  {visible && entry.asset.type !== 'image' && <AudioWaveform asset={entry.asset} trimStart={entry.clip.trimStart} speed={entry.clip.speed} duration={entry.durationFrames / layout.fps} logicalDuration={Math.round(entry.clip.duration * layout.fps) / layout.fps} audio={entry.clip} trackGain={item.muted ? 0 : item.volume} fps={layout.fps} compact />}
                  <button type="button" className="mt-clip-body" aria-label={label} aria-pressed={selected} aria-controls={inspectorId} title={`${entry.asset.name} · ${tc(entry.startFrame)} → ${tc(entry.endFrame)}`} onPointerDown={(event) => startGesture(event, item.id, entry.clip.id, 'move')} onClick={(event) => { if (!event.detail) selectClip(item.id, entry.clip.id); }} onKeyDown={(event) => keyboardGesture(event, item.id, entry.clip.id, 'move')}>
                    <span className="mt-clip-caption">{item.type === 'audio' ? <AudioLines size={14} /> : <Film size={14} />}<span>{entry.asset.name}</span>{(item.muted || entry.clip.muted) && <VolumeX size={12} />}</span>
                    {visible && item.type === 'video' && entry.clip.keyframes?.filter((point) => point.time >= 0 && point.time * layout.fps < entry.durationFrames).map((point) => <Diamond key={point.id} className="mt-keyframe-marker" aria-hidden="true" size={9} fill="currentColor" style={{ left: `${point.time * layout.fps / entry.durationFrames * 100}%` }} />)}
                  </button>
                  <button type="button" disabled={item.locked} className="mt-trim-handle is-start" aria-label={`Recortar inicio de ${entry.asset.name}`} title="Recortar inicio · flechas: un fotograma" onPointerDown={(event) => startGesture(event, item.id, entry.clip.id, 'trim-start')} onKeyDown={(event) => keyboardGesture(event, item.id, entry.clip.id, 'trim-start')}><span /></button>
                  <button type="button" disabled={item.locked} className="mt-trim-handle is-end" aria-label={`Recortar final de ${entry.asset.name}`} title="Recortar final · flechas: un fotograma" onPointerDown={(event) => startGesture(event, item.id, entry.clip.id, 'trim-end')} onKeyDown={(event) => keyboardGesture(event, item.id, entry.clip.id, 'trim-end')}><span /></button>
                </div>;
              })}
              {gesture?.preview.trackId === item.id && <div className={`mt-clip mt-gesture-preview ${!gesture.valid ? 'is-invalid' : ''}`} style={{ left: gesture.preview.startFrame / layout.fps * pps, width: Math.max(2, (gesture.preview.visibleEndFrame - gesture.preview.startFrame) / layout.fps * pps) }} aria-hidden="true"><span>{tc(gesture.preview.startFrame)} → {tc(gesture.preview.visibleEndFrame)}</span></div>}

            </div>
          </div>;
        })}
        {!tracks.length && <div className="mt-empty-state"><AudioLines size={25} /><div><strong>Da espacio al sonido.</strong><p>Añade música, voces o ambiente. Una capa visual permite superponer imágenes y videos.</p></div></div>}
        {gesture?.preview.snapFrame !== undefined && <div className="mt-snap-line" style={{ left: gutter + gesture.preview.snapFrame / layout.fps * pps }} aria-hidden="true" />}
        {layout.totalFrames > 0 && <div className="mt-playhead" aria-hidden="true" style={{ left: gutter + frame / layout.fps * pps }} />}
      </div>
    </div>
    {gesture && <div className="mt-gesture-status">{gesture.valid ? `${gesture.snapshot.kind === 'move' ? 'Mover' : 'Recortar'} · ${tc(gesture.preview.startFrame)} → ${tc(gesture.preview.visibleEndFrame)}` : 'Esta pista no admite el archivo. Suelta para cancelar.'}<span>Soltar aplica · Escape cancela · Alt sin ajuste</span></div>}
    <div className="mt-inspector" id={inspectorId}>
      <div className="mt-inspector-nav"><button type="button" aria-pressed={!track} className={!track ? 'is-selected' : ''} onClick={() => setSelection(null)}><Volume2 size={15} />Audio del plano</button>{track && <span>{track.type === 'audio' ? <Music2 size={15} /> : <Layers size={15} />}{track.name}{clip && <> / Clip</>}</span>}<small>{tracks.length ? 'Las capas superiores aparecen delante.' : 'Los originales permanecen en la biblioteca.'}</small></div>
      {track ? <>
        <div className="mt-track-settings"><label className="mt-field mt-track-name"><span>Nombre de pista</span><input value={track.name} maxLength={120} onChange={(event) => editTrack(track.id, { name: event.target.value }, `name-${track.id}`)} onBlur={() => { if (!track.name.trim()) editTrack(track.id, { name: track.type === 'audio' ? 'Audio' : 'Capa visual' }); }} /></label><label className="mt-range-field"><span>Volumen de pista <output>{Math.round(track.volume * 100)}%</output></span><input aria-label="Volumen de pista" type="range" min="0" max="1" step="0.01" value={track.volume} onChange={(event) => editTrack(track.id, { volume: Number(event.target.value) }, `volume-${track.id}`)} /></label><label className="mt-check"><input type="checkbox" checked={track.muted} onChange={(event) => editTrack(track.id, { muted: event.target.checked }, `mute-${track.id}`)} />Silenciar audio de pista</label><div className="mt-actions"><Action label="Subir pista" disabled={track.locked||tracks.at(-1)?.id === track.id} onClick={() => reorderTrack(track.id, 1)}><ArrowUp size={16} /></Action><Action label="Bajar pista" disabled={track.locked||tracks[0]?.id === track.id} onClick={() => reorderTrack(track.id, -1)}><ArrowDown size={16} /></Action><Action disabled={track.locked} label="Eliminar pista y sus clips" onClick={() => { onUpdate((current) => ({ ...current, tracks: (current.tracks ?? []).filter((item) => item.id !== track.id) })); setSelection(null); setAnnouncement('Pista retirada. Puedes deshacer el cambio.'); }}><Trash2 size={16} /></Action></div></div>
        {track.locked&&<p className="mt-warning" role="status">{tr('Pista bloqueada: sus clips conservan posición y recortes. Los vínculos siguen al guion al reordenarlo.','Track locked: clip positions and trims are protected. Links still follow script reordering.')}</p>}<div className="mt-add-clip"><label className="mt-field"><span>{track.type === 'audio' ? 'Archivo de audio' : 'Imagen o video'}</span><select value={assetToAdd} disabled={!availableAssets.length} onChange={(event) => setAssetChoice(event.target.value)}>{!availableAssets.length && <option value="">No hay archivos compatibles</option>}{availableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><button type="button" className="mt-text-button mt-primary" disabled={track.locked || !assetToAdd || !selectedAnchor || totalClips >= 500} onClick={addClip}><Plus size={15} />Añadir clip</button>{onUpload && <button type="button" className="mt-text-button" onClick={onUpload}><Upload size={15} />Importar</button>}<small>Vinculado al plano {selectedAnchor ? String(selectedAnchor.index + 1).padStart(2, '0') : '—'}. {totalClips >= 500 && 'Límite de 500 clips alcanzado.'}</small></div>
        {!!track.clips.length && <label className="mt-field mt-clip-picker"><span>Clip que quieres editar</span><select value={clip?.id ?? ''} onChange={(event) => event.target.value ? selectClip(track.id, event.target.value) : setSelection({ trackId: track.id })}><option value="">Selecciona un clip de esta pista</option>{track.clips.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {project.assets.find((asset) => asset.id === item.assetId)?.name ?? 'Archivo no disponible'}</option>)}</select></label>}
        {clip && <div className="mt-clip-inspector">
          <div className="mt-clip-heading"><strong>{clipAsset?.name ?? 'Archivo no disponible'}</strong><small>{resolvedClip ? `${tc(resolvedClip.startFrame)} → ${tc(resolvedClip.endFrame)}` : 'Fuera del montaje'}</small><button className="mt-text-button" disabled={track.locked||!resolvedClip||frame<=resolvedClip.startFrame||frame>=resolvedClip.endFrame} onClick={()=>clipOperation('split')}><Scissors size={14}/>{tr('Dividir en el cabezal','Split at playhead')}</button><button className="mt-text-button" disabled={track.locked} onClick={()=>clipOperation('copy')}><Copy size={14}/>{tr('Duplicar en el cabezal','Duplicate at playhead')}</button><Action disabled={track.locked} label="Eliminar clip de esta pista" onClick={deleteClip}><Trash2 size={15} /></Action></div>
          <fieldset className="mt-protected-fields" disabled={track.locked}><legend className="mt-sr-only">{tr('Edición del clip','Clip editing')}</legend><div className="mt-clip-fields"><label className="mt-field mt-anchor-field"><span>Plano de referencia</span><select value={clip.sceneId} onChange={(event) => editClip(track.id, clip.id, { sceneId: event.target.value }, `anchor-${clip.id}`)}>{project.scenes.map((item, index) => <option key={item.id} value={item.id}>{String(index + 1).padStart(2, '0')} · {item.title}</option>)}</select></label><SecondsField label="Desde el inicio del plano" value={clip.offset} fps={layout.fps} onChange={(offset) => editClip(track.id, clip.id, { offset }, `offset-${clip.id}`)} /><SecondsField label="Duración" value={clip.duration} fps={layout.fps} min={1 / layout.fps} max={86400} onChange={(duration) => editClip(track.id, clip.id, { duration }, `duration-${clip.id}`)} /><SecondsField label="Entrada en el archivo" value={clip.trimStart} fps={layout.fps} disabled={clipAsset?.type === 'image'} onChange={(trimStart) => editClip(track.id, clip.id, { trimStart }, `source-${clip.id}`)} /></div>
          <div className="mt-anchor-note"><span>{selectedCharacters.length ? selectedCharacters.map((character) => character.name).join(' · ') : 'Sin personajes vinculados'} · el clip acompaña a este plano al reordenar.</span>{anchor && <button type="button" className="mt-text-button" onClick={() => { onSelectScene?.(anchor.scene.id); onSeek(anchor.startFrame / layout.fps, anchor.scene.id); }}>Ir al plano <ChevronRight size={14} /></button>}</div>
          {(outOfRange || clip.duration > anchorRemaining + 1 / layout.fps) && <p className="mt-warning" role="status">{outOfRange ? 'Este clip no entra en el montaje. Revisa el plano de referencia, el desplazamiento o el archivo.' : `El montaje termina antes que el clip. Se usarán ${(resolvedClip!.durationFrames / layout.fps).toFixed(2)} s; el original permanece completo.`}</p>}
          {clipAsset && clipAsset.type !== 'image' && <div className="mt-waveform-inspector"><AudioWaveform asset={clipAsset} trimStart={clip.trimStart} speed={clip.speed} duration={resolvedClip ? resolvedClip.durationFrames / layout.fps : clip.duration} logicalDuration={Math.round(clip.duration * layout.fps) / layout.fps} audio={clip} trackGain={track.muted ? 0 : track.volume} fps={layout.fps} /></div>}
          {clipAsset?.type !== 'image' && <AudioControls audio={clip} duration={Math.round(clip.duration * layout.fps) / layout.fps} fps={layout.fps} prefix="del clip" onChange={(audio) => editClip(track.id, clip.id, {...audio,...(('fadeIn'in audio||'fadeOut'in audio)?{envelope:undefined}:{})}, `audio-${clip.id}`)} />}
          {clipAsset?.type !== 'image' && <div className="mt-speed-controls"><label className="mt-field"><span>Velocidad del archivo</span><select aria-label="Velocidad del clip" value={clip.speed ?? 1} onChange={(event) => editClip(track.id, clip.id, { speed: Number(event.target.value) }, `speed-${clip.id}`)}>{[.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4].map((speed) => <option key={speed} value={speed}>{speed}×{speed === 1 ? ' · Normal' : ''}</option>)}{![.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4].includes(clip.speed ?? 1) && <option value={clip.speed}>{clip.speed}×</option>}</select></label><p>Conserva la duración en el guion y el tono del audio. Al terminar el archivo, la imagen mantiene su último fotograma y el audio queda en silencio.</p></div>}
          {track.type === 'video' && <><LayerAnimationControls clip={clip} fps={layout.fps} startFrame={resolvedClip?.startFrame} playhead={playhead} onChange={(next, group) => { if (playing) onSeek(Math.round(playhead * layout.fps) / layout.fps, clip.sceneId); editClip(track.id, clip.id, next, group ?? `animation-${crypto.randomUUID()}`); }} onSeek={(seconds) => onSeek(seconds, clip.sceneId)} onMessage={setAnnouncement} /><ColorControls color={clip.color} label="Color de la capa" onChange={(color) => editClip(track.id, clip.id, { color }, `color-${clip.id}`)} /></>}
          {clip.envelope&&<p className="mt-footnote">{tr('Los fundidos conservan su recorrido previo a la división. Editar Entrada suave o Salida suave inicia un fundido nuevo para este fragmento.','Fades retain their pre-split curve. Editing Fade in or Fade out starts a new fade for this fragment.')}</p>}</fieldset><p className="mt-footnote">Ajuste por fotogramas · {layout.fps} fps. Alt + ←/→ mueve un fotograma; Alt + ↑/↓ cambia de pista compatible. En los extremos, ←/→ recorta; Mayús cambia el paso a un segundo.</p>
        </div>}
      </> : <div className="mt-base-audio"><div><strong>{scene ? `Audio de «${scene.title}»` : 'Selecciona un plano'}</strong><p>{baseHasVideo ? 'Ajusta el sonido incluido en la toma. Los cambios acompañan al plano.' : 'Este plano no tiene una toma de video. Puedes añadir voz, música o ambiente en una pista de audio.'}</p></div>{scene && <AudioControls audio={scene.audio ?? {}} duration={Math.round(scene.duration * layout.fps) / layout.fps} fps={layout.fps} prefix="del plano" disabled={!baseHasVideo} onChange={(audio) => onUpdate((current) => ({ ...current, scenes: current.scenes.map((item) => item.id === scene.id ? { ...item, audio: { ...item.audio, ...audio } } : item) }), `scene-audio-${scene.id}`)} />}</div>}
    </div>
    <span className="mt-sr-only" aria-live="polite">{announcement}</span>
  </section>;
}
