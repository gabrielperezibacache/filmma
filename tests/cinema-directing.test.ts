import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CINEMA_VALUES, buildCinematographyPrompt, buildDirectorPrompt, buildTakeTypePrompt, changeCinemaSetting, cinemaDirectionLabel, cinemaSettingWarnings, type Cinematography } from '../src/cinematography.js';
import { storyboardCsv, storyboardHtml } from '../src/storyboard.js';
import { cinematographySchema, generationProvenanceSchema, projectSchema } from '../server/types.js';
import { Store } from '../server/store.js';
import { createSeedProject } from '../server/seed.js';

test('director suggestions yield to explicit scene choices instead of sending contrary camera or color cues', () => {
  const ozu = buildDirectorPrompt({ director: 'ozu' });
  assert.match(ozu, /Consider a low, level camera/);
  assert.match(ozu, /Consider a patient locked camera/);
  const chosen: Cinematography = { director: 'ozu', angle: 'high', movement: 'crane-down', lens: '135mm', framing: 'close-up', palette: 'vibrant', era: 'future', historicalContext: { year: '2150', location: 'Santiago' } };
  const prompt = buildCinematographyPrompt({ cinematography: chosen });
  assert.doesNotMatch(prompt, /Consider a low, level camera|Consider a patient locked camera/);
  assert.match(prompt, /High camera angle/);
  assert.match(prompt, /descending crane move/);
  assert.match(prompt, /135 mm telephoto/);
  assert.match(prompt, /2150/);
  assert.match(prompt, /locked character identity, face, voice, costume/);
  const monochrome = buildDirectorPrompt({ director: 'wes-anderson', palette: 'monochrome', framing: 'over-shoulder' });
  assert.doesNotMatch(monochrome, /Consider frontal|Consider a coordinated expressive color/);
  assert.doesNotMatch(buildDirectorPrompt({ director: 'almodovar', filmStock: 'bw-negative' }), /Consider expressive color/);
  assert.doesNotMatch(buildDirectorPrompt({ director: 'chloe-zhao', lighting: 'neon' }), /Consider available natural light/);
  assert.doesNotMatch(buildDirectorPrompt({ director: 'ozu' }, 'Cámara alta en movimiento'), /Consider a low, level camera|Consider a patient locked camera/);
});

test('all director references explain their interpretation and preserve script, characters and original scene decisions', () => {
  const original: Cinematography = { framing: 'medium', movement: 'handheld', filmFormat: 'super16', era: '1920s', historicalContext: { year: '1928', location: 'Santiago' } };
  const snapshot = structuredClone(original);
  for (const director of CINEMA_VALUES.director) {
    const settings = changeCinemaSetting(original, 'director', director);
    assert.deepEqual(settings, { ...original, director });
    assert.deepEqual(cinematographySchema.parse(settings), settings);
    assert.match(buildDirectorPrompt(settings), /selective educational interpretation/);
    assert.match(buildDirectorPrompt(settings), /Explicit framing, angle, lens/);
    assert.match(buildDirectorPrompt(settings), /Preserve the script/);
    assert.match(buildDirectorPrompt(settings), /do not import a director/);
    assert.deepEqual(changeCinemaSetting(settings, 'director', ''), original);
  }
  assert.deepEqual(original, snapshot);
  assert.equal(buildDirectorPrompt({}), '');
  assert.equal(cinematographySchema.safeParse({ director: 'unlisted-director' }).success, false);
  assert.deepEqual(changeCinemaSetting(original, 'director', 'unlisted-director'), original);
});

