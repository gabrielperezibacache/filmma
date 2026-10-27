import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSeedProject } from '../server/seed.js';
import { projectSchema } from '../server/types.js';
import { Store } from '../server/store.js';
import { auditContinuity, buildContinuityPrompt, continuityContext, resolveContinuity, updateContinuity } from '../src/continuity.js';

function story() {
  const project = createSeedProject();
  project.characters[0]!.continuity = { costume: 'Abrigo ocre', appearance: 'Cabello seco', props: 'Lata de película' };
  project.scenes[0]!.continuity = { elena: { appearance: 'Cabello húmedo' } };
  project.scenes[1]!.continuity = { elena: { props: 'Lata sobre la mesa', intentionalChange: true, changeReason: 'Deja la película junto al proyector.' } };
  return project;
}

test('continuity inherits each field through previous appearances and skips absent scenes', () => {
  const project = story();
  const state = resolveContinuity(project, 'scene-04', 'elena')!;
  assert.equal(state.values.costume, 'Abrigo ocre');
  assert.equal(state.values.appearance, 'Cabello húmedo');
  assert.equal(state.values.props, 'Lata sobre la mesa');
  assert.equal(state.previousSceneId, 'scene-02');
  assert.equal(state.sources.appearance, 'scene-01');
  assert.equal(state.sources.props, 'scene-02');
  assert.equal(state.changes.length, 0);
  assert.equal(state.intentionalChange, false, 'The previous change flag must not leak into later scenes');
  assert.equal(resolveContinuity(project, 'scene-03', 'elena'), undefined);
});

test('explicit empty state clears inheritance and reordering recomputes the predecessor', () => {
  let project = story();
  project = updateContinuity(project, 'scene-02', 'elena', { props: '' }) as typeof project;
  assert.equal(resolveContinuity(project, 'scene-04', 'elena')!.values.props, '');
  project.scenes = [project.scenes[3]!, ...project.scenes.slice(0, 3)];
  assert.equal(resolveContinuity(project, 'scene-04', 'elena')!.values.props, 'Lata de película');
  assert.equal(resolveContinuity(project, 'scene-04', 'elena')!.previousSceneId, undefined);
});

test('unexplained differences are reminders while intentional changes preserve their explanation', () => {
  const project = story();
  project.scenes[3]!.continuity = { elena: { costume: 'Camisa marfil, sin abrigo' } };
  const changed = auditContinuity(project, 'scene-04').filter((issue) => issue.code === 'unexplained-change');
  assert.equal(changed.length, 1); assert.deepEqual(changed[0]!.fields, ['costume']);
  project.scenes[3]!.continuity.elena!.intentionalChange = true;
  project.scenes[3]!.continuity.elena!.changeReason = 'Dejó el abrigo en la cabina.';
  assert.equal(auditContinuity(project, 'scene-04').filter((issue) => issue.code === 'unexplained-change').length, 0);
  assert.match(buildContinuityPrompt(project, 'scene-04'), /Intentional story change: Dejó el abrigo en la cabina/);
  assert.equal(continuityContext(project).appearances.length, 4);
});

test('audit identifies missing visual references and state for an unlinked entity without blocking', () => {
  const project = story();
  project.scenes[2]!.continuity = { elena: { notes: 'Mira hacia la pantalla.' }, removed: { props: 'Una llave' } };
  const issues = auditContinuity(project, 'scene-03');
  assert.equal(issues.filter((issue) => issue.code === 'unlinked-state').length, 2);
  assert(issues.some((issue) => issue.code === 'missing-reference' && issue.characterId === 'projector'));
  assert.doesNotThrow(() => projectSchema.parse(project));
});

test('reference prompt maps exact entities to Picture order and uses effective scene state', () => {
  const project = story();
  const prompt = buildContinuityPrompt(project, 'scene-02', ['projector', 'elena']);
  assert.match(prompt, /<Picture 1>.*"El proyector" \[projector\]/);
  assert.match(prompt, /<Picture 2>.*"Elena" \[elena\]/);
  assert.match(prompt, /Wardrobe \/ materials: Abrigo ocre/);
  assert.match(prompt, /Physical appearance \/ current condition: Cabello húmedo/);
  assert.match(prompt, /Props \/ accessories: Lata sobre la mesa/);
  assert.doesNotMatch(prompt, /guarantee|garantiza/);
});

test('resetting one override restores inheritance without copying or erasing other fields', () => {
  const project = story();
  const changed = updateContinuity(project, 'scene-02', 'elena', { appearance: 'Pelo seco', notes: 'Gira a la derecha' });
  const reset = updateContinuity(changed, 'scene-02', 'elena', { appearance: undefined });
  assert.equal(resolveContinuity(reset, 'scene-02', 'elena')!.values.appearance, 'Cabello húmedo');
  assert.equal(reset.scenes[1]!.continuity?.elena?.notes, 'Gira a la derecha');
  assert.equal(reset.scenes[1]!.continuity?.elena?.appearance, undefined);
  assert.equal(project.scenes[1]!.continuity?.elena?.notes, undefined, 'Original project stays unchanged');
});

test('continuity survives validation and disk persistence; older projects stay valid', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-continuity-store-'));
  try {
    assert.doesNotThrow(() => projectSchema.parse(createSeedProject()));
    const store = new Store(directory); await store.init();
    store.project = projectSchema.parse(story()); await store.save();
    const restored = new Store(directory); await restored.init();
    assert.equal(restored.project.scenes[1]!.continuity?.elena?.changeReason, 'Deja la película junto al proyector.');
    assert.equal(resolveContinuity(restored.project, 'scene-04', 'elena')!.values.appearance, 'Cabello húmedo');
    const invalid = story(); invalid.scenes[0]!.continuity = { elena: { costume: 'x'.repeat(1201) } };
    assert.equal(projectSchema.safeParse(invalid).success, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
