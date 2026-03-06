import type { TextMeasurer, RenderStyles } from "@taleweaver/core";
import { buildCssFontString, getEffectiveStyles } from "./font-config";

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
  const cursorHeightCache = new Map<string, number>();

  return {
    measureWidth(text: string, styles: RenderStyles): number {
      const font = buildCssFontString(styles);
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

    measureHeight(styles: RenderStyles): number {
      const effective = getEffectiveStyles(styles);
      return effective.lineHeight * effective.fontSize;
    },

    measureCursorHeight(styles: RenderStyles): number {
      const font = buildCssFontString(styles);
      let height = cursorHeightCache.get(font);
      if (height === undefined) {
        ctx.font = font;
        const metrics = ctx.measureText("\u200b"); // zero-width space
        height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
        cursorHeightCache.set(font, height);
      }
      return height;
    },
  };
}
