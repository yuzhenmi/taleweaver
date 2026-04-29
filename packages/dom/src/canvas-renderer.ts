import type { LayoutBox, SelectionRect, UsedStyle, BorderStyle, Color } from "@taleweaver/core";
import { buildCssFontString } from "./font-config";
import type { ImageCache } from "./image-cache";

interface PhysicalBorderSides {
  topWidth: number; rightWidth: number; bottomWidth: number; leftWidth: number;
  topStyle: BorderStyle; rightStyle: BorderStyle; bottomStyle: BorderStyle; leftStyle: BorderStyle;
  topColor: Color; rightColor: Color; bottomColor: Color; leftColor: Color;
  topPadding: number; rightPadding: number; bottomPadding: number; leftPadding: number;
}

function physicalBorderSides(us: Readonly<UsedStyle>): PhysicalBorderSides {
  // Plan 3.A: horizontal-tb only.
  // LTR: blockStart=top, blockEnd=bottom, inlineStart=left, inlineEnd=right.
  // RTL: blockStart=top, blockEnd=bottom, inlineStart=right, inlineEnd=left.
  const isRtl = us.direction === "rtl";
  return {
    topWidth: us.borderBlockStartWidth, bottomWidth: us.borderBlockEndWidth,
    leftWidth: isRtl ? us.borderInlineEndWidth : us.borderInlineStartWidth,
    rightWidth: isRtl ? us.borderInlineStartWidth : us.borderInlineEndWidth,
    topStyle: us.borderBlockStartStyle, bottomStyle: us.borderBlockEndStyle,
    leftStyle: isRtl ? us.borderInlineEndStyle : us.borderInlineStartStyle,
    rightStyle: isRtl ? us.borderInlineStartStyle : us.borderInlineEndStyle,
    topColor: us.borderBlockStartColor, bottomColor: us.borderBlockEndColor,
    leftColor: isRtl ? us.borderInlineEndColor : us.borderInlineStartColor,
    rightColor: isRtl ? us.borderInlineStartColor : us.borderInlineEndColor,
    topPadding: us.paddingBlockStart, bottomPadding: us.paddingBlockEnd,
    leftPadding: isRtl ? us.paddingInlineEnd : us.paddingInlineStart,
    rightPadding: isRtl ? us.paddingInlineStart : us.paddingInlineEnd,
  };
}

interface PaintState {
  lastFont: string;
  imageCache?: ImageCache;
}

export type CursorState = "active" | "inactive" | "hidden";

