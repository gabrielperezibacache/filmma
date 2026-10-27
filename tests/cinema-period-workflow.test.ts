import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedProject } from '../server/seed.js';
import { auditContinuity, continuityContext, resolveContinuity } from '../src/continuity.js';
import { storyboardCinematography, storyboardCsv, storyboardHtml } from '../src/storyboard.js';

test('period reminders compare consecutive appearances, preserving character state and originals', () => {
  const project = createSeedProject();
  project.scenes[0]!.cinematography = { era: '1920s', historicalContext: { year: '1928', location: 'Santiago' } };
  project.scenes[1]!.cinematography = { era: '1920s', historicalContext: { year: '1928', location: 'Valparaíso', notes: 'Atardecer' } };
  project.scenes[3]!.cinematography = { era: '1970s', historicalContext: { year: '1975', location: 'Santiago' } };
  const before = structuredClone(project);
  const issues = auditContinuity(project).filter(item => item.code === 'historical-period-change');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.sceneId, 'scene-04');
  assert.equal(issues[0]!.previousSceneId, 'scene-02');
  assert.equal(issues[0]!.severity, 'note');
  assert.match(issues[0]!.message, /1928.*1975/);
  assert.deepEqual(resolveContinuity(project, 'scene-04', 'elena')!.values, resolveContinuity(project, 'scene-02', 'elena')!.values);
  assert.deepEqual(project, before);
  project.scenes[1]!.cinematography = undefined;
  assert.equal(auditContinuity(project).filter(item => item.code === 'historical-period-change').length, 0, 'An unspecified preceding period must not invent one');
});

test('Codex continuity context includes only active period briefs', () => {
  const project = createSeedProject();
  project.scenes[0]!.cinematography = { era: 'custom', historicalContext: { year: '1932', location: 'Santiago', mode: 'alternate', notes: 'Tranvía conservado' } };
  project.scenes[1]!.cinematography = { historicalContext: { notes: 'Borrador inactivo' } };
  const context = continuityContext(project);
  assert.deepEqual(context.appearances[0]!.storyPeriod, { era: 'custom', year: '1932', location: 'Santiago', mode: 'alternate', notes: 'Tranvía conservado' });
  assert.equal(context.appearances[1]!.storyPeriod, undefined);
});

test('storyboard and CSV include historical notes and effective optical choices without contradictory legacy fields', () => {
  const project = createSeedProject();
  const scene = project.scenes[0]!;
  scene.cinematography = { cameraStyle: 'film-35', filmFormat: 'super8', lens: 'anamorphic', lensFamily: 'macro', aperture: 'deep', fStop: 'f1.4', era: '1920s', historicalContext: { year: '1928', location: 'Santiago', notes: '<b>Faroles</b> y reloj heredado' } };
  const directions = storyboardCinematography(scene).join('\n');
  assert.match(directions, /1928.*Santiago/);
  assert.match(directions, /Notas de época: <b>Faroles<\/b>/);
  assert.doesNotMatch(directions, /Carácter de cámara|Óptica sugerida|f\/1\.4/);
  assert.match(storyboardCsv(project), /Santiago/);
  assert.match(storyboardHtml(project, {}), /&lt;b&gt;Faroles&lt;\/b&gt;/);
  delete scene.cinematography.era;
  assert.doesNotMatch(storyboardCinematography(scene).join('\n'), /Faroles|Santiago/);
});
