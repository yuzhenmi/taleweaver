import type { ComputedStyle, UsedStyle, StackingContextRole } from "@taleweaver/core";
import { computeStackingContextRole } from "@taleweaver/core";
import type { LeaderStyle } from "@taleweaver/core";
import type { WritingMode, Direction } from "@taleweaver/core";
import { logicalToPhysical } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { LayoutBoxMetadata } from "@taleweaver/core";
import type { PageBox } from "./page-box";
import { createPageBox } from "./page-box";
import type { ColumnRule } from "@taleweaver/core";
import { isDevMode } from "@taleweaver/core";
export type { PageBox } from "./page-box";

export type LayoutBox = BlockBox | LineBox | TextRunBox | InlineBox | InlineBlockBox | MarkerBox | TableBox | TableRowBox | TableCellBox | MultiColumnBox | PageBox;

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

  // POSITIONING — `position: relative` PAINT-TIME visual offset (positioning
  // slice 2). The box's logical/physical geometry (inlineOffset/blockOffset/x/y)
  // stays PRE-OFFSET; this PHYSICAL `(dx, dy)` delta — resolved in the BFC from
  // the box's `inset*` against its containing block, mapped logical→physical —
  // is added by the painter to the box's accumulated `(absX, absY)`, shifting
  // the box AND its descendants together. Omitted (undefined) when the box is
  // not `position: relative` or resolves to a zero offset, keeping the
  // untransformed fast path allocation- and read-free. Lives on the base (not
  // just BlockBox) so the clone paths thread it uniformly across box types
  // (an inline-block can also be `position: relative` — IFC path is a follow-up).
  readonly relativeOffset?: { readonly dx: number; readonly dy: number };

  // POSITIONING slice 3 — `position: absolute` descendants whose absolute
  // containing block is THIS box. Out-of-flow: they are NOT in `children` (they do
  // not advance the in-flow block offset and do not participate in margin
  // collapse). The BFC drains them in its post-loop second pass at the box that
  // ESTABLISHES their abc (this box), laid out at their resolved inset position in
  // THIS box's coordinate frame. The painter recurses them with the SAME parent
  // origin (absX/absY, incl. any relativeOffset) it uses for `children`, and
  // `collectLineBoxes` likewise descends them so their lines enter the flat
  // LineIndex (reachable by hit-test / cursor / selection / line-nav). Omitted
  // (undefined) when no abs-pos descendant resolves against this box — the common
  // case — so the un-positioned fast path is read-free. Lives on the base (not
  // just BlockBox) because abc-establishment can occur on inline-block / table
  // boxes too; optional → inert on box types that never carry it.
  readonly absoluteChildren?: readonly LayoutBox[];

  // POSITIONING slice 4 — whether this box establishes its own CSS stacking
  // context (CSS 2.2 §9.9 / Positioned Layout 3). Two-valued: `"self"` when it
  // does, ABSENT (undefined) otherwise — "none" is the field's absence. Computed
  // DETERMINISTICALLY from this box's `computedStyle` by `createBoxBase` (a
  // POSITIONED box with a non-`auto` z-index, OR `opacity < 1`, OR a non-empty
  // `transform`), so every factory and every clone/rebuild path that re-runs the
  // factory with the same `computedStyle` carries it automatically — no separate
  // threading, no clone-drop risk. The painter reads it to detect stacking-context
  // boundaries and paint such a box ATOMICALLY at its z-position (CSS §E.2).
  // `undefined` for the overwhelmingly common unpositioned / auto-z / opaque /
  // untransformed box keeps the §E.2 reorder gate off and the common paint path
  // byte-identical.
  readonly stackingContextRole?: StackingContextRole;
}

