import { Diamond, RotateCcw, Trash2 } from 'lucide-react';
import type { LayerTransform, TimelineClip } from '../types';
import { evaluateLayerTransform } from '../visual-effects';
import { editLayerTransform, layerFrameAtPlayhead, removeLayerKeyframe, setLayerKeyframe } from '../layer-editing';
import { frameToTimecode } from '../timeline';

type Props = { clip: TimelineClip; fps: number; startFrame?: number; playhead: number; onChange: (clip: TimelineClip, group?: string) => void; onSeek: (time: number) => void; onMessage: (message: string) => void };
const fields: { key: keyof LayerTransform; label: string; min: number; max: number; step: number; format: (value: number) => string }[] = [
  { key: 'x', label: 'Posición horizontal', min: -100, max: 100, step: .5, format: (value) => `${Number(value.toFixed(1))}%` },
  { key: 'y', label: 'Posición vertical', min: -100, max: 100, step: .5, format: (value) => `${Number(value.toFixed(1))}%` },
  { key: 'scale', label: 'Escala', min: .25, max: 3, step: .01, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'opacity', label: 'Opacidad', min: 0, max: 1, step: .01, format: (value) => `${Math.round(value * 100)}%` },
];

export default function LayerAnimationControls({ clip, fps, startFrame, playhead, onChange, onSeek, onMessage }: Props) {
  const frame = layerFrameAtPlayhead(clip, startFrame ?? 0, playhead, fps), time = frame / fps;
  const transform = evaluateLayerTransform(clip, time, fps), points = [...clip.keyframes ?? []].sort((a, b) => a.time - b.time);
  const current = points.find((point) => Math.round(point.time * fps) === frame), atLimit = points.length >= 100 && !current;
  const onClip = startFrame !== undefined && playhead * fps >= startFrame && playhead * fps < startFrame + Math.round(clip.duration * fps);
  const attempt = (action: () => void) => { try { action(); } catch (error) { onMessage(error instanceof Error ? error.message : 'No se pudo editar la animación.'); } };
  const seekFrame = (pointTime: number) => startFrame !== undefined && onSeek((startFrame + Math.round(pointTime * fps)) / fps);
  return <section className="mt-animation" aria-label="Animación de la capa">
    <div className="mt-effect-heading"><div><h3>Encuadre y animación</h3><p>{points.length ? 'Los ajustes guardan un punto en el fotograma actual. La curva sigue al clip.' : 'Ajusta la capa o añade dos fotogramas clave para animar su recorrido.'}</p></div><button type="button" className="mt-text-button" aria-label="Restablecer encuadre y quitar animación" onClick={() => { onChange({ ...clip, transform: { x: 0, y: 0, scale: 1, opacity: 1 }, opacity: 1, keyframes: [] }); onMessage('Encuadre restablecido. Puedes deshacer el cambio.'); }}><RotateCcw size={14} />Restablecer</button></div>
    <div className="mt-keyframe-toolbar"><span>En el clip <strong>{frameToTimecode(frame, fps)}</strong></span><button type="button" className={`mt-text-button ${current ? 'is-keyframe' : ''}`} disabled={!onClip || atLimit} onClick={() => attempt(() => { onChange(setLayerKeyframe(clip, time, fps)); onMessage(current ? 'Fotograma clave actualizado.' : 'Fotograma clave añadido. Mueve el cabezal para crear el siguiente.'); })}><Diamond size={14} fill={current ? 'currentColor' : 'none'} />{current ? 'Actualizar punto' : 'Añadir fotograma clave'}</button><small>{points.length} / 100</small></div>
    {!onClip && <p className="mt-animation-note">Sitúa el cabezal dentro del clip para animarlo.{startFrame !== undefined && <button type="button" className="mt-text-button" onClick={() => seekFrame(0)}>Ir al inicio</button>}</p>}
    <div className="mt-transform-fields">{fields.map((field) => <label className="mt-range-field" key={field.key}><span>{field.label}<output>{field.format(transform[field.key])}</output></span><input aria-label={`${field.label} de la capa`} type="range" min={field.min} max={field.max} step={field.step} value={transform[field.key]} disabled={!!points.length && (!onClip || atLimit)} onChange={(event) => attempt(() => onChange(editLayerTransform(clip, time, fps, { [field.key]: Number(event.target.value) }), `pose-${clip.id}-${frame}-${field.key}`))} /></label>)}</div>
    {!!points.length && <><div className="mt-keyframe-list" aria-label="Fotogramas clave">{points.map((point) => {
      const pointFrame = Math.round(point.time * fps), outside = pointFrame < 0 || pointFrame >= Math.round(clip.duration * fps), active = current?.id === point.id;
      return <div key={point.id} className={`mt-keyframe-row ${active ? 'is-current' : ''}`}>
        <button type="button" className="mt-keyframe-seek" disabled={outside || startFrame === undefined} aria-label={`Ir al fotograma clave ${pointFrame < 0 ? '-' : ''}${frameToTimecode(Math.abs(pointFrame), fps)}`} aria-current={active ? 'true' : undefined} onClick={() => seekFrame(point.time)}><Diamond size={12} fill={active ? 'currentColor' : 'none'} /><span>{pointFrame < 0 ? '−' : ''}{frameToTimecode(Math.abs(pointFrame), fps)}</span>{outside && <small>Fuera del tramo</small>}</button>
        <label className="mt-keyframe-easing"><span className="mt-sr-only">Curva después del fotograma {point.time.toFixed(2)} segundos</span><select value={point.easing} onChange={(event) => onChange({ ...clip, keyframes: points.map((item) => item.id === point.id ? { ...item, easing: event.target.value as typeof point.easing } : item) })}><option value="linear">Lineal</option><option value="ease-in-out">Suave</option><option value="hold">Mantener</option></select></label>
        <button type="button" className="mt-action" aria-label={`Eliminar fotograma clave en ${point.time.toFixed(2)} segundos`} onClick={() => { onChange(removeLayerKeyframe(clip, point.id, time, fps)); onMessage('Fotograma clave retirado. Puedes deshacer el cambio.'); }}><Trash2 size={14} /></button>
      </div>;
    })}</div><p className="mt-animation-note">La curva se aplica desde cada punto hasta el siguiente. Los puntos fuera del tramo conservan el movimiento al recortar.</p></>}
    {atLimit && <p className="mt-animation-note" role="status">Has llegado a 100 puntos. Selecciona uno existente o elimina un punto para seguir.</p>}
  </section>;
}
