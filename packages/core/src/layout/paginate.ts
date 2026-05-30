// packages/core/src/layout/paginate.ts
import type { ElementBox, RenderNode } from "../render/render-node";
import type { LayoutContext } from "./layout-context";
import type { TextShaper } from "./text-shaper";
import type { PageConfig } from "./page-config";
import type { BlockBox, LayoutBox } from "./layout-box-v2";
import { createBlockBox } from "./layout-box-v2";
import type { PageBox } from "./page-box";
import { createPageBox } from "./page-box";
import { layoutBlock } from "./bfc";
import { flattenContents } from "./group-children";
import { computeUsedStyle } from "./used-style";
import type { BreakToken, FragmentationContext } from "./fragmentation";

/**
 * Per-page reuse fingerprint (L-PERF-C).
 *
 * One entry per cached page. `childrenOnPage` are the cascaded render-
 * node references that fit on this page in the previous paginate cycle
 * (slice of `root.children` from `startIndex` to `startIndex +
 * childrenOnPage.length`). To reuse the page on a new cycle we
 * confirm: (a) the cycle's current `startIndex` matches `startIndex`,
 * and (b) `newRoot.children[startIndex .. +length]` are reference-
 * equal to `childrenOnPage`. When both hold, the entire per-page
 * BlockBox + the PageBox wrapper + the breakToken are reused as-is —
 * skipping the per-page `layoutBlock` call (which would otherwise
 * iterate every child on the page even though every child would
 * cache-hit individually).
 *
 * Only fully-fitting pages are cached: a partial-fragment break (IFC
 * mid-paragraph or table mid-row) leaves the resume-from state
 * non-degenerate, and reusing the partial fragment would lose that
 * context. As soon as a non-clean break occurs, subsequent pages
 * cannot be cached either (they'd depend on the partial-fragment
 * state we didn't store).
 */
interface PageCacheEntry {
  readonly startIndex: number;
  /** The resumeFrom this page's layoutBlock was invoked with last
   *  cycle. To reuse the cached page, the current cycle's resumeFrom
   *  must be DEEP-equal — token references differ across cycles even
   *  for structurally identical chains, so we compare by structure. */
  readonly resumeFrom: BreakToken | null;
  readonly childrenOnPage: readonly RenderNode[];
  readonly pageBox: PageBox;
  readonly breakToken: BreakToken | null;
}

interface PaginationCache {
  readonly entries: readonly PageCacheEntry[];
}

// WeakMap keyed on the layoutTree root BlockBox. layoutTreeIncremental
// looks up by the OLD root, paginateRoot writes by the NEW root.
const _paginationCache: WeakMap<BlockBox, PaginationCache> = new WeakMap();

function getPaginationCache(root: LayoutBox | null): PaginationCache | null {
  if (root === null || root.type !== "block") return null;
  return _paginationCache.get(root) ?? null;
}

/**
 * Structural equality for BreakToken chains. References differ across
 * cycles even when the chain is identical (a fresh layoutBlock builds
 * fresh tokens), so the page cache compares resumeFrom by structure
 * to decide reuse. Conservative on any future unknown types —
 * defaults to false to avoid false-positive cache hits.
 */
function breakTokensEqual(a: BreakToken | null, b: BreakToken | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.type === "block" && b.type === "block") {
    if (a.resumeChildIndex !== b.resumeChildIndex) return false;
    return breakTokensEqual(a.resumeChildToken, b.resumeChildToken);
  }
  if (a.type === "ifc" && b.type === "ifc") {
    return a.resumeAtLine === b.resumeAtLine;
  }
  if (a.type === "table" && b.type === "table") {
    return a.resumeAtRow === b.resumeAtRow;
  }
  return false;
}

/**
 * Compare a fingerprint against the current root's children slice.
 * O(N_children_on_page) reference-equality checks — orders of
 * magnitude faster than re-iterating the per-page layoutBlock loop
 * (each child cache-hit is ~1μs of bookkeeping; a reference check is
 * ~0.05μs).
 */
function childrenMatchFingerprint(
  rootChildren: readonly RenderNode[],
  startIndex: number,
  fingerprint: readonly RenderNode[],
): boolean {
  if (startIndex + fingerprint.length > rootChildren.length) return false;
  for (let i = 0; i < fingerprint.length; i++) {
    if (rootChildren[startIndex + i] !== fingerprint[i]) return false;
  }
  return true;
}