export interface BlockBox extends LayoutBoxBase {
  readonly type: "block";
  readonly children: readonly LayoutBox[];
  readonly metadata?: Readonly<LayoutBoxMetadata>;
  /**
   * The gapless in-flow block-size this BFC's flow consumed (EXCLUDES
   * out-of-flow floats). Mirrors `LayoutResult.inFlowConsumed`, carried ON THE
   * BOX so the layout-box cache can read it back EXACTLY after the original
   * in-flow scalar is gone (`buildLayoutBoxCacheFromTree`).
   *
   * `blockSize` is `Math.max(inFlowBlockSize, lowestFloatBlockEdge + paddingBlockEnd)`,
   * so a box enclosing a float TALLER than its in-flow content has
   * `blockSize > inFlowConsumed`. Stamped only at the `bfc.layoutBlock` full /
   * partial-fragment return sites (and threaded verbatim through the
   * reposition-clone paths). ABSENT (undefined) for every other BlockBox — IFC
   * line containers, table inner boxes, the reposition-clone of a box that
   * never carried it — where no float is enclosed and the value equals
   * `blockSize` by construction; consumers read `inFlowConsumed ?? blockSize`.
   */
  readonly inFlowConsumed?: number;
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
  /**
   * Per-state-code-unit count of DISPLAY code units this run renders, used
   * by length-changing CSS `text-transform` (e.g. `ß` → `SS`, where one
   * state code unit maps to two display code units). `undefined` when the
   * run's display length equals its state length 1:1 (the common case).
   *
   * Pure code-unit counts — geometry-independent — so the alignment-shift
   * and bidi-reorder rebuild passes copy it through verbatim.
   */
  readonly sourceDisplayLengths?: readonly number[];
  /**
   * Per DISPLAY UTF-16 code unit of `text`, the inline advance that code unit
   * contributes. Interior code units of a multi-unit grapheme carry 0 (the
   * full advance is attributed to the grapheme's FIRST code unit) — the SAME
   * partition as `sourceDisplayLengths`. Whitespace tokens that carry no
   * token-level cluster widths are synthesized here (whole advance on the
   * first unit, 0 on the rest) so the partition stays display-aligned.
   *
   * Used by the P4-C bidi reorder to SPLIT a run at a bidi-level boundary
   * (the prefix advance is the prefix-sum of these). The ONLY hard invariant is
   * `clusterWidths.length === text.length` (when present).
   *
   * These are NATURAL per-unit advances. They normally sum to `inlineSize`, but
   * a width-REDUCING rebuild does NOT adjust them: a trailing-letter-spacing
   * trim (`inlineSize - trim`) and a hung/overflowing-space clamp leave
   * `sum(clusterWidths) > inlineSize`. So a consumer that splits a run must
   * RECONCILE the prefix-sum against the box's actual `inlineSize` (e.g. clamp
   * the trailing fragment to `inlineSize`), NOT assume the sum equals it. Being
   * geometry-independent of the trim/clamp, they copy through rebuilds verbatim
   * (like `sourceDisplayLengths`).
   */
  readonly clusterWidths?: readonly number[];
  /**
   * The box's absolute UTF-16 offset into the paragraph source (`asm.source`),
   * i.e. the `absoluteSourceBase` of its first constituent token. The P4-C
   * reorder uses it to compute each split fragment's absolute source span.
   * Undefined for synthetic runs with no backing source (the empty-paragraph
   * strut).
   */
  readonly sourceStart?: number;
  /**
   * The run's resolved UAX #9 bidi embedding level (even = LTR, odd = RTL).
   * Stamped by the P4-C line reorder (`reorderLineLeaves`) so the painter can
   * render an RTL run right-to-left. `undefined` for any box the reorder did
   * not touch (the overwhelmingly common LTR-only case).
   */
  readonly bidiLevel?: number;
  /**
   * The hyperlink URL this run belongs to (the source inline item's `link` attr),
   * threaded for export consumers (PDF /Link annotations). Per-run IDENTITY metadata
   * — OPAQUE to geometry (never affects measurement, breaking, or position); copied
   * verbatim through every reorder/reposition/hyphen rebuild, like `sourceStart`.
   * Each run is wholly inside one link or none (the IFC builds one run per render text
   * node, and a linked item is its own text node). `undefined` for runs with no link.
   */
  readonly link?: string;
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
  /**
   * The absolute UTF-16 offset into the paragraph source of this inline-block's
   * single OBJECT_REPLACEMENT char (its `absoluteSourceBase`). Used by the
   * P4-C bidi reorder to position the atomic box's source span.
   */
  readonly sourceStart?: number;
  /**
   * The atomic inline's resolved UAX #9 bidi embedding level (even = LTR, odd
   * = RTL). Stamped by the P4-C line reorder (`reorderLineLeaves`); `undefined`
   * for any box the reorder did not touch.
   */
  readonly bidiLevel?: number;
  /**
   * Present only on a `"tab"` embed's inline-block (tab stops S2). Carries the
   * embed-kind discriminator plus the resolved tab-leader style so the painter
   * (S9) and the advance pass (S3) can recognize a tab without re-deriving it
   * from render metadata. In S2 `leader` is always `"none"` (the placeholder);
   * S3 resolves the real destination-stop leader when it computes the advance.
   */
  readonly inlineMeta?: { readonly embedType: "tab"; readonly leader: LeaderStyle };
  /**
   * The cross-reference target block id this atom points to (the source render
   * node's `metadata.targetId`), threaded for the PDF exporter to emit an
   * internal /GoTo link. Per-box IDENTITY metadata — OPAQUE to geometry (never
   * affects measurement, breaking, or position); copied verbatim through every
   * rebuild, like `sourceStart`/`inlineMeta`. `undefined` for any inline-block
   * that is not a cross-reference atom. (Mirrors `TextRunBox.link` (#521), for a
   * different box type.)
   */
  readonly targetId?: string;
  /**
   * Marks a REPLACED inline-block (e.g. an inline image — an atomic box with no
   * in-flow text/line boxes). A replaced inline-block aligns its BOTTOM margin
   * edge with the parent's baseline (CSS2 §10.8.1); a text-bearing inline-block
   * uses the content-baseline (`*0.8`) rule. Per-box IDENTITY metadata — OPAQUE
   * to geometry except for that baseline choice; copied verbatim through every
   * rebuild, like `targetId`/`sourceStart`/`inlineMeta`. `undefined` for a
   * non-replaced inline-block.
   */
  readonly isReplaced?: boolean;
}

