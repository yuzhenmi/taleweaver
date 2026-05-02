import type { ComputedStyle, UsedStyle } from "../styles";
import type { WritingMode, Direction } from "../styles/writing-mode";
import { logicalToPhysical } from "../styles/writing-mode";
import type { PageBox } from "./page-box";
import { createPageBox } from "./page-box";
export type { PageBox } from "./page-box";

export type LayoutBox = BlockBox | LineBox | TextRunBox | InlineBox | InlineBlockBox | MarkerBox | TableBox | TableRowBox | TableCellBox | PageBox;

interface LayoutBoxBase {
  readonly key: string;

  // PARENT-RELATIVE LOGICAL POSITIONS. inlineOffset and blockOffset are
  // measured from the parent's content-edge origin. The document root is
  // placed at (0, 0) relative to nothing.
  //
  // Painter, hit-test, and selection-geometry walk the tree accumulating
  // parent offsets cumulatively (see canvas-renderer.ts:paintBox and
  // editor/cursor-position.ts:collectTextBoxes for the pattern).
  readonly inlineOffset: number;
  readonly blockOffset:  number;
  readonly inlineSize:   number;
  readonly blockSize:    number;

  // PARENT-RELATIVE PHYSICAL POSITIONS. Derived from the logical fields via
  // logicalToPhysical(); `containingInlineSize` is required at factory time
  // to support RTL inline-axis inversion.
  // In Plan 3.A: derived as identity for LTR; Task 11 adds RTL inversion.
  readonly x: number;
  readonly y: number;
  readonly width:  number;
  readonly height: number;

  // Containing-block writing-mode + direction at this point
  readonly writingMode: WritingMode;
  readonly direction:   Direction;

  readonly computedStyle: Readonly<ComputedStyle>;
  readonly usedStyle:     Readonly<UsedStyle>;
}

export interface BlockBox extends LayoutBoxBase {
  readonly type: "block";
  readonly children: readonly LayoutBox[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LineBox extends LayoutBoxBase {
  readonly type: "line";
  readonly children: readonly LayoutBox[];
  readonly baseline: number;
  /**
   * True when the wrap pass inserted a hyphen glyph at the end of this line
   * because the hyphenated word continues on the next line.
   * Used by the IFC fragmentation fit-check (D.4) to avoid breaking between
   * two lines of a hyphenated word (CSS Fragmentation L4 §5).
   * Defaults to false when not set.
   */
  readonly endsWithHyphenContinuation?: boolean;
}

export interface TextRunBox extends LayoutBoxBase {
  readonly type: "text-run";
  readonly text: string;
}

/**
 * `fragmentEdge` indicates which side of an inline element this fragment is:
 * - "only"   — the element does not fragment (single line); has all paddings and borders.
 * - "first"  — the leading fragment; has start-side padding/border, no end-side.
 * - "middle" — neither leading nor trailing; no horizontal padding or border.
 * - "last"   — the trailing fragment; has end-side padding/border, no start-side.
 */
export type InlineFragmentEdge = "first" | "middle" | "last" | "only";

export interface InlineBox extends LayoutBoxBase {
  readonly type: "inline";
  readonly children: readonly LayoutBox[];
  readonly fragmentEdge: InlineFragmentEdge;
}

export interface InlineBlockBox extends LayoutBoxBase {
  readonly type: "inline-block";
  readonly children: readonly LayoutBox[];
}

export interface MarkerBox extends LayoutBoxBase {
  readonly type: "marker";
  readonly text: string;
}

export interface TableBox extends LayoutBoxBase {
  readonly type: "table";
  readonly children: readonly LayoutBox[];
  readonly columnPxWidths: readonly number[];
}

export interface TableRowBox extends LayoutBoxBase {
  readonly type: "table-row";
  readonly children: readonly LayoutBox[];
}

export interface TableCellBox extends LayoutBoxBase {
  readonly type: "table-cell";
  readonly children: readonly LayoutBox[];
}

interface BoxBaseFields {
  readonly key: string;
  readonly inlineOffset: number;
  readonly blockOffset:  number;
  readonly inlineSize:   number;
  readonly blockSize:    number;
  readonly x: number;
  readonly y: number;
  readonly width:  number;
  readonly height: number;
  readonly writingMode: WritingMode;
  readonly direction:   Direction;
  readonly computedStyle: Readonly<ComputedStyle>;
  readonly usedStyle:     Readonly<UsedStyle>;
}

function createBoxBase(args: {
  key: string;
  inlineOffset: number;
  blockOffset: number;
  inlineSize: number;
  blockSize: number;
  writingMode: WritingMode;
  direction: Direction;
  computedStyle: ComputedStyle;
  usedStyle: UsedStyle;
  containingInlineSize: number;
}): BoxBaseFields {
  const phys = logicalToPhysical(
    {
      inlineOffset: args.inlineOffset,
      blockOffset:  args.blockOffset,
      inlineSize:   args.inlineSize,
      blockSize:    args.blockSize,
    },
    args.writingMode, args.direction, args.containingInlineSize,
  );
  return {
    key: args.key,
    inlineOffset: args.inlineOffset,
    blockOffset:  args.blockOffset,
    inlineSize:   args.inlineSize,
    blockSize:    args.blockSize,
    ...phys,
    writingMode: args.writingMode,
    direction:   args.direction,
    computedStyle: Object.freeze({ ...args.computedStyle }),
    usedStyle:     Object.freeze({ ...args.usedStyle }),
  };
}

export function createBlockBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  children: readonly LayoutBox[],
  containingInlineSize: number,
  metadata?: Readonly<Record<string, unknown>>,
): BlockBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
  });
  return Object.freeze({
    type: "block" as const,
    ...base,
    children: Object.freeze([...children]),
    ...(metadata !== undefined ? { metadata: Object.freeze({ ...metadata }) } : {}),
  });
}

