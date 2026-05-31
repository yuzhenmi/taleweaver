import type { LayoutBox, SelectionRect, UsedStyle, BorderStyle, Color } from "@taleweaver/core";
import { markStart, markEnd } from "@taleweaver/core";
import { buildCssFontString } from "./font-config";
import { segmentClusters } from "./text-clusters";
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
    walkAndDetectChanges(layoutTree, 0, 0, cache, dirty, true);
    cache.setLastRoot(layoutTree);

    // Also dirty the cursor and selection regions when they change — these
    // don't touch the layout tree but still need a repaint (cursor moves on
    // click, selection rects on drag, cursor visibility on blink).
    addCursorDirty(dirty, cache, cursorPos, cursorState);
    addSelectionDirty(dirty, cache, selectionRects);

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
    // Walk in page-local coordinates so dirty-rect coords match canvas pixels;
    // see comment at the paintBox call below.
    walkAndDetectChanges(pageBox, -pageBox.x, -pageBox.y, cache, dirty, true);
    cache.setLastRoot(pageBox);

    // Dirty the cursor region when the cursor moved or changed state
    // (paintPage is called per-page; cursorPos may be null when the cursor
    // is not on this page).
    addCursorDirty(
      dirty,
      cache,
      cursorPos ?? { x: 0, y: 0, height: 0 },
      cursorPos === null ? "hidden" : cursorState,
    );
    addSelectionDirty(dirty, cache, selectionRects);

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
      // pageBox.x/y are document-relative (the page's offset within the wrapping
  // root BlockBox). The canvas paints in page-local coordinates (origin at the
  // page's top-left). Pass negative pageBox offsets so paintBox's first
  // computed absY is 0 — otherwise the page gets viewport-culled because
  // its absY (≈ pageBlockOffset = pageIndex × pageHeight) exceeds the
  // canvas's visible bound (pageBox.height). This bug was latent until P1.B
  // since page 0 has y=0 and rendered correctly by accident.
  paintBox(ctx, pageBox, -pageBox.x, -pageBox.y, 0, pageBox.height, state);

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
  // pageBox.x/y are document-relative (the page's offset within the wrapping
  // root BlockBox). The canvas paints in page-local coordinates (origin at the
  // page's top-left). Pass negative pageBox offsets so paintBox's first
  // computed absY is 0 — otherwise the page gets viewport-culled because
  // its absY (≈ pageBlockOffset = pageIndex × pageHeight) exceeds the
  // canvas's visible bound (pageBox.height). This bug was latent until P1.B
  // since page 0 has y=0 and rendered correctly by accident.
  paintBox(ctx, pageBox, -pageBox.x, -pageBox.y, 0, pageBox.height, state);

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
/**
 * If the cursor's position or state has changed since the last paint, push
 * the OLD and NEW cursor rects into `dirty` so the paint loop clears + redraws
 * those regions. Width is hardcoded to 2px (the cursor's painted width).
 * This is what lets click/move/blink visually update even when the layout
 * tree is reference-equal to the previous frame.
 */
function addCursorDirty(
  dirty: Rect[],
  cache: PaintCache,
  cursorPos: { x: number; y: number; height: number },
  cursorState: "active" | "inactive" | "hidden",
): void {
  const last = cache.getLastCursor();
  const current = { x: cursorPos.x, y: cursorPos.y, height: cursorPos.height, state: cursorState };
  const moved = last === null
    || last.x !== current.x
    || last.y !== current.y
    || last.height !== current.height
    || last.state !== current.state;
  if (moved) {
    if (last !== null && last.state !== "hidden") {
      dirty.push({ x: last.x, y: last.y, w: 2, h: last.height });
    }
    if (current.state !== "hidden") {
      dirty.push({ x: current.x, y: current.y, w: 2, h: current.height });
    }
    cache.setLastCursor(current);
  }
}