export interface MarkerBox extends LayoutBoxBase {
  readonly type: "marker";
  readonly text: string;
  /**
   * The marker's resolved UAX #9 bidi embedding level (even = LTR, odd = RTL).
   * Stamped by the P4-C line reorder (`reorderLineLeaves`) when a marker is
   * defensively carried through it; `undefined` otherwise.
   */
  readonly bidiLevel?: number;
}

/** A table cell's placement in the table grid (P8 rowSpan/colSpan). */
export interface TableCellGrid {
  readonly gridRow: number;
  readonly gridCol: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

export interface TableBox extends LayoutBoxBase {
  readonly type: "table";
  readonly children: readonly LayoutBox[];
  readonly columnPxWidths: readonly number[];
  /**
   * `occupancy[row][col]` = the owning cell's id, or `null` for an empty slot
   * (P8). The reverse map a point/selection uses to find the merged cell that
   * owns a grid slot — a spanning cell's box lives only in its first row's
   * children, so lower rows' slots resolve here. Rectangular (`columnCount` wide).
   */
  readonly occupancy: readonly (readonly (BlockId | null)[])[];
  readonly columnCount: number;
  /** cell id → its box, for O(1) reverse lookup from `occupancy` (P8). */
  readonly cellBoxById: ReadonlyMap<BlockId, TableCellBox>;
}

export interface TableRowBox extends LayoutBoxBase {
  readonly type: "table-row";
  readonly children: readonly LayoutBox[];
}

export interface TableCellBox extends LayoutBoxBase, TableCellGrid {
  readonly type: "table-cell";
  readonly children: readonly LayoutBox[];
}

/**
 * A multi-column section's body region (multi-column slice 2). A CONTAINER box
 * whose children are N **column boxes** (each a `BlockBox`), positioned side by
 * side, each holding a CONTIGUOUS doc-order run of the section's content
 * (fragmented into it). Its own variant — like `TableBox` — because it carries
 * distinct paint (column-rule), hit-test (the column-X filter), and
 * fragmentation (column distribution) semantics.
 *
 * VISUAL-ORDER GUARANTEE: because each column holds a contiguous doc-order run,
 * a depth-first walk descending `columns` LEFT-TO-RIGHT emits lines in visual
 * reading order (column-0's lines, then column-1's, …). So `collectLineBoxes`
 * needs NO reorder — it just descends `columns` in order. Which column a line
 * belongs to is recoverable geometrically (its `absoluteX` falls within the
 * column box's inline range), exactly as the column-aware hit-test picks one.
 *
 * The field is named `columns` (NOT `children`) so the type makes the per-column
 * grouping explicit; every generic box-walking concern descends `columns` exactly
 * as a `children`-bearing container descends `children`.
 */
export interface MultiColumnBox extends LayoutBoxBase {
  readonly type: "multicolumn";
  readonly columns: readonly BlockBox[];
  /**
   * The line-between (CSS `column-rule`) painted in each gap between adjacent
   * columns, or `null` for no rule. Threaded from the section's resolved
   * `ColumnConfig.columnRule`; the painter draws it centered in each inter-column
   * gap, spanning this box's block extent.
   */
  readonly columnRule: ColumnRule | null;
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
  readonly relativeOffset?: { readonly dx: number; readonly dy: number };
  readonly absoluteChildren?: readonly LayoutBox[];
  readonly stackingContextRole?: StackingContextRole;
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
  // POSITIONING — `position: relative` physical paint-time offset (slice 2).
  // Omitted when the box is not relatively positioned or resolves to (0, 0);
  // the painter then takes the no-offset fast path.
  relativeOffset?: { readonly dx: number; readonly dy: number };
  // POSITIONING slice 3 — abs-pos descendants whose abc is this box (out-of-flow;
  // drained by the BFC second pass). Omitted when there are none.
  absoluteChildren?: readonly LayoutBox[];
  // Only consulted for vertical-rl, where the physical block-axis x is the
  // right-to-left mirror `containingBlockSize − blockOffset − blockSize`. The
  // box factory does not have this at construction time (the containing block
  // size is layout's OUTPUT), so it stays undefined there and the un-mirrored
  // PENDING x is stored; the P3.1 physicalize pass re-runs the factory with the
  // resolved size to bake the mirror. h-tb / v-lr ignore it (factory-derivable).
  containingBlockSize?: number;
}): BoxBaseFields {
  const phys = logicalToPhysical(
    {
      inlineOffset: args.inlineOffset,
      blockOffset:  args.blockOffset,
      inlineSize:   args.inlineSize,
      blockSize:    args.blockSize,
    },
    args.writingMode, args.direction, args.containingInlineSize,
    args.containingBlockSize,
  );
  const stackingContextRole = computeStackingContextRole(args.computedStyle);
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
    ...(args.relativeOffset !== undefined
      ? { relativeOffset: Object.freeze({ ...args.relativeOffset }) }
      : {}),
    ...(args.absoluteChildren !== undefined
      ? { absoluteChildren: Object.freeze([...args.absoluteChildren]) }
      : {}),
    // POSITIONING slice 4 — stacking-context role is a pure function of this box's
    // computedStyle, computed HERE so every factory and clone/rebuild path picks it
    // up uniformly (the field is never threaded as a constructor arg → it can never
    // be dropped on a clone). Spread only when "self" so the common unpositioned box
    // omits the field entirely (keeping the painter's reorder gate off).
    ...(stackingContextRole !== undefined ? { stackingContextRole } : {}),
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
  metadata?: Readonly<LayoutBoxMetadata>,
  containingBlockSize?: number,
  relativeOffset?: { readonly dx: number; readonly dy: number },
  absoluteChildren?: readonly LayoutBox[],
  inFlowConsumed?: number,
): BlockBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize, relativeOffset, absoluteChildren,
  });
  return Object.freeze({
    type: "block" as const,
    ...base,
    children: Object.freeze([...children]),
    ...(metadata !== undefined ? { metadata: Object.freeze({ ...metadata }) } : {}),
    ...(inFlowConsumed !== undefined ? { inFlowConsumed } : {}),
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
  containingBlockSize?: number,
): LineBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize,
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
  sourceDisplayLengths?: readonly number[],
  clusterWidths?: readonly number[],
  sourceStart?: number,
  bidiLevel?: number,
  containingBlockSize?: number,
  link?: string,
): TextRunBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize,
  });
  return Object.freeze({
    type: "text-run" as const,
    ...base,
    text,
    offsetLength,
    sourceDisplayLengths,
    clusterWidths,
    sourceStart,
    bidiLevel,
    link,
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
  containingBlockSize?: number,
): InlineBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize,
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
  sourceStart?: number,
  bidiLevel?: number,
  containingBlockSize?: number,
  inlineMeta?: { readonly embedType: "tab"; readonly leader: LeaderStyle },
  relativeOffset?: { readonly dx: number; readonly dy: number },
  targetId?: string,
  isReplaced?: boolean,
): InlineBlockBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize, relativeOffset,
  });
  return Object.freeze({
    type: "inline-block" as const,
    ...base,
    children: Object.freeze([...children]),
    sourceStart,
    bidiLevel,
    inlineMeta,
    targetId,
    isReplaced,
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
  bidiLevel?: number,
  containingBlockSize?: number,
): MarkerBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize,
  });
  return Object.freeze({
    type: "marker" as const,
    ...base,
    text,
    bidiLevel,
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
  grid: { readonly occupancy: readonly (readonly (BlockId | null)[])[]; readonly columnCount: number },
  containingInlineSize: number,
  containingBlockSize?: number,
): TableBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize,
  });
  // O(1) reverse lookup from an occupancy id → its cell box (P8). A spanning
  // cell's box lives only in its first row's children, so we walk rows→cells.
  const cellBoxById = new Map<BlockId, TableCellBox>();
  for (const row of children) {
    if (row.type !== "table-row") continue;
    for (const cell of row.children) {
      if (cell.type === "table-cell") cellBoxById.set(cell.key as BlockId, cell);
    }
  }
  return Object.freeze({
    type: "table" as const,
    ...base,
    children: Object.freeze([...children]),
    columnPxWidths: Object.freeze([...columnPxWidths]),
    occupancy: Object.freeze(grid.occupancy.map((r) => Object.freeze([...r]))),
    columnCount: grid.columnCount,
    cellBoxById: Object.freeze(cellBoxById),
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
  containingBlockSize?: number,
): TableRowBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize,
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
  grid: TableCellGrid,
  containingInlineSize: number,
  containingBlockSize?: number,
): TableCellBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize,
  });
  return Object.freeze({
    type: "table-cell" as const,
    ...base,
    children: Object.freeze([...children]),
    gridRow: grid.gridRow,
    gridCol: grid.gridCol,
    rowSpan: grid.rowSpan,
    colSpan: grid.colSpan,
  });
}

