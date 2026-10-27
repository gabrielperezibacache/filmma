import type { Project, Scene } from './types';
import { buildContinuityPrompt } from './continuity';
import { buildCinematographyPrompt } from './cinematography';
import { storyContextText } from './story-structure';
export type InstructionOptions = {
    prompt?: string;
    negativePrompt?: string;
    referenceCharacterIds?: string[];
};
/** Shared by the execution request and the read-only preview. Production notes
 * remain editorial; only explicit opening/closing intentions enter this text. */
export function buildGenerationInstructions(project: Project, scene: Scene, options: InstructionOptions = {}) {
    const continuity = buildContinuityPrompt(project, scene.id, options.referenceCharacterIds ?? []), context = storyContextText(project, scene.id), roles = scene.characterIds.map(id => project.characters.find(c => c.id === id)?.role ?? ''), constraints = options.negativePrompt ?? scene.negativePrompt;
    const beats = [scene.planning?.opening?.trim() ? `Planned opening: ${scene.planning.opening.trim()}` : '', scene.planning?.closing?.trim() ? `Intended ending: ${scene.planning.closing.trim()}` : ''].filter(Boolean).join('\n');
    return [options.prompt ?? scene.prompt, context ? `Story scene context (creative notes):\n${context}` : '', beats, buildCinematographyPrompt(scene, roles), continuity ? `Effective continuity for this shot:\n${continuity}` : '', constraints ? `Visual constraints / Avoid: ${constraints}` : ''].filter(Boolean).join('\n');
}
export function instructionReferenceIds(project: Project, scene: Scene, mode: 'text' | 'image' | 'references') {
    return mode === 'references' ? project.characters.filter(c => scene.characterIds.includes(c.id) && c.locked && project.assets.some(a => a.id === c.assetId && a.type === 'image')).map(c => c.id) : [];
}
