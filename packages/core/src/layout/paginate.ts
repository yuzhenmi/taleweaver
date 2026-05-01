// packages/core/src/layout/paginate.ts
import type { BlockBox, LayoutBox } from "./layout-box-v2";
import { createBlockBox, withBlockOffset } from "./layout-box-v2";
import { createPageBox } from "./page-box";
import type { PageBox } from "./page-box";
import type { PageConfig } from "./page-config";

/**
 * Fragment a block-flow tree into a sequence of pages.
 *
 * P1.A scope: whole-block placement only. Each child of `rootBlock` is
 * placed on the current page if it fits in the remaining vertical space;
 * otherwise it starts a new page. A block too tall for one page goes on
 * its own page and overflows past the bottom (acceptable for P1.A;
 * P1.B adds within-block fragmentation at line boundaries).
 *
 * @param rootBlock the BFC's output — a BlockBox whose children are
 *   block-flow content (paragraphs, tables, etc.) with cumulative
 *   blockOffsets across the document.
 * @param pageConfig pagination parameters.
 * @returns a new BlockBox whose children are PageBox instances. Each
 *   PageBox contains the children that fit on it, with their
 *   blockOffsets adjusted to be page-content-relative.
 */
export function paginateRoot(
  rootBlock: BlockBox,
  pageConfig: PageConfig,
): BlockBox {
  // Available block-axis space for content within each page (page-block-size minus margins).
  const pageContentBlockSize = pageConfig.pageBlockSize
    - pageConfig.pageMargins.blockStart
    - pageConfig.pageMargins.blockEnd;

  if (pageContentBlockSize <= 0) {
    throw new Error(
      `Invalid PageConfig: pageMargins.blockStart (${pageConfig.pageMargins.blockStart}) + pageMargins.blockEnd (${pageConfig.pageMargins.blockEnd}) must be less than pageBlockSize (${pageConfig.pageBlockSize}). Got pageContentBlockSize=${pageContentBlockSize}.`,
    );
  }

  const pages: PageBox[] = [];
  const remaining = [...rootBlock.children];

  // Containing inline size for repositioning child boxes (used by withBlockOffset for RTL physical-x).
  const childContainingInlineSize = rootBlock.inlineSize
    - rootBlock.usedStyle.paddingInlineStart
    - rootBlock.usedStyle.paddingInlineEnd;

  let pageIndex = 0;

  while (remaining.length > 0) {
    const placed: LayoutBox[] = [];
    let usedHeight = 0;

    // Greedy: pack children until the next one wouldn't fit.
    while (remaining.length > 0) {
      const next = remaining[0];
      if (usedHeight > 0 && usedHeight + next.blockSize > pageContentBlockSize) {
        // Doesn't fit and we already placed something — push to next page.
        break;
      }
      // Either the page is empty (place even oversized blocks), or it fits.
      placed.push(withBlockOffset(next, usedHeight, childContainingInlineSize));
      usedHeight += next.blockSize;
      remaining.shift();
    }

    // Build the page.
    const pageBlockOffset = pageIndex * (pageConfig.pageBlockSize + pageConfig.pageGap);
    const page = createPageBox(
      `page-${pageIndex}`,
      0, pageBlockOffset,
      pageConfig.pageInlineSize, pageConfig.pageBlockSize,
      rootBlock.writingMode, rootBlock.direction,
      rootBlock.computedStyle, rootBlock.usedStyle,
      placed,
      pageIndex,
      pageConfig.pageInlineSize,
    );
    pages.push(page);
    pageIndex += 1;
  }

  // Empty input: emit a single blank page so the editor renders a blank canvas
  // rather than nothing. (CSS Paged Media: an empty flow still produces an
  // initial page box.)
  if (pages.length === 0) {
    pages.push(createPageBox(
      `page-0`,
      0, 0,
      pageConfig.pageInlineSize, pageConfig.pageBlockSize,
      rootBlock.writingMode, rootBlock.direction,
      rootBlock.computedStyle, rootBlock.usedStyle,
      [],
      0,
      pageConfig.pageInlineSize,
    ));
    pageIndex = 1;
  }

  // Build the new root with pages as children.
  const totalBlockSize = pageIndex > 0
    ? pageIndex * pageConfig.pageBlockSize + (pageIndex - 1) * pageConfig.pageGap
    : 0;

  return createBlockBox(
    rootBlock.key,
    rootBlock.inlineOffset, rootBlock.blockOffset,
    pageConfig.pageInlineSize, totalBlockSize,
    rootBlock.writingMode, rootBlock.direction,
    rootBlock.computedStyle, rootBlock.usedStyle,
    pages,
    pageConfig.pageInlineSize,
    rootBlock.metadata,
  );
}
