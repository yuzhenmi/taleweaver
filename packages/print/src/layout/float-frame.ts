import type { Direction } from "@taleweaver/core";
import type { FloatEnvironment } from "./float-context";

/**
 * One inline coordinate frame per BFC for its float env (F4). The env stores
 * inline coordinates from the BFC root's content-box LINE-LEFT edge (the
 * physical left in horizontal writing modes, the top in vertical ones), its
 * `"inline-start"` side meaning line-left and `"inline-end"` line-right, against
 * the BFC content inline size. Each block converts its own logical (direction-
 * relative) content-box coordinates in and out, so a float placed by an
 * indented, nested or opposite-direction block is read correctly by every other
 * block of the BFC.
 */
export interface FloatFrame {
  /** The content box's line-left edge, in the env frame. */
  readonly lineLeft: number;
  /** The content box's inline size. */
  readonly inlineSize: number;
  /** The direction the content box's logical offsets run in. */
  readonly direction: Direction;
  /** The BFC root's content inline size (the env's containing inline size). */
  readonly bfcInlineSize: number;
}

/** The env frame of a BFC root's own content box. */
export function bfcRootFrame(inlineSize: number, direction: Direction): FloatFrame {
  return { lineLeft: 0, inlineSize, direction, bfcInlineSize: inlineSize };
}

/**
 * The env frame of a box's content box, given the line-left edge and size of
 * the area the box was laid out in (its containing block minus its margins).
 * The box sits at that area's inline-start edge in its CONTAINING block's
 * direction (CSS 2.1 §10.3.3); its border + padding run in its own `direction`.
 */
export function contentFrame(
  areaLineLeft: number,
  areaInlineSize: number,
  containingDirection: Direction,
  boxInlineSize: number,
  direction: Direction,
  // The content edge's offset in the box's border-box frame (border + padding).
  contentInlineStart: number,
  contentInlineSize: number,
  bfcInlineSize: number,
): FloatFrame {
  const boxLineLeft = containingDirection === "rtl"
    ? areaLineLeft + areaInlineSize - boxInlineSize
    : areaLineLeft;
  const lineLeft = direction === "rtl"
    ? boxLineLeft + boxInlineSize - contentInlineStart - contentInlineSize
    : boxLineLeft + contentInlineStart;
  return { lineLeft, inlineSize: contentInlineSize, direction, bfcInlineSize };
}

/**
 * The line-left edge, in the env frame, of a child's area inside `frame`: the
 * frame minus the child's inline margins, which run in the CHILD's direction.
 */
export function childAreaLineLeft(
  frame: FloatFrame,
  childDirection: Direction,
  marginInlineStart: number,
  marginInlineEnd: number,
): number {
  return frame.lineLeft + (childDirection === "rtl" ? marginInlineEnd : marginInlineStart);
}

/** The env side of a float whose side is logical in `direction`. */
export function envSide(
  side: "inline-start" | "inline-end",
  direction: Direction,
): "inline-start" | "inline-end" {
  if (direction !== "rtl") return side;
  return side === "inline-start" ? "inline-end" : "inline-start";
}

/** A span's logical offset in `frame` from its line-left edge in the env frame. */
export function fromEnvInline(frame: FloatFrame, envLineLeft: number, inlineSize: number): number {
  return frame.direction === "rtl"
    ? frame.lineLeft + frame.inlineSize - envLineLeft - inlineSize
    : envLineLeft - frame.lineLeft;
}

/**
 * How far the floats active at `blockOffset` (cumulative) intrude into `frame`
 * from its start and end sides: each side's exclusion edge past the frame's own
 * edge, never negative (a float that ends inside an indent shortens nothing).
 */
export function floatIntrusionAt(
  env: FloatEnvironment,
  frame: FloatFrame,
  blockOffset: number,
): { readonly start: number; readonly end: number } {
  const active = env.availableInlineSizeAt(blockOffset, frame.bfcInlineSize);
  // No float on a side → no intrusion, even for a box overflowing the BFC.
  const left = active.inlineStartSize > 0 ? Math.max(0, active.inlineStartSize - frame.lineLeft) : 0;
  const right = active.inlineEndSize > 0
    ? Math.max(0, active.inlineEndSize - (frame.bfcInlineSize - frame.lineLeft - frame.inlineSize))
    : 0;
  return frame.direction === "rtl" ? { start: right, end: left } : { start: left, end: right };
}
