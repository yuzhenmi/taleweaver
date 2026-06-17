// packages/core/src/layout/fragmentation.ts

import type { LayoutBox } from "./layout-box";
import type { BlockId } from "@taleweaver/core";

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
}

/**
 * One `rowSpan > 1` cell whose origin is ABOVE the page break but whose spanned
 * rectangle extends INTO the rows resuming on the next fragment (CSS Tables
 * §17.5.3 × fragmentation, P8.S5). It carries the cell's grid placement (so the
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
   * `resumeAtRow`, extent reaching at/after it). OPTIONAL (P8.S5.T1): absent ⇒ no
   * spanning cell crosses the break (the only case before S5; keeps every existing
   * `{ type: "table", resumeAtRow }` construction valid with no broken-build
   * window). Consumers read `spanningCells ?? []`.
   */
  readonly spanningCells?: readonly SpanningCellContinuation[];
}

/**
 * Multi-column resume token (multi-column slice 2). Columns are an inline-axis
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
 * INERT until the slice-2 column-distribution loop emits these — added here
 * (union + `breakTokensEqual`) first so the LOAD-BEARING reuse gates
 * (measure-pass `canReusePage`, virtual-layout `PageFingerprint`) compare column
 * resume state correctly the moment the distribution loop lands. A missing
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
 * `spanningCells` continuation list (P8.S5) — two tables resuming at the same
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
    return a.resumeAtLine === b.resumeAtLine && a.paraFlowStart === b.paraFlowStart;
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
   * place — the section-page-break cap (C.2b-1). When set, `bfc.layoutBlock`
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
   * #528 cross-page float PUSHING opt-in. When `true`, the BFC float branch
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
 * P1.B doesn't honor recto/verso/left/right (need P1.C templates) or
 * column/region (no multi-column or named regions).
 */
export function normalizeBreakValue(raw: string): "auto" | "page" | "avoid" {
  if (raw === "page" || raw === "always") return "page";
  if (raw === "avoid" || raw === "avoid-page") return "avoid";
  return "auto";
}
