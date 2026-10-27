import test from 'node:test';
import assert from 'node:assert/strict';
import type { TimelineClip } from '../src/types.js';
import { evaluateLayerTransform } from '../src/visual-effects.js';
import { editLayerTransform, layerFrameAtPlayhead, rebaseLayerKeyframes, removeLayerKeyframe, setLayerKeyframe } from '../src/layer-editing.js';
const fixture = (): TimelineClip => ({ id: 'clip', assetId: 'asset', sceneId: 'scene', offset: 1, duration: 8, trimStart: 0, opacity: .8 });

test('static poses preserve legacy opacity and first key snapshots the visible pose', () => {
  const initial = fixture(), posed = editLayerTransform(initial, 3, 24, { x: 20, scale: 1.4 });
  assert.equal(posed.keyframes, undefined); assert.equal(evaluateLayerTransform(posed, 6).opacity, .8);
  const first = setLayerKeyframe(posed, 2, 24, {}, 'a');
  assert.deepEqual(first.keyframes, [{ id: 'a', time: 2, x: 20, y: 0, scale: 1.4, opacity: .8, easing: 'linear' }]);
  assert.deepEqual(evaluateLayerTransform(first, 0), evaluateLayerTransform(posed, 6));
  assert.equal(initial.transform, undefined); assert.equal(first.sceneId, initial.sceneId);
});

test('key edits quantize, replace same frame and insert without losing existing points or scene anchor', () => {
  let clip = setLayerKeyframe(fixture(), 0, 24, { x: -20 }, 'a');
  clip = setLayerKeyframe(clip, 4, 24, { x: 40, opacity: .5 }, 'b');
  const edited = editLayerTransform(clip, 2 + .001, 24, { y: 30 });
  assert.equal(edited.keyframes!.length, 3); assert.equal(edited.keyframes![1]!.time, 2);
  assert.equal(edited.keyframes![1]!.x, 10); assert.equal(edited.keyframes![1]!.y, 30);
  const replaced = setLayerKeyframe(edited, 2 + .002, 24, { scale: 2 }, 'unused');
  assert.equal(replaced.keyframes!.length, 3); assert.equal(replaced.keyframes![1]!.id, edited.keyframes![1]!.id);
  assert.equal(replaced.sceneId, 'scene'); assert.equal(replaced.offset, 1); assert.equal(replaced.duration, 8);
  assert.deepEqual(clip.keyframes!.map((point) => point.id), ['a', 'b']);
});

test('negative endpoints preserve the exact smooth curve through repeated frame-grid trims', () => {
  for (const fps of [24, 25, 30]) {
    const initial = fixture(); initial.keyframes = [{ id: 'a', time: 0, x: -70, y: 20, scale: .5, opacity: .2, easing: 'ease-in-out' }, { id: 'b', time: 6, x: 80, y: -20, scale: 2, opacity: .9, easing: 'hold' }];
    const delta = 31 / fps, trimmed = { ...initial, keyframes: rebaseLayerKeyframes(initial, delta) };
    assert.equal(trimmed.keyframes![0]!.time, -delta);
    for (let frame = 0; frame < 80; frame++) {
      const before = evaluateLayerTransform(initial, delta + frame / fps, fps), after = evaluateLayerTransform(trimmed, frame / fps, fps);
      for (const axis of ['x', 'y', 'scale', 'opacity'] as const) assert.ok(Math.abs(before[axis] - after[axis]) < 1e-9);
    }
    const restored = { ...trimmed, keyframes: rebaseLayerKeyframes(trimmed, -delta) };
    assert.deepEqual(restored.keyframes, initial.keyframes);
  }
});

test('deleting the final key preserves visible pose and clamping always selects a visible frame', () => {
  const clip = setLayerKeyframe(fixture(), 1, 24, { x: 50, scale: 2 }, 'a');
  const removed = removeLayerKeyframe(clip, 'a', 6, 24);
  assert.equal(removed.keyframes!.length, 0); assert.deepEqual(evaluateLayerTransform(removed, 6), evaluateLayerTransform(clip, 6));
  assert.equal(removeLayerKeyframe(clip, 'absent', 0, 24), clip);
  assert.equal(layerFrameAtPlayhead(clip, 120, 0, 24), 0); assert.equal(layerFrameAtPlayhead(clip, 120, 50, 24), 191);
  assert.equal(layerFrameAtPlayhead(clip, 120, 6.5, 24), 36);
});

test('bounded keyframe edits permit replacement at 100 but reject new points without mutation', () => {
  const clip = fixture(); clip.keyframes = Array.from({ length: 100 }, (_, index) => ({ id: `k-${index}`, time: index / 24, x: index, y: 0, scale: 1, opacity: 1, easing: 'linear' }));
  assert.equal(setLayerKeyframe(clip, 1, 24, { y: 40 }).keyframes!.length, 100);
  assert.throws(() => setLayerKeyframe(clip, 6, 24), /100 fotogramas/);
  assert.equal(clip.keyframes![24]!.y, 0);
  assert.throws(() => rebaseLayerKeyframes(clip, 86401), /fuera del rango/);
});