/**
 * Multi-column slice 2 — assemble a `MultiColumnBox` from its already-built
 * column boxes. Mirrors `createTableBox`: logical-axis args + `containingInlineSize`
 * (for the RTL inline-axis inversion in `logicalToPhysical`), runs the shared base
 * factory, and `Object.freeze`s the output. The producer (a later slice) positions
 * each column box at its inline-offset and passes them in here; this factory just
 * freezes the assembled container.
 */
export function createMultiColumnBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,
  columns: readonly BlockBox[],
  columnRule: ColumnRule | null,
  containingInlineSize: number,
  containingBlockSize?: number,
): MultiColumnBox {
  const base = createBoxBase({
    key, inlineOffset, blockOffset, inlineSize, blockSize,
    writingMode, direction, computedStyle, usedStyle, containingInlineSize,
    containingBlockSize,
  });
  return Object.freeze({
    type: "multicolumn" as const,
    ...base,
    columns: Object.freeze([...columns]),
    columnRule,
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
 * Recreate a reorder-reachable leaf/inline box at a PHYSICAL (visual-order)
 * inline offset — its positioning `direction` is forced to `"ltr"` so
 * `logicalToPhysical` is the IDENTITY and `x === inlineOffset`. Used by the
 * P4-C bidi reorder (`reorderLineLeaves` / `renestLeaves` /
 * `splitTextRunBoxAtOffset`), which emits boxes already in physical
 * (left-to-right) order: a second uniform RTL flip by the factory would invert
 * them (the double-flip bug).
 *
 * The box's true directionality is NOT lost — it rides on `computedStyle.direction`
 * (the CSS property, preserved unchanged) and, for leaves, on `bidiLevel` (stamped
 * by the reorder for T7 glyph paint). This is the deliberate three-way split
 * documented in the P4-C reorder coordinate contract: positioning `direction`
 * on a reordered box means "offsets are already physical/visual", while
 * `computedStyle.direction` / `bidiLevel` carry the real RTL-ness.
 *
 * Only the reorder-reachable box types are handled (`text-run` / `inline` /
 * `inline-block` / `marker`); the reorder never repositions a container/line/page
 * box, so passing one is a programmer error and throws.
 *
 * @param containingInlineSize the box's containing-block inline-size — passed to
 *   the factory for parity with the rest of the line (the ltr identity makes it
 *   irrelevant to the derived `x`, but the factory still records it via
 *   `usedStyle`/children parity).
 */
export function withPhysicalInlineOffset(
  box: LayoutBox,
  newInlineOffset: number,
  containingInlineSize: number,
): LayoutBox {
  switch (box.type) {
    case "text-run":
      return createTextRunBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, "ltr", box.computedStyle, box.usedStyle,
        box.text, box.offsetLength, containingInlineSize, box.sourceDisplayLengths,
        box.clusterWidths, box.sourceStart, box.bidiLevel,
        /* containingBlockSize (was omitted → undefined) */ undefined, box.link,
      );
    case "inline":
      return createInlineBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, "ltr", box.computedStyle, box.usedStyle,
        box.children, box.fragmentEdge, box.ancestorKey, containingInlineSize,
      );
    case "inline-block":
      return createInlineBlockBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, "ltr", box.computedStyle, box.usedStyle,
        box.children, containingInlineSize, box.sourceStart, box.bidiLevel,
        /* containingBlockSize */ undefined, box.inlineMeta, box.relativeOffset,
        box.targetId, box.isReplaced,
      );
    case "marker":
      return createMarkerBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, "ltr", box.computedStyle, box.usedStyle,
        box.text, containingInlineSize, box.bidiLevel,
      );
    default:
      throw new Error(
        `withPhysicalInlineOffset: box type ${JSON.stringify(box.type)} (key=${box.key}) is ` +
          "not reorder-reachable; only text-run / inline / inline-block / marker boxes are repositioned by the bidi reorder.",
      );
  }
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

