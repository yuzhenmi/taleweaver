import type { CompleteReserve } from "./complete-reserve";
// packages/core/src/layout/fragmentation.ts

import type { LayoutBox } from "./layout-box";
import type { BlockId } from "@taleweaver/core";
import type { PlacedFloat } from "./float-context";
import { placedFloatListsEqual } from "./float-lists-equal";

/**
 * Break-token continuation model. When a fragmentation-aware layout call
 * stops early because content didn't fit on the current fragment, it
 * returns a BreakToken describing where to resume. The next call (typically
 * for the next page) passes the token in via FragmentationContext.resumeFrom.
 *
 * BreakTokens are recursive: a BlockBreakToken's resumeChildToken carries
 * the inner FC's break state when a child was itself mid-fragment.
 */
export type BreakToken = BlockBreakToken | IFCBreakToken | TableBreakToken | ColumnBreakToken;

export interface BlockBreakToken {
  readonly type: "block";
  /** Index of the next child to lay out in the parent's children array. */
  readonly resumeChildIndex: number;
  /** If the child at resumeChildIndex was itself mid-fragmenting on the
   * previous fragment, this carries that child's break token. Null when
   * the child should be laid out fresh. */
  readonly resumeChildToken: BreakToken | null;
}

export interface IFCBreakToken {
  readonly type: "ifc";
  /** 0-based line index in the paragraph at which to resume emitting lines. */
  readonly resumeAtLine: number;
  /** Cumulative document-flow offset of the paragraph's FIRST line — a fixed
   *  property of where the paragraph began, carried across fragments so a later
   *  task can query floats at the line's TRUE cumulative offset. */
  readonly paraFlowStart: number;
  /**
   * R2-1: the float exclusions the paragraph's earlier lines wrapped around
   * (env frame, cumulative, cut at the break). The resumed fragment re-wraps
   * from line 0, so it seeds these for the re-wrap only — never painted, never
   * placed. Absent ≡ none.
   */
  readonly floats?: readonly PlacedFloat[];
}

/**
 * One `rowSpan > 1` cell whose origin is ABOVE the page break but whose spanned
 * rectangle extends INTO the rows resuming on the next fragment (CSS Tables
 * §17.5.3 × fragmentation). It carries the cell's grid placement (so the
 * resume can rebuild the occupied columns the post-break rows must route around)
 * plus its interior continuation (`interiorBreakToken`) — the cell's own content
 * fragmented at the break, the remainder laid out on the next fragment.
 */
export interface SpanningCellContinuation {
  readonly cellId: BlockId;
  readonly gridRow: number;
  readonly gridCol: number;
  readonly rowSpan: number;
  readonly colSpan: number;
  /**
   * The cell interior's break token — its remaining content continues on the next
   * fragment. NULL for the "empty spanned tail" case: the cell's content fit
   * entirely within the placed rows, but its merged box still spans rows that
   * resume on the next fragment (those rows were made tall by OTHER cells). The
   * continuation is still emitted so the resume knows columns
   * `[gridCol, gridCol+colSpan)` stay occupied for rows `[resumeAtRow, gridRow+rowSpan)`
   * — the post-break rows must route around them — even though there is no
   * interior left to lay out.
   */
  readonly interiorBreakToken: BreakToken | null;
}

export interface TableBreakToken {
  readonly type: "table";
  /** 0-based ABSOLUTE row index (counting all rows from 0) at which to resume;
   * header rows `[0, headerRowCount)` are re-emitted on each continuation but do
   * NOT advance this index. (`headerRowCount === 0` ⇒ no header repetition ⇒ this
   * is just the next body row, byte-identical to the pre-header behavior.) */
  readonly resumeAtRow: number;
  /**
   * Cells with `rowSpan > 1` whose rectangle straddles this break (origin before
   * `resumeAtRow`, extent reaching at/after it). OPTIONAL: absent ⇒ no
   * spanning cell crosses the break (keeps every plain
   * `{ type: "table", resumeAtRow }` construction valid). Consumers read `spanningCells ?? []`.
   */
  readonly spanningCells?: readonly SpanningCellContinuation[];
}

