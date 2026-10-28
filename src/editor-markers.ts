import type { Project, TimelineMarker } from './types';
import { buildTimeline, frameToTimecode, segmentAtFrame } from './timeline';
import { storyboardCsvCell } from './storyboard';
export function resolveEditorMarkers(project: Project) { const layout = buildTimeline(project); return (project.markers ?? []).flatMap(marker => { const shot = layout.segments.find(s => s.scene.id === marker.sceneId); if (!shot)
    return []; const localFrame = Math.round(marker.offset * layout.fps); return [{ marker, shot, frame: shot.startFrame + localFrame, outside: localFrame >= shot.durationFrames, character: project.characters.find(c => c.id === marker.characterId), unlinked: !!marker.characterId && !shot.scene.characterIds.includes(marker.characterId) }]; }).sort((a, b) => a.frame - b.frame || a.marker.id.localeCompare(b.marker.id)); }
export function addEditorMarker(project: Project, seconds: number, id: string = crypto.randomUUID()): Project {
    if (!Number.isFinite(seconds))
        throw Error('El tiempo del marcador no es válido.');
    const layout = buildTimeline(project);
    if (!layout.totalFrames)
        throw Error('Añade un plano antes de marcar el montaje.');
    if ((project.markers?.length ?? 0) >= 1000)
        throw Error('La película admite hasta mil marcadores.');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || project.markers?.some(m => m.id === id))
        throw Error('El marcador necesita un identificador único.');
    const frame = Math.max(0, Math.min(layout.totalFrames - 1, Math.round(seconds * layout.fps))), shot = segmentAtFrame(layout, frame)!;
    return { ...project, markers: [...project.markers ?? [], { id, sceneId: shot.scene.id, offset: (frame - shot.startFrame) / layout.fps, title: `Marcador ${(project.markers?.length ?? 0) + 1}`, kind: 'edit', note: '' }] };
}
export function updateEditorMarker(project: Project, id: string, patch: Partial<Pick<TimelineMarker, 'title' | 'note' | 'kind' | 'offset' | 'characterId'>>): Project {
    if (patch.title !== undefined && (!patch.title.trim() || patch.title.length > 120))
        throw Error('El marcador necesita un título de hasta 120 caracteres.');
    if (patch.note !== undefined && patch.note.length > 2000)
        throw Error('La nota admite hasta 2.000 caracteres.');
    if (patch.offset !== undefined && (!Number.isFinite(patch.offset) || patch.offset < 0 || patch.offset > 86400))
        throw Error('El tiempo del marcador no es válido.');
    if (patch.characterId && !project.characters.some(c => c.id === patch.characterId))
        throw Error('El personaje del marcador ya no existe.');
    return { ...project, markers: project.markers?.map(m => m.id === id ? { ...m, ...patch, ...(patch.offset !== undefined ? { offset: Math.round(patch.offset * project.fps) / project.fps } : {}) } : m) };
}
export function markersCsv(project: Project) { return '\uFEFF' + [['Título', 'Tipo', 'Plano', 'Personaje / objeto', 'Tiempo global', 'Tiempo en el plano (s)', 'Nota', 'Estado'], ...resolveEditorMarkers(project).map(x => [x.marker.title, x.marker.kind, x.shot.scene.title, x.character?.name ?? '', frameToTimecode(x.frame, project.fps), x.marker.offset.toFixed(5), x.marker.note, x.outside ? 'Fuera del plano' : x.unlinked ? 'Elemento no vinculado a este plano' : 'Dentro del plano'])].map(r => r.map(storyboardCsvCell).join(',')).join('\r\n') + '\r\n'; }
