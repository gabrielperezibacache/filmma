import type { Character, ContinuityOverride, ContinuityValues, Project } from './types';
import { historicalDirectionLabel } from './cinematography';

export const continuityFields = ['costume', 'appearance', 'props', 'notes'] as const;
export type ContinuityField = typeof continuityFields[number];
export const continuityLabels: Record<ContinuityField, string> = {
  costume: 'Vestuario y materiales', appearance: 'Aspecto y estado', props: 'Objetos y accesorios', notes: 'Notas de continuidad',
};
const promptLabels: Record<ContinuityField, string> = {
  costume: 'Wardrobe / materials', appearance: 'Physical appearance / current condition', props: 'Props / accessories', notes: 'Continuity notes',
};
type Values = Record<ContinuityField, string>;
export type ContinuityChange = { field: ContinuityField; before: string; after: string };
export type EffectiveContinuity = {
  characterId: string; sceneId: string; values: Values; overrides: ContinuityOverride;
  sources: Record<ContinuityField, string | null>; previousSceneId?: string;
  changes: ContinuityChange[]; intentionalChange: boolean; changeReason: string;
};
export type ContinuityIssue = {
  id: string; code: 'unexplained-change' | 'missing-reference' | 'missing-character' | 'unlinked-state' | 'missing-change-reason' | 'historical-period-change';
  severity: 'warning' | 'note'; sceneId: string; characterId: string; message: string;
  previousSceneId?: string; fields?: ContinuityField[];
};
const emptyValues = (value?: ContinuityValues): Values => ({ costume: value?.costume ?? '', appearance: value?.appearance ?? '', props: value?.props ?? '', notes: value?.notes ?? '' });
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** Inherit only through this entity's appearances, in the current montage order. */
export function resolveContinuity(project: Project, sceneId: string, characterId: string): EffectiveContinuity | undefined {
  const character = project.characters.find((item) => item.id === characterId);
  const target = project.scenes.find((item) => item.id === sceneId);
  if (!character || !target?.characterIds.includes(characterId)) return undefined;
  let values = emptyValues(character.continuity);
  let sources: EffectiveContinuity['sources'] = { costume: null, appearance: null, props: null, notes: null };
  let previousSceneId: string | undefined;
  for (const scene of project.scenes) {
    if (!scene.characterIds.includes(characterId)) continue;
    const overrides = scene.continuity && own(scene.continuity, characterId) ? scene.continuity[characterId]! : {};
    const next = { ...values }, nextSources = { ...sources };
    for (const field of continuityFields) if (own(overrides, field) && typeof overrides[field] === 'string') {
      next[field] = overrides[field]!; nextSources[field] = scene.id;
    }
    const changes = continuityFields.filter((field) => normalized(next[field]) !== normalized(values[field])).map((field) => ({ field, before: values[field], after: next[field] }));
    const result: EffectiveContinuity = { characterId, sceneId: scene.id, values: next, sources: nextSources, previousSceneId, overrides, changes, intentionalChange: overrides.intentionalChange === true, changeReason: overrides.changeReason ?? '' };
    if (scene.id === sceneId) return result;
    values = next; sources = nextSources; previousSceneId = scene.id;
  }
  return undefined;
}

export function resolveSceneContinuity(project: Project, sceneId: string) {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) return [];
  return project.characters.filter((character) => scene.characterIds.includes(character.id)).map((character) => ({ character, state: resolveContinuity(project, sceneId, character.id)! }));
}

