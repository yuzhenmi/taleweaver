export interface PlacedFloat {
  readonly side: "inline-start" | "inline-end";
  readonly inlineOffset: number;
  readonly blockOffset: number;
  readonly inlineSize: number;
  readonly blockSize: number;
}

/**
 * CSS 9.5.1 float environment. One per BFC root; tracks placed floats
 * and computes placement per the rules:
 *   - A float must not overlap an earlier float on the same side.
 *   - Top of float ≤ top of containing block; ≤ top of any earlier float.
 *   - When a float doesn't fit at the requested block-offset, it's pushed
 *     below the next float bottom.
 */
export interface FloatEnvironment {
  /**
   * Place a new float per CSS 9.5.1.
   *
   * @returns the final placement (block-offset may be greater than
   *   `requestedBlockOffset` if the float was pushed down).
   */
  placeFloat(
    side: "inline-start" | "inline-end",
    requestedBlockOffset: number,
    inlineSize: number,
    blockSize: number,
    containingInlineSize: number,
  ): { blockOffset: number; inlineOffset: number };

  /** Inline-size occupied at `blockOffset` per side. */
  availableInlineSizeAt(
    blockOffset: number,
    containingInlineSize: number,
  ): { inlineStartSize: number; inlineEndSize: number };

  /**
   * For `clear`: returns the block-offset where the cleared side(s) have
   * no active float. Result ≥ `currentBlockOffset`.
   */
  clearance(
    side: "inline-start" | "inline-end" | "both",
    currentBlockOffset: number,
  ): number;

  /** Lowest float block-edge across all placed floats. */
  lowestFloatBlockEdge(): number;

  /**
   * Returns the smallest float block-bottom strictly greater than `blockOffset`.
   * Returns `blockOffset` if no float bottom is strictly below (so caller can
   * detect "no progress").
   */
  nextFloatBottomBelow(blockOffset: number): number;
}

export function createFloatEnvironment(): FloatEnvironment {
  const placed: PlacedFloat[] = [];

  function nextFloatBottomBelow(blockOffset: number): number {
    let candidate = Infinity;
    for (const f of placed) {
      const bottom = f.blockOffset + f.blockSize;
      if (bottom > blockOffset && bottom < candidate) {
        candidate = bottom;
      }
    }
    return candidate === Infinity ? blockOffset : candidate;
  }

  function activeAt(blockOffset: number) {
    let inlineStartSize = 0;
    let inlineEndSize = 0;
    for (const f of placed) {
      if (blockOffset < f.blockOffset) continue;
      if (blockOffset >= f.blockOffset + f.blockSize) continue;
      if (f.side === "inline-start") {
        inlineStartSize = Math.max(inlineStartSize, f.inlineOffset + f.inlineSize);
      } else {
        // For inline-end floats, inline-end "size" is the right-side occupied width.
        // (Stored: f.inlineOffset is the inline-offset from start; for inline-end floats,
        // the inline-end edge is at containingInlineSize; the float's left edge is at
        // f.inlineOffset, so the inline-end occupied size is containingInlineSize - f.inlineOffset.)
        // Simpler: track per-float, take the max occupied inline-end size.
        // We don't have containingInlineSize here, but the placement stored f.inlineOffset
        // s.t. f.inlineOffset + f.inlineSize === containingInlineSize for inline-end floats.
        // So: end-occupied = f.inlineSize.
        inlineEndSize = Math.max(inlineEndSize, f.inlineSize);
      }
    }
    return { inlineStartSize, inlineEndSize };
  }

  return {
    placeFloat(side, requestedBlockOffset, inlineSize, blockSize, containingInlineSize) {
      let candidateBlockOffset = requestedBlockOffset;

      // Iterate: try at the requested offset; if doesn't fit, push to next float bottom.
      // Cap iterations to prevent infinite loops in pathological cases.
      for (let iter = 0; iter < 1000; iter++) {
        const active = activeAt(candidateBlockOffset);
        const free = containingInlineSize - active.inlineStartSize - active.inlineEndSize;

        if (free >= inlineSize) {
          // Fits.
          const inlineOffset = side === "inline-start"
            ? active.inlineStartSize
            : containingInlineSize - active.inlineEndSize - inlineSize;
          placed.push({ side, inlineOffset, blockOffset: candidateBlockOffset, inlineSize, blockSize });
          return { blockOffset: candidateBlockOffset, inlineOffset };
        }

        // Doesn't fit; push below next float bottom.
        const next = nextFloatBottomBelow(candidateBlockOffset);
        if (next <= candidateBlockOffset) {
          // No float below; place anyway (overflows containingInlineSize).
          // Per CSS 9.5.1 rule 7: "A floating box must be placed as high as possible."
          // If even with no floats it doesn't fit (because inlineSize > containingInlineSize),
          // place at requested with overflow.
          const inlineOffset = side === "inline-start" ? 0 : Math.max(0, containingInlineSize - inlineSize);
          placed.push({ side, inlineOffset, blockOffset: candidateBlockOffset, inlineSize, blockSize });
          return { blockOffset: candidateBlockOffset, inlineOffset };
        }
        candidateBlockOffset = next;
      }
      // Pathological — should not be reachable.
      throw new Error("placeFloat: too many iterations");
    },

    availableInlineSizeAt(blockOffset, _containingInlineSize) {
      return activeAt(blockOffset);
    },

    clearance(side, currentBlockOffset) {
      let bottom = currentBlockOffset;
      for (const f of placed) {
        const isMatch =
          side === "both" ||
          (side === "inline-start" && f.side === "inline-start") ||
          (side === "inline-end" && f.side === "inline-end");
        if (!isMatch) continue;
        bottom = Math.max(bottom, f.blockOffset + f.blockSize);
      }
      return bottom;
    },

    lowestFloatBlockEdge() {
      let b = 0;
      for (const f of placed) b = Math.max(b, f.blockOffset + f.blockSize);
      return b;
    },

    nextFloatBottomBelow(blockOffset) {
      return nextFloatBottomBelow(blockOffset);
    },
  };
}

// Backwards-compat aliases (sunset path). Marked deprecated; remove in a future plan.
/** @deprecated Use `FloatEnvironment` */
export type FloatContext = FloatEnvironment;
/** @deprecated Use `createFloatEnvironment` */
export const createFloatContext = createFloatEnvironment;
