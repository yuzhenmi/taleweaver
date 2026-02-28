import type { TextMeasurer, RenderStyles } from "@taleweaver/core";
import { buildCssFontString, getEffectiveStyles } from "./font-config";

/** Create a TextMeasurer backed by a canvas 2D context. */
export function createCanvasMeasurer(canvas: HTMLCanvasElement): TextMeasurer {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D canvas context");

  return {
    measureWidth(text: string, styles: RenderStyles): number {
      ctx.font = buildCssFontString(styles);
      return ctx.measureText(text).width;
    },

    measureHeight(styles: RenderStyles): number {
      const effective = getEffectiveStyles(styles);
      return effective.lineHeight!;
    },
  };
}
