// packages/core/src/layout/paginate.ts
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
import type { BreakToken, FragmentationContext } from "./fragmentation";

/**
 * Paginate a block-flow document by driving `layoutBlock` per page with the
 * previous page's breakToken as the next page's resumeFrom.
 *
 * P1.B: interleaved-with-BFC fragmentation. The fragmenter is no longer a
 * post-hoc pass over a fully-laid-out tree; it's a per-page coordinator
 * that asks the BFC to produce one page's worth of content at a time.
 *
 * @param root the cascaded document root element (must have computedStyle set).
 * @param ctx the root layout context (writingMode, direction, containingInlineSize).
 * @param shaper the text shaper for inline content measurement.
 * @param pageConfig pagination parameters.
 * @returns a BlockBox whose children are PageBox instances, one per page.
 */
export function paginateRoot(
  root: ElementBox,
  ctx: LayoutContext,
  shaper: TextShaper,
  pageConfig: PageConfig,
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

  const pages: PageBox[] = [];
  let resumeFrom: BreakToken | null = null;
  let pageIndex = 0;

  do {
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
    );
    pages.push(page);
    resumeFrom = breakToken;
    pageIndex++;
  } while (resumeFrom !== null);

  // Defensive: the do-while always pushes ≥1 page, so this is unreachable in
  // normal flow. Kept as a guard against future regressions.
  if (pages.length === 0) {
    pages.push(createPageBox(
      `page-0`, 0, 0,
      pageConfig.pageInlineSize, pageConfig.pageBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, rootUsedStyle,
      [], 0, pageConfig.pageInlineSize,
    ));
    pageIndex = 1;
  }

  const totalBlockSize = pageIndex * pageConfig.pageBlockSize + (pageIndex - 1) * pageConfig.pageGap;
  return createBlockBox(
    root.key, 0, 0,
    pageConfig.pageInlineSize, totalBlockSize,
    ctx.writingMode, ctx.direction,
    rootComputed, rootUsedStyle,
    pages,
    pageConfig.pageInlineSize,
  );
}
