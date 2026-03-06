import type { RenderNode, RenderStyles, TextRenderNode } from "../render/render-node";
import type { TableRenderNode } from "../render/table-render-node";
import type { TextMeasurer } from "./text-measurer";
import type { LayoutBox } from "./layout-node";
import { createBlockLayoutBox } from "./block-layout-box";
import { createTableLayoutBox } from "./table-layout-box";
import { createLineLayoutBox } from "./line-layout-box";
import { createPageLayoutBox } from "./page-layout-box";
import { createTextLayoutBox } from "./text-layout-box";
import { splitTextIntoWords, type WordBox } from "./text-splitter";

export interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Layout engine: takes a render tree and a width constraint,
 * produces a layout tree with resolved positions and sizes.
 */
export function layoutTree(
  renderNode: RenderNode,
  containerWidth: number,
  measurer: TextMeasurer,
  pageHeight?: number,
  pageMargins?: PageMargins,
): LayoutBox {
  const contentWidth = pageMargins
    ? containerWidth - pageMargins.left - pageMargins.right
    : containerWidth;
  const docBox = layoutNode(renderNode, 0, 0, contentWidth, measurer);
  if (pageHeight === undefined) return docBox;
  return paginateDocument(docBox, pageHeight, containerWidth, pageMargins);
}

/**
 * Distribute the document's children into PageLayoutBox nodes.
 * Whole-block only — blocks don't split across pages.
 */
function paginateDocument(
  docBox: LayoutBox,
  pageHeight: number,
  containerWidth?: number,
  margins?: PageMargins,
): LayoutBox {
  const pageWidth = containerWidth ?? docBox.width;
  const contentHeight = margins
    ? pageHeight - margins.top - margins.bottom
    : pageHeight;
  const offsetX = margins?.left ?? 0;
  const offsetY = margins?.top ?? 0;

  const pages: LayoutBox[] = [];
  let currentPageChildren: LayoutBox[] = [];
  let currentPageContentHeight = 0;
  let pageIndex = 0;

  for (const child of docBox.children) {
    // If this block doesn't fit and current page is non-empty, start a new page
    if (
      currentPageChildren.length > 0 &&
      currentPageContentHeight + child.height > contentHeight
    ) {
      pages.push(
        createPageLayoutBox(
          `page-${pageIndex}`,
          0,
          0,
          pageWidth,
          pageHeight,
          currentPageChildren,
        ),
      );
      pageIndex++;
      currentPageChildren = [];
      currentPageContentHeight = 0;
    }

    // Reposition child: x offset by margin, y = marginTop + accumulated content height
    const repositioned = repositionBox(child, child.x + offsetX, offsetY + currentPageContentHeight);
    currentPageChildren.push(repositioned);
    currentPageContentHeight += child.height;
  }

  // Finish last page
  if (currentPageChildren.length > 0) {
    pages.push(
      createPageLayoutBox(
        `page-${pageIndex}`,
        0,
        0,
        pageWidth,
        pageHeight,
        currentPageChildren,
      ),
    );
  }

  return createBlockLayoutBox(
    docBox.key,
    docBox.x,
    docBox.y,
    pageWidth,
    pages.length * pageHeight,
    pages,
  );
}

function layoutNode(
  renderNode: RenderNode,
  x: number,
  y: number,
  availableWidth: number,
  measurer: TextMeasurer,
): LayoutBox {
  switch (renderNode.type) {
    case "block":
      return layoutBlock(renderNode, x, y, availableWidth, measurer);
    case "table":
      return layoutTable(renderNode, x, y, availableWidth, measurer);
    case "inline":
      // Inline nodes are always children of a block's inline formatting context,
      // where they are handled by collectWordBoxes. This path only runs for a
      // standalone inline node (not nested inside a block), which shouldn't
      // occur in a well-formed render tree. Fall through to block layout.
      return layoutBlock(renderNode, x, y, availableWidth, measurer);
    case "text":
      // Text nodes are handled within layoutBlock's line wrapping
      return layoutTextNode(renderNode, x, y, measurer);
    default: {
      const unexpected: never = renderNode;
      throw new Error(`Unknown render node type: ${unexpected}`);
    }
  }
}

