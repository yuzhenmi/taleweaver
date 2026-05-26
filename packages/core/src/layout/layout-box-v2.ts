import type { ComputedStyle, UsedStyle } from "../styles";
import type { WritingMode, Direction } from "../styles/writing-mode";
import { logicalToPhysical } from "../styles/writing-mode";
import type { BlockId } from "../state/block-id";
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

  /**
   * The block whose IFC produced this line. Stamped by the IFC at
   * line-emit time. Used by geometry queries to map (line, char-offset)
   * back to a Position without parsing text-run keys.
   *
   * Typed as the branded `BlockId` (re-export from `state/block-id`)
   * so downstream consumers (hit-test, cursor-position) can pass it
   * directly to state APIs without a cast.
   */
  readonly ownerBlockId: BlockId;

  /**
   * Inline-content offset (state-model character count: UTF-16 code
   * units across text items + 1 per embed item) of the FIRST character
   * on this line. For an empty line, equal to `inlineOffsetEnd`.
   *
   * Invariant: `nextLine.inlineOffsetStart === currentLine.inlineOffsetEnd`
   * for two adjacent lines within the same block.
   */
  readonly inlineOffsetStart: number;

  /**
   * Inline-content offset just past the LAST character on this line.
   * For the final line of a block, equals
   * `inlineContentLength(block.inlineContent)`.
   */
  readonly inlineOffsetEnd: number;

  /**
   * True iff this is the LAST line of its `ownerBlockId`'s IFC.
   * Used by selection-rect emission to draw the paragraph-break
   * indicator after the line; replaces the
   * `collectBlockBoundaryLines` traversal.
   *
   * A symmetric `isFirstLineOfBlock` is NOT carried — derive it as
   * `inlineOffsetStart === 0` when needed.
   */
  readonly isBlockBoundaryLine: boolean;
}

export interface TextRunBox extends LayoutBoxBase {
  readonly type: "text-run";
  readonly text: string;
  /**
   * Number of STATE-model characters this run owns. Equals `text.length`
   * in the common (non-collapsing) case, but is GREATER when trailing
   * collapsed whitespace was absorbed into this run: under
   * `white-space: normal` a double space renders as one glyph yet
   * occupies two state-character offsets, and the collapsed-away
   * character is attributed to the preceding run so cursor offsets after
   * it stay aligned with state offsets. The synthetic hyphen run (a
   * rendered glyph with no backing state char) carries `offsetLength: 0`.
   */
  readonly offsetLength: number;
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
  /**
   * The InlineBox's underlying inline-ancestor render-node key — used to
   * group fragments of the same inline element across lines for
   * fragmentEdge resolution ("first" / "middle" / "last" / "only").
   *
   * Previously derived by `extractAncestorKey` from `box.key` via
   * `lastIndexOf("-")`, but inline-ancestor render-node keys themselves
   * commonly contain dashes (compound block IDs), so the string-derived
   * extraction was wrong for any non-trivial document. L-C: store it
   * explicitly to make grouping unambiguous.
   */
  readonly ancestorKey: string;
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
  ownerBlockId: BlockId,
  inlineOffsetStart: number,
  inlineOffsetEnd: number,
  isBlockBoundaryLine: boolean,
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
    ownerBlockId,
    inlineOffsetStart,
    inlineOffsetEnd,
    isBlockBoundaryLine,
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
  offsetLength: number,
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
    offsetLength,
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
  ancestorKey: string,
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
    ancestorKey,
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
 * Updates ONLY the inline offset; the block offset is preserved. The
 * physical `x` / `y` are re-derived by the underlying factory, so the
 * logical↔physical invariant is preserved.
 *
 * Prefer this helper over `Object.freeze({ ...box, x })` — spread-and-cast
 * leaves `inlineOffset` stale, so consumers reading the logical field see
 * a different position than consumers reading the physical field.
 *
 * @param containingInlineSize the box's containing-block inline-size
 *   (used for RTL physical-x derivation; same value passed to the original
 *   factory).
 */
export function withInlineOffset(
  box: LayoutBox,
  newInlineOffset: number,
  containingInlineSize: number,
): LayoutBox {
  return rebuildBoxWithOffsets(box, newInlineOffset, box.blockOffset, containingInlineSize);
}

/**
 * Recreate a layout box with a new block-offset. Used by IFC vertical-align
 * and similar passes that reposition a box on the block axis without
 * re-running its children's layout.
 *
 * Updates ONLY the block offset; the inline offset is preserved. The
 * physical `x` / `y` are re-derived by the underlying factory, so the
 * logical↔physical invariant is preserved.
 *
 * Prefer this helper over `Object.freeze({ ...box, y })` — spread-and-cast
 * leaves `blockOffset` stale, so consumers reading the logical field see
 * a different position than consumers reading the physical field.
 *
 * @param containingInlineSize the box's containing-block inline-size
 *   (used for RTL physical-x derivation; same value passed to the original
 *   factory).
 */
export function withBlockOffset(
  box: LayoutBox,
  newBlockOffset: number,
  containingInlineSize: number,
): LayoutBox {
  return rebuildBoxWithOffsets(box, box.inlineOffset, newBlockOffset, containingInlineSize);
}

/**
 * Recreate a layout box with new inline AND block offsets at once. Used by
 * BFC float placement, which positions a float on both axes simultaneously.
 *
 * Updates both logical offsets; the physical `x` / `y` are re-derived by
 * the underlying factory, so the logical↔physical invariant is preserved.
 *
 * Prefer this helper over `Object.freeze({ ...box, x, y })` — spread-and-cast
 * leaves the matching logical fields stale.
 *
 * @param containingInlineSize the box's containing-block inline-size
 *   (used for RTL physical-x derivation; same value passed to the original
 *   factory).
 */
export function withOffsets(
  box: LayoutBox,
  newInlineOffset: number,
  newBlockOffset: number,
  containingInlineSize: number,
): LayoutBox {
  return rebuildBoxWithOffsets(box, newInlineOffset, newBlockOffset, containingInlineSize);
}

function rebuildBoxWithOffsets(
  box: LayoutBox,
  newInlineOffset: number,
  newBlockOffset: number,
  containingInlineSize: number,
): LayoutBox {
  switch (box.type) {
    case "block":
      return createBlockBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize, box.metadata,
      );
    case "line":
      return createLineBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.baseline, containingInlineSize,
        box.ownerBlockId, box.inlineOffsetStart, box.inlineOffsetEnd,
        box.isBlockBoundaryLine,
        box.endsWithHyphenContinuation,
      );
    case "text-run":
      return createTextRunBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, box.offsetLength, containingInlineSize,
      );
    case "inline":
      return createInlineBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.fragmentEdge, box.ancestorKey, containingInlineSize,
      );
    case "inline-block":
      return createInlineBlockBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "marker":
      return createMarkerBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, containingInlineSize,
      );
    case "table":
      return createTableBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.columnPxWidths, containingInlineSize,
      );
    case "table-row":
      return createTableRowBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "table-cell":
      return createTableCellBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "page":
      return createPageBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.pageIndex, containingInlineSize,
        // Preserve the named header/footer slots across the reposition clone.
        box.headerSlot, box.footerSlot,
      );
  }
}

