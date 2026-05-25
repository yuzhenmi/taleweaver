// packages/core/src/layout/virtual-layout-tree.ts
//
// Virtualized-layout Phase 2. The on-demand page-materialization machinery.
//
// A `VirtualLayoutTree` carries the `PagePlan` (from Phase-1 `measurePass`) plus
// a memoizing `getPage(i)` that positions ONE page on demand by running the
// SAME per-page `layoutBlock` recipe `paginateRoot` runs — seeded from the
// plan's `resumeInto` token (NOT from a sequential previous-page break). This is
// the property virtualization depends on: any page can be positioned in
// isolation, identically to the sequential paginator.
//
// `getPage(i)` deep-equals `paginateRoot`'s page `i`; `materializeAll()`
// deep-equals `paginateRoot`'s whole tree. The equivalence suite
// (`virtual-layout-tree.test.ts`) guards this against any drift — `paginateRoot`
// is the oracle.
//
// **Unwired** (like Phase 1): `layoutTreeIncremental` is NOT changed; no
// consumer is touched. Wiring + controller migration are Phase 3.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase2.md

import type { ElementBox } from "../render/render-node";
import type { LayoutContext } from "./layout-context";
import type { TextShaper } from "./text-shaper";
import type { PageConfig } from "./page-config";
import type { BlockBox, LayoutBox } from "./layout-box-v2";
import { createBlockBox } from "./layout-box-v2";
import type { PageBox } from "./page-box";
import { createPageBox } from "./page-box";
import { layoutBlock } from "./bfc";
import { computeUsedStyle } from "./used-style";
import type { ComputedStyle, UsedStyle } from "../styles";
import type { PagePlan, PagePlanEntry } from "./measure-pass";
import type { BreakToken } from "./fragmentation";

/**
 * A virtualized layout result. Discriminated from the legacy positioned
 * `LayoutBox` by `type: "virtual-root"`. Holds the `PagePlan` and lazily
 * materializes positioned `PageBox`es on demand.
 */
export interface VirtualLayoutTree {
  readonly type: "virtual-root";
  readonly plan: PagePlan;
  /** Document inline-size (== plan.pageInlineSize). */
  readonly inlineSize: number;
  /** Document block-size (== plan.totalBlockSize). */
  readonly blockSize: number;
  /** Position + memoize page `pageIndex`. Out-of-range throws. */
  getPage(pageIndex: number): PageBox;
  /** `getPage(from..to)`, inclusive, clamped to `[0, lastPage]`. */
  getPages(from: number, to: number): PageBox[];
  /**
   * Build the legacy outer `BlockBox` whose children are `getPage(0..N-1)`,
   * sized exactly as `paginateRoot`'s outer box. Lets Phase-2 consumers/tests
   * that expect the positioned tree run unchanged.
   */
  materializeAll(): BlockBox;
}

// ---------------------------------------------------------------------------
// Test-only instrumentation: count per-page `layoutBlock` DRIVER invocations.
//
// `getPage` invokes `layoutBlock(root, …)` exactly once per page it positions
// (the top-level per-page driver call — recursion into children is internal).
// The Phase-2 guard test asserts that calling only `getPage(19)` on a 20-page
// tree drives layout ONCE, not 20 times — i.e. positioning page 19 does NOT
// position pages 0–18. Production code pays one integer increment per page it
// actually materializes.
// ---------------------------------------------------------------------------

let _getPageDriverCount = 0;

/** Test-only: number of per-page `layoutBlock` driver calls since last reset. */
export function __getGetPageDriverCountForTest(): number {
  return _getPageDriverCount;
}

/** Test-only: reset the driver-call counter. */
export function __resetGetPageDriverCountForTest(): void {
  _getPageDriverCount = 0;
}