/** Resolve a margin ratio to pixels using the block's resolved line height. */
function resolveMarginPx(ratio: number, renderNode: RenderNode, measurer: TextMeasurer): number {
  return ratio * measurer.measureHeight(renderNode.styles);
}

/** Compute the resolved top-edge line margin for a render subtree (first leaf's line margin). */
function computeTopEdgeLineMargin(renderNode: RenderNode, measurer: TextMeasurer): number {
  if (renderNode.type === "table" || renderNode.type === "text") return 0;
  const hasInlineContent = renderNode.children.some(
    (c) => c.type === "text" || c.type === "inline",
  );
  if (hasInlineContent || renderNode.children.length === 0) {
    return resolveMarginPx(renderNode.styles.lineMarginTop ?? 0, renderNode, measurer);
  }
  return computeTopEdgeLineMargin(renderNode.children[0], measurer);
}

/** Compute the resolved bottom-edge line margin for a render subtree (last leaf's line margin). */
function computeBottomEdgeLineMargin(renderNode: RenderNode, measurer: TextMeasurer): number {
  if (renderNode.type === "table" || renderNode.type === "text") return 0;
  const hasInlineContent = renderNode.children.some(
    (c) => c.type === "text" || c.type === "inline",
  );
  if (hasInlineContent || renderNode.children.length === 0) {
    return resolveMarginPx(renderNode.styles.lineMarginBottom ?? 0, renderNode, measurer);
  }
  return computeBottomEdgeLineMargin(renderNode.children[renderNode.children.length - 1], measurer);
}

function layoutBlock(
  renderNode: RenderNode,
  x: number,
  y: number,
  availableWidth: number,
  measurer: TextMeasurer,
): LayoutBox {
  const paddingTop = renderNode.styles.paddingTop ?? 0;
  const paddingBottom = renderNode.styles.paddingBottom ?? 0;
  const paddingLeft = renderNode.styles.paddingLeft ?? 0;
  const paddingRight = renderNode.styles.paddingRight ?? 0;
  const contentWidth = availableWidth - paddingLeft - paddingRight;

  const hasInlineContent = renderNode.children.some(
    (c) => c.type === "text" || c.type === "inline",
  );

  let children: LayoutBox[];
  let contentY: number;

  if (hasInlineContent) {
    // Inline formatting context: margins handled per-line inside layoutInlineContent
    contentY = paddingTop;
    children = layoutInlineContent(
      renderNode,
      paddingLeft,
      contentY,
      contentWidth,
      measurer,
    );
  } else if (renderNode.children.length === 0) {
    // Leaf block (e.g. image, hr): height is padding only; spacing handled by block margins
    contentY = paddingTop;
    const totalHeight = paddingTop + paddingBottom;

    const marker = renderNode.type === "block" ? renderNode.marker : undefined;
    const metadata = renderNode.type === "block" ? renderNode.metadata : undefined;
    return createBlockLayoutBox(
      renderNode.key, x, y, availableWidth, totalHeight, [], marker, metadata,
    );
  } else {
    // Block formatting context: stack children with line margin collapsing + block margin gaps
    contentY = paddingTop;
    children = [];
    let childY = contentY;
    let prevLineMarginBottom = 0;
    let prevBlockMarginBottom = 0;
    for (const child of renderNode.children) {
      const childLineMarginTop = computeTopEdgeLineMargin(child, measurer);
      const childBlockMarginTop = resolveMarginPx(child.styles.blockMarginTop ?? 0, child, measurer);
      if (children.length > 0) {
        const lineOverlap = Math.min(prevLineMarginBottom, childLineMarginTop);
        const lineGap = prevLineMarginBottom + childLineMarginTop - lineOverlap;
        const blockGap = Math.max(prevBlockMarginBottom, childBlockMarginTop);
        const extraSpace = Math.max(0, blockGap - lineGap);
        childY -= lineOverlap;
        childY += extraSpace;
      }
      const laid = layoutNode(child, paddingLeft, childY, contentWidth, measurer);
      children.push(laid);
      childY = laid.y + laid.height;
      prevLineMarginBottom = computeBottomEdgeLineMargin(child, measurer);
      prevBlockMarginBottom = resolveMarginPx(child.styles.blockMarginBottom ?? 0, child, measurer);
    }
  }

  const lastChild = children.length > 0 ? children[children.length - 1] : undefined;
  const lastChildMarginBottom = lastChild?.type === "line" ? lastChild.marginBottom : 0;
  const contentBottom =
    lastChild !== undefined
      ? lastChild.y + lastChild.height + lastChildMarginBottom
      : contentY;

  const totalHeight = contentBottom + paddingBottom;

  const marker = renderNode.type === "block" ? renderNode.marker : undefined;
  const metadata = renderNode.type === "block" ? renderNode.metadata : undefined;
  return createBlockLayoutBox(
    renderNode.key,
    x,
    y,
    availableWidth,
    totalHeight,
    children,
    marker,
    metadata,
  );
}

