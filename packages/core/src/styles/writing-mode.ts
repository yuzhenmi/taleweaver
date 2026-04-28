export type WritingMode = "horizontal-tb" | "vertical-rl" | "vertical-lr";
export type Direction = "ltr" | "rtl";

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
 *
 * Plan 3.A only implements `horizontal-tb` (vertical writing modes activate
 * in Plan 4):
 *   - LTR: identity. inlineOffset = x, blockOffset = y, etc.
 *   - RTL: inline axis is mirrored. The inline-start edge is on the right;
 *          x = containingInlineSize - inlineOffset - inlineSize.
 *
 * @param containingInlineSize the inline-size of the containing block
 *   (e.g., parent box's content-area inline-size). Required for RTL inversion;
 *   ignored for LTR.
 */
export function logicalToPhysical(
  logical: LogicalRect,
  writingMode: WritingMode,
  direction: Direction,
  containingInlineSize: number,
): PhysicalRect {
  if (writingMode !== "horizontal-tb") {
    throw new Error(`writing-mode "${writingMode}" not implemented in Plan 3.A`);
  }
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