test('a subjective take respects an explicitly external viewpoint, while a sequence remains inside clip duration', () => {
  assert.match(buildTakeTypePrompt({ takeType: 'pov', angle: 'eye-level' }), /subjective point-of-view take/);
  for (const external of [{ framing: 'over-shoulder' }, { framing: 'two-shot' }, { angle: 'overhead' }] as const) {
    const settings: Cinematography = { takeType: 'pov', ...external };
    assert.match(buildTakeTypePrompt(settings), /retaining the explicitly selected external framing/);
    assert.doesNotMatch(buildTakeTypePrompt(settings), /from the designated character’s visual position/);
    assert.match(cinemaSettingWarnings(settings).join(' '), /Se conserva tu encuadre explícito/);
  }
  assert.match(buildTakeTypePrompt({ takeType: 'sequence' }), /no internal cuts/);
  assert.match(buildTakeTypePrompt({ takeType: 'sequence' }), /Do not lengthen the clip/);
  assert.match(cinemaSettingWarnings({ takeType: 'sequence' }).join(' '), /15 segundos/);
  assert.match(cinemaSettingWarnings({ takeType: 'master', framing: 'close-up' }).join(' '), /Se conserva el tamaño de plano/);
  assert.match(buildTakeTypePrompt({ takeType: 'dialogue' }), /do not invent words, voices or additional speakers/);
  assert.match(buildTakeTypePrompt({ takeType: 'product-hero' }), /without inventing logos/);
});

test('movement choices distinguish translation, rotation and optical zoom without changing clip speed', () => {
  const prompt = (movement: NonNullable<Cinematography['movement']>) => buildCinematographyPrompt({ cinematography: { movement } });
  assert.match(prompt('tilt-up'), /fixed camera position/);
  assert.match(prompt('tilt-up'), /without raising or translating/);
  assert.match(prompt('pedestal-up'), /entire camera straight upward/);
  assert.match(prompt('pedestal-up'), /no vertical tilt, arc or zoom/);
  assert.match(prompt('dolly-in'), /physical dolly/);
  assert.match(prompt('zoom-in'), /camera position fixed/);
  assert.match(prompt('zoom-in'), /increase focal length/);
  assert.match(prompt('dolly-zoom'), /subject approximately the same size/);
  assert.match(prompt('follow'), /behind the moving subject/);
  assert.match(prompt('lead'), /backward ahead of the advancing subject/);
  const original = { movement: 'locked', pace: 'still', lens: '85mm' } as const;
  assert.deepEqual(changeCinemaSetting(original, 'movement', 'whip-pan'), { ...original, movement: 'whip-pan' });
  assert.match(cinemaSettingWarnings({ movement: 'whip-pan', pace: 'still' }).join(' '), /actuación sea pausada/);
  for (const movement of CINEMA_VALUES.movement) assert.equal(cinematographySchema.safeParse({ movement }).success, true);
});

test('direction, take purpose and motion survive project storage, provenance and storyboard without changing originals or script', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-cinema-directing-'));
  try {
    const store = new Store(directory); await store.init();
    const project = createSeedProject(), before = structuredClone(project), scene = project.scenes[0]!;
    scene.cinematography = { director: 'varda', takeType: 'reaction', movement: 'lateral-reveal', lens: '85mm', cameraBody: 'film-motion', era: '1970s', historicalContext: { year: '1975', location: 'Santiago' } };
    store.project = projectSchema.parse(project); await store.save();
    const restored = new Store(directory); await restored.init();
    assert.deepEqual(restored.project.scenes[0]!.cinematography, scene.cinematography);
    assert.deepEqual(restored.project.characters, before.characters);
    assert.deepEqual(restored.project.assets, before.assets);
    const { cinematography: _added, ...rest } = restored.project.scenes[0]!;
    assert.deepEqual(rest, before.scenes[0]);
    const generation = generationProvenanceSchema.parse({ projectId: project.id, sceneId: scene.id, model: 'minimax-h3', seed: 5, prompt: buildCinematographyPrompt(scene), negativePrompt: '', createdAt: new Date().toISOString(), width: 512, height: 320, numFrames: 22, fps: 24, steps: 20, conditioningMode: 'text', referenceAssetIds: [], characterIds: scene.characterIds, cinematography: scene.cinematography });
    scene.cinematography = changeCinemaSetting(scene.cinematography, 'director', 'fincher');
    assert.equal(generation.cinematography!.director, 'varda', 'a subsequent creative choice must not rewrite the original take provenance');
    const csv = storyboardCsv(restored.project), html = storyboardHtml(restored.project, {}), label = cinemaDirectionLabel(restored.project.scenes[0]!);
    for (const output of [csv, html, label]) {
      assert.match(output, /Agnès Varda/);
      assert.match(output, /Reacción/);
      assert.match(output, /Revelación lateral/);
      assert.match(output, /1975/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