/** Layout a table render node. */
function layoutTable(
  renderNode: TableRenderNode,
  x: number,
  y: number,
  availableWidth: number,
  measurer: TextMeasurer,
): LayoutBox {
  const { columnWidths, rowHeights } = renderNode;

  // Resolve fractional column widths to pixels
  const resolvedColumnWidths = columnWidths.map((w) => w * availableWidth);

  // For each row: layout each cell at its column x offset, track max height
  const rowBoxes: LayoutBox[] = [];
  let rowY = 0;

  for (let r = 0; r < renderNode.children.length; r++) {
    const rowNode = renderNode.children[r];
    const cellBoxes: LayoutBox[] = [];
    let maxCellHeight = 0;
    let cellX = 0;

    // Layout each cell within the row
    const cellChildren = rowNode.children;
    for (let c = 0; c < cellChildren.length; c++) {
      const cellNode = cellChildren[c];
      const colWidth = c < resolvedColumnWidths.length ? resolvedColumnWidths[c] : 0;
      const cellBox = layoutNode(cellNode, cellX, 0, colWidth, measurer);
      cellBoxes.push(cellBox);
      maxCellHeight = Math.max(maxCellHeight, cellBox.height);
      cellX += colWidth;
    }

    // Resolve row height: explicit height (rowHeights[r]) or auto (tallest cell)
    const explicitHeight = r < rowHeights.length ? rowHeights[r] : 0;
    const resolvedRowHeight = Math.max(maxCellHeight, explicitHeight);

    // Wrap cell boxes in a BlockLayoutBox for the row
    const rowBox = createBlockLayoutBox(
      rowNode.key,
      0,
      rowY,
      availableWidth,
      resolvedRowHeight,
      cellBoxes,
    );
    rowBoxes.push(rowBox);
    rowY += resolvedRowHeight;
  }

  const resolvedRowHeights = rowBoxes.map((rb) => rb.height);

  return createTableLayoutBox(
    renderNode.key,
    x,
    y,
    availableWidth,
    rowY,
    rowBoxes,
    resolvedColumnWidths,
    resolvedRowHeights,
  );
}

/** Collect all word boxes from inline/text children, then wrap into lines. */
function layoutInlineContent(
  renderNode: RenderNode,
  x: number,
  y: number,
  availableWidth: number,
  measurer: TextMeasurer,
): LayoutBox[] {
  // Resolve line margins from block styles (ratios of resolved line height)
  const topMarginPx = resolveMarginPx(renderNode.styles.lineMarginTop ?? 0, renderNode, measurer);
  const bottomMarginPx = resolveMarginPx(renderNode.styles.lineMarginBottom ?? 0, renderNode, measurer);

  // Collect all word boxes from children, each with a unique key and styles.
  // Pass availableWidth so oversized words are broken at character boundaries.
  const wordBoxes: { word: WordBox; key: string; styles: RenderStyles }[] = [];
  collectWordBoxes(renderNode.children, measurer, wordBoxes, new Map(), renderNode.styles, availableWidth);

  // Wrap into lines
  // Line coordinates are relative to the parent block
  // Text box coordinates are relative to their line
  const lines: LayoutBox[] = [];
  let lineY = y + topMarginPx;
  let textX = 0;
  let lineChildren: LayoutBox[] = [];
  let lineHeight = 0;
  let lineIndex = 0;

  for (const { word, key, styles } of wordBoxes) {
    // If this word would exceed the available width and line is not empty, wrap
    if (lineChildren.length > 0 && textX + word.width > availableWidth) {
      // Finish current line
      lines.push(
        createLineLayoutBox(
          `${renderNode.key}-line-${lineIndex}`,
          x,
          lineY,
          availableWidth,
          lineHeight,
          lineChildren,
          topMarginPx,
          bottomMarginPx,
        ),
      );
      lineIndex++;
      lineY += lineHeight + Math.max(bottomMarginPx, topMarginPx);
      textX = 0;
      lineChildren = [];
      lineHeight = 0;
    }

    // Add word to current line (positioned relative to the line)
    const textBox = createTextLayoutBox(
      key,
      textX,
      0,
      word.width,
      word.height,
      word.text,
      styles,
    );
    lineChildren.push(textBox);
    textX += word.width;
    lineHeight = Math.max(lineHeight, word.height);
  }

  // Finish last line
  if (lineChildren.length > 0) {
    lines.push(
      createLineLayoutBox(
        `${renderNode.key}-line-${lineIndex}`,
        x,
        lineY,
        availableWidth,
        lineHeight,
        lineChildren,
        topMarginPx,
        bottomMarginPx,
      ),
    );
  }

  return lines;
}