/**
 * Paginate a block-flow document by driving `layoutBlock` per page with the
 * previous page's breakToken as the next page's resumeFrom.
 *
 * P1.B: interleaved-with-BFC fragmentation. The fragmenter is no longer a
 * post-hoc pass over a fully-laid-out tree; it's a per-page coordinator
 * that asks the BFC to produce one page's worth of content at a time.
 *
 * **L-PERF-C — page-level reuse.** When `prevRoot` is supplied (passed
 * from `layoutTreeIncremental`), each prospective page first consults
 * the WeakMap-cached pagination fingerprint from the previous cycle.
 * If the current `startIndex` and the children-slice references match
 * a cached entry, the entire per-page BlockBox + PageBox wrapper + the
 * breakToken are reused by reference — no `layoutBlock` call at all.
 * Hot path for "type one character on a 100-page doc": only the page
 * containing the edited paragraph (plus any subsequent pages whose
 * positions shifted) re-lays-out; the other ~99 pages reuse cached
 * outputs after an O(N_children_per_page) ref-eq fingerprint check.
 *
 * @param root the cascaded document root element (must have computedStyle set).
 * @param ctx the root layout context (writingMode, direction, containingInlineSize).
 * @param shaper the text shaper for inline content measurement.
 * @param pageConfig pagination parameters.
 * @param prevRoot the previous cycle's layoutTree root (a `BlockBox`);
 *   if supplied, page-level reuse may short-circuit `layoutBlock` for
 *   unchanged pages.
 * @returns a BlockBox whose children are PageBox instances, one per page.
 */
