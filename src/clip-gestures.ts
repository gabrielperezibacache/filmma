import type { Asset, Project, TimelineClip } from './types';
import { buildTimeline } from './timeline';
import { resolveTimelineClips } from './multitrack';
import { rebaseLayerKeyframes } from './layer-editing';
import { playbackSpeed } from './visual-effects';

export type ClipGestureKind = 'move' | 'trim-start' | 'trim-end';
export type ClipGestureSnapshot = {
  projectId: string; fps: number; trackId: string; clip: TimelineClip; assetType: Asset['type'];
  kind: ClipGestureKind; startFrame: number; endFrame: number; visibleEndFrame: number; sourceStartFrame: number;
  totalFrames: number; scenes: { id: string; startFrame: number; endFrame: number }[];
  tracks: { id: string; type: 'audio' | 'video';locked?:boolean }[]; snapFrames: number[];
};
export type ClipGesturePreview = { clip: TimelineClip; trackId: string; startFrame: number; endFrame: number; visibleEndFrame: number; snapFrame?: number };
const bounded = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const timing = (clip: TimelineClip) => [clip.assetId, clip.sceneId, clip.offset, clip.duration, clip.trimStart, clip.speed, clip.keyframes,clip.envelope];

export function createClipGesture(project: Project, trackId: string, clipId: string, kind: ClipGestureKind, playhead = 0): ClipGestureSnapshot {
  const layout = buildTimeline(project), resolved = resolveTimelineClips(project);
  const item = resolved.find((entry) => entry.track.id === trackId && entry.clip.id === clipId);
  if (!item) throw new Error('El clip ya no está disponible en el montaje.');
  if(item.track.locked)throw new Error('Desbloquea la pista antes de editar sus clips.');
  const snapFrames = new Set([0, layout.totalFrames, bounded(Math.round(playhead * layout.fps), 0, layout.totalFrames), ...layout.segments.map((segment) => segment.startFrame)]);
  for (const entry of resolved) if (entry.track.id !== trackId || entry.clip.id !== clipId) { snapFrames.add(entry.startFrame); snapFrames.add(entry.endFrame); }
  return { projectId: project.id, fps: layout.fps, trackId, clip: { ...item.clip }, assetType: item.asset.type, kind,
    startFrame: item.startFrame, endFrame: item.startFrame + Math.round(item.clip.duration * layout.fps), visibleEndFrame: item.endFrame, sourceStartFrame: item.clip.trimStart * layout.fps,
    totalFrames: layout.totalFrames, scenes: layout.segments.map((segment) => ({ id: segment.scene.id, startFrame: segment.startFrame, endFrame: segment.endFrame })),
    tracks: (project.tracks ?? []).map((track) => ({ id: track.id, type: track.type,locked:track.locked })), snapFrames: [...snapFrames].sort((a, b) => a - b),
  };
}

export function compatibleGestureTrack(snapshot: ClipGestureSnapshot, trackId: string) {
  const track = snapshot.tracks.find((entry) => entry.id === trackId);
  return !!track && !track.locked && (track.type === 'audio' ? snapshot.assetType === 'audio' : snapshot.assetType !== 'audio');
}

/** Pure local preview: no writes, IDs or timestamps. Snaps use screen-derived
 * tolerance, but both the candidate and accepted result stay on the frame grid. */
