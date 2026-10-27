import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CINEMA_FIELDS, CINEMA_VALUES, HISTORICAL_CONTEXT_LIMITS, buildCinematographyPrompt, buildHistoricalPrompt, changeCinemaSetting, cinemaDirectionLabel, cinemaSettingWarnings, clearHistoricalSetting, copyHistoricalSetting, historicalDirectionLabel, historicalSettingSignature, type Cinematography } from '../src/cinematography.js';
import { cinematographySchema, generationProvenanceSchema, projectSchema } from '../server/types.js';
import { Store } from '../server/store.js';
import { createSeedProject } from '../server/seed.js';

test('film, lenses, cameras and periods are complete opt-in enum fields; context is not a dropdown field', () => {
  assert.equal(CINEMA_FIELDS.length, 17);
  assert.equal(CINEMA_FIELDS.reduce((sum, field) => sum + field.options.length, 0), 139);
  assert.equal(Object.hasOwn(CINEMA_VALUES, 'historicalContext'), false);
  for (const key of ['filmFormat', 'filmStock', 'lensFamily', 'cameraBody', 'era'] as const) {
    const field = CINEMA_FIELDS.find(field => field.key === key)!;
    assert.deepEqual(field.options.map(option => option.value), [...CINEMA_VALUES[key]]);
    for (const option of field.options) {
      assert.equal(cinematographySchema.safeParse({ [key]: option.value }).success, true);
      assert.match(buildCinematographyPrompt({ cinematography: { [key]: option.value } }), new RegExp(option.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.equal(cinematographySchema.safeParse({ [key]: 'made-up-option' }).success, false);
  }
  const dv = buildCinematographyPrompt({ cinematography: { cameraBody: 'dv-tape' } });
  assert.match(dv, /do not change the output resolution, frame rate or aspect ratio/);
  assert.match(dv, /do not add interlacing artifacts/);
});

test('explicit film gauges override conflicting legacy looks but preserve compatible digital and film combinations', () => {
  const old: Cinematography = { cameraStyle: 'film-16', filmFormat: '35mm', cameraBody: 'cinema-digital', filmStock: 'tungsten-fast' };
  const before = structuredClone(old), prompt = buildCinematographyPrompt({ cinematography: old }), label = cinemaDirectionLabel({ cinematography: old });
  assert.match(prompt, /35 mm-inspired film format/);
  assert.match(prompt, /professional digital-cinema acquisition/);
  assert.match(prompt, /500T-inspired/);
  assert.doesNotMatch(prompt, /A 16 mm film-inspired aesthetic/);
  assert.doesNotMatch(label, /Carácter de cámara/);
  assert.match(cinemaSettingWarnings(old).join(' '), /tiene prioridad/);
  assert.deepEqual(old, before);
  assert.match(buildCinematographyPrompt({ cinematography: { cameraStyle: 'film-16', filmFormat: 'super16' } }), /A 16 mm film-inspired aesthetic/);
  assert.match(buildCinematographyPrompt({ cinematography: { cameraStyle: 'film-35', cameraBody: 'cinema-digital' } }), /35 mm photochemical-film-inspired/);
  assert.match(buildCinematographyPrompt({ cinematography: { cameraStyle: 'digital-clean', cameraBody: 'cinema-digital' } }), /clean contemporary digital-cinema/);
  assert.doesNotMatch(buildCinematographyPrompt({ cinematography: { cameraStyle: 'digital-clean', filmStock: 'daylight-fine' } }), /clean contemporary digital-cinema/);
  assert.doesNotMatch(buildCinematographyPrompt({ cinematography: { cameraStyle: 'large-format', cameraBody: 'dv-tape' } }), /A large-format cinema-inspired aesthetic/);
  const cleared = changeCinemaSetting(old, 'filmFormat', '');
  assert.match(buildCinematographyPrompt({ cinematography: cleared }), /A 16 mm film-inspired aesthetic/, 'stored legacy style can become active after clearing its conflicting replacement');
});

test('lens family replaces legacy construction without erasing focal length or adding a zoom move', () => {
  const modern = { lens: 'anamorphic', lensFamily: 'spherical-modern' } as const;
  assert.doesNotMatch(buildCinematographyPrompt({ cinematography: modern }), /anamorphic/);
  assert.match(cinemaSettingWarnings(modern).join(' '), /tipo de lente tiene prioridad/);
  const anamorphic = buildCinematographyPrompt({ cinematography: { lens: '85mm', lensFamily: 'anamorphic' } });
  assert.match(anamorphic, /85 mm portrait-lens/);
  assert.match(anamorphic, /anamorphic-lens-inspired/);
  assert.match(buildCinematographyPrompt({ cinematography: { lens: '50mm', lensFamily: 'zoom' } }), /do not introduce a zoom move/);
  assert.equal(buildCinematographyPrompt({ cinematography: { lens: 'anamorphic', lensFamily: 'anamorphic' } }).split('\n').length, 1);
});

test('historical context is opt-in, preserves saved notes, and keeps script and character continuity authoritative', () => {
  const settings: Cinematography = { era: '1920s', historicalContext: { year: '1927', location: 'Valparaíso, Chile', notes: 'Mantener el abrigo rojo del guion.\nTranvía al fondo.', mode: 'faithful' }, filmFormat: 'super8', cameraBody: 'cinema-digital' };
  const before = structuredClone(settings), prompt = buildHistoricalPrompt(settings);
  assert.match(prompt, /1927/); assert.match(prompt, /Valparaíso/); assert.match(prompt, /abrigo rojo/);
  assert.match(prompt, /not verified historical facts/);
  assert.match(prompt, /locked character identity, face, voice/);
  assert.match(prompt, /Do not automatically replace wardrobe, appearance or carried objects/);
  assert.match(prompt, /script and explicit continuity choices take priority/);
  assert.equal(historicalDirectionLabel(settings), 'Época: Años 20 · 1927 · Valparaíso, Chile · Verosímil');
  assert.deepEqual(settings, before);
  const dormant = changeCinemaSetting(settings, 'era', '');
  assert.deepEqual(dormant.historicalContext, settings.historicalContext);
  assert.equal(buildHistoricalPrompt(dormant), '');
  assert.equal(historicalDirectionLabel(dormant), '');
  assert.equal(historicalSettingSignature(dormant), '');
  assert.doesNotMatch(buildCinematographyPrompt({ cinematography: dormant }), /1927|Valparaíso|abrigo rojo/);
  assert.match(buildCinematographyPrompt({ cinematography: dormant }), /Super 8/);
  assert.deepEqual(changeCinemaSetting(dormant, 'era', '1920s'), settings);
  assert.deepEqual(clearHistoricalSetting(settings), { filmFormat: 'super8', cameraBody: 'cinema-digital' });
});

test('copying story period is isolated and signatures include context without order or whitespace noise', () => {
  const source: Cinematography = { era: '1940s', historicalContext: { year: '1948', location: 'Santiago', notes: 'La misma maleta.', mode: 'faithful' }, filmStock: 'bw-negative' };
  const target: Cinematography = { era: 'future', historicalContext: { year: '2200' }, lens: '85mm', lensFamily: 'vintage', movement: 'locked', filmStock: 'daylight-fine' };
  const copied = copyHistoricalSetting(source, target);
  assert.deepEqual(copied, { ...target, era: source.era, historicalContext: source.historicalContext });
  assert.notEqual(copied.historicalContext, source.historicalContext);
  copied.historicalContext!.notes = 'Otra maleta.';
  assert.equal(source.historicalContext!.notes, 'La misma maleta.');
  assert.notEqual(historicalSettingSignature(copied), historicalSettingSignature(source));
  const reordered: Cinematography = { era: '1940s', historicalContext: { notes: ' La misma maleta. ', location: ' Santiago ', year: '1948' } };
  assert.equal(historicalSettingSignature(reordered), historicalSettingSignature(source));
  assert.deepEqual(copyHistoricalSetting(undefined, target), { lens: '85mm', lensFamily: 'vintage', movement: 'locked', filmStock: 'daylight-fine' });
  assert.equal(target.era, 'future');
});

test('historical modes and non-blocking warnings surface ambiguity without inventing a region or rewriting settings', () => {
  assert.match(buildHistoricalPrompt({ era: 'medieval', historicalContext: { mode: 'stylized' } }), /stylized artistic interpretation/);
  assert.match(buildHistoricalPrompt({ era: 'custom', historicalContext: { mode: 'alternate', notes: 'Ciudad del futuro en 1850.' } }), /explicitly fictional alternate history/);
  assert.match(cinemaSettingWarnings({ era: 'antiquity' }).join(' '), /lugar o cultura/);
  assert.match(cinemaSettingWarnings({ era: 'custom' }).join(' '), /época personalizada/);
  assert.match(cinemaSettingWarnings({ era: '1920s', historicalContext: { year: '1985', location: 'Chile' } }).join(' '), /fuera de la década/);
  assert.deepEqual(cinemaSettingWarnings({ era: '1920s', historicalContext: { year: '1927', location: 'Chile' }, cameraBody: 'cinema-digital', filmStock: 'daylight-fine' }), []);
  assert.match(cinemaSettingWarnings({ filmStock: 'bw-negative', palette: 'vibrant' }).join(' '), /blanco y negro/);
});

test('historical inputs are strictly bounded strings, with multiline notes and no executable control bytes', () => {
  for (const key of ['year', 'location', 'notes'] as const) {
    const limit = HISTORICAL_CONTEXT_LIMITS[key];
    assert.equal(cinematographySchema.safeParse({ historicalContext: { [key]: 'a'.repeat(limit) } }).success, true);
    assert.equal(cinematographySchema.safeParse({ historicalContext: { [key]: 'a'.repeat(limit + 1) } }).success, false);
    assert.equal(cinematographySchema.safeParse({ historicalContext: { [key]: 'bad\u0000text' } }).success, false);
  }
  assert.equal(cinematographySchema.safeParse({ historicalContext: { year: 1927 } }).success, false);
  assert.equal(cinematographySchema.safeParse({ historicalContext: { mode: 'certified-accurate' } }).success, false);
  assert.equal(cinematographySchema.safeParse({ historicalContext: { place: 'Unknown field' } }).success, false);
  assert.equal(cinematographySchema.safeParse({ historicalContext: { notes: 'Primera línea.\nSegunda línea.' } }).success, true);
});

test('project persistence and generation provenance keep all new directions without mutating voices, costume, script or originals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-cinema-period-'));
  try {
    const store = new Store(directory); await store.init();
    const project = createSeedProject(), before = structuredClone(project), scene = project.scenes[0]!;
    scene.cinematography = { filmFormat: '35mm', filmStock: 'tungsten-fast', lensFamily: 'vintage', lens: '85mm', cameraBody: 'film-motion', era: '1970s', historicalContext: { year: '1974', location: 'Valparaíso, Chile', notes: 'Mantener maleta y abrigo, según continuidad.', mode: 'faithful' } };
    store.project = projectSchema.parse(project); await store.save();
    const restored = new Store(directory); await restored.init();
    assert.deepEqual(restored.project.scenes[0]!.cinematography, scene.cinematography);
    assert.deepEqual(restored.project.characters, before.characters);
    assert.deepEqual(restored.project.assets, before.assets);
    const { cinematography: _added, ...rest } = restored.project.scenes[0]!;
    assert.deepEqual(rest, before.scenes[0]);
    const generation = generationProvenanceSchema.parse({ projectId: project.id, sceneId: scene.id, model: 'ltx-2b', seed: 5, prompt: buildCinematographyPrompt(scene), negativePrompt: '', createdAt: new Date().toISOString(), width: 768, height: 448, numFrames: 89, fps: 24, steps: 4, conditioningMode: 'text', referenceAssetIds: [], characterIds: scene.characterIds, cinematography: scene.cinematography });
    assert.deepEqual(generation.cinematography, scene.cinematography);
    assert.match(generation.prompt, /1974/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
