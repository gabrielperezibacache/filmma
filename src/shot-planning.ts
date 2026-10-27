import type { DirectionAlternative, DirectionSnapshot, Project, Scene, ShotPlanning } from './types';
import { CINEMA_FIELDS, cinemaFieldIsActive, historicalDirectionLabel } from './cinematography';
import { storyVersion } from './story-structure';
export function directionSnapshot(scene: Scene): DirectionSnapshot { return { prompt: scene.prompt, negativePrompt: scene.negativePrompt, camera: scene.camera, cinematography: scene.cinematography ? structuredClone(scene.cinematography) : undefined, opening: scene.planning?.opening ?? '', closing: scene.planning?.closing ?? '' }; }
export function updateShotPlanning(project: Project, shotId: string, patch: Pick<ShotPlanning, 'opening' | 'closing' | 'notes'>): Project {
    for (const [k, v] of Object.entries(patch))
        if (v !== undefined && (typeof v !== 'string' || v.length > (k === 'notes' ? 4000 : 1200)))
            throw Error('Las notas o el inicio/final superan el límite de texto.');
    return { ...project, scenes: project.scenes.map(s => s.id === shotId ? { ...s, planning: { ...s.planning, ...patch } } : s) };
}
export function saveDirectionAlternative(project: Project, shotId: string, name: string, id: string = crypto.randomUUID()): Project {
    const shot = project.scenes.find(s => s.id === shotId);
    if (!shot)
        throw Error('El plano ya no existe.');
    if (!name.trim() || name.trim().length > 120)
        throw Error('Escribe un nombre de alternativa de hasta 120 caracteres.');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
        throw Error('La alternativa necesita un identificador válido.');
    const alts = shot.planning?.alternatives ?? [];
    if (alts.length >= 6)
        throw Error('Cada plano admite hasta seis alternativas de dirección.');
    if (alts.some(a => a.id === id))
        throw Error('La alternativa ya existe.');
    const alternative: DirectionAlternative = { ...directionSnapshot(shot), id, name: name.trim() };
    return { ...project, scenes: project.scenes.map(s => s.id === shotId ? { ...s, planning: { ...s.planning, alternatives: [...alts, alternative] } } : s) };
}
export function removeDirectionAlternative(project: Project, shotId: string, id: string): Project { return { ...project, scenes: project.scenes.map(s => s.id === shotId ? { ...s, planning: { ...s.planning, alternatives: s.planning?.alternatives?.filter(a => a.id !== id) } } : s) }; }
export function applyDirectionSnapshot(project: Project, shotId: string, snapshot: DirectionSnapshot): Project {
    return { ...project, scenes: project.scenes.map(s => s.id === shotId ? { ...s, prompt: snapshot.prompt, negativePrompt: snapshot.negativePrompt, camera: snapshot.camera, cinematography: snapshot.cinematography ? structuredClone(snapshot.cinematography) : undefined, planning: { ...s.planning, opening: snapshot.opening, closing: snapshot.closing } } : s) };
}
export function applyReviewedDirection(project: Project, baseline: Project, shotId: string, snapshot: DirectionSnapshot): Project {
    if (storyVersion(project) !== storyVersion(baseline))
        throw Error('El proyecto cambió. Vuelve a comparar la alternativa antes de aplicarla.');
    if (!project.scenes.some(s => s.id === shotId))
        throw Error('El plano ya no existe.');
    return applyDirectionSnapshot(project, shotId, snapshot);
}
export function directionDecisionRows(scene: Scene) {
    return [{ key: 'intention', label: 'Intención', value: scene.prompt }, { key: 'opening', label: 'Inicio previsto', value: scene.planning?.opening ?? '' }, { key: 'closing', label: 'Final previsto', value: scene.planning?.closing ?? '' }, ...CINEMA_FIELDS.map(field => { const selected = field.options.find(o => o.value === scene.cinematography?.[field.key]), active = !!selected && cinemaFieldIsActive(scene.cinematography, field.key); return { key: field.key, label: field.label, value: field.key === 'era' ? historicalDirectionLabel(scene.cinematography) : active ? selected!.label : '', stored: !active ? selected?.label : undefined }; }), { key: 'historicalNotes', label: 'Notas de época', value: scene.cinematography?.era ? scene.cinematography.historicalContext?.notes ?? '' : '', stored: !scene.cinematography?.era && scene.cinematography?.historicalContext ? Object.entries(scene.cinematography.historicalContext).map(([k, v]) => `${k}: ${v}`).join(' · ') : undefined }, { key: 'legacy', label: 'Dirección heredada', value: !scene.cinematography?.framing && !scene.cinematography?.movement ? scene.camera : '', stored: scene.cinematography?.framing || scene.cinematography?.movement ? scene.camera : undefined }, { key: 'constraints', label: 'Restricciones', value: scene.negativePrompt }];
}