/**
 * Dev-mode invariant check: verify a layout box's physical fields match the
 * factory-derived `physicalFromLogical(...)` for its logical fields.
 *
 * This catches the spread-and-cast anti-pattern (e.g.
 * `Object.freeze({ ...box, y: 9999 })`) which leaves the matching logical
 * field stale — consumers reading logical vs physical positions then see
 * different geometry, causing silent rendering and hit-test bugs.
 *
 * The factories themselves construct boxes consistently. This helper is the
 * trap for code that bypasses the factories.
 *
 * Behavior:
 * - In dev mode (NODE_ENV !== "production"): throws a descriptive Error if
 *   the box is inconsistent.
 * - In production: no-op (the helper still runs but the assertion is gated).
 *
 * @param box the layout box to check.
 * @param containingInlineSize the inline-size of the box's containing
 *   block. Required to re-derive physical fields under RTL.
 */
export function assertLayoutBoxConsistent(
  box: LayoutBox,
  containingInlineSize: number,
): void {
  if (!isDevModeForBox()) return;
  const expected = logicalToPhysical(
    {
      inlineOffset: box.inlineOffset,
      blockOffset:  box.blockOffset,
      inlineSize:   box.inlineSize,
      blockSize:    box.blockSize,
    },
    box.writingMode, box.direction, containingInlineSize,
  );
  if (
    expected.x !== box.x ||
    expected.y !== box.y ||
    expected.width !== box.width ||
    expected.height !== box.height
  ) {
    throw new Error(
      `LayoutBox invariant violated for key="${box.key}" (type=${box.type}): ` +
      `physical fields {x:${box.x}, y:${box.y}, width:${box.width}, height:${box.height}} ` +
      `do not match logicalToPhysical {x:${expected.x}, y:${expected.y}, width:${expected.width}, height:${expected.height}}. ` +
      `This usually means the box was constructed via Object.freeze({ ...box, x/y }) ` +
      `instead of the factory or withInlineOffset / withBlockOffset / withOffsets helpers.`,
    );
  }
}

/**
 * Local copy of the dev-mode flag. Imported lazily to avoid pulling the
 * state module into the layout-box module's dependency graph at module
 * eval — the check is read once per assertion call and is cheap.
 */
function isDevModeForBox(): boolean {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process;
  return proc?.env?.NODE_ENV !== "production";
}