export function paginateRoot(
  root: ElementBox,
  ctx: LayoutContext,
  shaper: TextShaper,
  pageConfig: PageConfig,
  prevRoot?: LayoutBox | null,
): BlockBox {
  const margins = pageConfig.pageMargins;
  const pageContentBlockSize =
    pageConfig.pageBlockSize - margins.blockStart - margins.blockEnd;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;

  if (pageContentBlockSize <= 0) {
    throw new Error(
      `Invalid PageConfig: pageMargins.blockStart (${margins.blockStart}) + pageMargins.blockEnd (${margins.blockEnd}) must be less than pageBlockSize (${pageConfig.pageBlockSize}).`,
    );
  }
  if (pageContentInlineSize <= 0) {
    throw new Error(
      `Invalid PageConfig: pageMargins.inlineStart (${margins.inlineStart}) + pageMargins.inlineEnd (${margins.inlineEnd}) must be less than pageInlineSize (${pageConfig.pageInlineSize}).`,
    );
  }

  if (!root.computedStyle) {
    throw new Error("paginateRoot: root must be cascaded (computedStyle missing)");
  }

  // Compute the root's UsedStyle once; reuse for every PageBox + the wrapping
  // root BlockBox. The root's containing-inline-size is the page's inline size.
  const rootComputed = root.computedStyle;
  const rootUsedStyle = computeUsedStyle(rootComputed, pageConfig.pageInlineSize, "indefinite");

  // Per-page layout uses the content area (page minus margins) as the BFC's
  // containing inline size, so text wraps at content-area width and the BFC's
  // BlockBox is positioned at (margins.inlineStart, margins.blockStart) within
  // each PageBox. Content visibly insets from the page edges.
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };

  // `layoutBlock` walks the root's children via `groupChildren` (which flattens
  // `display: contents` elements), so a `BreakToken.resumeChildIndex` is an index
  // into the FLATTENED child list. The page-cache fingerprints (`startIndex`,
  // `childrenOnPage` slice) must be indexed over the same flattened list — not
  // raw `root.children` — or a `display: contents` element at root level desyncs
  // the slice index from the break index.
  const effectiveChildren = flattenContents(root.children);

  const prevCache = getPaginationCache(prevRoot ?? null);
  const prevEntries: readonly PageCacheEntry[] | null = prevCache?.entries ?? null;

  const pages: PageBox[] = [];
  const newEntries: PageCacheEntry[] = [];
  let resumeFrom: BreakToken | null = null;
  let pageIndex = 0;
  let startIndex = 0;

  while (true) {
    // Page-level reuse: try a cache hit before invoking layoutBlock.
    // Each page is checked INDEPENDENTLY — a single page missing the
    // cache (e.g., page 0 contains the dirty paragraph) does NOT
    // disable cache reuse for subsequent pages. As long as the
    // post-mismatch layoutBlock returns a breakToken with the SAME
    // resumeChildIndex the cached entry expected, the next page's
    // startIndex realigns and that page can still cache-hit. The
    // common "edit one paragraph on page 0" workload thus reuses
    // ~99% of pages.
    if (prevEntries !== null && pageIndex < prevEntries.length) {
      const cached = prevEntries[pageIndex];
      if (
        cached.startIndex === startIndex &&
        breakTokensEqual(cached.resumeFrom, resumeFrom) &&
        childrenMatchFingerprint(effectiveChildren, startIndex, cached.childrenOnPage)
      ) {
        pages.push(cached.pageBox);
        newEntries.push(cached);
        startIndex += cached.childrenOnPage.length;
        resumeFrom = cached.breakToken;
        pageIndex++;
        if (resumeFrom === null) break;
        continue;
      }
    }

    const cycleResumeFrom = resumeFrom;
    const fragmentation: FragmentationContext = {
      availableBlockSize: pageContentBlockSize,
      pageIndex,
      resumeFrom,
    };
    const { box, breakToken } = layoutBlock(
      root,
      margins.inlineStart,
      margins.blockStart,
      contentCtx,
      shaper,
      fragmentation,
    );
    // Wrap the BFC's BlockBox as a single page child so its (margins.inlineStart,
    // margins.blockStart) offset is preserved in the descendant coordinate
    // system. PageBox.children are walked with parent (0, 0) per P1.A.14's
    // PageBox-as-frame convention; nesting the BFC under PageBox lets the
    // margin offset propagate naturally to paint and editor utilities.
    const placedChildren: readonly LayoutBox[] = box ? [box] : [];
    const pageBlockOffset = pageIndex * (pageConfig.pageBlockSize + pageConfig.pageGap);
    const page = createPageBox(
      `page-${pageIndex}`,
      0, pageBlockOffset,
      pageConfig.pageInlineSize, pageConfig.pageBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, rootUsedStyle,
      placedChildren,
      pageIndex,
      pageConfig.pageInlineSize,
      // T1: header/footer slots default null (legacy positioned-paginate path).
      // FN-4: footnote slot also null — footnotes flow only through the virtual
      // path (float/clear docs that fall to this legacy path are out of scope).
      null, null, null,
      // #332 region edges: this legacy path lays the body flush at the page
      // content margins (no growing slot), so the body content area is exactly
      // [margins.blockStart, pageBlockSize − margins.blockEnd].
      margins.blockStart, margins.blockEnd,
    );
    pages.push(page);

    // Record the fingerprint for next cycle ONLY when both sides of
    // this page are clean (the resumeFrom we consumed AND the
    // breakToken we'd emit). Otherwise we'd cache a partial fragment
    // that can't be safely reused without the matching resume context.
    // Once a non-cacheable page is encountered, subsequent pages also
    // become non-cacheable (the resume chain is compromised).
    // Cache the page if it made block-level progress. Pages with
    // zero progress (IFC mid-paragraph, table mid-row) carry partial
    // state we can't faithfully represent as a child-slice
    // fingerprint, so they're omitted. Subsequent pages CAN still be
    // cached independently — their cache hit requires a structurally
    // identical resumeFrom (deep-equal), which holds whenever the
    // partial state recomputes identically.
    const nextStartIndex =
      breakToken === null
        ? effectiveChildren.length
        : breakToken.type === "block"
          ? breakToken.resumeChildIndex
          : startIndex;
    if (nextStartIndex > startIndex) {
      newEntries.push({
        startIndex,
        resumeFrom: cycleResumeFrom,
        childrenOnPage: effectiveChildren.slice(startIndex, nextStartIndex),
        pageBox: page,
        breakToken,
      });
    }

    if (breakToken === null) {
      startIndex = effectiveChildren.length;
      resumeFrom = null;
      pageIndex++;
      break;
    }
    if (breakToken.type === "block") {
      startIndex = breakToken.resumeChildIndex;
    }
    resumeFrom = breakToken;
    pageIndex++;
  }

  // Defensive: the loop always pushes ≥1 page when invoked, so this is
  // unreachable in normal flow. Kept as a guard against future regressions.
  if (pages.length === 0) {
    pages.push(createPageBox(
      `page-0`, 0, 0,
      pageConfig.pageInlineSize, pageConfig.pageBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, rootUsedStyle,
      [], 0, pageConfig.pageInlineSize,
      null, null, null,
      // #332 region edges: empty defensive page uses the page content margins.
      margins.blockStart, margins.blockEnd,
    ));
    pageIndex = 1;
  }

  const totalBlockSize = pageIndex * pageConfig.pageBlockSize + (pageIndex - 1) * pageConfig.pageGap;
  const outerBox = createBlockBox(
    root.key, 0, 0,
    pageConfig.pageInlineSize, totalBlockSize,
    ctx.writingMode, ctx.direction,
    rootComputed, rootUsedStyle,
    pages,
    pageConfig.pageInlineSize,
  );
  _paginationCache.set(outerBox, { entries: newEntries });
  return outerBox;
}

