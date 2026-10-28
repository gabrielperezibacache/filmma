import type { Project } from './types';
import { buildTimeline } from './timeline';
import { resolveTimelineClips } from './multitrack';
import { duplicateTimelineClip, splitTimelineClip } from './clip-editing';
export const allEditorClips = (project: Project) => (project.tracks ?? []).flatMap(track => track.clips.map(clip => ({ track, clip })));
export function expandClipSelection(project: Project, ids: string[]) {
    const known = new Set(allEditorClips(project).map(x => x.clip.id)), selected = new Set(ids.filter(id => known.has(id)));
    for (const group of project.clipGroups ?? [])
        if (group.clipIds.some(id => selected.has(id)))
            group.clipIds.forEach(id => { if (known.has(id))
                selected.add(id); });
    return [...selected];
}
export function selectEditorClips(project: Project, current: string[], id: string, mode: 'replace' | 'toggle' | 'range', anchorId?: string) {
    const cohort = expandClipSelection(project, [id]);
    if (mode === 'replace')
        return cohort;
    if (mode === 'range' && anchorId) {
        const resolved = resolveTimelineClips(project), order = [...project.tracks ?? []].reverse().flatMap(t => resolved.filter(x => x.track.id === t.id).sort((a, b) => a.startFrame - b.startFrame).map(x => x.clip.id));
        const a = order.indexOf(anchorId), b = order.indexOf(id);
        if (a >= 0 && b >= 0)
            return expandClipSelection(project, [...current, ...order.slice(Math.min(a, b), Math.max(a, b) + 1)]);
    }
    const selected = new Set(current), remove = cohort.every(key => selected.has(key));
    cohort.forEach(key => remove ? selected.delete(key) : selected.add(key));
    return [...selected];
}
export { reconcileEditorMetadata } from './editor-metadata';
import { reconcileEditorMetadata } from './editor-metadata';
function editable(project: Project, ids: string[]) {
    const expanded = expandClipSelection(project, ids), items = allEditorClips(project).filter(x => expanded.includes(x.clip.id));
    if (!items.length || new Set(ids).size !== ids.length || ids.some(id => !items.some(x => x.clip.id === id)))
        throw Error('La selección ya no está disponible.');
    if (items.some(x => x.track.locked))
        throw Error('La selección incluye una pista bloqueada. No se ha movido ni editado ningún clip.');
    return items;
}
export function groupEditorClips(project: Project, ids: string[], name: string, id: string = crypto.randomUUID()): Project {
    const keys = expandClipSelection(project, ids);
    if (keys.length < 2)
        throw Error('Selecciona al menos dos clips para agrupar.');
    if (!name.trim() || name.trim().length > 120)
        throw Error('Escribe un nombre de grupo de hasta 120 caracteres.');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || (project.clipGroups ?? []).some(g => g.id === id))
        throw Error('El grupo necesita un identificador único.');
    const remaining = (project.clipGroups ?? []).filter(g => !g.clipIds.some(key => keys.includes(key)));
    if (remaining.length >= 100)
        throw Error('La película admite hasta cien grupos.');
    return { ...project, clipGroups: [...remaining, { id, name: name.trim(), clipIds: keys }] };
}
export function ungroupEditorClips(project: Project, ids: string[]): Project { return { ...project, clipGroups: project.clipGroups?.filter(g => !g.clipIds.some(id => ids.includes(id))) }; }
export function deleteEditorClips(project: Project, ids: string[]): Project {
    const keys = new Set(editable(project, ids).map(x => x.clip.id));
    return reconcileEditorMetadata({ ...project, tracks: project.tracks?.map(t => ({ ...t, clips: t.clips.filter(c => !keys.has(c.id)) })) });
}
export type BatchMoveSnapshot = {
    projectId: string;
    fps: number;
    scenes: {
        id: string;
        startFrame: number;
        endFrame: number;
    }[];
    items: {
        trackId: string;
        clipId: string;
        anchorFrame: number;
        offsetFrame: number;
        durationFrame: number;
        clipJson: string;
    }[];
    groupsJson: string;
    minDelta: number;
    maxDelta: number;
    snapFrames: number[];
};
const groupSignature = (p: Project, ids: string[]) => JSON.stringify((p.clipGroups ?? []).filter(g => g.clipIds.some(id => ids.includes(id))));
export function createBatchMove(project: Project, ids: string[], playhead = 0): BatchMoveSnapshot {
    const layout = buildTimeline(project), items = editable(project, ids), known = resolveTimelineClips(project);
    if (items.some(x => !known.some(k => k.clip.id === x.clip.id)))
        throw Error('Un clip de la selección está fuera de la película. Revisa sus tiempos antes de mover el conjunto.');
    const snapshots = items.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id, anchorFrame: layout.segments.find(s => s.scene.id === clip.sceneId)!.startFrame, offsetFrame: Math.round(clip.offset * layout.fps), durationFrame: Math.round(clip.duration * layout.fps), clipJson: JSON.stringify(clip) }));
    const keys = snapshots.map(x => x.clipId), snaps = new Set([0, layout.totalFrames, Math.round(playhead * layout.fps), ...layout.segments.map(s => s.startFrame)]);
    known.filter(x => !keys.includes(x.clip.id)).forEach(x => { snaps.add(x.startFrame); snaps.add(x.endFrame); });
    for (const m of project.markers ?? []) {
        const scene = layout.segments.find(s => s.scene.id === m.sceneId);
        if (scene && m.offset * layout.fps < scene.durationFrames)
            snaps.add(scene.startFrame + Math.round(m.offset * layout.fps));
    }
    return { projectId: project.id, fps: layout.fps, scenes: layout.segments.map(s => ({ id: s.scene.id, startFrame: s.startFrame, endFrame: s.endFrame })), items: snapshots, groupsJson: groupSignature(project, keys), minDelta: Math.max(...snapshots.map(x => -x.offsetFrame)), maxDelta: Math.min(...snapshots.map(x => Math.min(layout.totalFrames - 1 - x.anchorFrame - x.offsetFrame, 86400 * layout.fps - x.offsetFrame))), snapFrames: [...snaps] };
}
export function previewBatchMove(snapshot: BatchMoveSnapshot, delta: number, options: {
    snap?: boolean;
    threshold?: number;
} = {}) {
    let value = Math.min(snapshot.maxDelta, Math.max(snapshot.minDelta, Number.isFinite(delta) ? Math.round(delta) : 0)), snapFrame: number | undefined, distance = Infinity;
    const requested = value;
    if (options.snap !== false)
        for (const item of snapshot.items)
            for (const edge of [item.anchorFrame + item.offsetFrame, item.anchorFrame + item.offsetFrame + item.durationFrame])
                for (const target of snapshot.snapFrames) {
                    const candidate = target - edge, d = Math.abs(candidate - requested);
                    if (candidate >= snapshot.minDelta && candidate <= snapshot.maxDelta && d < distance && d <= (options.threshold ?? 0)) {
                        value = candidate;
                        snapFrame = target;
                        distance = d;
                    }
                }
    return { deltaFrames: value, snapFrame, items: snapshot.items.map(x => ({ clipId: x.clipId, trackId: x.trackId, startFrame: x.anchorFrame + x.offsetFrame + value, endFrame: x.anchorFrame + x.offsetFrame + value + x.durationFrame })) };
}
/** Follow a whole voice placement only when all retained fragments agree on
 * one source clock. Repeated takes remain editorial copies, never new dialogue. */