/**
 * Multi-column resume token. Columns are an inline-axis
 * fragmentation sub-axis nested inside page block-axis fragmentation: a page's
 * `MultiColumnBox` fills its column boxes left-to-right via the existing BFC
 * fill, and when the LAST column overflows the page is full. The remaining
 * content's resume state is wrapped in a `ColumnBreakToken` that becomes the
 * NEXT page's `MultiColumnBox` entry point.
 *
 * - `resumeColumnIndex` — the column at which to resume distributing on the next
 *   page (0-based; the column-distribution loop seeds from here). For a token
 *   that ends a page, the next page resumes at column 0; the index exists so a
 *   measure/getPage re-entry can target a specific column deterministically.
 * - `resumeChildToken` — the inner BFC token for the content that was mid-fill
 *   when the page filled (the same recursive nesting as `BlockBreakToken`'s
 *   `resumeChildToken`). Null when the resumed column starts a child fresh.
 *
 * Emitted by the column-distribution loop (`column-fit.ts`). The LOAD-BEARING
 * reuse gates (measure-pass `canReusePage`, virtual-layout `PageFingerprint`)
 * compare column resume state through `breakTokensEqual`. A missing
 * `"column"` arm would make every multicol page re-fit every keystroke.
 */
export interface ColumnBreakToken {
  readonly type: "column";
  /** 0-based column index at which to resume distribution on the next fragment. */
  readonly resumeColumnIndex: number;
  /** The inner BFC continuation for the column that was mid-fill, or null to
   * start the resumed column's content fresh. */
  readonly resumeChildToken: BreakToken | null;
}

/**
 * Unwrap a page-level resume token to the INNER BFC token that carries its
 * block-axis bookkeeping. For a multicol page the page's `resumeOut` is a
 * `ColumnBreakToken` whose `resumeChildToken` is the actual block/ifc/table/null
 * continuation; for a single-column page the token is already that inner token
 * (so this is the identity).
 *
 * The COLUMN token is what an entry stores and the page loop threads to the next
 * page (so the next multicol page unwraps it into the column distribution). But
 * the block-axis bookkeeping — `nextStartIndex`, `recordBlockMaps`, and the
 * page-reuse gates, which reason about which top-level child index the page
 * reached — must operate on the INNER BFC token: they check `.type === "block"`
 * to read `resumeChildIndex`, and a raw `ColumnBreakToken` would fall to their
 * `else` branches and compute WRONG values (e.g. `recordBlockMaps` would map ALL
 * remaining blocks onto this page). For single-column pages this is the identity
 * (the token has no `"column"` wrapper), so single-column behavior is unchanged.
 *
 * Shared by `measure-pass.ts` and `resolve-footnotes.ts` (the latter rewrites the
 * page plan after the measure pass and threads the same resume tokens).
 */
export function innerBfcToken(token: BreakToken | null): BreakToken | null {
  return token !== null && token.type === "column" ? token.resumeChildToken : token;
}

/**
 * Structural equality of two break tokens — the shared predicate the incremental
 * page-reuse gates (measure-pass, virtual-layout-tree) and resolve-footnotes use
 * to decide whether a fragment's resume state is unchanged. Single source of
 * truth (was triplicated). Recurses through block child tokens and column
 * child tokens, and for table tokens compares `resumeAtRow` AND the
 * `spanningCells` continuation list — two tables resuming at the same
 * row but with different rowSpan continuations are NOT equal, so a reuse gate
 * cannot stale-reuse one for the other.
 */
export function breakTokensEqual(a: BreakToken | null, b: BreakToken | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.type === "block" && b.type === "block") {
    return a.resumeChildIndex === b.resumeChildIndex &&
      breakTokensEqual(a.resumeChildToken, b.resumeChildToken);
  }
  if (a.type === "ifc" && b.type === "ifc") {
    return a.resumeAtLine === b.resumeAtLine && a.paraFlowStart === b.paraFlowStart &&
      placedFloatListsEqual(a.floats ?? [], b.floats ?? []);
  }
  if (a.type === "table" && b.type === "table") {
    return a.resumeAtRow === b.resumeAtRow &&
      spanningCellsEqual(a.spanningCells, b.spanningCells);
  }
  if (a.type === "column" && b.type === "column") {
    return a.resumeColumnIndex === b.resumeColumnIndex &&
      breakTokensEqual(a.resumeChildToken, b.resumeChildToken);
  }
  return false;
}