export function paintCanvas(
  ctx: CanvasRenderingContext2D,
  layoutTree: LayoutBox,
  selectionRects: SelectionRect[],
  cursorPos: { x: number; y: number; height: number },
  cursorState: CursorState,
  canvasWidth: number,
  canvasHeight: number,
  visibleTop: number,
  visibleBottom: number,
  imageCache?: ImageCache,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.textBaseline = "top";

  // Selection rects (drawn first, behind text)
  if (selectionRects.length > 0) {
    ctx.fillStyle = "rgba(59, 130, 246, 0.3)";
    for (const rect of selectionRects) {
      if (rect.y + rect.height < visibleTop || rect.y > visibleBottom) continue;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  // Layout tree
  const state: PaintState = { lastFont: "", imageCache };
  paintBox(ctx, layoutTree, 0, 0, visibleTop, visibleBottom, state);

  // Cursor
  if (cursorState === "active") {
    ctx.fillStyle = "black";
    ctx.fillRect(cursorPos.x, cursorPos.y, 2, cursorPos.height);
  } else if (cursorState === "inactive") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(cursorPos.x, cursorPos.y, 2, cursorPos.height);
  }
}

export function paintPage(
  ctx: CanvasRenderingContext2D,
  pageBox: LayoutBox,
  selectionRects: SelectionRect[],
  cursorPos: { x: number; y: number; height: number } | null,
  cursorState: CursorState,
  imageCache?: ImageCache,
): void {
  // White background
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, pageBox.width, pageBox.height);
  ctx.textBaseline = "top";

  // Selection rects (already page-relative and filtered by pageIndex)
  if (selectionRects.length > 0) {
    ctx.fillStyle = "rgba(59, 130, 246, 0.3)";
    for (const rect of selectionRects) {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  // Paint the page box contents (page.y is 0, children are page-relative)
  const state: PaintState = { lastFont: "", imageCache };
  paintBox(ctx, pageBox, 0, 0, 0, pageBox.height, state);

  // Cursor (null means cursor is not on this page)
  if (cursorPos) {
    if (cursorState === "active") {
      ctx.fillStyle = "black";
      ctx.fillRect(cursorPos.x, cursorPos.y, 2, cursorPos.height);
    } else if (cursorState === "inactive") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(cursorPos.x, cursorPos.y, 2, cursorPos.height);
    }
  }
}

function paintBox(
  ctx: CanvasRenderingContext2D,
  box: LayoutBox,
  parentX: number,
  parentY: number,
  visibleTop: number,
  visibleBottom: number,
  state: PaintState,
): void {
  const absX = parentX + box.x;
  const absY = parentY + box.y;

  // Viewport culling: skip entire subtree if out of visible range
  if (absY + box.height < visibleTop || absY > visibleBottom) return;

  const cs = box.computedStyle;
  const us = box.usedStyle;

  if (box.type === "text-run") {
    const fontStr = buildCssFontString(cs);
    if (fontStr !== state.lastFont) {
      ctx.font = fontStr;
      state.lastFont = fontStr;
    }
    ctx.fillStyle = cs.color;
    const fontSize = cs.fontSize;
    const lineHeight = us.lineHeight;
    const halfLeading = (lineHeight - fontSize) / 2;
    ctx.fillText(box.text, absX, absY + halfLeading);
    if (cs.textDecoration === "underline") {
      const ulY = absY + halfLeading + fontSize + 1;
      ctx.fillRect(absX, ulY, box.width, 1);
    }
    return;
  }

  if (box.type === "marker") {
    const fontStr = buildCssFontString(cs);
    if (fontStr !== state.lastFont) {
      ctx.font = fontStr;
      state.lastFont = fontStr;
    }
    ctx.fillStyle = cs.color;
    const fontSize = cs.fontSize;
    const lineHeight = us.lineHeight;
    const halfLeading = (lineHeight - fontSize) / 2;
    ctx.fillText(box.text, absX, absY + halfLeading);
    return;
  }

  if (box.type === "block") {
    // Background
    if (cs.backgroundColor && cs.backgroundColor !== "transparent") {
      ctx.fillStyle = cs.backgroundColor;
      ctx.fillRect(absX, absY, box.width, box.height);
    }
    // Borders
    paintBorders(ctx, us, absX, absY, box.width, box.height);
    // Image content
    if (box.metadata?.image) {
      const img = box.metadata.image as { src: string; width: number; height: number };
      const cached = state.imageCache?.get(img.src);
      if (cached) {
        ctx.drawImage(cached, absX, absY, img.width, img.height);
      } else {
        ctx.fillStyle = "#f0f0f0";
        ctx.fillRect(absX, absY, img.width, img.height);
      }
    }
    // Horizontal line
    if (box.metadata?.horizontalLine) {
      ctx.fillStyle = "#dadce0";
      ctx.fillRect(absX + 8, absY + box.height / 2 - 0.5, box.width - 16, 1);
    }
    // Recurse into children
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
    }
    return;
  }

  if (box.type === "line") {
    // Lines don't paint themselves; just recurse into children.
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
    }
    return;
  }

  if (box.type === "inline") {
    // Background: full fragment
    if (cs.backgroundColor && cs.backgroundColor !== "transparent") {
      ctx.fillStyle = cs.backgroundColor;
      ctx.fillRect(absX, absY, box.width, box.height);
    }

    // Borders: edge-aware
    paintInlineBorders(ctx, us, absX, absY, box.width, box.height, box.fragmentEdge);

    // Recurse
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
    }
    return;
  }

  if (box.type === "table" || box.type === "table-row") {
    // Table and table-row just recurse into children
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
    }
    return;
  }

  if (box.type === "table-cell") {
    // Background
    if (cs.backgroundColor && cs.backgroundColor !== "transparent") {
      ctx.fillStyle = cs.backgroundColor;
      ctx.fillRect(absX, absY, box.width, box.height);
    }
    // Borders
    paintBorders(ctx, us, absX, absY, box.width, box.height);
    // Recurse into cell content
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
    }
    return;
  }

  // Plan 2/3 types: skip silently (not produced in Plan 1)
}

function paintBorders(
  ctx: CanvasRenderingContext2D,
  us: Readonly<UsedStyle>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const sides = physicalBorderSides(us);
  if (sides.topWidth > 0 && sides.topStyle !== "none") {
    ctx.fillStyle = sides.topColor;
    ctx.fillRect(x, y, w, sides.topWidth);
  }
  if (sides.bottomWidth > 0 && sides.bottomStyle !== "none") {
    ctx.fillStyle = sides.bottomColor;
    ctx.fillRect(x, y + h - sides.bottomWidth, w, sides.bottomWidth);
  }
  if (sides.leftWidth > 0 && sides.leftStyle !== "none") {
    ctx.fillStyle = sides.leftColor;
    ctx.fillRect(x, y, sides.leftWidth, h);
  }
  if (sides.rightWidth > 0 && sides.rightStyle !== "none") {
    ctx.fillStyle = sides.rightColor;
    ctx.fillRect(x + w - sides.rightWidth, y, sides.rightWidth, h);
  }
}

function paintInlineBorders(
  ctx: CanvasRenderingContext2D,
  us: Readonly<UsedStyle>,
  x: number,
  y: number,
  w: number,
  h: number,
  edge: "first" | "middle" | "last" | "only",
): void {
  const sides = physicalBorderSides(us);
  const drawTop    = sides.topWidth > 0    && sides.topStyle !== "none";
  const drawBottom = sides.bottomWidth > 0 && sides.bottomStyle !== "none";
  const drawLeft   = (edge === "first" || edge === "only") && sides.leftWidth > 0  && sides.leftStyle !== "none";
  const drawRight  = (edge === "last"  || edge === "only") && sides.rightWidth > 0 && sides.rightStyle !== "none";

  if (drawTop) {
    ctx.fillStyle = sides.topColor;
    ctx.fillRect(x, y, w, sides.topWidth);
  }
  if (drawBottom) {
    ctx.fillStyle = sides.bottomColor;
    ctx.fillRect(x, y + h - sides.bottomWidth, w, sides.bottomWidth);
  }
  if (drawLeft) {
    ctx.fillStyle = sides.leftColor;
    ctx.fillRect(x, y, sides.leftWidth, h);
  }
  if (drawRight) {
    ctx.fillStyle = sides.rightColor;
    ctx.fillRect(x + w - sides.rightWidth, y, sides.rightWidth, h);
  }
}
