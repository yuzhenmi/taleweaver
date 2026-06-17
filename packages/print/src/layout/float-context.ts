import type { RenderNode } from "@taleweaver/core";

export interface PlacedFloat {
  readonly side: "inline-start" | "inline-end";
  readonly inlineOffset: number;
  readonly blockOffset: number;
  readonly inlineSize: number;
  readonly blockSize: number;
}

/**
 * A float that did not fit the remaining block space on its page and was
 * deferred to the next page. Carries only the cascaded float node and its
 * side — sizes are recomputed by re-layout on the landing page, so no
 * pre-computed geometry is recorded here.
 */
export interface PushedFloat {
  readonly node: RenderNode;
  readonly side: "inline-start" | "inline-end";
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

  /**
   * Non-mutating query: returns the landing placement `placeFloat` WOULD
   * produce for a float with these parameters, WITHOUT placing it. Runs the
   * same push-below computation as `placeFloat` but reads the placed-floats
   * array without appending to it. `blockSize` is not needed — the landing is
   * where the float's TOP goes; vertical fit is the caller's concern.
   */
  peekPlaceFloat(
    side: "inline-start" | "inline-end",
    requestedBlockOffset: number,
    inlineSize: number,
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

  /**
   * Inject a pre-placed float (position already decided) VERBATIM into the
   * environment, in the SAME coordinate frame as the other placed floats
   * (document-cumulative for the paginated path). No placement/push-down logic
   * runs — the caller asserts the float already sits where `placed` says. Used to
   * SEED a fresh per-page env with the floats whose shadow crosses in from a prior
   * page (VL float fast-path: materialize + the measure-pass incoming carry).
   */
  seedPlaced(placed: PlacedFloat): void;

  /**
   * Record a float that did not fit the remaining block space and must be
   * deferred to the next page. INERT primitive — pushing does NOT create an
   * exclusion region or affect `placeFloat`/`clearance` queries; the BFC float
   * branch (a later task) records pushed floats here and the landing page
   * re-lays them out.
   */
  pushFloat(pf: PushedFloat): void;

  /** The floats pushed to the next page, in push order. */
  pushedFloats(): readonly PushedFloat[];

  /** For incremental-layout diffing. Returns a frozen reference to the placed floats. */
  getPlacedFloats(): readonly PlacedFloat[];

  /**
   * Forward-compat: returns the lowest block-offset where this environment
   * differs from `prev`. Returns +Infinity when the environments are
   * effectively the same (no float changes affect later lines). Plan 3.G
   * Task 5 reserves; consumers (Plan 3.H) implement.
   */
  dirtyBlockOffsetSince(prev: FloatEnvironment): number;
}

export function createFloatEnvironment(): FloatEnvironment {
  const placed: PlacedFloat[] = [];
  const pushed: PushedFloat[] = [];

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

  /**
   * Pure landing computation: where would a float with these parameters land,
   * given the floats currently in `placed`? Reads `placed` but does NOT mutate
   * it. Both `placeFloat` (which then appends) and `peekPlaceFloat` (which does
   * not) share this; their landing results are therefore identical.
   */
  function computeLanding(
    side: "inline-start" | "inline-end",
    requestedBlockOffset: number,
    inlineSize: number,
    containingInlineSize: number,
  ): { blockOffset: number; inlineOffset: number } {
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
        return { blockOffset: candidateBlockOffset, inlineOffset };
      }
      candidateBlockOffset = next;
    }
    // Pathological — should not be reachable.
    throw new Error("computeLanding: too many iterations");
  }

  return {
    placeFloat(side, requestedBlockOffset, inlineSize, blockSize, containingInlineSize) {
      const landing = computeLanding(side, requestedBlockOffset, inlineSize, containingInlineSize);
      placed.push({
        side,
        inlineOffset: landing.inlineOffset,
        blockOffset: landing.blockOffset,
        inlineSize,
        blockSize,
      });
      return landing;
    },

    peekPlaceFloat(side, requestedBlockOffset, inlineSize, containingInlineSize) {
      return computeLanding(side, requestedBlockOffset, inlineSize, containingInlineSize);
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

    seedPlaced(f) {
      placed.push(f);
    },

    pushFloat(pf) {
      pushed.push(pf);
    },

    pushedFloats() {
      return pushed;
    },

    getPlacedFloats() {
      return placed;
    },

    dirtyBlockOffsetSince(prev) {
      if (prev === this) return Number.POSITIVE_INFINITY;

      const prevFloats = prev.getPlacedFloats();
      const currFloats = placed;

      // Find lowest block-offset where the two arrays differ in any float's placement.
      let minDirtyBlock = Number.POSITIVE_INFINITY;

      const maxLen = Math.max(prevFloats.length, currFloats.length);
      for (let i = 0; i < maxLen; i++) {
        const p = prevFloats[i];
        const c = currFloats[i];
        if (!p || !c || !floatsEqual(p, c)) {
          const blockOffset = (p?.blockOffset ?? c?.blockOffset ?? 0);
          if (blockOffset < minDirtyBlock) minDirtyBlock = blockOffset;
        }
      }

      return minDirtyBlock;
    },
  };
}

function floatsEqual(a: PlacedFloat, b: PlacedFloat): boolean {
  return a.side === b.side
    && a.inlineOffset === b.inlineOffset
    && a.blockOffset === b.blockOffset
    && a.inlineSize === b.inlineSize
    && a.blockSize === b.blockSize;
}

