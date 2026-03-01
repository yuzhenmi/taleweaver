import type { RenderNode, RenderStyles, TextRenderNode } from "../render/render-node";
import type { TextMeasurer } from "./text-measurer";
import type { LayoutBox } from "./layout-node";
import { createBlockLayoutBox } from "./block-layout-box";
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
    const repositioned = Object.freeze({
      ...child,
      x: child.x + offsetX,
      y: offsetY + currentPageContentHeight,
    });
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

function layoutBlock(
  renderNode: RenderNode,
  x: number,
  y: number,
  availableWidth: number,
  measurer: TextMeasurer,
): LayoutBox {
  const marginTop = renderNode.styles.marginTop ?? 0;
  const marginBottom = renderNode.styles.marginBottom ?? 0;
  const paddingTop = renderNode.styles.paddingTop ?? 0;
  const paddingBottom = renderNode.styles.paddingBottom ?? 0;
  const paddingLeft = renderNode.styles.paddingLeft ?? 0;
  const paddingRight = renderNode.styles.paddingRight ?? 0;
  const contentWidth = availableWidth - paddingLeft - paddingRight;

  // Content starts at (paddingLeft, marginTop + paddingTop) relative to block origin
  const contentY = marginTop + paddingTop;

  // Check if this block's children are all blocks (block formatting context)
  // or contain inline/text (inline formatting context needing line wrapping)
  const hasInlineContent = renderNode.children.some(
    (c) => c.type === "text" || c.type === "inline",
  );

  let children: LayoutBox[];

  if (hasInlineContent) {
    // Inline formatting context: collect word boxes and do line wrapping
    // All coordinates are relative to this block's origin
    children = layoutInlineContent(
      renderNode,
      paddingLeft,
      contentY,
      contentWidth,
      measurer,
    );
  } else {
    // Block formatting context: stack children vertically
    // All coordinates are relative to this block's origin
    children = [];
    let childY = contentY;
    for (const child of renderNode.children) {
      const laid = layoutNode(child, paddingLeft, childY, contentWidth, measurer);
      children.push(laid);
      childY = laid.y + laid.height;
    }
  }

  const contentBottom =
    children.length > 0
      ? children[children.length - 1].y +
        children[children.length - 1].height
      : contentY;

  const totalHeight = contentBottom + paddingBottom + marginBottom;

  return createBlockLayoutBox(
    renderNode.key,
    x,
    y,
    availableWidth,
    totalHeight,
    children,
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
  // Collect all word boxes from children, each with a unique key and styles.
  // Pass availableWidth so oversized words are broken at character boundaries.
  const wordBoxes: { word: WordBox; key: string; styles: RenderStyles }[] = [];
  collectWordBoxes(renderNode.children, measurer, wordBoxes, new Map(), renderNode.styles, availableWidth);

  // Wrap into lines
  // Line coordinates are relative to the parent block
  // Text box coordinates are relative to their line
  const lines: LayoutBox[] = [];
  let lineY = y;
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
        ),
      );
      lineIndex++;
      lineY += lineHeight;
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
  if (newRenderNode.type !== "block" && newRenderNode.type !== "inline") {
    return layoutTree(newRenderNode, containerWidth, measurer);
  }

  const hasInlineContent = newRenderNode.children.some(
    (c) => c.type === "text" || c.type === "inline",
  );

  // Inline formatting contexts need full re-layout (line wrapping depends on all content)
  if (hasInlineContent) {
    return layoutTree(newRenderNode, containerWidth, measurer);
  }

  // Block formatting context: match children by key, reuse unchanged subtrees
  const marginTop = newRenderNode.styles.marginTop ?? 0;
  const paddingTop = newRenderNode.styles.paddingTop ?? 0;
  const paddingBottom = newRenderNode.styles.paddingBottom ?? 0;
  const marginBottom = newRenderNode.styles.marginBottom ?? 0;
  const paddingLeft = newRenderNode.styles.paddingLeft ?? 0;
  const paddingRight = newRenderNode.styles.paddingRight ?? 0;
  const layoutWidth = pageMargins
    ? containerWidth - pageMargins.left - pageMargins.right
    : containerWidth;
  const contentWidth = layoutWidth - paddingLeft - paddingRight;
  const contentY = marginTop + paddingTop;

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

  // Layout children, reusing unchanged subtrees
  const children: LayoutBox[] = [];
  let childY = contentY;

  for (const child of newRenderNode.children) {
    const oldChild = oldRenderByKey.get(child.key);
    const oldLaid = oldLayoutByKey.get(child.key);

    let laid: LayoutBox;
    if (oldChild && oldLaid && child === oldChild && contentWidth === oldLaid.width) {
      // Same render node reference and same width — reuse but reposition
      laid = repositionBox(oldLaid, paddingLeft, childY);
    } else if (oldChild && oldLaid && child.type === oldChild.type) {
      // Same key and type, different reference — recurse incrementally
      const incrementalLaid = layoutTreeIncremental(
        child, oldChild, oldLaid, contentWidth, measurer,
      );
      laid = repositionBox(incrementalLaid, paddingLeft, childY);
    } else {
      // New child or type changed — full layout
      laid = layoutNode(child, paddingLeft, childY, contentWidth, measurer);
    }

    children.push(laid);
    childY = laid.y + laid.height;
  }

  const contentBottom = children.length > 0
    ? children[children.length - 1].y + children[children.length - 1].height
    : contentY;
  const totalHeight = contentBottom + paddingBottom + marginBottom;

  const docBox = createBlockLayoutBox(
    newRenderNode.key,
    0,
    0,
    layoutWidth,
    totalHeight,
    children,
  );
  if (pageHeight === undefined) return docBox;
  return paginateDocument(docBox, pageHeight, containerWidth, pageMargins);
}

/** Reposition a layout box to new coordinates (preserving internal layout). */
function repositionBox(box: LayoutBox, x: number, y: number): LayoutBox {
  if (box.x === x && box.y === y) return box;
  return Object.freeze({ ...box, x, y });
}