/**
 * The per-page fingerprint used by the carry-forward memo. Two pages with
 * structurally-equal fingerprints render identically, so an unchanged page from
 * a prior tree can be returned by reference (preserving paint-cache + LineIndex
 * warmth). Includes the page dimensions so a resize never reuses a PageBox laid
 * out at an old width, and `listCounterAtStart` so an ordered-list seed change
 * (which changes marker text) is never reused stale.
 */
interface PageFingerprint {
  readonly children: readonly unknown[]; // cascaded child refs (reference identity)
  readonly resumeInto: BreakToken | null;
  readonly resumeOut: BreakToken | null;
  readonly blockOffset: number;
  readonly listCounterAtStart: number;
  readonly pageInlineSize: number;
  readonly pageContentBlockSize: number;
}

function fingerprintOf(
  entry: PagePlanEntry,
  pageInlineSize: number,
  pageContentBlockSize: number,
): PageFingerprint {
  return {
    children: entry.children,
    resumeInto: entry.resumeInto,
    resumeOut: entry.resumeOut,
    blockOffset: entry.blockOffset,
    listCounterAtStart: entry.listCounterAtStart,
    pageInlineSize,
    pageContentBlockSize,
  };
}

/** Structural break-token equality (references differ across measure cycles). */
function breakTokensEqual(a: BreakToken | null, b: BreakToken | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.type === "block" && b.type === "block") {
    return a.resumeChildIndex === b.resumeChildIndex && breakTokensEqual(a.resumeChildToken, b.resumeChildToken);
  }
  if (a.type === "ifc" && b.type === "ifc") return a.resumeAtLine === b.resumeAtLine;
  if (a.type === "table" && b.type === "table") return a.resumeAtRow === b.resumeAtRow;
  return false;
}

function childrenRefsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function fingerprintsEqual(a: PageFingerprint, b: PageFingerprint): boolean {
  return (
    a.blockOffset === b.blockOffset &&
    a.listCounterAtStart === b.listCounterAtStart &&
    a.pageInlineSize === b.pageInlineSize &&
    a.pageContentBlockSize === b.pageContentBlockSize &&
    childrenRefsEqual(a.children, b.children) &&
    breakTokensEqual(a.resumeInto, b.resumeInto) &&
    breakTokensEqual(a.resumeOut, b.resumeOut)
  );
}

/**
 * Build a `VirtualLayoutTree` from a `PagePlan` and the cascaded document root.
 * Replicates `paginateRoot`'s setup ONCE (margins, root used style, content
 * context); `getPage(i)` then positions page `i` lazily by running the same
 * per-page `layoutBlock` recipe seeded from `plan.entries[i].resumeInto`.
 *
 * @param prevTree optional prior tree for carry-forward memo: an unchanged page
 *   (same fingerprint) whose prior PageBox was materialized is returned by
 *   reference, preserving paint-cache + LineIndex warmth.
 */
