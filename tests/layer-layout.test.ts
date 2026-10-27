import test from 'node:test';
import assert from 'node:assert/strict';
import { layerMediaLayout } from '../src/layer-layout.js';

test('same-ratio sources occupy the full viewport with no black beneath their alpha', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [100, 100]]) {
    const result = layerMediaLayout(width!, height!, width! / height!);
    assert.deepEqual(result.media, { left: 0, top: 0, width: 100, height: 100 }); assert.deepEqual(result.bars, []);
  }
});

test('portrait, landscape and square fits cover only letterbox area and never overlap transparent source pixels', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [1000, 1000], [4096, 1000]]) for (const aspect of [16 / 9, 9 / 16, 1]) {
    const { media, bars } = layerMediaLayout(width!, height!, aspect);
    assert.ok(Math.abs((media.width * aspect / media.height) - width! / height!) < 1e-9, 'Source aspect is unchanged');
    assert.ok(Math.abs(media.left * 2 + media.width - 100) < 1e-9); assert.ok(Math.abs(media.top * 2 + media.height - 100) < 1e-9);
    const totalArea = media.width * media.height + bars.reduce((area, bar) => area + bar.width * bar.height, 0);
    assert.ok(Math.abs(totalArea - 10000) < 1e-7, 'Bars plus source fill viewport without holes');
    for (const bar of bars) {
      const overlapWidth = Math.max(0, Math.min(bar.left + bar.width, media.left + media.width) - Math.max(bar.left, media.left));
      const overlapHeight = Math.max(0, Math.min(bar.top + bar.height, media.top + media.height) - Math.max(bar.top, media.top));
      assert.ok(overlapWidth * overlapHeight < 1e-7, 'No opaque bar lies beneath the image rectangle');
    }
  }
});

test('dimensions not yet loaded leave the layer transparent until the natural aspect is known', () => {
  for (const [width, height, aspect] of [[0, 0, 16 / 9], [NaN, 100, 1], [100, 100, Infinity]]) {
    const result = layerMediaLayout(width!, height!, aspect!); assert.deepEqual(result.bars, []);
    assert.deepEqual(result.media, { left: 0, top: 0, width: 100, height: 100 });
  }
});