/**
 * Recreate a leaf layout box with its UAX #9 bidi embedding `level` set. Used by
 * the P4-C line reorder (`reorderLineLeaves`) to stamp each reordered run with
 * its resolved level (even = LTR, odd = RTL) so the painter can render an RTL
 * run right-to-left.
 *
 * Only the three reorder-reachable LEAF types carry `bidiLevel`
 * (`text-run` / `inline-block` / `marker`); the reorder never stamps a
 * container or page box, so passing one is a programmer error and throws.
 * Geometry is preserved (offsets unchanged); physical `x` / `y` are re-derived
 * by the factory, so the logical↔physical invariant holds.
 *
 * @param containingInlineSize the box's containing-block inline-size (used for
 *   RTL physical-x derivation; same value passed to the original factory).
 */
export function withBidiLevel(
  box: LayoutBox,
  level: number,
  containingInlineSize: number,
): LayoutBox {
  switch (box.type) {
    case "text-run":
      return createTextRunBox(
        box.key, box.inlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, box.offsetLength, containingInlineSize, box.sourceDisplayLengths,
        box.clusterWidths, box.sourceStart, level,
        /* containingBlockSize (was omitted → undefined) */ undefined, box.link,
      );
    case "inline-block":
      return createInlineBlockBox(
        box.key, box.inlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize, box.sourceStart, level,
        /* containingBlockSize */ undefined, box.inlineMeta, box.relativeOffset,
        box.targetId, box.isReplaced,
      );
    case "marker":
      return createMarkerBox(
        box.key, box.inlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, containingInlineSize, level,
      );
    default:
      throw new Error(
        `withBidiLevel: box type ${JSON.stringify(box.type)} (key=${box.key}) does not ` +
          "carry a bidiLevel; only text-run / inline-block / marker leaves are reordered.",
      );
  }
}