/** These are editorial reminders, never proof that a generated image matches. */
export function auditContinuity(project: Project, onlySceneId?: string): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  for (const scene of project.scenes) {
    if (onlySceneId && scene.id !== onlySceneId) continue;
    for (const characterId of scene.characterIds) {
      const character = project.characters.find((item) => item.id === characterId);
      if (!character) { issues.push({ id: `${scene.id}:${characterId}:missing`, code: 'missing-character', severity: 'warning', sceneId: scene.id, characterId, message: 'Este plano enlaza un elemento que ya no está en el proyecto.' }); continue; }
      const image = project.assets.find((asset) => asset.id === character.assetId && asset.type === 'image');
      if (!image) issues.push({ id: `${scene.id}:${characterId}:reference`, code: 'missing-reference', severity: 'note', sceneId: scene.id, characterId, message: `${character.name} no tiene una referencia visual disponible. Su descripción y su estado siguen incluidos en el prompt.` });
      const state = resolveContinuity(project, scene.id, characterId)!;
      const previous = project.scenes.find(item => item.id === state.previousSceneId);
      const period = scene.cinematography, previousPeriod = previous?.cinematography;
      if (period?.era && previousPeriod?.era && (period.era !== previousPeriod.era || normalized(period.historicalContext?.year ?? '') !== normalized(previousPeriod.historicalContext?.year ?? ''))) {
        issues.push({ id: `${scene.id}:${characterId}:period`, code: 'historical-period-change', severity: 'note', sceneId: scene.id, characterId, previousSceneId: previous!.id, message: `${character.name} reaparece en otra época o fecha: ${historicalDirectionLabel(previousPeriod)} → ${historicalDirectionLabel(period)}. Revisa si es un salto temporal intencional y anota los cambios de vestuario, aspecto y objetos; su identidad y su voz se conservan.` });
      }
      if (state.previousSceneId && state.changes.length && !state.intentionalChange) issues.push({ id: `${scene.id}:${characterId}:change`, code: 'unexplained-change', severity: 'warning', sceneId: scene.id, characterId, previousSceneId: state.previousSceneId, fields: state.changes.map((change) => change.field), message: `${character.name} cambia ${state.changes.map((change) => continuityLabels[change.field].toLowerCase()).join(', ')} respecto de su aparición anterior. Marca el cambio como intencional o vuelve al estado heredado.` });
      if (state.intentionalChange && state.changes.length && !state.changeReason.trim()) issues.push({ id: `${scene.id}:${characterId}:reason`, code: 'missing-change-reason', severity: 'note', sceneId: scene.id, characterId, message: `El cambio de ${character.name} está marcado como intencional. Una nota breve ayudará a entenderlo después.` });
    }
    for (const characterId of Object.keys(scene.continuity ?? {})) if (!scene.characterIds.includes(characterId)) {
      const name = project.characters.find((item) => item.id === characterId)?.name ?? 'Un elemento eliminado';
      issues.push({ id: `${scene.id}:${characterId}:unlinked`, code: 'unlinked-state', severity: 'warning', sceneId: scene.id, characterId, message: `${name} tiene notas en este plano pero no está vinculado. Vincúlalo para usar ese estado; mientras tanto las notas se conservan.` });
    }
  }
  return issues;
}

export function describeContinuityEntity(character: Character, state: EffectiveContinuity): string {
  const current = continuityFields.filter((field) => state.values[field].trim()).map((field) => `${promptLabels[field]}: ${state.values[field].trim()}`);
  const cleared = continuityFields.filter((field) => state.sources[field] !== null && !state.values[field].trim()).map((field) => `${promptLabels[field]}: no additional constraint; the previous appearance's value was explicitly cleared.`);
  return [
    `Entity ${JSON.stringify(character.name)} [${character.id}]: ${character.description.trim() || character.role}`,
    character.locked ? 'Keep this entity\'s stable identity recognizable; current scene wardrobe and condition below take priority over conflicting state details in its general description.' : '',
    ...current, ...cleared,
    state.intentionalChange && state.changes.length ? `Intentional story change: ${state.changeReason.trim() || 'the specified state change is deliberate'}.` : '',
  ].filter(Boolean).join('\n');
}

export function buildContinuityPrompt(project: Project, sceneId: string, referenceCharacterIds: string[] = []): string {
  const appearances = resolveSceneContinuity(project, sceneId);
  const byId = new Map(appearances.map((appearance) => [appearance.character.id, appearance]));
  const references = referenceCharacterIds.flatMap((id, index) => {
    const appearance = byId.get(id);
    return appearance ? [`<Picture ${index + 1}> is the visual identity reference for ${JSON.stringify(appearance.character.name)} [${id}]. Apply the current scene state specified above.`] : [];
  });
  return [...appearances.map(({ character, state }) => describeContinuityEntity(character, state)), ...references].join('\n\n');
}

export function continuityContext(project: Project, onlySceneId?: string) {
  return {
    inheritance: 'An omitted field inherits the last appearance in montage order, then the character baseline. An empty string explicitly clears a field. Visual identity remains model-dependent.',
    appearances: project.scenes.filter((scene) => !onlySceneId || scene.id === onlySceneId).map((scene) => ({ sceneId: scene.id, title: scene.title, ...(scene.cinematography?.era ? { storyPeriod: { era: scene.cinematography.era, ...scene.cinematography.historicalContext }, periodDirection: historicalDirectionLabel(scene.cinematography) } : {}), elements: resolveSceneContinuity(project, scene.id).map(({ character, state }) => ({ characterId: character.id, name: character.name, currentState: state.values, previousSceneId: state.previousSceneId, changes: state.changes, intentionalChange: state.intentionalChange, changeReason: state.changeReason })) })),
    reminders: auditContinuity(project, onlySceneId),
  };
}

/** Update one appearance without materializing the other inherited fields. */
export function updateContinuity(project: Project, sceneId: string, characterId: string, patch: Partial<ContinuityOverride>): Project {
  return { ...project, updatedAt: new Date().toISOString(), scenes: project.scenes.map((scene) => {
    if (scene.id !== sceneId) return scene;
    const state: ContinuityOverride = { ...(scene.continuity?.[characterId] ?? {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete (state as Record<string, unknown>)[key];
      else (state as Record<string, unknown>)[key] = value;
    }
    const continuity = { ...scene.continuity };
    if (Object.keys(state).length) continuity[characterId] = state; else delete continuity[characterId];
    return { ...scene, continuity: Object.keys(continuity).length ? continuity : undefined };
  }) };
}