/** Recursively collect word boxes from inline/text render nodes. */
function collectWordBoxes(
  children: readonly RenderNode[],
  measurer: TextMeasurer,
  out: { word: WordBox; key: string; styles: RenderStyles }[],
  keyCounters: Map<string, number>,
  inheritedStyles: RenderStyles = {},
  maxWidth?: number,
): void {
  for (const child of children) {
    if (child.type === "text") {
      const mergedStyles = { ...inheritedStyles, ...child.styles };
      const words = splitTextIntoWords(child.text, mergedStyles, measurer, maxWidth);
      for (let w = 0; w < words.length; w++) {
        const count = keyCounters.get(child.key) ?? 0;
        const key = count === 0 && words.length === 1
          ? child.key
          : `${child.key}:${count}`;
        keyCounters.set(child.key, count + 1);
        out.push({ word: words[w], key, styles: mergedStyles });
      }
    } else if (child.type === "inline") {
      const mergedStyles = { ...inheritedStyles, ...child.styles };
      collectWordBoxes(child.children, measurer, out, keyCounters, mergedStyles, maxWidth);
    }
  }
}

function layoutTextNode(
  renderNode: TextRenderNode,
  x: number,
  y: number,
  measurer: TextMeasurer,
): LayoutBox {
  const width = measurer.measureWidth(renderNode.text, renderNode.styles);
  const height = measurer.measureHeight(renderNode.styles);
  return createTextLayoutBox(renderNode.key, x, y, width, height, renderNode.text);
}

/**
 * Incremental layout: only re-layout branches where the render node changed.
 * For block formatting contexts, matches children by key and reuses unchanged
 * subtrees. For inline formatting contexts (line wrapping), re-layouts the
 * entire block when any inline child changes.
 */
