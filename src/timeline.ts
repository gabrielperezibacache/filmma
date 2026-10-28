import type { Project, Scene, SubtitleCue } from './types';
import { getProjectSubtitleCues } from './subtitles';
import {playbackSpeed} from './visual-effects';
import { DEFAULT_PROJECT_FPS, isProjectFrameRate } from './export-resolution';

/** Split a shot on the project's frame grid, preserving its source media.
 * Duration is rounded to the nearest frame (at most half a frame of adjustment).
 * The original incoming transition stays on the first part; the internal cut
 * is direct. Legacy per-shot fades are cleared to avoid a fade at the split.
 * This function does not mutate the project or generate IDs/timestamps.
 */
export function splitProjectScene(project: Project, sceneId: string, offsetSeconds: number, newId: string): Project {
  if (project.scenes.length >= 100) throw new Error('El proyecto ya tiene 100 planos; elimina uno antes de dividir.');
  if (!isProjectFrameRate(project.fps)) throw new Error('La velocidad del proyecto debe ser 24, 25, 30, 48, 50 o 60 fps.');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(newId) || project.scenes.some((scene) => scene.id === newId)) throw new Error('El nuevo plano necesita un identificador válido y único.');
  const index = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) throw new Error('No se encontró el plano que quieres dividir.');
  const scene = project.scenes[index]!;
  if (!Number.isFinite(scene.duration) || !Number.isFinite(offsetSeconds)) throw new Error('La duración y la posición del corte deben ser números válidos.');
  const totalFrames = Math.round(scene.duration * project.fps), firstFrames = Math.round(offsetSeconds * project.fps), secondFrames = totalFrames - firstFrames;
  if (firstFrames < project.fps || secondFrames < project.fps) throw new Error('Cada parte del plano debe durar al menos un segundo.');
  const firstDuration = firstFrames / project.fps, secondDuration = secondFrames / project.fps;
  const sourceStart = scene.trimStart ?? 0;
  const sourceAdvance=firstDuration*playbackSpeed(scene.speed);
  if (scene.videoAssetId && (!Number.isFinite(sourceStart) || sourceStart < 0 || sourceStart + sourceAdvance > 86400)) throw new Error('El punto de entrada del video está fuera del rango permitido.');
  const first: Scene = { ...scene, duration: firstDuration, characterIds: [...scene.characterIds], transition: scene.transition === 'fade' ? 'cut' : scene.transition,
    ...(scene.audio ? { audio: { ...scene.audio, fadeIn: Math.min(scene.audio.fadeIn ?? 0, firstDuration), fadeOut: 0 } } : {}),
  };
  const suffix = ' · continuación';
  const second: Scene = {
    ...scene, id: newId, title: scene.title.slice(0, 250 - suffix.length) + suffix,
    duration: secondDuration, trimStart: scene.videoAssetId ? sourceStart + sourceAdvance : 0,
    characterIds: [...scene.characterIds], dialogue: '', transition: 'cut', transitionDuration: undefined,
    ...(scene.audio ? { audio: { ...scene.audio, fadeIn: 0, fadeOut: Math.min(scene.audio.fadeOut ?? 0, secondDuration) } } : {}),
  };
  // Extra clips keep one uninterrupted source/envelope. Those beginning after
  // the cut follow the continuation; a clip crossing the cut keeps its anchor.
  const tracks = project.tracks?.map((track) => ({ ...track, clips: track.clips.map((clip) => {
    const offsetFrames = Math.round(clip.offset * project.fps);
    return clip.sceneId === sceneId && offsetFrames >= firstFrames ? { ...clip, sceneId: newId, offset: (offsetFrames - firstFrames) / project.fps } : clip;
  }) }));
  if ((tracks ?? []).reduce((sum, track) => sum + track.clips.length, 0) > 500) throw new Error('El proyecto supera los 500 clips adicionales.');
  // Materialize legacy captions for every shot before splitting, so captions
  // belonging to the untouched shots are not lost when the list becomes explicit.
  const originalCues = getProjectSubtitleCues(project), used = new Set(originalCues.map((cue) => cue.id));
  const subtitleCues: SubtitleCue[] = [];
  for (const cue of originalCues) {
    if (cue.sceneId !== sceneId) { subtitleCues.push(cue); continue; }
    const start = Math.round(cue.start * project.fps), end = Math.round(cue.end * project.fps);
    if (end <= firstFrames) subtitleCues.push(cue);
    else if (start >= firstFrames) subtitleCues.push({ ...cue, sceneId: newId, start: (start - firstFrames) / project.fps, end: (end - firstFrames) / project.fps });
    else {
      const base = `${cue.id.slice(0, 40)}-${newId.slice(0, 40)}-split`; let id = base, suffix = 1;
      while (used.has(id)) id = `${base}-${suffix++}`;
      used.add(id);
      subtitleCues.push({ ...cue, end: firstDuration }, { ...cue, id, sceneId: newId, start: 0, end: (end - firstFrames) / project.fps });
    }
  }
  if (subtitleCues.length > 1000) throw new Error('Dividir el plano superaría los 1.000 subtítulos.');
  const dialogueLines=project.dialogueLines?.map(line=>line.sceneId===sceneId&&Math.round(line.offset*project.fps)>=firstFrames?{...line,sceneId:newId,offset:(Math.round(line.offset*project.fps)-firstFrames)/project.fps}:line);
  return { ...project, ...(project.markers?{markers:project.markers.map(m=>m.sceneId===sceneId&&Math.round(m.offset*project.fps)>=firstFrames?{...m,sceneId:newId,offset:(Math.round(m.offset*project.fps)-firstFrames)/project.fps}:m)}:{}), dialogueLines, scenes: [...project.scenes.slice(0, index), first, second, ...project.scenes.slice(index + 1)], tracks, subtitleCues,
    ...(project.subtitleCues === undefined ? { subtitlesEnabled: project.subtitlesEnabled ?? false } : {}),
  };
}

