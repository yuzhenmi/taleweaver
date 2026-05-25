// packages/core/src/layout/fragmentation.ts

import type { LayoutBox } from "./layout-box-v2";

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

export interface TableBreakToken {
  readonly type: "table";
  /** 0-based row index in the table BODY (excluding thead) at which to resume.
   * thead rows always repeat at the top of each fragment. */
  readonly resumeAtRow: number;
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