/**
 * If the selection rects changed since the last paint, push union(prev, curr)
 * into `dirty`. Selection rect changes happen on drag-select; without this
 * dirty entry, the layout-reference-equal short-circuit would skip painting.
 *
 * SelectionRect uses `width/height`; the cache stores `Rect` shape (`w/h`),
 * so each rect is translated before storage and comparison.
 */
function addSelectionDirty(
  dirty: Rect[],
  cache: PaintCache,
  selectionRects: readonly SelectionRect[],
): void {
  const last = cache.getLastSelectionRects();
  const current: Rect[] = selectionRects.map((r) => ({
    x: r.x,
    y: r.y,
    w: r.width,
    h: r.height,
  }));
  // Cheap structural compare: same length + every rect matches by value.
  let same = last !== null && last.length === current.length;
  if (same && last !== null) {
    for (let i = 0; i < current.length; i++) {
      const a = last[i];
      const b = current[i];
      if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) {
        same = false;
        break;
      }
    }
  }
  if (!same) {
    if (last !== null) {
      for (const r of last) dirty.push({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
    for (const r of current) dirty.push({ x: r.x, y: r.y, w: r.w, h: r.h });
    cache.setLastSelectionRects(current);
  }
}

function walkAndDetectChanges(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  cache: PaintCache,
  dirty: Rect[],
  isRoot: boolean = false,
): void {
  const t = markStart("paint.walk");
  try {
  // Root short-circuit: when the entire layout tree is reference-equal to
  // the previously walked root, no LayoutBox in the tree can have changed
  // (Plan 3.H subtree-reuse machinery guarantees that subtrees with the
  // same reference have the same content). Skip the entire walk.
  //
  // This is the difference between O(N-boxes) and O(1) on cursor moves:
  // when cursor changes don't touch the layout tree, the new tree is
  // reference-equal to the previous one and the walk returns immediately.
  if (isRoot && cache.getLastRoot() === box) {
    return;
  }

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
      walkAndDetectChanges(child, absX, absY, cache, dirty, false);
    }
  }
  // C.2c (T5): a page's header/footer slots are NAMED fields, NOT in
  // `box.children`, so the `"children" in box` recursion above never reaches
  // them. Walk them explicitly so a slot's content/geometry change marks its
  // region dirty for repaint (plan-review I5). Page-local origin matches the
  // children's (absX/absY); the slot box carries its own page-local x/y.
  if (box.type === "page") {
    if (box.headerSlot !== null) {
      walkAndDetectChanges(box.headerSlot, absX, absY, cache, dirty, false);
    }
    if (box.footerSlot !== null) {
      walkAndDetectChanges(box.footerSlot, absX, absY, cache, dirty, false);
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
    // box.height is the line's pixel height (tokBlockSize from the IFC).
    // us.lineHeight is the CSS computed value — for `line-height: 1.2` this
    // is `1.2` (the unitless ratio), NOT `19.2` (the resolved pixels). Using
    // us.lineHeight directly produces halfLeading = (1.2 - 16) / 2 = -7.4
    // and paints text ~9px above the line top.
    const halfLeading = (box.height - fontSize) / 2;
    const baselineY = absY + halfLeading;
    // #330: paint cluster-by-cluster at the SAME cumulative advances the shaper
    // measured (`Σ ctx.measureText(cluster).width`), instead of one
    // `fillText(box.text)` that the browser would lay out with native kerning.
    // The caret / hit-test / layout all SUM these per-cluster advances; a single
    // kerned whole-run draw drifts the painted glyphs from the measured caret
    // (worst at a long token's tail). `ctx.font` is already set from `cs` above,
    // so `measureText` here measures against the SAME font the shaper used →
    // painted glyph origins == summed advances == caret x by construction.
    // (Trades whole-string kerning for caret accuracy — correct for a word
    // processor; real cluster-shaping/HarfBuzz restores both later.)
    let clusterX = absX;
    for (const cluster of segmentClusters(box.text)) {
      ctx.fillText(cluster, clusterX, baselineY);
      clusterX += ctx.measureText(cluster).width;
    }
    if (cs.textDecoration === "underline") {
      const ulY = absY + halfLeading + fontSize + 1;
      ctx.fillRect(absX, ulY, box.width, 1);
    } else if (cs.textDecoration === "line-through") {
      // Strikethrough (Google Docs / CSS line-through): a rule through the middle
      // of the text. ~em-box center is a good approximation; uses the current
      // fillStyle (= cs.color, i.e. currentColor per CSS text-decoration-color).
      // Exact y is a pixel detail tunable in-browser.
      const stY = absY + halfLeading + fontSize * 0.5;
      ctx.fillRect(absX, stY, box.width, 1);
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
    // See text-run branch above for why box.height (not us.lineHeight).
    const halfLeading = (box.height - fontSize) / 2;
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
    // Footnote separator rule (E5 / D1): a short thin rule at the inline-start
    // of the footnote area, above the bodies — Google Docs parity. The layout
    // (virtual-layout-tree) emits a full-content-width separator BlockBox
    // carrying `{ footnoteSeparator: true }`; without this branch the rule never
    // painted (it was invisible). Drawn short (~1.5in, like Google Docs) at the
    // box's vertical center; RTL anchors it at the inline-start (right edge).
    // Exact length/colour are visual details tunable in-browser.
    if (box.metadata?.footnoteSeparator) {
      const ruleLength = Math.min(box.width, 144);
      const ruleX =
        box.direction === "rtl" ? absX + box.width - ruleLength : absX;
      ctx.fillStyle = "#000000";
      ctx.fillRect(ruleX, absY + box.height / 2 - 0.5, ruleLength, 1);
    }
    // Recurse into children
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
    }
    return;
  }

  if (box.type === "inline-block") {
    // An inline-block is a block-formatting box positioned inline (e.g. a
    // footnote call-marker's superscript glyph). It paints like a block —
    // full-box background + borders (NOT edge-split like an inline fragment) —
    // then recurses into its inner BFC's line boxes.
    if (cs.backgroundColor && cs.backgroundColor !== "transparent") {
      ctx.fillStyle = cs.backgroundColor;
      ctx.fillRect(absX, absY, box.width, box.height);
    }
    paintBorders(ctx, us, absX, absY, box.width, box.height);
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

  if (box.type === "page") {
    // The page's white background is painted by `paintPage` before the
    // paintBox walk (and before selection rects are drawn). Repainting it
    // here would overwrite the selection-rect layer that was just drawn
    // between paintPage's background fill and this paintBox call.
    //
    // The earlier comment claimed this was a defensive fallback for
    // single-canvas mode painting a paginated tree — but `paintCanvas` /
    // single-canvas mode never receives a paginated tree (the controller
    // routes paginated layouts through `paintPages` / `paintPage`). The
    // fallback was dead code masking a real rendering bug.
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
    }
    // C.2c (T5) + #328: paint the header/footer slots. They are NAMED fields
    // (not in `box.children`), positioned in PAGE-LOCAL coords (header at
    // block-offset 0, growing DOWN from the page top; footer anchored at
    // `pageBlockSize − effectiveBottomInset`, growing UP so it ends at the page
    // bottom). Each is laid at its NATURAL height; a header/footer taller than
    // its margin band GROWS the page's effective inset, which pushes the body
    // content down/up so the slot and body never overlap (the grow-and-push is
    // computed in the layout pass — the renderer just paints the slot box at the
    // page-local x/y it carries). Painted after children, using the same
    // page-local origin.
    if (box.headerSlot !== null) {
      paintBox(ctx, box.headerSlot, absX, absY, visibleTop, visibleBottom, state);
    }
    if (box.footerSlot !== null) {
      paintBox(ctx, box.footerSlot, absX, absY, visibleTop, visibleBottom, state);
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