/**
 * Recreate a layout box with new inline + block offsets, optionally baking the
 * vertical-rl block-axis physical-x mirror.
 *
 * EXPORTED (P3.1) so the `physicalizeVertical` post-layout pass can re-run the
 * box factory once the containing block-size is resolved: for `vertical-rl` the
 * factory could not compute the block-axis mirror at construction time (the
 * containing block-size is layout's OUTPUT), so it stored a PENDING un-mirrored
 * x; this rebuild bakes `x = containingBlockSize − blockOffset − blockSize` when
 * `containingBlockSize` is supplied. `containingBlockSize` is consulted ONLY for
 * `vertical-rl`; for `horizontal-tb` / `vertical-lr` the physical fields are
 * fully factory-derivable and the param is ignored (byte-identical).
 *
 * The 3 offset-only callers (`withInlineOffset` / `withBlockOffset` /
 * `withOffsets`) pass nothing → `containingBlockSize` defaults to undefined →
 * the v-rl box keeps its PENDING x exactly as before (behavior unchanged).
 *
 * A `page` box's OWN frame coords are page-placement, assigned by pagination,
 * and are NEVER writing-mode-mirrored (only the page CONTENT is) — so the `page`
 * case does NOT thread `containingBlockSize`; the physicalize pass mirrors a
 * page's content/slots separately, not its frame.
 *
 * @param containingBlockSize the box's containing-block block-size, for the
 *   v-rl block-axis mirror. Omit (undefined) to keep the PENDING un-mirrored x.
 */
