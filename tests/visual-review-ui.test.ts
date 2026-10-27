import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedRegion, comparisonNeedsNote, emptyVisualSettings, normalizedRegion, visualReportReady } from '../src/visual-review.js';
import type { VisualComparison, VisualContinuityReport, VisualRegion } from '../src/visual-continuity.js';

function comparison(): VisualComparison {
  return {
    id: 'pair-0', characterId: 'elena', characterName: 'Elena',
    left: { sceneId: 'before', sceneTitle: 'Antes', time: .5 },
    right: { sceneId: 'after', sceneTitle: 'Después', time: .5 },
    checks: ['face', 'wardrobe', 'object'].map(category => ({
      category: category as 'face' | 'wardrobe' | 'object', status: 'no-obvious-change',
      origin: 'manual', message: 'No hay diferencias evidentes en la zona elegida.',
    })),
    intentionalChange: false, changeReason: '', expected: { face: '', wardrobe: '', object: '' },
    decision: { decision: 'reviewed', note: '', reviewedAt: '2026-10-17T23:00:00.000Z' },
  };
}

function report(): VisualContinuityReport {
  return {
    id: 'report-1', projectId: 'movie-1', fingerprint: 'a'.repeat(64),
    createdAt: '2026-10-17T23:00:00.000Z', status: 'completed', engine: 'apple-vision-cpu',
    settings: emptyVisualSettings(), comparisons: [comparison()], total: 1, warnings: [],
    acknowledgement: { note: 'Revisadas las fuentes y los límites del análisis.', reviewedAt: '2026-10-17T23:01:00.000Z' },
  };
}

function assertInside(region: VisualRegion) {
  assert(region.x >= 0 && region.y >= 0);
  assert(region.width >= .02 - 1e-12 && region.height >= .02 - 1e-12);
  assert(region.x + region.width <= 1 + 1e-12);
  assert(region.y + region.height <= 1 + 1e-12);
}

test('source-relative drag rectangle is identical in either drawing direction', () => {
  const start = { x: .125, y: .25 }, end = { x: .75, y: .875 };
  assert.deepEqual(normalizedRegion(start, end), { x: .125, y: .25, width: .625, height: .625 });
  assert.deepEqual(normalizedRegion(end, start), normalizedRegion(start, end));
});

test('pointer capture outside the image clamps ROI to the visible source bounds', () => {
  assert.deepEqual(normalizedRegion({ x: -.4, y: 1.3 }, { x: 1.8, y: -.2 }), { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(normalizedRegion({ x: -2, y: .5 }, { x: -.2, y: .5 }), { x: 0, y: .5, width: 0, height: 0 }, 'Zero-area drags remain ignorable instead of choosing an arbitrary ROI');
});

test('numeric ROI edits keep a usable minimum size inside each edge', () => {
  for (const value of [
    { x: -1, y: -2, width: 3, height: 5 },
    { x: 1, y: 1, width: 1, height: 1 },
    { x: .9, y: .95, width: .5, height: .8 },
    { x: .2, y: .4, width: 0, height: -.2 },
  ]) assertInside(boundedRegion(value));
  const chosen = { x: .125, y: .25, width: .25, height: .5 };
  assert.deepEqual(boundedRegion(chosen), chosen, 'Already valid manual regions stay unchanged');
});

test('export readiness requires a completed, current, acknowledged report', () => {
  const value = report();
  assert.equal(visualReportReady(value, false), true);
  assert.equal(visualReportReady(undefined, false), false);
  assert.equal(visualReportReady(value, true), false, 'Changing the source or its settings makes approval stale');
  for (const status of ['running', 'cancelled', 'failed'] as const) {
    assert.equal(visualReportReady({ ...value, status }, false), false, `${status} cannot authorize export`);
  }
  delete value.acknowledgement;
  assert.equal(visualReportReady(value, false), false);
});

test('export readiness rejects incomplete reports even if available pairs were reviewed', () => {
  const value = report();
  value.total = 2;
  assert.equal(visualReportReady(value, false), false);
  value.total = 1;
  delete value.comparisons[0]!.decision;
  assert.equal(visualReportReady(value, false), false, 'Every pair needs its own explicit decision');
});

test('zero comparisons can be acknowledged only after completion and coverage review', () => {
  const value = report(); value.total = 0; value.comparisons = [];
  assert.equal(visualReportReady(value, false), true);
  delete value.acknowledgement;
  assert.equal(visualReportReady(value, false), false, 'No pair is not evidence of full visual continuity');
});

test('both a possible change and an inconclusive result require a review note', () => {
  const value = comparison();
  assert.equal(comparisonNeedsNote(value), false);
  value.checks[1]!.status = 'possible-change';
  assert.equal(comparisonNeedsNote(value), true);
  value.checks[1]!.status = 'no-obvious-change';
  value.checks[2]!.status = 'insufficient';
  assert.equal(comparisonNeedsNote(value), true, 'An unmarked or unusable object ROI cannot be silently accepted');
});

test('new projects receive isolated visual settings', () => {
  const first = emptyVisualSettings(), second = emptyVisualSettings();
  first.sampleTimes.push({ sceneId: 'before', time: .25 });
  assert.deepEqual(second, { regions: [], sampleTimes: [] });
});