export function makeVirtualLayoutTree(
  plan: PagePlan,
  cascadedRoot: ElementBox,
  ctx: LayoutContext,
  shaper: TextShaper,
  pageConfig: PageConfig,
  prevTree?: VirtualLayoutTree,
): VirtualLayoutTree {
  const margins = pageConfig.pageMargins;
  const pageContentBlockSize =
    pageConfig.pageBlockSize - margins.blockStart - margins.blockEnd;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;

  if (pageContentBlockSize <= 0) {
    throw new Error(
      `makeVirtualLayoutTree: pageMargins.blockStart (${margins.blockStart}) + pageMargins.blockEnd (${margins.blockEnd}) must be less than pageBlockSize (${pageConfig.pageBlockSize}).`,
    );
  }
  if (pageContentInlineSize <= 0) {
    throw new Error(
      `makeVirtualLayoutTree: pageMargins.inlineStart (${margins.inlineStart}) + pageMargins.inlineEnd (${margins.inlineEnd}) must be less than pageInlineSize (${pageConfig.pageInlineSize}).`,
    );
  }
  if (!cascadedRoot.computedStyle) {
    throw new Error("makeVirtualLayoutTree: root must be cascaded (computedStyle missing)");
  }

  // paginate.ts:162–169 — compute the root's UsedStyle once; per-page layout
  // uses the content area (page minus margins) as the BFC's containing inline
  // size, with the BFC positioned at (margins.inlineStart, margins.blockStart).
  const rootComputed: ComputedStyle = cascadedRoot.computedStyle;
  const rootUsedStyle: UsedStyle = computeUsedStyle(rootComputed, pageConfig.pageInlineSize, "indefinite");
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };

  // Lazy per-index memo of materialized pages. Populated on first getPage(i).
  const pageMemo = new Map<number, PageBox>();

  // Carry-forward setup: snapshot the prev tree's per-page fingerprints so we
  // can compare in getPage. We only reuse a prev page if it was actually
  // materialized — the non-materializing probe below checks that.
  const prevInternal = prevTree as VirtualLayoutTreeInternal | undefined;
  const prevFingerprints: (PageFingerprint | undefined)[] = [];
  if (prevInternal !== undefined && prevInternal.__fingerprintAt !== undefined) {
    for (const e of prevInternal.plan.entries) {
      prevFingerprints[e.pageIndex] = prevInternal.__fingerprintAt(e.pageIndex);
    }
  }

  function getPage(pageIndex: number): PageBox {
    const memoized = pageMemo.get(pageIndex);
    if (memoized !== undefined) return memoized;

    const entry = plan.entries[pageIndex];
    if (entry === undefined) {
      throw new Error(
        `VirtualLayoutTree.getPage: page index ${pageIndex} out of range (0..${plan.entries.length - 1})`,
      );
    }

    // Carry-forward memo (lazy): if the prior tree has a structurally-identical
    // fingerprint for this page AND that page was actually materialized, reuse
    // its PageBox by reference (paint-cache + LineIndex warmth preserved).
    if (prevInternal !== undefined && prevInternal.__peekMaterializedPage !== undefined) {
      const prevFp = prevFingerprints[pageIndex];
      const thisFp = fingerprintOf(entry, plan.pageInlineSize, pageContentBlockSize);
      if (prevFp !== undefined && fingerprintsEqual(prevFp, thisFp)) {
        const reused = prevInternal.__peekMaterializedPage(pageIndex);
        if (reused !== undefined) {
          pageMemo.set(pageIndex, reused);
          return reused;
        }
      }
    }

    const page = materializePage(pageIndex, entry);
    pageMemo.set(pageIndex, page);
    return page;
  }

  function materializePage(pageIndex: number, entry: PagePlanEntry): PageBox {
    // NOTE: an earlier version threaded a per-page `prevLayoutCache` built from
    // the prior tree's PageBox (buildLayoutBoxCacheFromTree(prevPage, …)) so
    // unchanged blocks WITHIN a re-materialized page reused their prior boxes
    // (intra-page L-PERF-A/-G). That was REMOVED — it reused a moved block's
    // box at its STALE position (e.g. Enter at the start of a line left the
    // text painted on the old line: the cache returned the text box at its
    // pre-edit blockOffset instead of repositioning it). Re-materializing one
    // visible page from scratch is cheap (the measure pass already decided the
    // boundaries; this just positions ~one page of blocks). A correct
    // intra-page reuse can be reinstated later (see the tracked follow-up), but
    // correctness comes first. `getPage` runs the SAME per-page driver call
    // paginateRoot runs (paginate.ts:213–220), seeded from the PLAN's
    // resumeInto — NOT a sequential previous-page break.
    _getPageDriverCount++;
    const { box } = layoutBlock(
      cascadedRoot,
      margins.inlineStart,
      margins.blockStart,
      contentCtx,
      shaper,
      {
        availableBlockSize: pageContentBlockSize,
        pageIndex,
        resumeFrom: entry.resumeInto,
      },
    );
    // Wrap exactly as paginate.ts:226–237. The BFC BlockBox can be null
    // (no content fit) — guard it. blockOffset comes from the plan (it equals
    // pageIndex * (pageBlockSize + pageGap); we use the plan's value, not a
    // recompute). blockSize is the PAGE block-size, not the content size.
    const children: readonly LayoutBox[] = box ? [box] : [];
    return createPageBox(
      `page-${pageIndex}`,
      0, entry.blockOffset,
      pageConfig.pageInlineSize, pageConfig.pageBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, rootUsedStyle,
      children,
      pageIndex,
      pageConfig.pageInlineSize,
    );
  }

  function getPages(from: number, to: number): PageBox[] {
    const last = plan.entries.length - 1;
    const lo = Math.max(0, Math.min(from, last));
    const hi = Math.max(0, Math.min(to, last));
    const pages: PageBox[] = [];
    for (let i = lo; i <= hi; i++) pages.push(getPage(i));
    return pages;
  }

  function materializeAll(): BlockBox {
    // Mirror paginate.ts:295–305. totalBlockSize uses (pageCount - 1) gaps.
    const pageCount = plan.entries.length;
    const pages: PageBox[] = [];
    for (let i = 0; i < pageCount; i++) pages.push(getPage(i));
    const totalBlockSize =
      pageCount * pageConfig.pageBlockSize + Math.max(0, pageCount - 1) * pageConfig.pageGap;
    return createBlockBox(
      cascadedRoot.key, 0, 0,
      pageConfig.pageInlineSize, totalBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, rootUsedStyle,
      pages,
      pageConfig.pageInlineSize,
    );
  }

  // Non-materializing peek for the NEXT tree's carry-forward memo: returns this
  // page's PageBox iff it was already materialized; never triggers layout.
  function peekMaterializedPage(pageIndex: number): PageBox | undefined {
    return pageMemo.get(pageIndex);
  }

  // This tree's per-page fingerprint, for the NEXT tree's comparison. Uses THIS
  // tree's own geometry (pageInlineSize + pageContentBlockSize), so a config
  // change between trees is reflected in the fingerprint.
  function fingerprintAt(pageIndex: number): PageFingerprint | undefined {
    const entry = plan.entries[pageIndex];
    if (entry === undefined) return undefined;
    return fingerprintOf(entry, plan.pageInlineSize, pageContentBlockSize);
  }

  // The public tree: only the contract surface as enumerable own properties.
  // The carry-forward hooks are attached non-enumerably below so they never
  // leak via Object.keys / for..in / JSON serialization, then the whole object
  // is frozen so a consumer can't mutate the layout result. The hooks remain
  // readable off `prevTree` (they're values, not enumerable) — that's the only
  // path that touches them.
  const tree = {
    type: "virtual-root",
    plan,
    inlineSize: plan.pageInlineSize,
    blockSize: plan.totalBlockSize,
    getPage,
    getPages,
    materializeAll,
  } as VirtualLayoutTreeInternal;
  Object.defineProperty(tree, "__peekMaterializedPage", {
    value: peekMaterializedPage,
    enumerable: false,
  });
  Object.defineProperty(tree, "__fingerprintAt", {
    value: fingerprintAt,
    enumerable: false,
  });
  Object.freeze(tree);
  return tree;
}

/**
 * Internal shape: the carry-forward hooks attached to every VirtualLayoutTree.
 * Not part of the public contract; only `makeVirtualLayoutTree` reads them off
 * a `prevTree` to drive the lazy carry-forward memo.
 */
interface VirtualLayoutTreeInternal extends VirtualLayoutTree {
  /** Already-materialized PageBox for `pageIndex`, or undefined if never materialized. Does NOT materialize. */
  readonly __peekMaterializedPage?: (pageIndex: number) => PageBox | undefined;
  /** This tree's fingerprint for `pageIndex` (uses this tree's geometry), or undefined if out of range. */
  readonly __fingerprintAt?: (pageIndex: number) => PageFingerprint | undefined;
}
