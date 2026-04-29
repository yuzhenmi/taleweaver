import type { TextMeasurer, ComputedStyle } from "@taleweaver/core";
import { buildCssFontString } from "./font-config";

const DEFAULT_CACHE_SIZE = 10_000;

export interface CanvasMeasurerOptions {
  cacheSize?: number;
}

/** Create a TextMeasurer backed by a canvas 2D context. */
export function createCanvasMeasurer(
  canvas: HTMLCanvasElement,
  options?: CanvasMeasurerOptions,
): TextMeasurer {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D canvas context");

  const maxSize = options?.cacheSize ?? DEFAULT_CACHE_SIZE;
  const widthCache = new Map<string, number>();

  return {
    measureWidth(text: string, style: Readonly<ComputedStyle>): number {
      const font = buildCssFontString(style);
      const key = font + "\0" + text;
      let width = widthCache.get(key);
      if (width === undefined) {
        if (widthCache.size >= maxSize) {
          widthCache.clear();
        }
        ctx.font = font;
        width = ctx.measureText(text).width;
        widthCache.set(key, width);
      }
      return width;
    },

    measureHeight(style: Readonly<ComputedStyle>): number {
      const lh = style.lineHeight;
      const resolvedLineHeight =
        typeof lh === "number"
          ? lh * style.fontSize
          : (lh.value / 100) * style.fontSize;
      return resolvedLineHeight;
    },
  };
}
