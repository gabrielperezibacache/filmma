import type { Asset, ClipAudio, EditorTrack, Project, TimelineClip } from './types';
import {removeDialogueLine} from './dialogue-removal';
import { buildTimeline } from './timeline';

export type ResolvedTimelineClip = { track: EditorTrack; clip: TimelineClip; asset: Asset; startFrame: number; endFrame: number; sourceStartFrame: number; durationFrames: number };

export function quantizeTimelineSeconds(value: number, fps: number) {
  return Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * fps)) / fps;
}

/** V1 determines movie length. Extra tracks follow scene anchors and may cross cuts.
 * Order is preserved: the last video track (and last overlapping clip) is on top.
 * Muting affects sound only, so muted video clips remain in this resolved list. */
export function resolveTimelineClips(project: Project): ResolvedTimelineClip[] {
  const layout = buildTimeline(project), scenes = new Map(layout.segments.map((segment) => [segment.scene.id, segment]));
  const assets = new Map(project.assets.map((asset) => [asset.id, asset])), resolved: ResolvedTimelineClip[] = [];
  for (const track of project.tracks ?? []) for (const clip of track.clips) {
    const anchor = scenes.get(clip.sceneId), asset = assets.get(clip.assetId);
    if (!anchor || !asset || (track.type === 'audio' ? asset.type !== 'audio' : !['video', 'image'].includes(asset.type))) continue;
    if (![clip.offset, clip.duration, clip.trimStart].every(Number.isFinite) || clip.offset < 0 || clip.duration <= 0 || clip.trimStart < 0) continue;
    const startFrame = anchor.startFrame + Math.round(clip.offset * layout.fps);
    const endFrame = Math.min(layout.totalFrames, startFrame + Math.round(clip.duration * layout.fps));
    if (endFrame <= startFrame) continue;
    resolved.push({ track, clip, asset, startFrame, endFrame, sourceStartFrame: clip.trimStart * layout.fps, durationFrames: endFrame - startFrame });
  }
  return resolved;
}

/** Linear input/output fades multiply when they overlap, matching audio filters.
 * elapsedSeconds is relative to the start of the clip, not to source trimStart.
 * Multiply this gain by the track gain; use opacity separately for picture. */
export function audioGainAt(elapsedSeconds: number, durationSeconds: number, settings: ClipAudio = {}) {
  if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || elapsedSeconds < 0 || elapsedSeconds >= durationSeconds || settings.muted) return 0;
  const finite = (value: number | undefined, fallback: number) => value == null ? fallback : Number.isFinite(value) ? value : 0;
  const volume = Math.max(0, Math.min(1, finite(settings.volume, 1)));
  const duration=settings.envelope?.duration??durationSeconds,time=elapsedSeconds+(settings.envelope?.offset??0);
  if(time<0||time>=duration)return 0;
  const fadeIn = Math.max(0, Math.min(duration, finite(settings.fadeIn, 0))), fadeOut = Math.max(0, Math.min(duration, finite(settings.fadeOut, 0)));
  return volume * (fadeIn ? Math.min(1, time / fadeIn) : 1) * (fadeOut ? Math.min(1, (duration - time) / fadeOut) : 1);
}

/** Call alongside deleting a scene; media files and the scene array are untouched. */
export function removeSceneAttachments(project: Project, sceneId: string): Project {
  // A synchronized take may be reused in a different scene. Restore its source
  // before removing the narrative line, so embedded dialogue cannot be orphaned.
  project=(project.dialogueLines??[]).filter(line=>line.sceneId===sceneId).reduce((p,line)=>removeDialogueLine(p,line.id),project);
  const removedLines=new Set((project.dialogueLines??[]).filter(line=>line.sceneId===sceneId).map(line=>line.id));
  return { ...project,
    tracks: project.tracks?.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.sceneId !== sceneId && !removedLines.has(clip.dialogueLineId??'')) })),
    subtitleCues: project.subtitleCues?.filter((cue) => cue.sceneId !== sceneId),
    dialogueLines: project.dialogueLines?.filter(line => line.sceneId !== sceneId),
  };
}

function attachmentId(id: string, sceneId: string, used: Set<string>) {
  const base = `${id.slice(0, 40)}-${sceneId.slice(0, 40)}-copy`;
  let result = base, suffix = 1;
  while (used.has(result)) result = `${base}-${suffix++}`;
  used.add(result); return result;
}

/** Call after inserting the new scene. Legacy dialogue subtitles stay implicit. */
export function duplicateSceneAttachments(project: Project, sourceSceneId: string, newSceneId: string): Project {
  if (!project.scenes.some((scene) => scene.id === newSceneId) || sourceSceneId === newSceneId) return project;
  const clips = (project.tracks ?? []).flatMap((track) => track.clips);
  if (clips.length + clips.filter((clip) => clip.sceneId === sourceSceneId).length > 500) throw new Error('Duplicar el plano superaría los 500 clips adicionales.');
  const cues = project.subtitleCues ?? [];
  if (cues.length + cues.filter((cue) => cue.sceneId === sourceSceneId).length > 1000) throw new Error('Duplicar el plano superaría los 1.000 subtítulos.');
  const sourceLines=(project.dialogueLines??[]).filter(line=>line.sceneId===sourceSceneId);
  if((project.dialogueLines?.length??0)+sourceLines.length>1000)throw new Error('Duplicar el plano superaría las 1.000 intervenciones.');
  const lineIds=new Set((project.dialogueLines??[]).map(line=>line.id));
  const lineMap=new Map(sourceLines.map(line=>[line.id,attachmentId(line.id,newSceneId,lineIds)]));
  const used = new Set([...(project.tracks ?? []).flatMap((track) => track.clips.map((clip) => clip.id)), ...(project.subtitleCues ?? []).map((cue) => cue.id)]);
  return { ...project,
    dialogueLines: project.dialogueLines ? [...project.dialogueLines,...sourceLines.map(line=>({...line,id:lineMap.get(line.id)!,sceneId:newSceneId}))] : undefined,
    tracks: project.tracks?.map((track) => ({ ...track, clips: [...track.clips, ...track.clips.filter((clip) => clip.sceneId === sourceSceneId).map((clip) => ({ ...clip, id: attachmentId(clip.id, newSceneId, used), sceneId: newSceneId, dialogueLineId: clip.dialogueLineId ? lineMap.get(clip.dialogueLineId)??clip.dialogueLineId : undefined }))] })),
    subtitleCues: project.subtitleCues ? [...project.subtitleCues, ...project.subtitleCues.filter((cue) => cue.sceneId === sourceSceneId).map((cue) => ({ ...cue, id: cue.id.startsWith('dialogue-') && lineMap.has(cue.id.slice(9)) ? `dialogue-${lineMap.get(cue.id.slice(9))}` : attachmentId(cue.id, newSceneId, used), sceneId: newSceneId,dialogueLineId:cue.dialogueLineId?lineMap.get(cue.dialogueLineId)??cue.dialogueLineId:undefined }))] : undefined,
  };
}