/** Element-wise equality of two spanning-cell continuation lists (absent ≡ empty). */
function spanningCellsEqual(
  a: readonly SpanningCellContinuation[] | undefined,
  b: readonly SpanningCellContinuation[] | undefined,
): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    const ca = aa[i];
    const cb = bb[i];
    if (ca === undefined || cb === undefined) return false;
    if (
      ca.cellId !== cb.cellId ||
      ca.gridRow !== cb.gridRow ||
      ca.gridCol !== cb.gridCol ||
      ca.rowSpan !== cb.rowSpan ||
      ca.colSpan !== cb.colSpan ||
      !breakTokensEqual(ca.interiorBreakToken, cb.interiorBreakToken)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Carried down the layout walk when pagination is active. When undefined,
 * layout runs in unpaginated mode and never returns a breakToken.
 */
export interface FragmentationContext {
  /** Block-axis space remaining on the current fragment (page). */
  readonly availableBlockSize: number;
  /** 0-based page index for diagnostics and the PageBox.pageIndex field. */
  readonly pageIndex: number;
  /** Resume state from the previous fragment, if any. Null on first attempt
   * for a fresh fragment. */
  readonly resumeFrom: BreakToken | null;
  /**
   * An EXCLUSIVE upper bound on the TOP-LEVEL child index this fragment may
   * place — the section-page-break cap. When set, `bfc.layoutBlock`
   * stops before placing the top-level child at this index, forcing a page
   * break there exactly as if that child had `break-before:page` (mirroring the
   * plan's `fitOnePage` `stopBeforeIndex` cap, so positioning agrees with the
   * page plan). TOP-LEVEL ONLY: it is never propagated into the child
   * `FragmentationContext`s the loop builds for nested containers / IFC leaves —
   * those are constructed fresh without it — so nested formatting contexts are
   * never capped. Undefined ⇒ no cap (the common, section-less case).
   */
  readonly stopBeforeIndex?: number;
  /**
   * Cross-page float PUSHING opt-in. When `true`, the BFC float branch
   * defers ("pushes") a float that does not fit the remaining page block-space
   * to the next page (the in-flow content keeps flowing). Set ONLY by the
   * VIRTUALIZED fast-path (`virtual-producer.ts` measure closure +
   * `virtual-layout-tree.ts` materialize), which threads the pushed floats to the
   * next page's landing placement. Left `undefined`/`false` by the legacy
   * `paginateRoot` path (a single persistent float env across pages, no per-page
   * carry to land a pushed float) — so floats there retain the documented
   * overflow behavior. Undefined ⇒ no pushing.
   */
  readonly enableFloatPushing?: boolean;
  /**
   * What must still fit after this box's content IF the box completes on this
   * fragmentainer: the end padding + border of the ancestors that complete with
   * it, plus an end margin they enclose (see `complete-reserve.ts`). Each
   * container hands it only to its LAST in-flow child. A fragment that breaks
   * ignores it. Lockstep with fit-core. Undefined ⇒ `NO_RESERVE`.
   */
  readonly completeReserve?: CompleteReserve;
  /**
   * Whether this flow starts its fragmentainer, so the margins before its first
   * content adjoin the break and truncate (CSS Fragmentation §5.2). bfc sets it
   * for each child flow (true only while nothing precedes it on the
   * fragmentainer); lockstep with fit-core. Undefined ⇒ true: the caller lays a
   * fragmentainer root (a page, column or region body).
   */
  readonly atFragmentainerStart?: boolean;
  /**
   * The call lays the root of a fragmentation flow (a page body, a multicol
   * column, a footnote body): its trailing end margin truncates at the
   * fragmentainer end (CSS Fragmentation §5.2), so it never pushes or breaks.
   * Not propagated to child flows.
   */
  readonly flowRoot?: boolean;
}

/**
 * The unified return shape for fragmentation-aware layout calls.
 *
 * - `{ box, breakToken: null }` — content fitted entirely.
 * - `{ box, breakToken }` — content fitted partially; remainder needs another fragment.
 * - `{ box: null, breakToken }` — couldn't fit anything on this fragment; parent
 *   should push the whole node to the next fragment.
 *
 * In the unpaginated path (no FragmentationContext passed), `box` is always
 * non-null and `breakToken` is always null.
 *
 * Generic on the box subtype so each FC's entry point can advertise the
 * specific kind of LayoutBox it produces:
 *   - `layoutBlock` returns `LayoutResult<BlockBox>`
 *   - `layoutInlineContent` returns `LayoutResult<BlockBox>` (a wrapping block of lines)
 *   - `layoutTable` returns `LayoutResult<TableBox>`
 *
 * Consumers get the narrow type for free — no per-call-site type guards
 * needed beyond the standard `if (result.box === null) throw` pattern.
 * Mirrors LayoutNG's typed-fragment model, where each layout phase produces
 * fragments specific to its layout kind.
 */
export interface LayoutResult<T extends LayoutBox = LayoutBox> {
  readonly box: T | null;
  readonly breakToken: BreakToken | null;
  /** In-flow block-size consumed by THIS flow on this page (gapless; EXCLUDES
   *  out-of-flow floats). Float-coherent pagination reads this, NOT `box.blockSize`
   *  (= Math.max(inFlow, lowestFloatBlockEdge+padding), inflated by an overflowing
   *  float). 0 for a null box. */
  readonly inFlowConsumed: number;
}

/**
 * Normalize a CSS break-* property value to the three values BFC actually
 * consumes: "auto", "page", or "avoid".
 *
 * Mapping rules:
 *   "always" → "page" (synonym in pagination context)
 *   "avoid-page" → "avoid"
 *   "page", "auto", "avoid" → unchanged
 *   anything else (recto/verso/left/right/column/region/avoid-column/avoid-region/garbage) → "auto"
 *
 * Recto/verso/left/right (no left/right page templates) and column/region are
 * not honored.
 */
export function normalizeBreakValue(raw: string): "auto" | "page" | "avoid" {
  if (raw === "page" || raw === "always") return "page";
  if (raw === "avoid" || raw === "avoid-page") return "avoid";
  return "auto";
}

/**
 * True when a resume-token chain ultimately says "start from the
 * beginning at every level": the chain is null, or each block-typed
 * level resumes at child 0 with a degenerate inner token, or the
 * terminal IFC level resumes at line 0. Used by the paginated-mode
 * cache reuse check — a cached complete-block layout is
 * a valid reuse target only when the requested call doesn't have
 * partial mid-fragmentation state to honor.
 *
 * Note: `{block, resumeChildIndex:0, resumeChildToken:{ifc, resumeAtLine:0}}`
 * is classified as degenerate because the CSS Fragmentation L4 §3.5
 * overflow rule guarantees the first
 * child always fits on a fragment — if it can't fit, the rule re-
 * invokes layout without fragmentation and accepts the overflowing
 * box. A token at child-0/line-0 can therefore only arise from a
 * full-layout round-trip in practice, not from a genuine mid-
 * fragmentation state. If the overflow rule ever changes (or a future FC introduces
 * a different overflow rule), revisit this case — a non-degenerate
 * `{idx:0, line:0}` token could silently win cache reuse and emit a
 * complete-block layout where a partial-fragment was expected.
 */
export function isResumeFromDegenerate(rf: BreakToken | null): boolean {
  if (rf === null) return true;
  if (rf.type === "ifc") return rf.resumeAtLine === 0;
  if (rf.type === "block") {
    return rf.resumeChildIndex === 0 && isResumeFromDegenerate(rf.resumeChildToken);
  }
  // Other types (table) — be conservative.
  return false;
}
