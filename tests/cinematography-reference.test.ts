import test from 'node:test';
import assert from 'node:assert/strict';
import { CINEMA_FIELDS, CINEMA_VALUES, buildCinematographyPrompt, changeCinemaSetting, cinemaApertureIsCoherent, cinemaDirectionLabel } from '../src/cinematography.js';
import { CINEMA_FIELD_HELP, CINEMA_REFERENCE_GROUPS, cinemaReference } from '../src/cinema-reference.js';
import { cinematographySchema, projectSchema } from '../server/types.js';
import { createSeedProject } from '../server/seed.js';

test('visual guide covers every validated option and groups each field once', () => {
  const fields = CINEMA_FIELDS.map(field => field.key);
  const grouped = CINEMA_REFERENCE_GROUPS.flatMap(group => group.fields);
  assert.deepEqual([...grouped].sort(), [...fields].sort());
  assert.equal(new Set(grouped).size, fields.length);
  for (const field of CINEMA_FIELDS) {
    assert(CINEMA_FIELD_HELP[field.key].length > 30);
    assert.deepEqual(field.options.map(option => option.value), [...CINEMA_VALUES[field.key]]);
    for (const option of field.options) {
      const reference = cinemaReference(field.key, option.value);
      assert(reference && reference.description.length > 40, `${field.key}/${option.value} needs useful guidance`);
      assert(reference.image || reference.diagram);
      if (reference.image) { assert.match(reference.image, /^\/cinema-references\/[a-z0-9-]+\.webp$/); assert(reference.alt); }
      assert.equal(cinematographySchema.safeParse({ [field.key]: option.value }).success, true);
    }
  }
  assert.equal(cinemaReference('lens', 'invented-lens'), undefined);
});

test('choosing a suggested aperture updates depth but preserves other directions and input', () => {
  const original = { framing: 'close-up', lighting: 'window', aperture: 'deep', cameraStyle: 'film-35' } as const;
  const next = changeCinemaSetting(original, 'fStop', 'f1.4');
  assert.deepEqual(next, { ...original, aperture: 'shallow', fStop: 'f1.4' });
  assert.equal(original.aperture, 'deep');
  assert.equal(cinemaApertureIsCoherent(next), true);
  assert.deepEqual(cinematographySchema.parse(next), next);
  assert.match(buildCinematographyPrompt({ cinematography: next }), /f\/1\.4-inspired/);
  assert.match(buildCinematographyPrompt({ cinematography: next }), /35 mm photochemical-film-inspired/);
});

test('an explicit depth choice clears only an incompatible numeric suggestion', () => {
  const previous = { fStop: 'f2.8', aperture: 'shallow', lens: '85mm', movement: 'locked' } as const;
  assert.deepEqual(changeCinemaSetting(previous, 'aperture', 'shallow'), previous);
  assert.deepEqual(changeCinemaSetting(previous, 'aperture', 'deep'), { aperture: 'deep', lens: '85mm', movement: 'locked' });
  assert.equal(cinemaApertureIsCoherent(changeCinemaSetting(previous, 'fStop', 'f11')), true);
  assert.deepEqual(changeCinemaSetting(previous, 'fStop', ''), { aperture: 'shallow', lens: '85mm', movement: 'locked' });
});

test('conflicting imported directions prefer explicit depth without sending opposing instructions', () => {
  const scene = { cinematography: { aperture: 'deep', fStop: 'f1.4', cameraStyle: 'digital-clean' } as const };
  assert.equal(cinemaApertureIsCoherent(scene.cinematography), false);
  assert.match(buildCinematographyPrompt(scene), /Deep focus/);
  assert.doesNotMatch(buildCinematographyPrompt(scene), /f\/1\.4/);
  assert.match(cinemaDirectionLabel(scene), /Todo en foco/);
  assert.doesNotMatch(cinemaDirectionLabel(scene), /f\/1\.4/);
  assert.match(buildCinematographyPrompt({ cinematography: { fStop: 'f11' } }), /f\/11/);
});

test('changing direction never injects invalid values or affects scene ownership, references or script', () => {
  const project = createSeedProject();
  const before = structuredClone(project);
  const scene = project.scenes[0]!;
  const settings = changeCinemaSetting(changeCinemaSetting(scene.cinematography ?? {}, 'cameraStyle', 'film-16'), 'fStop', 'f5.6');
  scene.cinematography = settings;
  const roundTrip = projectSchema.parse(project);
  assert.deepEqual(roundTrip.scenes[0]!.cinematography, settings);
  const { cinematography: _new, ...rest } = scene;
  const { cinematography: _old, ...oldRest } = before.scenes[0]!;
  assert.deepEqual(rest, oldRest);
  assert.deepEqual(project.characters, before.characters);
  assert.deepEqual(project.assets, before.assets);
  assert.deepEqual(changeCinemaSetting(settings, 'cameraStyle', 'fictional-hardware'), settings);
  assert.equal(cinematographySchema.safeParse({ cameraStyle: 'fictional-hardware' }).success, false);
  assert.equal(cinematographySchema.safeParse({ fStop: 'f0.1' }).success, false);
});
