import type { LayoutBox, SelectionRect, ComputedStyle } from "@taleweaver/core";
import { buildCssFontString } from "./font-config";
import type { ImageCache } from "./image-cache";

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

  if (box.type === "text-run") {
    const fontStr = buildCssFontString(cs);
    if (fontStr !== state.lastFont) {
      ctx.font = fontStr;
      state.lastFont = fontStr;
    }
    ctx.fillStyle = cs.color;
    const fontSize = cs.fontSize as number;
    const lineHeightMultiplier = cs.lineHeight as number;
    const lineHeight = lineHeightMultiplier * fontSize;
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
    const fontSize = cs.fontSize as number;
    const lineHeightMultiplier = cs.lineHeight as number;
    const lineHeight = lineHeightMultiplier * fontSize;
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
    paintBorders(ctx, cs, absX, absY, box.width, box.height);
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
    paintInlineBorders(ctx, cs, absX, absY, box.width, box.height, box.fragmentEdge);

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
    paintBorders(ctx, cs, absX, absY, box.width, box.height);
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
  cs: Readonly<ComputedStyle>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (cs.borderTopWidth > 0 && cs.borderTopStyle !== "none") {
    ctx.fillStyle = cs.borderTopColor;
    ctx.fillRect(x, y, w, cs.borderTopWidth);
  }
  if (cs.borderBottomWidth > 0 && cs.borderBottomStyle !== "none") {
    ctx.fillStyle = cs.borderBottomColor;
    ctx.fillRect(x, y + h - cs.borderBottomWidth, w, cs.borderBottomWidth);
  }
  if (cs.borderLeftWidth > 0 && cs.borderLeftStyle !== "none") {
    ctx.fillStyle = cs.borderLeftColor;
    ctx.fillRect(x, y, cs.borderLeftWidth, h);
  }
  if (cs.borderRightWidth > 0 && cs.borderRightStyle !== "none") {
    ctx.fillStyle = cs.borderRightColor;
    ctx.fillRect(x + w - cs.borderRightWidth, y, cs.borderRightWidth, h);
  }
}

function paintInlineBorders(
  ctx: CanvasRenderingContext2D,
  cs: Readonly<ComputedStyle>,
  x: number,
  y: number,
  w: number,
  h: number,
  edge: "first" | "middle" | "last" | "only",
): void {
  const drawTop    = cs.borderTopWidth > 0    && cs.borderTopStyle !== "none";
  const drawBottom = cs.borderBottomWidth > 0 && cs.borderBottomStyle !== "none";
  const drawLeft   = (edge === "first" || edge === "only") && cs.borderLeftWidth > 0  && cs.borderLeftStyle !== "none";
  const drawRight  = (edge === "last"  || edge === "only") && cs.borderRightWidth > 0 && cs.borderRightStyle !== "none";

  if (drawTop) {
    ctx.fillStyle = cs.borderTopColor;
    ctx.fillRect(x, y, w, cs.borderTopWidth);
  }
  if (drawBottom) {
    ctx.fillStyle = cs.borderBottomColor;
    ctx.fillRect(x, y + h - cs.borderBottomWidth, w, cs.borderBottomWidth);
  }
  if (drawLeft) {
    ctx.fillStyle = cs.borderLeftColor;
    ctx.fillRect(x, y, cs.borderLeftWidth, h);
  }
  if (drawRight) {
    ctx.fillStyle = cs.borderRightColor;
    ctx.fillRect(x + w - cs.borderRightWidth, y, cs.borderRightWidth, h);
  }
}
