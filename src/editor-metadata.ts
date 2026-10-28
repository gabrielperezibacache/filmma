import type { Project } from './types';
/** Prune only metadata orphaned by an actual edit. Never invent or change media. */
export function reconcileEditorMetadata<T extends Pick<Project, 'scenes' | 'characters' | 'tracks' | 'clipGroups' | 'markers' | 'audioMix'>>(project: T): T {
    let result = project;
    if(project.audioMix){const ids=project.audioMix.musicTrackIds.filter(id=>project.tracks?.some(t=>t.id===id&&t.type==='audio'));if(ids.length!==project.audioMix.musicTrackIds.length)result={...result,audioMix:{...project.audioMix,musicTrackIds:ids}};}
    if (project.clipGroups) {
        const ids = new Set((project.tracks ?? []).flatMap(t => t.clips.map(c => c.id)));
        const groups = project.clipGroups.map(g => ({ ...g, clipIds: g.clipIds.filter(id => ids.has(id)) })).filter(g => g.clipIds.length >= 2);
        if (JSON.stringify(groups) !== JSON.stringify(project.clipGroups))
            result = { ...result, clipGroups: groups };
    }
    if (project.markers) {
        const scenes = new Set(project.scenes.map(s => s.id)), characters = new Set(project.characters.map(c => c.id));
        const markers = project.markers.filter(m => scenes.has(m.sceneId)).map(m => m.characterId && !characters.has(m.characterId) ? { ...m, characterId: undefined } : m);
        if (JSON.stringify(markers) !== JSON.stringify(project.markers))
            result = { ...result, markers };
    }
    return result;
}
