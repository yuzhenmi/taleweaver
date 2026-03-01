import type { RenderStyles } from "../render/render-node";

/** Interface for measuring text dimensions. */
export interface TextMeasurer {
  /** Measure the width of a string given style properties. */
  measureWidth(text: string, styles: RenderStyles): number;
  /** Get the line height for the given styles. */
  measureHeight(styles: RenderStyles): number;
  /** Get the cursor height for the given styles (font bounding box height). */
  measureCursorHeight(styles: RenderStyles): number;
}

/**
 * Mock text measurer for testing.
 * Uses a fixed character width (default 8px per char) and line height (default 16px).
 */
export function createMockMeasurer(
  charWidth: number = 8,
  lineHeight: number = 16,
  cursorHeight?: number,
): TextMeasurer {
  return {
    measureWidth(text: string, _styles: RenderStyles): number {
      return text.length * charWidth;
    },
    measureHeight(_styles: RenderStyles): number {
      return lineHeight;
    },
    measureCursorHeight(_styles: RenderStyles): number {
      return cursorHeight ?? lineHeight;
    },
  };
}
