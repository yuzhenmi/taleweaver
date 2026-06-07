// packages/core/src/layout/fragmentation.ts

import type { LayoutBox } from "./layout-box";
import type { BlockId } from "../state";

/**
 * Break-token continuation model. When a fragmentation-aware layout call
 * stops early because content didn't fit on the current fragment, it
 * returns a BreakToken describing where to resume. The next call (typically
 * for the next page) passes the token in via FragmentationContext.resumeFrom.
 *
 * BreakTokens are recursive: a BlockBreakToken's resumeChildToken carries
 * the inner FC's break state when a child was itself mid-fragment.
 */
export type BreakToken = BlockBreakToken | IFCBreakToken | TableBreakToken;

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
  /** The cell interior's break token — its content continues on the next fragment. */
  readonly interiorBreakToken: BreakToken;
}

export interface TableBreakToken {
  readonly type: "table";
  /** 0-based row index in the table BODY (excluding thead) at which to resume.
   * thead rows always repeat at the top of each fragment. */
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
 * Structural equality of two break tokens — the shared predicate the incremental
 * page-reuse gates (measure-pass, virtual-layout-tree) and resolve-footnotes use
 * to decide whether a fragment's resume state is unchanged. Single source of
 * truth (was triplicated). Recurses through block child tokens and, for table
 * tokens, compares `resumeAtRow` AND the `spanningCells` continuation list
 * (P8.S5) — two tables resuming at the same row but with different rowSpan
 * continuations are NOT equal, so a reuse gate cannot stale-reuse one for the other.
 */
export function breakTokensEqual(a: BreakToken | null, b: BreakToken | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.type === "block" && b.type === "block") {
    return a.resumeChildIndex === b.resumeChildIndex &&
      breakTokensEqual(a.resumeChildToken, b.resumeChildToken);
  }
  if (a.type === "ifc" && b.type === "ifc") return a.resumeAtLine === b.resumeAtLine;
  if (a.type === "table" && b.type === "table") {
    return a.resumeAtRow === b.resumeAtRow &&
      spanningCellsEqual(a.spanningCells, b.spanningCells);
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
