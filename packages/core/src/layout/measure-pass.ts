// packages/core/src/layout/measure-pass.ts
//
// The measure pass (virtualized-layout Phase 1). Given the top-level
// `BlockFitMeta[]` for a document and a `PageConfig`, repeatedly invoke the
// pure `fitOnePage` to compute a `PagePlan`: which top-level children land on
// each page, each page's document-y offset, the resume tokens INTO / OUT of
// each page, and the per-page ordered-list counter seed. No box allocation —
// the plan is plain data; the positioned `PageBox`es are materialized lazily
// in a later phase.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase1.md

import type { RenderNode, ElementBox } from "../render/render-node";
import type { BreakToken } from "./fragmentation";
import type { BlockFitMeta } from "./fit-core";
import { fitOnePage } from "./fit-core";
import type { PageConfig } from "./page-config";
import { groupChildren } from "./group-children";
import type { ComputedLength } from "../styles/length";

/** One page's boundary decision (plain data; no positioned boxes). */
export interface PagePlanEntry {
  readonly pageIndex: number;
  /** Document-y of this page's top edge. */
  readonly blockOffset: number;
  /** Page block-size (constant per config). */
  readonly blockSize: number;
  /** Cascaded top-level child references that begin/continue on this page. */
  readonly children: readonly RenderNode[];
  /** Index of the first top-level child on this page (into the doc's children). */
  readonly startIndex: number;
  /** Resume state INTO this page; `null` ⇒ a fresh page boundary. */
  readonly resumeInto: BreakToken | null;
  /** Resume state OUT of this page; `null` ⇒ this is the last page. */
  readonly resumeOut: BreakToken | null;
  /** Ordered-list counter value seeding this page's markers. */
  readonly listCounterAtStart: number;
}

/** The document's full pagination plan. */
export interface PagePlan {
  readonly entries: readonly PagePlanEntry[];
  /** Total document height (page count × page block-size + gaps). */
  readonly totalBlockSize: number;
  readonly pageInlineSize: number;
}

/**
 * Compute the `PagePlan` for a document from its top-level block metas. Pure;
 * allocation-free apart from the plan structure itself.
 *
 * First-on-fragment top margins are handled entirely by the CSS Fragmentation
 * §5.4 truncation inside `fitOnePage` (the first child of every fragment has
 * its top margin zeroed). In the paginated path — the only mode the measure
 * pass runs in — that truncation runs BEFORE bfc's `noTopBoundary` first-child
 * suppression, so the latter is always a no-op; we do not model it here.
 */
export function measurePass(
  metas: readonly BlockFitMeta[],
  pageConfig: PageConfig,
  rootChildren?: readonly RenderNode[],
): PagePlan {
  const margins = pageConfig.pageMargins;
  const pageContentBlockSize =
    pageConfig.pageBlockSize - margins.blockStart - margins.blockEnd;

  if (pageContentBlockSize <= 0) {
    throw new Error(
      `measurePass: pageMargins.blockStart (${margins.blockStart}) + pageMargins.blockEnd (${margins.blockEnd}) must be less than pageBlockSize (${pageConfig.pageBlockSize}).`,
    );
  }

  const entries: PagePlanEntry[] = [];
  let resumeInto: BreakToken | null = null;
  let startIndex = 0;
  let listCounterAtStart = 0;
  let pageIndex = 0;

  // Hard page-count bound (defensive). A correct fit advances state every page
  // (consumes ≥1 whole child OR carries a resume token forward), so the page
  // count is at most one per child plus a fragment continuation each — well
  // under `metas.length * 2 + 2`. The loop must never reach this bound; if it
  // does, `fitOnePage` failed to advance and we throw rather than hang.
  const maxPages = metas.length * 2 + 2;
  for (;;) {
    if (pageIndex > maxPages) {
      throw new Error(
        `measurePass: page count exceeded safe bound (${maxPages}); fitOnePage failed to advance state — likely an unsupported document (see measurePassUnsupported).`,
      );
    }
    const blockOffset = pageIndex * (pageConfig.pageBlockSize + pageConfig.pageGap);
    const result = fitOnePage(
      metas,
      startIndex,
      resumeInto,
      pageContentBlockSize,
      listCounterAtStart,
    );

    // The next page begins at the first child not fully consumed on this page.
    // When `resumeOut` is a block token, that index is `resumeChildIndex`;
    // otherwise it's `startIndex + childrenCount`.
    const nextStartIndex =
      result.resumeOut !== null && result.resumeOut.type === "block"
        ? result.resumeOut.resumeChildIndex
        : startIndex + result.childrenCount;

    // `children` references come from the caller's cascaded root. The metas are
    // 1:1 with the root's block children, so the slice is
    // [startIndex, nextStartIndex). This matches `paginateRoot`'s per-page
    // child-fingerprint slice (`root.children.slice(startIndex,
    // breakToken.resumeChildIndex)`), so a child still mid-fragment at the page
    // bottom (whose `resumeChildIndex === startIndex + childrenCount`) is
    // counted on the NEXT page where it makes whole-block progress — keeping
    // the equivalence harness comparing the same boundary on both sides.
    // Callers that only need boundaries may omit `rootChildren`; `children` is
    // then empty.
    const sliceEnd = result.resumeOut === null ? metas.length : nextStartIndex;
    const children: readonly RenderNode[] =
      rootChildren !== undefined ? rootChildren.slice(startIndex, sliceEnd) : [];

    entries.push({
      pageIndex,
      blockOffset,
      blockSize: pageConfig.pageBlockSize,
      children,
      startIndex,
      resumeInto,
      resumeOut: result.resumeOut,
      listCounterAtStart,
    });

    if (result.resumeOut === null) {
      pageIndex++;
      break;
    }

    startIndex = nextStartIndex;
    resumeInto = result.resumeOut;
    listCounterAtStart = result.listCounterAtEnd;
    pageIndex++;
  }

  const pageCount = pageIndex;
  const totalBlockSize =
    pageCount * pageConfig.pageBlockSize + Math.max(0, pageCount - 1) * pageConfig.pageGap;

  return {
    entries,
    totalBlockSize,
    pageInlineSize: pageConfig.pageInlineSize,
  };
}