export function previewClipGesture(snapshot: ClipGestureSnapshot, deltaFrames: number, options: { snap?: boolean; snapThresholdFrames?: number; targetTrackId?: string } = {}): ClipGesturePreview {
  const s = snapshot, limit = 86400 * s.fps, duration = s.endFrame - s.startFrame, rate = playbackSpeed(s.clip.speed);
  const delta = Number.isFinite(deltaFrames) ? Math.round(deltaFrames) : 0;
  let min: number, max: number, initial: number;
  if (s.kind === 'move') { min = 0; max = s.totalFrames - 1; initial = s.startFrame + delta; }
  else if (s.kind === 'trim-start') {
    min = Math.max(0, s.endFrame - limit, s.assetType === 'image' ? 0 : s.startFrame - Math.floor(s.sourceStartFrame / rate));
    max = Math.min(s.visibleEndFrame - 1, s.assetType === 'image' ? s.visibleEndFrame - 1 : s.startFrame + Math.floor((limit - s.sourceStartFrame) / rate));
    initial = s.startFrame + delta;
  } else { min = s.startFrame + 1; max = Math.min(s.totalFrames, s.startFrame + limit); initial = s.visibleEndFrame + delta; }
  let value = bounded(initial, min, max), snapFrame: number | undefined;
  const threshold = Math.max(0, options.snapThresholdFrames ?? 0);
  if (options.snap !== false && threshold > 0) {
    let distance = Infinity;
    const edges = s.kind === 'move' ? [0, duration] : [0];
    for (const edge of edges) for (const target of s.snapFrames) {
      const candidate = target - edge, difference = Math.abs(candidate - value);
      if (candidate >= min && candidate <= max && difference <= threshold && difference < distance) { distance = difference; snapFrame = target; initial = candidate; }
    }
    if (snapFrame !== undefined) value = initial;
  }
  const startFrame = s.kind === 'trim-end' ? s.startFrame : value;
  const endFrame = s.kind === 'move' ? startFrame + duration : s.kind === 'trim-start' ? s.endFrame : value;
  const anchor = s.scenes.find((scene) => startFrame >= scene.startFrame && startFrame < scene.endFrame) ?? s.scenes[s.scenes.length - 1]!;
  const trackId = s.kind === 'move' && options.targetTrackId && compatibleGestureTrack(s, options.targetTrackId) ? options.targetTrackId : s.trackId;
  const clip = { ...s.clip, sceneId: s.kind === 'trim-end' ? s.clip.sceneId : anchor.id, offset: s.kind === 'trim-end' ? s.clip.offset : (startFrame - anchor.startFrame) / s.fps, duration: (endFrame - startFrame) / s.fps,
    trimStart: s.assetType === 'image' ? 0 : (s.sourceStartFrame + (s.kind === 'trim-start' ? (startFrame - s.startFrame) * rate : 0)) / s.fps,
    ...(s.kind === 'trim-start' ? { keyframes: rebaseLayerKeyframes(s.clip, (startFrame - s.startFrame) / s.fps),...(s.clip.envelope?{envelope:{...s.clip.envelope,offset:s.clip.envelope.offset+(startFrame-s.startFrame)/s.fps}}:{}) } : {}),
  };
  return { clip, trackId, startFrame, endFrame, visibleEndFrame: Math.min(s.totalFrames, endFrame), ...(snapFrame === undefined ? {} : { snapFrame }) };
}

/** Commit only if the gesture's timing context is still current. Unrelated
 * script, audio and asset edits are kept; one returned project is one undo step. */
export function commitClipGesture(project: Project, snapshot: ClipGestureSnapshot, preview: ClipGesturePreview): Project {
  const layout = buildTimeline(project);
  if (project.id !== snapshot.projectId || project.fps !== snapshot.fps || JSON.stringify(layout.segments.map((segment) => ({ id: segment.scene.id, startFrame: segment.startFrame, endFrame: segment.endFrame }))) !== JSON.stringify(snapshot.scenes)) throw new Error('El montaje cambió durante el arrastre. Vuelve a mover el clip.');
  const source = project.tracks?.find((track) => track.id === snapshot.trackId), target = project.tracks?.find((track) => track.id === preview.trackId);
  const current = source?.clips.find((clip) => clip.id === snapshot.clip.id);
  if(source?.locked||target?.locked)throw new Error('La pista se bloqueó durante la edición. El clip se conserva.');
  if (!source || !target || !current || JSON.stringify(timing(current)) !== JSON.stringify(timing(snapshot.clip))) throw new Error('El clip cambió durante el arrastre. Revisa su posición antes de continuar.');
  const asset = project.assets.find((item) => item.id === current.assetId);
  if (!asset || (target.type === 'audio' ? asset.type !== 'audio' : asset.type === 'audio')) throw new Error('El archivo no es compatible con la pista de destino.');
  const next = { ...current, sceneId: preview.clip.sceneId, offset: preview.clip.offset, duration: preview.clip.duration, trimStart: preview.clip.trimStart, ...(snapshot.kind === 'trim-start' ? { keyframes: preview.clip.keyframes,envelope:preview.clip.envelope } : {}) };
  if (source.id === target.id && JSON.stringify(timing(current)) === JSON.stringify(timing(next))) return project;
  return { ...project, tracks: project.tracks!.map((track) => track.id === source.id && source.id === target.id ? { ...track, clips: track.clips.map((clip) => clip.id === current.id ? next : clip) }
    : track.id === source.id ? { ...track, clips: track.clips.filter((clip) => clip.id !== current.id) }
      : track.id === target.id ? { ...track, clips: [...track.clips, next] } : track) };
}