export function createLineBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  children: readonly LayoutBox[],
  baseline: number = blockSize,
  containingInlineSize: number,
  endsWithHyphenContinuation?: boolean,
): LineBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
  });
  return Object.freeze({
    type: "line" as const,
    ...base,
    children: Object.freeze([...children]),
    baseline,
    ...(endsWithHyphenContinuation === true ? { endsWithHyphenContinuation: true } : {}),
  });
}

export function createTextRunBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  text: string,
  containingInlineSize: number,
): TextRunBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
  });
  return Object.freeze({
    type: "text-run" as const,
    ...base,
    text,
  });
}

export function createInlineBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  children: readonly LayoutBox[],
  fragmentEdge: InlineFragmentEdge,
  containingInlineSize: number,
): InlineBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
  });
  return Object.freeze({
    type: "inline" as const,
    ...base,
    children: Object.freeze([...children]),
    fragmentEdge,
  });
}

export function createInlineBlockBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  children: readonly LayoutBox[],
  containingInlineSize: number,
): InlineBlockBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
  });
  return Object.freeze({
    type: "inline-block" as const,
    ...base,
    children: Object.freeze([...children]),
  });
}

export function createMarkerBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  text: string,
  containingInlineSize: number,
): MarkerBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
  });
  return Object.freeze({
    type: "marker" as const,
    ...base,
    text,
  });
}

export function createTableBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  children: readonly LayoutBox[],
  columnPxWidths: readonly number[],
  containingInlineSize: number,
): TableBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
  });
  return Object.freeze({
    type: "table" as const,
    ...base,
    children: Object.freeze([...children]),
    columnPxWidths: Object.freeze([...columnPxWidths]),
  });
}

export function createTableRowBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  children: readonly LayoutBox[],
  containingInlineSize: number,
): TableRowBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
  });
  return Object.freeze({
    type: "table-row" as const,
    ...base,
    children: Object.freeze([...children]),
  });
}

export function createTableCellBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  children: readonly LayoutBox[],
  containingInlineSize: number,
): TableCellBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
  });
  return Object.freeze({
    type: "table-cell" as const,
    ...base,
    children: Object.freeze([...children]),
  });
}

/**
 * Recreate a layout box with a new inline-offset. Used by IFC bidi
 * reordering and similar passes that need to reposition a box without
 * re-running its children's layout.
 *
 * @param containingInlineSize the box's containing-block inline-size
 *   (used for RTL physical-x derivation; same value passed to original
 *   factory).
 */
export function withInlineOffset(
  box: LayoutBox,
  newInlineOffset: number,
  containingInlineSize: number,
): LayoutBox {
  switch (box.type) {
    case "block":
      return createBlockBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize, box.metadata,
      );
    case "line":
      return createLineBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.baseline, containingInlineSize, box.endsWithHyphenContinuation,
      );
    case "text-run":
      return createTextRunBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, containingInlineSize,
      );
    case "inline":
      return createInlineBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.fragmentEdge, containingInlineSize,
      );
    case "inline-block":
      return createInlineBlockBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "marker":
      return createMarkerBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, containingInlineSize,
      );
    case "table":
      return createTableBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.columnPxWidths, containingInlineSize,
      );
    case "table-row":
      return createTableRowBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "table-cell":
      return createTableCellBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "page":
      return createPageBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.pageIndex, containingInlineSize,
      );
  }
}

/**
 * Re-emit a LayoutBox at a different blockOffset, preserving all other
 * fields. Children are kept by reference (their blockOffsets are
 * relative to the parent and don't need updating when only the parent
 * moves vertically).
 *
 * Used by the pagination fragmenter to reposition blocks from
 * document-relative to page-relative blockOffsets.
 */
export function withBlockOffset(
  box: LayoutBox,
  newBlockOffset: number,
  containingInlineSize: number,
): LayoutBox {
  switch (box.type) {
    case "block":
      return createBlockBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize, box.metadata,
      );
    case "line":
      return createLineBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.baseline, containingInlineSize, box.endsWithHyphenContinuation,
      );
    case "text-run":
      return createTextRunBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, containingInlineSize,
      );
    case "inline":
      return createInlineBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.fragmentEdge, containingInlineSize,
      );
    case "inline-block":
      return createInlineBlockBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "marker":
      return createMarkerBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, containingInlineSize,
      );
    case "table":
      return createTableBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.columnPxWidths, containingInlineSize,
      );
    case "table-row":
      return createTableRowBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "table-cell":
      return createTableCellBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "page":
      return createPageBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.pageIndex, containingInlineSize,
      );
  }
}