function moveLinkedDialogue(project:Project,ids:string[],delta:number):Project {
 const clips=allEditorClips(project).map(x=>x.clip),keys=new Set(ids),lineIds=new Set(clips.filter(c=>keys.has(c.id)&&c.dialogueLineId).map(c=>c.dialogueLineId!));let result=project;
 for(const id of lineIds){const line=project.dialogueLines?.find(l=>l.id===id);if(!line)continue;const copies=clips.filter(c=>c.dialogueLineId===id);if(copies.some(c=>!keys.has(c.id)))continue;if(copies.some(c=>c.sceneId!==line.sceneId))throw Error('La voz está vinculada a otro plano. Revisa su referencia en Voces antes de mover el conjunto.');
  const bases=copies.map(c=>c.offset-c.trimStart/(c.speed??1)),start=bases[0]!;if(bases.some(n=>Math.abs(n-start)>1/project.fps))continue;
  const offset=Math.round((start+delta)*project.fps)/project.fps;if(offset<0||offset>120)throw Error('La entrada de la voz quedaría fuera del intervalo de 0 a 120 s. No se movió el conjunto.');
  const shift=offset-line.offset;for(const cue of project.subtitleCues??[])if(cue.dialogueLineId===id&&(cue.start+shift<0||cue.end+shift>86400))throw Error('El movimiento dejaría un subtítulo vinculado fuera del rango. Ajusta sus tiempos antes de mover el conjunto.');
  result={...result,dialogueLines:result.dialogueLines?.map(l=>l.id===id?{...l,offset}:l),subtitleCues:result.subtitleCues?.map(c=>c.dialogueLineId===id?{...c,start:c.start+shift,end:c.end+shift}:c)};
 }
 return result;
}
export function commitBatchMove(project: Project, snapshot: BatchMoveSnapshot, deltaFrames: number, targetTrackId?: string): Project {
    const layout = buildTimeline(project), ids = snapshot.items.map(x => x.clipId);
    if (project.id !== snapshot.projectId || layout.fps !== snapshot.fps || JSON.stringify(layout.segments.map(s => ({ id: s.scene.id, startFrame: s.startFrame, endFrame: s.endFrame }))) !== JSON.stringify(snapshot.scenes) || groupSignature(project, ids) !== snapshot.groupsJson)
        throw Error('El montaje o el grupo cambió durante el movimiento. Revisa la selección de nuevo.');
    const current = editable(project, ids);
    if (current.length !== ids.length || current.some(x => snapshot.items.find(s => s.clipId === x.clip.id && s.trackId === x.track.id)?.clipJson !== JSON.stringify(x.clip)))
        throw Error('Un clip cambió durante el movimiento. No se aplicó el conjunto.');
    const delta = previewBatchMove(snapshot, deltaFrames, { snap: false }).deltaFrames;
    if (!delta && (!targetTrackId || targetTrackId === snapshot.items[0]?.trackId))
        return project;
    project=moveLinkedDialogue(project,ids,delta/snapshot.fps);
    if (targetTrackId && snapshot.items.length === 1 && targetTrackId !== snapshot.items[0]!.trackId) {
        const item = current[0]!, target = project.tracks?.find(t => t.id === targetTrackId), asset = project.assets.find(a => a.id === item.clip.assetId);
        if (!target || target.locked || !asset || (target.type === 'audio' ? asset.type !== 'audio' : asset.type === 'audio'))
            throw Error('La pista de destino no admite el clip o está bloqueada.');
        const clip = { ...item.clip, offset: (snapshot.items[0]!.offsetFrame + delta) / snapshot.fps };
        return { ...project, tracks: project.tracks?.map(t => t.id === target.id ? { ...t, clips: [...t.clips, clip] } : t.id === item.track.id ? { ...t, clips: t.clips.filter(c => c.id !== clip.id) } : t) };
    }
    return { ...project, tracks: project.tracks?.map(t => ({ ...t, clips: t.clips.map(c => { const item = snapshot.items.find(x => x.clipId === c.id); return item ? { ...c, offset: (item.offsetFrame + delta) / snapshot.fps } : c; }) })) };
}
export function duplicateEditorClips(project: Project, ids: string[], seconds: number, newId: () => string = () => crypto.randomUUID()): {
    project: Project;
    ids: string[];
} {
    const snapshot = createBatchMove(project, ids), start = Math.min(...snapshot.items.map(x => x.anchorFrame + x.offsetFrame)), delta = Math.round(seconds * snapshot.fps) - start;
    if (delta < snapshot.minDelta || delta > snapshot.maxDelta)
        throw Error('El cabezal dejaría alguna copia antes de su plano de referencia o fuera de la película.');
    let result = project;
    const copies = new Map<string, string>();
    for (const item of snapshot.items) {
        const id = newId();
        let first = true;
        result = duplicateTimelineClip(result, item.trackId, item.clipId, (item.anchorFrame + item.offsetFrame + delta) / snapshot.fps, () => { if (first) {
            first = false;
            return id;
        } return newId(); });
        copies.set(item.clipId, id);
    }
    const groups = (project.clipGroups ?? []).filter(g => g.clipIds.every(id => copies.has(id))).map(g => ({ ...g, id: newId(), name: `${g.name.slice(0, 110)} · copia`, clipIds: g.clipIds.map(id => copies.get(id)!) }));
    if ((result.clipGroups?.length ?? 0) + groups.length > 100)
        throw Error('La copia superaría los cien grupos.');
    return { project: groups.length ? { ...result, clipGroups: [...result.clipGroups ?? [], ...groups] } : result, ids: [...copies.values()] };
}
export function splitEditorClips(project: Project, ids: string[], seconds: number, newId: () => string = () => crypto.randomUUID()): Project {
    const items = editable(project, ids), frame = Math.round(seconds * project.fps), resolved = resolveTimelineClips(project), crossing = items.filter(x => { const r = resolved.find(k => k.clip.id === x.clip.id); return r && frame > r.startFrame && frame < r.endFrame; });
    if (!crossing.length)
        throw Error('Sitúa el cabezal dentro de al menos un clip seleccionado.');
    return crossing.reduce((p, x) => splitTimelineClip(p, x.track.id, x.clip.id, seconds, newId), project);
}
