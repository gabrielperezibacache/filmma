import type { LayerTransform, TimelineClip } from './types';
import { evaluateLayerTransform } from './visual-effects';

/** Retain every interpolation endpoint, even outside the mounted interval.
 * Replacing a negative endpoint with a sample at zero would alter smoothstep. */
export function rebaseLayerKeyframes(clip: Pick<TimelineClip, 'keyframes'>, deltaSeconds: number): TimelineClip['keyframes'] {
  if (!clip.keyframes?.length || deltaSeconds === 0) return clip.keyframes;
  if (!Number.isFinite(deltaSeconds)) throw new Error('El recorte necesita un tiempo válido.');
  const points = clip.keyframes.map((point) => ({ ...point, time: point.time - deltaSeconds }));
  if (points.some((point) => Math.abs(point.time) > 86400)) throw new Error('El recorte desplazaría un fotograma clave fuera del rango permitido.');
  return points;
}

export function layerFrameAtPlayhead(clip: TimelineClip, startFrame: number, playhead: number, fps: number) {
  return Math.max(0, Math.min(Math.max(0, Math.round(clip.duration * fps) - 1), Math.round(playhead * fps) - startFrame));
}

/** A complete snapshot makes each key independent of later static edits. */
export function setLayerKeyframe(clip: TimelineClip, time: number, fps: number, patch: Partial<LayerTransform> = {}, newId: string = crypto.randomUUID()): TimelineClip {
  const frame = Math.max(0, Math.min(Math.max(0, Math.round(clip.duration * fps) - 1), Math.round(time * fps)));
  const local = frame / fps, points = clip.keyframes ?? [];
  const existing = points.find((point) => Math.round(point.time * fps) === frame);
  if (!existing && points.length >= 100) throw new Error('Esta capa ya tiene 100 fotogramas clave. Elimina uno para añadir otro.');
  const snapshot = { ...evaluateLayerTransform(clip, local, fps), ...patch };
  const point = { ...snapshot, id: existing?.id ?? newId, time: local, easing: existing?.easing ?? 'linear' as const };
  return { ...clip, keyframes: [...points.filter((item) => item.id !== existing?.id), point].sort((a, b) => a.time - b.time) };
}

/** With animation, edit the selected frame. Otherwise edit the static pose. */
export function editLayerTransform(clip: TimelineClip, time: number, fps: number, patch: Partial<LayerTransform>): TimelineClip {
  if (clip.keyframes?.length) return setLayerKeyframe(clip, time, fps, patch);
  return { ...clip, transform: { ...evaluateLayerTransform(clip, 0, fps), ...patch } };
}

/** Removing the final point holds the pose that was visible at the playhead. */
export function removeLayerKeyframe(clip: TimelineClip, id: string, time: number, fps: number): TimelineClip {
  if (!clip.keyframes?.some((point) => point.id === id)) return clip;
  const keyframes = clip.keyframes.filter((point) => point.id !== id);
  return { ...clip, keyframes, ...(!keyframes.length ? { transform: evaluateLayerTransform(clip, time, fps) } : {}) };
}
