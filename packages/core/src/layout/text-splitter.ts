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
 */
export function splitTextIntoWords(
  text: string,
  styles: RenderStyles,
  measurer: TextMeasurer,
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

  return boxes;
}
