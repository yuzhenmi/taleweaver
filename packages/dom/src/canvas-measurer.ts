import { adaptShaperToMeasurer, type TextMeasurer } from "@taleweaver/core";
import { createCanvasShaper } from "./canvas-shaper";

export interface CanvasMeasurerOptions {
  // Reserved for future caching options. The implementation no longer
  // caches measurement results — measurement happens via the shaper.
  cacheSize?: number;
}

/**
 * Create a `TextMeasurer` backed by a canvas 2D context. This is a thin
 * adapter over `createCanvasShaper` for backwards-compat with callers
 * that only need string width and font height.
 *
 * New code should prefer `createCanvasShaper(canvas)` directly for
 * cluster-level info needed by the IFC.
 */
export function createCanvasMeasurer(
  canvas: HTMLCanvasElement,
  _options?: CanvasMeasurerOptions,
): TextMeasurer {
  return adaptShaperToMeasurer(createCanvasShaper(canvas));
}