/**
 * Recursive detection of any document feature the measure pass / fit-core
 * cannot reproduce, so callers can route such documents to the legacy full
 * positioned layout. Returns `true` (UNSUPPORTED) for any of:
 *
 *   1. `float` / `clear` — break decisions become non-local (shared float
 *      environment); OUT OF SCOPE for v1 (design §"Out of scope for v1").
 *   2. A CONTAINER block (a block element with block-level element children)
 *      that has block-axis padding or border > 0. `fitOnePage`'s recursion
 *      threads the parent's `remaining` straight into the container's children
 *      without subtracting the container's own block-axis padding/border, so
 *      the available space for the children is overstated. A LEAF paragraph
 *      with padding is FINE — its padding is folded into its own
 *      `totalBlockSize` / line heights, with no recursion to mis-budget — so
 *      only container blocks are flagged. (Phase-3 prerequisite #254.)
 *   3. A block element with MIXED content — BOTH block-level element children
 *      AND text / inline children. `buildBlockFitMetas` walks only the block
 *      children and drops the bare inline runs, so the container's metas omit
 *      real content. (Phase-3 prerequisite #253.)
 *
 * Tasks #253 (mixed content) and #254 (padded/bordered container) will teach
 * the measure pass to model these cases, shrinking this fallback.
 *
 * NOTE: this is an O(N) walk. The design calls for a cheap rolled-up cascade
 * flag on the hot path; that rollup is a separate task. This helper is the
 * correctness-complete detector used by tests and by the (not-yet-wired)
 * fallback branch — it is NOT wired into `layoutTreeIncremental` in Phase 1.
 */
export function measurePassUnsupported(cascadedRoot: RenderNode): boolean {
  if (cascadedRoot.type !== "element") return false;
  return elementUnsupported(cascadedRoot);
}

function elementUnsupported(node: ElementBox): boolean {
  const cs = node.computedStyle;
  if (cs !== undefined) {
    // (1) float / clear.
    if (cs.float === "inline-start" || cs.float === "inline-end") return true;
    if (cs.clear !== "none") return true;
  }

  // Classify this element's content the same way `buildBlockFitMetas` does.
  const groups = groupChildren(node);
  const hasBlockChild = groups.some((g) => g.kind === "block");
  const hasInlineRun = groups.some((g) => g.kind === "inline-run");

  if (hasBlockChild) {
    // (3) mixed content: a container that ALSO has bare inline/text children.
    if (hasInlineRun) return true;

    // (2) padded/bordered container: block-axis padding or border > 0 on a
    // block element with block children. Skip `display: table` (its FC budgets
    // padding/border itself; it is a leaf in `buildBlockFitMetas`). Read the
    // COMPUTED values directly (unit-agnostic) so a non-zero PERCENT padding is
    // also caught — resolving against a containing inline-size we don't have
    // here would falsely zero it.
    if (cs !== undefined && cs.display !== "table") {
      if (
        lengthIsNonZero(cs.paddingBlockStart) ||
        lengthIsNonZero(cs.paddingBlockEnd) ||
        cs.borderBlockStartWidth > 0 ||
        cs.borderBlockEndWidth > 0
      ) {
        return true;
      }
    }
  }

  for (const child of node.children) {
    if (child.type === "element" && elementUnsupported(child)) return true;
  }
  return false;
}

/** A computed length is non-zero if it is a non-zero px number OR a non-zero percent. */
function lengthIsNonZero(value: ComputedLength): boolean {
  if (typeof value === "number") return value > 0;
  return value.value > 0;
}
