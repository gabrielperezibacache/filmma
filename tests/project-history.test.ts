import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistory, recordHistory, travelHistory } from '../src/projectHistory.js';
import { createSeedProject } from '../server/seed.js';

test('grouped writing can undo and redo without losing generated originals or late clips', () => {
  const before = createSeedProject();
  const typed = { ...before, logline: 'A' }, after = { ...before, logline: 'AB' };
  let history = recordHistory(emptyHistory(), before, typed, 'logline', 10);
  history = recordHistory(history, typed, after, 'logline', 20);
  assert.equal(history.past.length, 1);
  const live = { ...after, assets: [...after.assets, { id: 'late', name: 'Late', type: 'video' as const, url: '/api/media/late.mp4', mime: 'video/mp4', size: 1 }], scenes: after.scenes.map((s, i) => i === 0 ? { ...s, videoAssetId: 'late' } : s) };
  const undone = travelHistory(history, live, 'undo');
  assert.equal(undone.project.logline, before.logline);
  assert.equal(undone.project.scenes[0].videoAssetId, 'late');
  assert.ok(undone.project.assets.some(a => a.id === 'late'));
  const redone = travelHistory(undone.history, undone.project, 'redo');
  assert.equal(redone.project.logline, 'AB');
  assert.equal(redone.project.scenes[0].videoAssetId, 'late');
});

test('undo explicit clip assignment clears it and redo restores it', () => {
  const before = createSeedProject(), after = structuredClone(before);
  after.scenes[0].videoAssetId = 'chosen';
  const undone = travelHistory(recordHistory(emptyHistory(), before, after), after, 'undo');
  assert.equal(undone.project.scenes[0].videoAssetId, undefined);
  assert.equal(undone.project.scenes[0].clearVideoAsset, true);
  assert.equal(travelHistory(undone.history, undone.project, 'redo').project.scenes[0].videoAssetId, 'chosen');
});

test('a take arriving between grouped keystrokes survives undo and redo', () => {
  const before = createSeedProject(); before.scenes[0].videoAssetId = 'old';
  const first = { ...before, logline: 'A' };
  let history = recordHistory(emptyHistory(), before, first, 'typing', 10);
  const arrived = { ...first, scenes: first.scenes.map((s,i)=> i===0 ? {...s,videoAssetId:'generated'} : s) };
  const last = { ...arrived, logline: 'AB' };
  history = recordHistory(history, arrived, last, 'typing', 20);
  const undone = travelHistory(history, last, 'undo');
  assert.equal(undone.project.logline, before.logline);
  assert.equal(undone.project.scenes[0].videoAssetId, 'generated');
  assert.equal(travelHistory(undone.history, undone.project, 'redo').project.scenes[0].videoAssetId, 'generated');
});

test('history is bounded, a new change clears redo, and projects cannot cross', () => {
  let project = createSeedProject(), history = emptyHistory();
  for (let n = 0; n < 65; n++) { const next = { ...project, name: `Film ${n}` }; history = recordHistory(history, project, next); project = next; }
  assert.equal(history.past.length, 60);
  const undone = travelHistory(history, project, 'undo');
  assert.equal(undone.history.future.length, 1);
  assert.equal(recordHistory(undone.history, undone.project, { ...undone.project, name: 'New' }).future.length, 0);
  assert.equal(travelHistory(history, { ...project, id: 'another' }, 'undo').project.id, 'another');
});

test('undoing text preserves a pending explicit clip removal until the server saves it',()=>{
 const before=createSeedProject();before.scenes[0].clearVideoAsset=true;
 const after={...before,logline:'Writing after removing a take'};
 const undone=travelHistory(recordHistory(emptyHistory(),before,after),after,'undo');
 assert.equal(undone.project.scenes[0].clearVideoAsset,true);
 assert.equal(undone.project.scenes[0].videoAssetId,undefined);
});