export function layoutTreeIncremental(
  newRenderNode: RenderNode,
  oldRenderNode: RenderNode,
  oldLayoutTree: LayoutBox,
  containerWidth: number,
  measurer: TextMeasurer,
  pageHeight?: number,
  pageMargins?: PageMargins,
): LayoutBox {
  // If render node unchanged and container width unchanged, reuse layout
  if (newRenderNode === oldRenderNode && containerWidth === oldLayoutTree.width) {
    return oldLayoutTree;
  }

  // Only attempt subtree reuse for blocks with block children
  if (newRenderNode.type !== "block" && newRenderNode.type !== "inline" && newRenderNode.type !== "table") {
    return layoutTree(newRenderNode, containerWidth, measurer);
  }

  // Table nodes: full re-layout (incremental optimization can come later)
  if (newRenderNode.type === "table") {
    return layoutTree(newRenderNode, containerWidth, measurer, pageHeight, pageMargins);
  }

  const hasInlineContent = newRenderNode.children.some(
    (c) => c.type === "text" || c.type === "inline",
  );

  // Inline formatting contexts need full re-layout (line wrapping depends on all content)
  if (hasInlineContent) {
    return layoutTree(newRenderNode, containerWidth, measurer);
  }

  // Block formatting context: match children by key, reuse unchanged subtrees
  const paddingTop = newRenderNode.styles.paddingTop ?? 0;
  const paddingBottom = newRenderNode.styles.paddingBottom ?? 0;
  const paddingLeft = newRenderNode.styles.paddingLeft ?? 0;
  const paddingRight = newRenderNode.styles.paddingRight ?? 0;
  const layoutWidth = pageMargins
    ? containerWidth - pageMargins.left - pageMargins.right
    : containerWidth;
  const contentWidth = layoutWidth - paddingLeft - paddingRight;
  const contentY = paddingTop;

  // Build lookup maps from old render/layout by key
  const oldRenderByKey = new Map<string, RenderNode>();
  const oldLayoutByKey = new Map<string, LayoutBox>();
  for (let i = 0; i < oldRenderNode.children.length; i++) {
    const oldChild = oldRenderNode.children[i];
    oldRenderByKey.set(oldChild.key, oldChild);
    if (i < oldLayoutTree.children.length) {
      oldLayoutByKey.set(oldChild.key, oldLayoutTree.children[i]);
    }
  }

  // Layout children, reusing unchanged subtrees with line margin collapsing + block margin gaps
  const children: LayoutBox[] = [];
  let childY = contentY;
  let prevLineMarginBottom = 0;
  let prevBlockMarginBottom = 0;

  for (const child of newRenderNode.children) {
    const childLineMarginTop = computeTopEdgeLineMargin(child, measurer);
    const childBlockMarginTop = resolveMarginPx(child.styles.blockMarginTop ?? 0, child, measurer);
    if (children.length > 0) {
      const lineOverlap = Math.min(prevLineMarginBottom, childLineMarginTop);
      const lineGap = prevLineMarginBottom + childLineMarginTop - lineOverlap;
      const blockGap = Math.max(prevBlockMarginBottom, childBlockMarginTop);
      const extraSpace = Math.max(0, blockGap - lineGap);
      childY -= lineOverlap;
      childY += extraSpace;
    }

    const oldChild = oldRenderByKey.get(child.key);
    const oldLaid = oldLayoutByKey.get(child.key);

    let laid: LayoutBox;
    if (oldChild && oldLaid && child === oldChild && contentWidth === oldLaid.width) {
      laid = repositionBox(oldLaid, paddingLeft, childY);
    } else if (oldChild && oldLaid && child.type === oldChild.type) {
      const incrementalLaid = layoutTreeIncremental(
        child, oldChild, oldLaid, contentWidth, measurer,
      );
      laid = repositionBox(incrementalLaid, paddingLeft, childY);
    } else {
      laid = layoutNode(child, paddingLeft, childY, contentWidth, measurer);
    }

    children.push(laid);
    childY = laid.y + laid.height;
    prevLineMarginBottom = computeBottomEdgeLineMargin(child, measurer);
    prevBlockMarginBottom = resolveMarginPx(child.styles.blockMarginBottom ?? 0, child, measurer);
  }

  const lastChild = children.length > 0 ? children[children.length - 1] : undefined;
  const lastChildMarginBottom = lastChild?.type === "line" ? lastChild.marginBottom : 0;
  const contentBottom = lastChild !== undefined
    ? lastChild.y + lastChild.height + lastChildMarginBottom
    : contentY;
  const totalHeight = contentBottom + paddingBottom;

  const marker = newRenderNode.type === "block" ? newRenderNode.marker : undefined;
  const metadata = newRenderNode.type === "block" ? newRenderNode.metadata : undefined;
  const docBox = createBlockLayoutBox(
    newRenderNode.key,
    0,
    0,
    layoutWidth,
    totalHeight,
    children,
    marker,
    metadata,
  );
  if (pageHeight === undefined) return docBox;
  return paginateDocument(docBox, pageHeight, containerWidth, pageMargins);
}

/** Reposition a layout box to new coordinates (preserving internal layout). */
function repositionBox(box: LayoutBox, x: number, y: number): LayoutBox {
  if (box.x === x && box.y === y) return box;
  return Object.freeze({ ...box, x, y });
}
