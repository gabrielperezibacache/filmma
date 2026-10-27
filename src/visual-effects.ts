import type { ColorAdjustments, LayerKeyframe, LayerTransform, TimelineClip } from './types';

const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;

export function playbackSpeed(value?: number) { return bounded(value, 1, .25, 4); }
export function sourceTime(trimStart: number | undefined, localTime: number, speed?: number) { return Math.max(0, trimStart ?? 0) + Math.max(0, localTime) * playbackSpeed(speed); }

/** One sRGB matrix is shared by SVG preview and the renderer. Saturation uses
 * Rec.709 luminance; exposure multiplies RGB, contrast pivots around mid-grey,
 * and temperature changes the red/blue gains. Alpha is never colour graded. */
export function colorMatrix(color: ColorAdjustments = {}): number[] {
  const exposure = 2 ** bounded(color.exposure, 0, -2, 2), contrast = bounded(color.contrast, 1, .5, 1.5);
  const saturation = bounded(color.saturation, 1, 0, 2), temperature = bounded(color.temperature, 0, -1, 1);
  const weights = [.2126, .7152, .0722], gains = [1 + temperature * .15, 1, 1 - temperature * .15];
  return [...gains.flatMap((gain, row) => [
    ...weights.map((weight, col) => gain * exposure * contrast * (weight * (1 - saturation) + (row === col ? saturation : 0))),
    0, gain * .5 * (1 - contrast),
  ]), 0, 0, 0, 1, 0];
}

export type TransformClip = Pick<TimelineClip, 'transform' | 'opacity' | 'keyframes'>;
export function baseLayerTransform(clip: TransformClip): LayerTransform {
  return { x: bounded(clip.transform?.x, 0, -100, 100), y: bounded(clip.transform?.y, 0, -100, 100), scale: bounded(clip.transform?.scale, 1, .25, 3), opacity: bounded(clip.transform?.opacity, bounded(clip.opacity, 1, 0, 1), 0, 1) };
}

/** Negative key times retain the interpolation curve after a left-edge trim. */
export function normalizedLayerKeyframes(clip: TransformClip, fps?: number): LayerKeyframe[] {
  const quantum = fps && Number.isFinite(fps) && fps > 0 ? fps : undefined;
  return (clip.keyframes ?? []).filter((key) => Number.isFinite(key.time)).map((key) => ({
    ...key, ...baseLayerTransform({ transform: key }), time: quantum ? Math.round(key.time * quantum) / quantum : key.time,
  })).sort((a, b) => a.time - b.time);
}

export function evaluateLayerTransform(clip: TransformClip, time: number, fps?: number): LayerTransform {
  const keys = normalizedLayerKeyframes(clip, fps);
  if (!keys.length) return baseLayerTransform(clip);
  const localTime = Math.max(0, Number.isFinite(time) ? time : 0), t = fps && fps > 0 ? Math.floor(localTime * fps + 1e-7) / fps : localTime;
  const values = ({ x, y, scale, opacity }: LayerTransform): LayerTransform => ({ x, y, scale, opacity });
  if (t < keys[0]!.time) return values(keys[0]!);
  for (let i = 0; i < keys.length - 1; i++) {
    const left = keys[i]!, right = keys[i + 1]!;
    if (t >= right.time) continue;
    if (left.easing === 'hold' || right.time <= left.time) return values(left);
    const progress = (t - left.time) / (right.time - left.time), amount = left.easing === 'ease-in-out' ? progress * progress * (3 - 2 * progress) : progress;
    return Object.fromEntries((['x', 'y', 'scale', 'opacity'] as const).map((field) => [field, left[field] + (right[field] - left[field]) * amount])) as LayerTransform;
  }
  return values(keys[keys.length - 1]!);
}