export type TimelineSegment = { scene: Scene; index: number; startFrame: number; endFrame: number; durationFrames: number };
export type TimelineLayout = { fps: number; segments: TimelineSegment[]; totalFrames: number; totalSeconds: number };

/** One frame-based model is shared by the ruler, selection, cuts and keyboard. */
export function buildTimeline(project: Pick<Project, 'fps' | 'scenes'>): TimelineLayout {
  const fps = isProjectFrameRate(project.fps) ? project.fps : DEFAULT_PROJECT_FPS;
  let cursor = 0;
  const segments = project.scenes.map((scene, index) => {
    const durationFrames = Math.max(1, Math.round((Number.isFinite(scene.duration) ? scene.duration : 1) * fps));
    const segment = { scene, index, startFrame: cursor, endFrame: cursor + durationFrames, durationFrames };
    cursor += durationFrames;
    return segment;
  });
  return { fps, segments, totalFrames: cursor, totalSeconds: cursor / fps };
}

export function frameFromSeconds(seconds: number, fps: number, maxFrames = Number.MAX_SAFE_INTEGER) {
  return Math.min(Math.max(0, maxFrames), Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * fps)));
}

export function frameToTimecode(frame: number, fps: number) {
  const value = Math.max(0, Math.round(frame)), seconds = Math.floor(value / fps);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, value % fps].map((part) => String(part).padStart(2, '0')).join(':');
}

/** At a cut, selection belongs to the incoming shot; the end belongs to the last. */
export function segmentAtFrame(layout: TimelineLayout, frame: number) {
  if (!layout.segments.length) return undefined;
  const bounded = Math.min(Math.max(0, frame), layout.totalFrames);
  return layout.segments.find((segment) => bounded < segment.endFrame) ?? layout.segments[layout.segments.length - 1];
}

export function adjacentCutFrame(layout: TimelineLayout, frame: number, direction: -1 | 1) {
  const cuts = [0, ...layout.segments.map((segment) => segment.endFrame)];
  return direction === -1 ? [...cuts].reverse().find((cut) => cut < frame) ?? 0 : cuts.find((cut) => cut > frame) ?? layout.totalFrames;
}

/** targetIndex refers to the original array; the result is its index after removal. */
export function timelineDropIndex(sourceIndex: number, targetIndex: number, after: boolean) {
  const insertion = targetIndex + Number(after);
  return Math.max(0, insertion - Number(sourceIndex < insertion));
}

export function timelineRulerTicks(layout: TimelineLayout, pixelsPerSecond: number, firstVisibleFrame = 0, lastVisibleFrame = layout.totalFrames) {
  const pps = Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0 ? pixelsPerSecond : 1;
  const framesForLabel = 76 * layout.fps / pps;
  const steps = [1, 2, 5, 10, Math.ceil(layout.fps / 2), layout.fps, ...[2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].map((seconds) => seconds * layout.fps)].sort((a, b) => a - b);
  const step = steps.find((candidate) => candidate >= framesForLabel) ?? Math.ceil(framesForLabel / layout.fps) * layout.fps;
  const start = Math.max(0, Math.floor(firstVisibleFrame / step) * step), end = Math.min(layout.totalFrames, lastVisibleFrame + step);
  const ticks: { frame: number; label: string }[] = [];
  for (let frame = start; frame <= end; frame += step) ticks.push({ frame, label: frameToTimecode(frame, layout.fps) });
  return ticks;
}
