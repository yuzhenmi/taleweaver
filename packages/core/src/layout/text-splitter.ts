import type { RenderStyles } from "../render/render-node";
import type { TextMeasurer } from "./text-measurer";

/** An atomic text box — the smallest unsplittable unit. */
export interface WordBox {
  readonly text: string;
  readonly width: number;
  readonly height: number;
  /** Whether this word is followed by a space (breakpoint). */
  readonly trailingSpace: boolean;
}

/**
 * Split text content into word-level atomic boxes.
 * Splits on spaces, preserving trailing spaces as breakpoints.
 * Leading spaces are preserved as a standalone space box.
 *
 * When `maxWidth` is provided, words wider than `maxWidth` are broken
 * at character boundaries into chunks that fit within the width limit.
 */
export function splitTextIntoWords(
  text: string,
  styles: RenderStyles,
  measurer: TextMeasurer,
  maxWidth?: number,
): WordBox[] {
  if (text.length === 0) {
    return [
      {
        text: "",
        width: 0,
        height: measurer.measureHeight(styles),
        trailingSpace: false,
      },
    ];
  }

  const boxes: WordBox[] = [];
  const parts = text.split(/( +)/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.length === 0) continue;

    if (/^ +$/.test(part)) {
      if (boxes.length > 0) {
        // Attach trailing space to previous word box
        const prev = boxes[boxes.length - 1];
        boxes[boxes.length - 1] = {
          text: prev.text + part,
          width: measurer.measureWidth(prev.text + part, styles),
          height: prev.height,
          trailingSpace: true,
        };
      } else {
        // Leading space — create a standalone space box
        boxes.push({
          text: part,
          width: measurer.measureWidth(part, styles),
          height: measurer.measureHeight(styles),
          trailingSpace: true,
        });
      }
    } else {
      boxes.push({
        text: part,
        width: measurer.measureWidth(part, styles),
        height: measurer.measureHeight(styles),
        trailingSpace: false,
      });
    }
  }

  // Break oversized words at character boundaries
  if (maxWidth !== undefined) {
    const result: WordBox[] = [];
    for (const box of boxes) {
      if (box.width > maxWidth && box.text.length > 1) {
        breakWord(box, styles, maxWidth, measurer, result);
      } else {
        result.push(box);
      }
    }
    return result;
  }

  return boxes;
}

/** Break a single word box into chunks that each fit within maxWidth. */
function breakWord(
  box: WordBox,
  styles: RenderStyles,
  maxWidth: number,
  measurer: TextMeasurer,
  out: WordBox[],
): void {
  let remaining = box.text;
  const height = box.height;

  while (remaining.length > 0) {
    let fit = 0;
    let fitWidth = 0;
    for (let c = 1; c <= remaining.length; c++) {
      const w = measurer.measureWidth(remaining.slice(0, c), styles);
      if (w > maxWidth && fit > 0) break;
      fit = c;
      fitWidth = w;
    }
    if (fit === 0) {
      fit = 1;
      fitWidth = measurer.measureWidth(remaining.slice(0, 1), styles);
    }

    const chunk = remaining.slice(0, fit);
    remaining = remaining.slice(fit);

    out.push({
      text: chunk,
      width: fitWidth,
      height,
      // Only the last chunk inherits the trailing space from the original word
      trailingSpace: remaining.length === 0 && box.trailingSpace,
    });
  }
}
