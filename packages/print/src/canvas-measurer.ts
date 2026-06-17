import { adaptShaperToMeasurer, type TextMeasurer } from "@taleweaver/core";
import { createCanvasShaper } from "./canvas-shaper";

export interface CanvasMeasurerOptions {
  // Reserved for future caching options. The implementation no longer
  // caches measurement results — measurement happens via the shaper.
  cacheSize?: number;
}

/**
 * @deprecated Use `createCanvasShaper(canvas)` directly. The measurer
 * adapter synthesizes per-character widths by dividing the total string
 * width by character count, which produces equal advances for every
 * glyph — visibly wrong for any proportional font. The shaper provides
 * true per-cluster glyph advances, ligature boundaries, and UAX-14
 * break opportunities the IFC needs. The `TextShaper` type is accepted
 * directly by `EditorConfig.measurer` and `EditorController.measurer`.
 *
 * Internally still a thin adapter over `createCanvasShaper` for
 * backwards-compat with existing callers; emits a dev-mode warning
 * pointing them at the shaper.
 */
export function createCanvasMeasurer(
  canvas: HTMLCanvasElement,
  _options?: CanvasMeasurerOptions,
): TextMeasurer {
  const g = globalThis as {
    process?: { env?: { NODE_ENV?: string } };
    console?: { warn(...args: unknown[]): void };
  };
  const isDev = g.process?.env?.NODE_ENV !== "production";
  if (isDev && g.console !== undefined) {
    g.console.warn(
      "[@taleweaver/print] createCanvasMeasurer is deprecated. " +
        "Use createCanvasShaper(canvas) directly — per-glyph cluster " +
        "info is needed by the IFC, and createCanvasMeasurer synthesizes " +
        "equal per-character widths via division (wrong for proportional " +
        "fonts). EditorConfig.measurer accepts TextShaper directly.",
    );
  }
  return adaptShaperToMeasurer(createCanvasShaper(canvas));
}
