import assert from 'node:assert/strict';
import test from 'node:test';
import { colorMatrix, evaluateLayerTransform, playbackSpeed, sourceTime } from '../src/visual-effects.js';
import type { TimelineClip, LayerKeyframe } from '../src/types.js';

const key = (time: number, x: number, easing: LayerKeyframe['easing'] = 'linear'): LayerKeyframe => ({ id: `key-${time}`, time, x, y: x / 2, scale: 1 + x / 100, opacity: 1 - x / 100, easing });
const rgb = (matrix: number[], input: number[]) => [0, 1, 2].map((row) => input.reduce((sum, value, col) => sum + matrix[row * 5 + col]! * value, matrix[row * 5 + 4]!));

test('sRGB colour matrix defaults to identity, exposes Rec.709 grey and leaves alpha intact', () => {
  assert.deepEqual(colorMatrix(), [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual(rgb(colorMatrix({ exposure: 1 }), [.1, .2, .3]), [.2, .4, .6]);
  const grey = rgb(colorMatrix({ saturation: 0 }), [.8, .4, .2]);
  grey.forEach((value) => assert.ok(Math.abs(value - (.8 * .2126 + .4 * .7152 + .2 * .0722)) < 1e-10));
  assert.deepEqual(colorMatrix({ exposure: -2, temperature: 1, contrast: 1.5 }).slice(15), [0, 0, 0, 1, 0]);
});

test('colour controls are bounded defensively and contrast pivots around mid-grey', () => {
  assert.deepEqual(colorMatrix({ exposure: 99 }), colorMatrix({ exposure: 2 }));
  assert.deepEqual(colorMatrix({ exposure: NaN, contrast: Infinity }), colorMatrix());
  rgb(colorMatrix({ contrast: .5 }), [.5, .5, .5]).forEach((value) => assert.equal(value, .5));
  const warm = rgb(colorMatrix({ temperature: 1 }), [.5, .5, .5]);
  assert.ok(warm[0]! > warm[1]! && warm[1]! > warm[2]!);
});

test('full key snapshots interpolate all fields using the LEFT easing and hold endpoints', () => {
  const clip = { keyframes: [key(2, 100), key(0, 0, 'ease-in-out')] };
  assert.deepEqual(evaluateLayerTransform(clip, .5), { x: 15.625, y: 7.8125, scale: 1.15625, opacity: .84375 });
  assert.deepEqual(evaluateLayerTransform(clip, 1), { x: 50, y: 25, scale: 1.5, opacity: .5 });
  assert.deepEqual(evaluateLayerTransform(clip, 3), { x: 100, y: 50, scale: 2, opacity: 0 });
  assert.equal(evaluateLayerTransform({ keyframes: [key(1, 25), key(2, 50)] }, 0).x, 25);
});

test('hold jumps at the keyed frame and fractional playback uses a stable frame clock', () => {
  const clip = { keyframes: [key(0, 0, 'hold'), key(1, 100)] };
  assert.equal(evaluateLayerTransform(clip, 23.999 / 24, 24).x, 0);
  assert.equal(evaluateLayerTransform(clip, 1, 24).x, 100);
  assert.equal(evaluateLayerTransform({ keyframes: [key(0, 0), key(1, 24)] }, 1.99 / 24, 24).x, 1);
});

test('negative key times preserve a trimmed smooth curve and legacy opacity remains usable', () => {
  const clip: Pick<TimelineClip, 'keyframes'> = { keyframes: [key(-1, 0, 'ease-in-out'), key(1, 100)] };
  assert.equal(evaluateLayerTransform(clip, 0, 24).x, 50);
  assert.deepEqual(evaluateLayerTransform({ opacity: .2, transform: { scale: .5 } }, 10), { x: 0, y: 0, scale: .5, opacity: .2 });
  assert.equal(evaluateLayerTransform({ opacity: .2, transform: { opacity: .7 } }, 0).opacity, .7);
});

test('source speed consumes original time without moving the mounted timeline', () => {
  assert.equal(sourceTime(.125, 2, .25), .625);
  assert.equal(sourceTime(.125, 2, 4), 8.125);
  assert.equal(playbackSpeed(NaN), 1); assert.equal(playbackSpeed(10), 4); assert.equal(playbackSpeed(0), .25);
});
