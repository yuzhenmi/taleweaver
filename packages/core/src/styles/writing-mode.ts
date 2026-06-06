export type WritingMode = "horizontal-tb" | "vertical-rl" | "vertical-lr";
export type Direction = "ltr" | "rtl";

/**
 * Exhaustiveness guard for the `WritingMode` union. Placed in the `default` arm
 * of every `switch (writingMode)`: a future 4th mode makes the `never` parameter
 * a COMPILE error at every call site (the new case is no longer assignable to
 * `never`), and an out-of-union value (reachable only via a cast) throws at
 * runtime. The throw is unconditional (not dev-gated): the branch is unreachable
 * by the types, so it costs nothing on the happy path, and throwing in prod is
 * the correct behaviour for a value that violates the union contract.
 */
export function assertNeverWritingMode(wm: never): never {
  throw new Error(`Unhandled writing mode: ${String(wm)}`);
}

export interface LogicalRect {
  readonly inlineOffset: number;
  readonly blockOffset: number;
  readonly inlineSize: number;
  readonly blockSize: number;
}

export interface PhysicalRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Map a logical rect to a physical rect based on writing-mode + direction.
 * Implements the authoritative mapping table in
 * `docs/architecture/1-core/1.0-styles.md` ("logicalToPhysical — full mapping
 * for all writing modes").
 *
 * `horizontal-tb`:
 *   - LTR: identity. inlineOffset = x, blockOffset = y, etc.
 *   - RTL: inline axis is mirrored. x = containingInlineSize − inlineOffset − inlineSize.
 *
 * `vertical-lr`:
 *   - block axis → physical x (left-to-right: x = blockOffset).
 *   - inline axis → physical y (LTR: y = inlineOffset; RTL: y mirrored against
 *     containingInlineSize).
 *   - width = blockSize, height = inlineSize.
 *
 * `vertical-rl`:
 *   - inline axis → physical y (same as vertical-lr).
 *   - block axis → physical x with the right-to-left mirror
 *     x = containingBlockSize − blockOffset − blockSize. Because the box factory
 *     does not have the containing block-size at construction time, this is an
 *     OPTIONAL trailing param: when omitted or "indefinite", the un-mirrored x
 *     (= blockOffset) is returned — the pending value that the P3.1 physicalize
 *     pass corrects once the containing block-size is known.
 *   - width = blockSize, height = inlineSize.
 *
 * @param containingInlineSize the inline-size of the containing block. Required
 *   for inline-axis mirroring (RTL in any mode); ignored when not mirroring.
 * @param containingBlockSize the block-size of the containing block. Only used
 *   by `vertical-rl` for the block-axis (physical x) mirror. When omitted or
 *   "indefinite", `vertical-rl` returns the un-mirrored x.
 */
export function logicalToPhysical(
  logical: LogicalRect,
  writingMode: WritingMode,
  direction: Direction,
  containingInlineSize: number,
  containingBlockSize?: number | "indefinite",
): PhysicalRect {
  switch (writingMode) {
    case "horizontal-tb": {
      if (direction === "ltr") {
        return {
          x: logical.inlineOffset,
          y: logical.blockOffset,
          width: logical.inlineSize,
          height: logical.blockSize,
        };
      }
      return {
        x: containingInlineSize - logical.inlineOffset - logical.inlineSize,
        y: logical.blockOffset,
        width: logical.inlineSize,
        height: logical.blockSize,
      };
    }
    case "vertical-lr":
    case "vertical-rl": {
      // Vertical modes: inline axis → physical y, block axis → physical x.
      // width = blockSize, height = inlineSize.
      const y =
        direction === "ltr"
          ? logical.inlineOffset
          : containingInlineSize - logical.inlineOffset - logical.inlineSize;

      const x =
        writingMode === "vertical-lr"
          ? // Blocks stack left-to-right: physical x = blockOffset.
            logical.blockOffset
          : // vertical-rl: blocks stack right-to-left, x is mirrored against the
            // containing block-size. Without it, return the un-mirrored pending x.
            containingBlockSize === undefined ||
              containingBlockSize === "indefinite"
            ? logical.blockOffset
            : containingBlockSize - logical.blockOffset - logical.blockSize;

      return {
        x,
        y,
        width: logical.blockSize,
        height: logical.inlineSize,
      };
    }
    default:
      return assertNeverWritingMode(writingMode);
  }
}

/**
 * Exact inverse of `logicalToPhysical` for all four (writingMode, direction)
 * combos. Used by hit-testing (P3.5) to map a physical point/rect back to the
 * logical axes. For `vertical-rl`, the `containingBlockSize` arg must match
 * whichever form produced the physical rect: supply it to invert the mirror;
 * omit it to invert the un-mirrored form.
 */
export function physicalToLogical(
  physical: PhysicalRect,
  writingMode: WritingMode,
  direction: Direction,
  containingInlineSize: number,
  containingBlockSize?: number | "indefinite",
): LogicalRect {
  if (writingMode === "horizontal-tb") {
    if (direction === "ltr") {
      return {
        inlineOffset: physical.x,
        blockOffset: physical.y,
        inlineSize: physical.width,
        blockSize: physical.height,
      };
    }
    return {
      inlineOffset: containingInlineSize - physical.x - physical.width,
      blockOffset: physical.y,
      inlineSize: physical.width,
      blockSize: physical.height,
    };
  }

  // Vertical modes: physical y → inline axis, physical x → block axis.
  // inlineSize = height, blockSize = width.
  const inlineSize = physical.height;
  const blockSize = physical.width;

  const inlineOffset =
    direction === "ltr"
      ? physical.y
      : containingInlineSize - physical.y - inlineSize;

  let blockOffset: number;
  if (writingMode === "vertical-lr") {
    blockOffset = physical.x;
  } else {
    // vertical-rl
    blockOffset =
      containingBlockSize === undefined || containingBlockSize === "indefinite"
        ? physical.x
        : containingBlockSize - physical.x - blockSize;
  }

  return {
    inlineOffset,
    blockOffset,
    inlineSize,
    blockSize,
  };
}

export interface AxisMap {
  /** Which physical axis the logical inline axis maps to. */
  readonly inline: "x" | "y";
  /** Which physical axis the logical block axis maps to. */
  readonly block: "x" | "y";
  /**
   * True when the inline axis runs in the negative physical direction relative
   * to the containing block's inline-start edge (i.e. the inline-start edge is
   * at the far/high end of the physical axis). RTL in every mode.
   */
  readonly inlineReversed: boolean;
}

/**
 * The consumer-facing axis selector: which physical axis each logical axis maps
 * to, plus whether the inline axis is reversed. Used by P3.5+ layout/cursor
 * code to pick the right physical coordinate without re-deriving the mapping.
 *
 * Per `1.0-styles.md`: `horizontal-tb` maps inline→x, block→y; both vertical
 * modes map inline→y, block→x. The inline axis is reversed iff direction is rtl.
 */
export function axisMapFor(writingMode: WritingMode, direction: Direction): AxisMap {
  const inlineReversed = direction === "rtl";
  if (writingMode === "horizontal-tb") {
    return { inline: "x", block: "y", inlineReversed };
  }
  return { inline: "y", block: "x", inlineReversed };
}
