import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCinematographyPrompt, cinemaDirectionLabel, CINEMA_FIELDS, CINEMA_PRESETS } from '../src/cinematography.js';
import { listSceneTakes } from '../src/takes.js';
import type { Asset, GenerationProvenance, Project } from '../src/types.js';
import { createSeedProject } from '../server/seed.js';
import { projectSchema } from '../server/types.js';
import { restoreHistorySnapshot } from '../src/projectHistory.js';

test('camera directions are opt-in, validated, and replace legacy direction only for explicit framing or movement', () => {
  assert.equal(buildCinematographyPrompt({}), '');
  assert.equal(buildCinematographyPrompt({ camera: 'Plano medio' }), 'Camera direction: Plano medio');
  const partial = buildCinematographyPrompt({ camera: 'Plano medio', cinematography: { lighting: 'window' } });
  assert.match(partial, /Camera direction: Plano medio/); assert.match(partial, /window light/); assert.doesNotMatch(partial, /50 mm/);
  const locked = buildCinematographyPrompt({ camera: 'Travelling suave', cinematography: { movement: 'locked' } });
  assert.match(locked, /Locked-off/); assert.doesNotMatch(locked, /Travelling/);
  assert.equal(cinemaDirectionLabel({ camera: 'Travelling suave', cinematography: { movement: 'locked' } }), 'Movimiento de cámara: Cámara fija');
  assert.equal(cinemaDirectionLabel({ camera: 'Travelling suave', cinematography: { lighting: 'window' } }), 'Travelling suave · Iluminación: Luz de ventana');
  const structured = buildCinematographyPrompt({ camera: 'Legacy camera detail', cinematography: { framing: 'close-up', lens: '85mm', movement: 'locked' } });
  assert.match(structured, /Close-up/); assert.match(structured, /85 mm/); assert.match(structured, /Locked-off/); assert.doesNotMatch(structured, /Legacy/);
  const seed = createSeedProject();
  for (const preset of CINEMA_PRESETS) {
    seed.scenes[0]!.cinematography = preset.settings;
    assert.deepEqual(projectSchema.parse(seed).scenes[0]!.cinematography, preset.settings);
  }
  for (const field of CINEMA_FIELDS) {
    assert.equal(new Set(field.options.map(option => option.value)).size, field.options.length);
    assert(field.options.every(option => option.label && option.prompt));
  }
  assert.equal(projectSchema.safeParse({ ...seed, scenes: [{ ...seed.scenes[0], cinematography: { lens: 'unknown' } }] }).success, false);
});

test('take families include generated originals, derivatives and current imports without stealing another shot', () => {
  const project: Project = createSeedProject(), sceneId = project.scenes[0]!.id;
  const generation: GenerationProvenance = { projectId: project.id, sceneId, model: 'ltx-2b', seed: 5, prompt: 'Original prompt', negativePrompt: '', createdAt: '2026-10-17T12:00:00Z', width: 768, height: 448, numFrames: 89, fps: 24, steps: 4, conditioningMode: 'text', referenceAssetIds: [], characterIds: ['elena'], cinematography: { framing: 'medium' } };
  const asset = (id: string): Asset => ({ id, name: id, type: 'video', url: `/api/media/${id}.mp4`, mime: 'video/mp4', size: 1000 });
  const original = { ...asset('original'), generation };
  const derivative: Asset = { ...asset('copy'), enhancement: { sourceAssetId: 'original', preset: 'ai-4k', method: 'realesrgan-ncnn', createdAt: '2026-10-17T12:01:00Z', width: 3840, height: 2160, duration: 3, fps: 24 } };
  project.assets.push(original, derivative, asset('import'), { ...asset('elsewhere'), generation: { ...generation, sceneId: 'other-scene' } });
  project.scenes[0]!.videoAssetId = 'import';
  const takes = listSceneTakes(project, sceneId);
  assert.deepEqual(takes.map(take => take.asset.id).sort(), ['copy', 'import', 'original']);
  assert.equal(takes.find(take => take.asset.id === 'copy')?.generation?.seed, 5);
  assert.equal(takes.find(take => take.selected)?.asset.id, 'import');
  project.scenes[0]!.takeAssetIds = ['import']; project.scenes[0]!.videoAssetId = 'copy';
  assert.deepEqual(listSceneTakes(project, sceneId).map(take => take.asset.id).sort(), ['copy', 'import', 'original'], 'remembered import remains available after selecting a generated take');
  const old = structuredClone(project); old.assets = old.assets.filter(asset => !asset.generation && !asset.enhancement);
  const undone = restoreHistorySnapshot(project, old, old);
  assert.deepEqual(undone.assets.find(asset => asset.id === 'original')?.generation, generation);
  assert.deepEqual(listSceneTakes(project, 'missing'), []);
});
