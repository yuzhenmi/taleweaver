import type { LayoutBox, SelectionRect, UsedStyle, BorderStyle, Color } from "@taleweaver/core";
import { markStart, markEnd } from "@taleweaver/core";
import { buildCssFontString } from "./font-config";
import type { ImageCache } from "./image-cache";
import { hashPaintInputs } from "./paint-cache";
import type { PaintCache, Rect } from "./paint-cache";

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

/**
 * Paint the editor's scrollable canvas.
 *
 * When `cache` is provided (incremental mode):
 *   1. Walk the layout tree to detect which boxes changed since the last paint.
 *   2. Issue `ctx.clearRect` only over dirty regions.
 *   3. Repaint the full layout tree (changed boxes redraw over cleared regions;
 *      unchanged boxes repaint on top of their still-valid canvas pixels).
 *   4. Return the list of dirty rectangles for this pass.
 *
 * When `cache` is null/omitted (non-incremental, default):
 *   - Clear the whole canvas and repaint everything (original behaviour).
 *   - Return an empty array.
 *
 * Note — "true skip-painting" (where unchanged boxes are not repainted at all)
 * requires careful management of parent-background re-clearing and is deferred
 * to a future plan.  The current "clear-dirty + full-repaint" strategy is safe
 * and already avoids the full-canvas clear on unchanged frames.
 */
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
  cache?: PaintCache | null,
): Rect[] {
  const t = markStart("paint.total");
  try {
  ctx.textBaseline = "top";

  if (cache) {
    // Incremental path: detect changes, clear only dirty regions.
    const dirty: Rect[] = [];
    walkAndDetectChanges(layoutTree, 0, 0, cache, dirty);

    if (dirty.length > 0) {
      for (const r of dirty) {
        ctx.clearRect(r.x, r.y, r.w, r.h);
      }

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

    return dirty;
  }

  // Non-incremental path (cache = null / undefined): original behaviour.
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

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

  return [];
  } finally {
    markEnd("paint.total", t);
  }
}

/**
 * Paint a single page onto its dedicated canvas.
 *
 * Incremental behaviour mirrors `paintCanvas`:
 * - With `cache`: detect changes; clear only dirty regions; repaint full tree.
 *   Returns dirty rectangles.
 * - Without `cache`: clear+paint everything (original behaviour); returns [].
 *
 * PaintCache instances are 1:1 with canvases.  When Plan 5 introduces
 * pagination, each page canvas will carry its own PaintCache.
 */
export function paintPage(
  ctx: CanvasRenderingContext2D,
  pageBox: LayoutBox,
  selectionRects: SelectionRect[],
  cursorPos: { x: number; y: number; height: number } | null,
  cursorState: CursorState,
  imageCache?: ImageCache,
  cache?: PaintCache | null,
): Rect[] {
  const t = markStart("paint.total");
  try {
  ctx.textBaseline = "top";

  if (cache) {
    // Incremental path.
    const dirty: Rect[] = [];
    walkAndDetectChanges(pageBox, 0, 0, cache, dirty);

    if (dirty.length > 0) {
      for (const r of dirty) {
        ctx.clearRect(r.x, r.y, r.w, r.h);
      }

      // White background (re-paint only over dirty areas is sufficient
      // because clearRect already erased those pixels; paint the full box
      // so that cleared regions within the page get the white fill back).
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, pageBox.width, pageBox.height);

      // Selection rects
      if (selectionRects.length > 0) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.3)";
        for (const rect of selectionRects) {
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
      }

      // Paint the page box contents.
      const state: PaintState = { lastFont: "", imageCache };
      paintBox(ctx, pageBox, 0, 0, 0, pageBox.height, state);

      // Cursor
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

    return dirty;
  }

  // Non-incremental path: original behaviour.
  // White background
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, pageBox.width, pageBox.height);

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

  return [];
  } finally {
    markEnd("paint.total", t);
  }
}

// ── Dirty-region detection (Task 3 + 4) ─────────────────────────────────────

/**
 * Walk the layout tree and record the bounding rectangle of every box whose
 * paint-input hash differs from what is in `cache`.
 *
 * After the walk `cache` is updated so the next call sees the latest hashes.
 * The caller uses the returned `dirty` list to issue targeted clearRect calls
 * before a full repaint.
 *
 * @param box       Current node.
 * @param parentX   Accumulated x offset from parent nodes.
 * @param parentY   Accumulated y offset from parent nodes.
 * @param cache     Per-canvas PaintCache (1:1 with paint target).
 * @param dirty     Accumulator — rectangles of changed boxes are appended here.
 */
function walkAndDetectChanges(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  cache: PaintCache,
  dirty: Rect[],
): void {
  const t = markStart("paint.walk");
  try {
  const absX = parentX + box.x;
  const absY = parentY + box.y;

  const currentHash = hashPaintInputs(box);
  const cachedHash = cache.get(box);

  if (cachedHash !== currentHash) {
    // Box changed (or is new): record its region as dirty and update cache.
    dirty.push({ x: absX, y: absY, w: box.width, h: box.height });
    cache.set(box, currentHash);
  }

  // Always recurse — children may have changed even if parent hash is the same.
  if ("children" in box) {
    for (const child of box.children) {
      walkAndDetectChanges(child, absX, absY, cache, dirty);
    }
  }
  } finally {
    markEnd("paint.walk", t);
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
  const t = markStart("paint.draw");
  try {
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
  } finally {
    markEnd("paint.draw", t);
  }
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
