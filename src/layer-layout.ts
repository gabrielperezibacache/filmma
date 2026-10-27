export type LayerRect = { left: number; top: number; width: number; height: number };

/** A contain fit in viewport percentages. Black belongs only to the padded
 * region: filling the source rectangle would destroy transparent image pixels. */
export function layerMediaLayout(sourceWidth: number, sourceHeight: number, viewportAspect: number): { media: LayerRect; bars: LayerRect[] } {
  if (![sourceWidth, sourceHeight, viewportAspect].every((value) => Number.isFinite(value) && value > 0)) return { media: { left: 0, top: 0, width: 100, height: 100 }, bars: [] };
  const sourceAspect = sourceWidth / sourceHeight;
  const width = Math.min(100, sourceAspect / viewportAspect * 100), height = Math.min(100, viewportAspect / sourceAspect * 100);
  const left = (100 - width) / 2, top = (100 - height) / 2;
  const bars = left > 1e-9 ? [
    { left: 0, top: 0, width: left, height: 100 },
    { left: left + width, top: 0, width: left, height: 100 },
  ] : top > 1e-9 ? [
    { left: 0, top: 0, width: 100, height: top },
    { left: 0, top: top + height, width: 100, height: top },
  ] : [];
  return { media: { left, top, width, height }, bars };
}

export function layerRectStyle(rect: LayerRect) {
  return { left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` };
}
