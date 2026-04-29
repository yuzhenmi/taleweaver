export interface PlacedFloat {
  readonly side: "inline-start" | "inline-end";
  readonly inlineOffset: number;
  readonly blockOffset: number;
  readonly inlineSize: number;
  readonly blockSize: number;
}

export interface FloatContext {
  placeFloat(f: PlacedFloat): void;
  /**
   * @returns the inline-size occupied at `blockOffset` by floats on each side.
   * Caller subtracts these from the containing inline-size to get the free
   * inline-size at that block-offset.
   */
  activeAt(blockOffset: number): { inlineStartSize: number; inlineEndSize: number };
  /**
   * @returns the block-offset at which all floats on the cleared side(s) end.
   * Used by `clear: inline-start | inline-end | both`.
   */
  clearY(side: "inline-start" | "inline-end" | "both", blockOffset: number): number;
  lowestBottom(): number;
}

export function createFloatContext(): FloatContext {
  const placed: PlacedFloat[] = [];
  return {
    placeFloat(f) {
      placed.push(f);
    },
    activeAt(blockOffset) {
      let inlineStartSize = 0;
      let inlineEndSize = 0;
      for (const f of placed) {
        if (blockOffset < f.blockOffset) continue;
        if (blockOffset >= f.blockOffset + f.blockSize) continue;
        if (f.side === "inline-start") {
          inlineStartSize = Math.max(inlineStartSize, f.inlineOffset + f.inlineSize);
        } else {
          inlineEndSize = Math.max(inlineEndSize, f.inlineSize);
        }
      }
      return { inlineStartSize, inlineEndSize };
    },
    clearY(side, blockOffset) {
      let bottom = blockOffset;
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
    lowestBottom() {
      let b = 0;
      for (const f of placed) b = Math.max(b, f.blockOffset + f.blockSize);
      return b;
    },
  };
}