export function rebuildBoxWithOffsets(
  box: LayoutBox,
  newInlineOffset: number,
  newBlockOffset: number,
  containingInlineSize: number,
  containingBlockSize?: number,
): LayoutBox {
  switch (box.type) {
    case "block":
      return createBlockBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize, box.metadata, containingBlockSize,
        box.relativeOffset,
        // Preserve abs-pos children across the reposition clone (slice 3): they
        // are positioned in this box's OWN frame (parent-relative), independent of
        // the outer (inlineOffset, blockOffset) reposition, so they carry through
        // verbatim — a dropped clone would lose the abs subtree entirely.
        box.absoluteChildren,
        // Preserve the in-flow-consumed scalar (intrinsic to the box's content,
        // independent of the reposition) so the cache stays exact after a clone.
        box.inFlowConsumed,
      );
    case "line":
      return createLineBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.baseline, containingInlineSize,
        box.ownerBlockId, box.inlineOffsetStart, box.inlineOffsetEnd,
        box.isBlockBoundaryLine,
        box.endsWithHyphenContinuation, containingBlockSize,
      );
    case "text-run":
      return createTextRunBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, box.offsetLength, containingInlineSize, box.sourceDisplayLengths,
        box.clusterWidths, box.sourceStart, box.bidiLevel, containingBlockSize, box.link,
      );
    case "inline":
      return createInlineBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.fragmentEdge, box.ancestorKey, containingInlineSize,
        containingBlockSize,
      );
    case "inline-block":
      return createInlineBlockBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize, box.sourceStart, box.bidiLevel,
        containingBlockSize, box.inlineMeta, box.relativeOffset,
        box.targetId, box.isReplaced,
      );
    case "marker":
      return createMarkerBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, containingInlineSize, box.bidiLevel, containingBlockSize,
      );
    case "table":
      return createTableBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.columnPxWidths,
        { occupancy: box.occupancy, columnCount: box.columnCount },
        containingInlineSize, containingBlockSize,
      );
    case "table-row":
      return createTableRowBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize, containingBlockSize,
      );
    case "table-cell":
      return createTableCellBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children,
        { gridRow: box.gridRow, gridCol: box.gridCol, rowSpan: box.rowSpan, colSpan: box.colSpan },
        containingInlineSize, containingBlockSize,
      );
    case "multicolumn":
      // Reposition the container at the new offsets; the column boxes are
      // PARENT-RELATIVE (positioned in this box's own frame), so they carry
      // through verbatim — exactly as the `table` arm carries `children`. A
      // dropped column would lose that column's whole content subtree.
      return createMultiColumnBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.columns, box.columnRule, containingInlineSize, containingBlockSize,
      );
    case "page":
      // The page FRAME is never writing-mode-mirrored (page placement is
      // assigned by pagination; only the page CONTENT is mirrored, by the
      // physicalize pass). So `containingBlockSize` is deliberately NOT threaded.
      return createPageBox(
        box.key, newInlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.pageIndex, containingInlineSize,
        // Preserve the named header/footer/footnote slots across the reposition clone.
        box.headerSlot, box.footerSlot, box.footnoteSlot,
        // Preserve the #332 region-classification edges across the clone.
        box.effectiveTopInset, box.effectiveBottomInset,
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
  if (!isDevMode()) return;
  // vertical-rl stores an un-mirrored block-axis x at factory time (the
  // containing block-size is not available there). The P3.1 physicalize pass
  // applies the right-to-left mirror once the containing size is known, so the
  // block-axis consistency check is meaningless here — skip it. v-lr and h-tb
  // are fully derivable at factory time and stay checked.
  if (box.writingMode === "vertical-rl") return;
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

