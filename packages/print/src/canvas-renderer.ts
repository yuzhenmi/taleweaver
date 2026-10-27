import type { UsedStyle, ComputedStyle, LeaderStyle } from "@taleweaver/core";
import type { LayoutBox } from "./layout/layout-node";
import type { SelectionRect } from "./cursor/selection-geometry";
import { markStart, markEnd, resolveSpacingPx, clusterSpacing, fromTransformFns, resolveTransformOrigin, physicalBorderSides } from "@taleweaver/core";
import { buildCssFontString } from "./font-config";
import { segmentClusters } from "./text-clusters";
import type { ImageCache } from "./image-cache";
import { hashPaintInputs } from "./paint-cache";
import type { PaintCache, Rect, DecorationRectSnapshot } from "./paint-cache";
import { CURRENT_COLOR, type DecorationRect, type DecorationUnderlinePaint } from "./decoration-geometry";
export type { DecorationRect } from "./decoration-geometry";
import { createOffscreenSurface } from "./offscreen-surface";

const SELECTION_FILL = "rgba(59, 130, 246, 0.3)";

/** Underline stroke thickness (px). */
const UNDERLINE_THICKNESS = 1;
/** Wavy underline: half-period and amplitude (px). */
const WAVE_HALF_PERIOD = 2;
const WAVE_AMPLITUDE = 1.5;

/**
 * Decoration paint input, indexed for the per-box paint slots.
 * Decorations paint like their DOM counterparts in digital — CSS backgrounds:
 * a BLOCK decoration fills right after its box's own background (under its
 * borders, image and children); an INLINE fragment fills in each text run's
 * background slot (over the run's highlight, under glyphs, images and the
 * selection), clipped to the run. Underlines paint in the same slot, under the
 * glyphs (CSS paints underlines before text).
 */
interface DecorationPaint {
  /** Block box key (= block id) → fill colours, bottom-to-top. */
  readonly blockFills: ReadonlyMap<string, readonly string[]>;
  /** Inline fragments, bottom-to-top. */
  readonly inline: readonly DecorationRect[];
}

const NO_DECORATION_PAINT: DecorationPaint = { blockFills: new Map(), inline: [] };

function indexDecorations(rects: readonly DecorationRect[]): DecorationPaint {
  if (rects.length === 0) return NO_DECORATION_PAINT;
  const blockFills = new Map<string, string[]>();
  const seen = new Set<string>();
  const inline: DecorationRect[] = [];
  for (const r of rects) {
    if (r.kind === "inline") {
      inline.push(r);
      continue;
    }
    if (r.backgroundColor === undefined || r.decoration.kind !== "block") continue;
    const key = r.decoration.blockId;
    const once = `${key}\u0000${r.decoration.id}`;
    if (seen.has(once)) continue; // a block fragmented into several boxes: one fill per box
    seen.add(once);
    const fills = blockFills.get(key);
    if (fills === undefined) blockFills.set(key, [r.backgroundColor]);
    else fills.push(r.backgroundColor);
  }
  return { blockFills, inline };
}

/** Block-decoration fills for the box `key`, right after its own background. */
function paintBlockDecorations(
  ctx: CanvasRenderingContext2D,
  state: PaintState,
  key: string,
  absX: number,
  absY: number,
  width: number,
  height: number,
  textColor: string,
): void {
  const fills = state.decorations.blockFills.get(key);
  if (fills === undefined) return;
  for (const fill of fills) {
    ctx.fillStyle = fill === CURRENT_COLOR ? textColor : fill;
    ctx.fillRect(absX, absY, width, height);
  }
}

/**
 * The inline fragments over one text run, clipped to the run's inline extent.
 * Fragments are in the painted frame (relative offsets applied); `state.frameDx/Dy`
 * maps them into an opacity-group surface.
 */
function paintRunDecorations(
  ctx: CanvasRenderingContext2D,
  state: PaintState,
  runX: number,
  runY: number,
  runW: number,
  runH: number,
  textColor: string,
): void {
  const inline = state.decorations.inline;
  if (inline.length === 0 || state.insideAtomicInline > 0) return;
  // The run in fragment coordinates.
  const x = runX - state.frameDx;
  const y = runY - state.frameDy;
  for (const f of inline) {
    let lo: number;
    let hi: number;
    if (f.vertical) {
      const cx = x + runW / 2;
      if (cx < f.x || cx >= f.x + f.width) continue;
      lo = Math.max(y, f.y);
      hi = Math.min(y + runH, f.y + f.height);
    } else {
      const cy = y + runH / 2;
      if (cy < f.y || cy >= f.y + f.height) continue;
      lo = Math.max(x, f.x);
      hi = Math.min(x + runW, f.x + f.width);
    }
    if (hi <= lo) continue;
    if (f.backgroundColor !== undefined) {
      ctx.fillStyle = f.backgroundColor === CURRENT_COLOR ? textColor : f.backgroundColor;
      if (f.vertical) ctx.fillRect(f.x + state.frameDx, lo + state.frameDy, f.width, hi - lo);
      else ctx.fillRect(lo + state.frameDx, f.y + state.frameDy, hi - lo, f.height);
    }
    if (f.underline !== undefined) paintUnderline(ctx, state, f, f.underline, lo, hi, textColor);
  }
}

/**
 * Stroke the part `[lo, hi)` (fragment frame, along the inline axis) of one
 * decoration underline. The dotted / dashed / wavy pattern is phased from the
 * FRAGMENT's start, so a fragment spanning several runs draws one continuous
 * pattern. Solid / dotted (1px dots every 2px) / dashed (3px dashes every 5px)
 * are axis-aligned fills; wavy is a zig-zag stroke (round joins) ending exactly at
 * `hi`. Everything stays inside the fragment rect (see `underlineFor`'s clamp).
 */
function paintUnderline(
  ctx: CanvasRenderingContext2D,
  state: PaintState,
  f: DecorationRect,
  u: DecorationUnderlinePaint,
  lo: number,
  hi: number,
  textColor: string,
): void {
  const color = u.color ?? textColor;
  const origin = u.vertical ? f.y : f.x;
  const dAlong = u.vertical ? state.frameDy : state.frameDx;
  const dAcross = u.vertical ? state.frameDx : state.frameDy;
  const across = u.offset + dAcross;
  const fill = (a: number, b: number): void => {
    if (b <= a) return;
    if (u.vertical) ctx.fillRect(across - UNDERLINE_THICKNESS / 2, a + dAlong, UNDERLINE_THICKNESS, b - a);
    else ctx.fillRect(a + dAlong, across - UNDERLINE_THICKNESS / 2, b - a, UNDERLINE_THICKNESS);
  };
  ctx.fillStyle = color;
  if (u.style === "solid") {
    fill(lo, hi);
    return;
  }
  if (u.style === "dotted" || u.style === "dashed") {
    const [on, period] = u.style === "dotted" ? [1, 2] : [3, 5];
    const first = origin + Math.floor((lo - origin) / period) * period;
    for (let p = first; p < hi; p += period) fill(Math.max(p, lo), Math.min(p + on, hi));
    return;
  }
  // Wavy: a triangle wave phased from the fragment start, sampled at `lo`, every
  // grid point inside, and exactly `hi`.
  const wave = (p: number): number => {
    const phase = (p - origin) / WAVE_HALF_PERIOD;
    const k = Math.floor(phase);
    const v0 = k % 2 === 0 ? -WAVE_AMPLITUDE : WAVE_AMPLITUDE;
    return across + v0 + (-2 * v0) * (phase - k);
  };
  const point = (p: number, first: boolean): void => {
    const a = p + dAlong;
    const b = wave(p);
    if (u.vertical) {
      if (first) ctx.moveTo(b, a);
      else ctx.lineTo(b, a);
    } else if (first) ctx.moveTo(a, b);
    else ctx.lineTo(a, b);
  };
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = UNDERLINE_THICKNESS;
  ctx.lineJoin = "round";
  ctx.beginPath();
  point(lo, true);
  for (let p = origin + (Math.floor((lo - origin) / WAVE_HALF_PERIOD) + 1) * WAVE_HALF_PERIOD; p < hi; p += WAVE_HALF_PERIOD) point(p, false);
  point(hi, false);
  ctx.stroke();
  ctx.restore();
}

interface PaintState {
  lastFont: string;
  imageCache?: ImageCache;
  /** Decorations to paint in the per-box slots. */
  decorations: DecorationPaint;
  /** Paint frame minus decoration-fragment frame (non-zero only inside an
   *  opacity-group surface; fragments already carry `position: relative` shifts). */
  frameDx: number;
  frameDy: number;
  /** > 0 while painting inside an inline-block (its band covers it whole). */
  insideAtomicInline: number;
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
  decorations: readonly DecorationRect[],
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
    addDecorationDirty(dirty, cache, decorations);

    if (dirty.length > 0) {
      for (const r of dirty) {
        ctx.clearRect(r.x, r.y, r.w, r.h);
      }

      // Two-phase paint (#397): background layer (incl. decorations, in their
      // CSS-background slots) → selection overlay → foreground (text) layer →
      // cursor, so the translucent selection tint composites OVER content
      // backgrounds and decorations and UNDER the glyphs.
      const state: PaintState = { lastFont: "", imageCache, decorations: indexDecorations(decorations), frameDx: 0, frameDy: 0, insideAtomicInline: 0 };

      // Background phase: content backgrounds, borders, images, highlights.
      paintBox(ctx, layoutTree, 0, 0, visibleTop, visibleBottom, state, "background");


      // Selection rects (over backgrounds, under text)
      if (selectionRects.length > 0) {
        ctx.fillStyle = SELECTION_FILL;
        for (const rect of selectionRects) {
          if (rect.y + rect.height < visibleTop || rect.y > visibleBottom) continue;
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
      }

      // Foreground phase: glyphs + text decorations.
      paintBox(ctx, layoutTree, 0, 0, visibleTop, visibleBottom, state, "foreground");

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

  // Two-phase paint (#397): background (incl. decorations) → selection overlay →
  // foreground (text) → cursor. The selection tint composites over content
  // backgrounds and decorations, under text.
  const state: PaintState = { lastFont: "", imageCache, decorations: indexDecorations(decorations), frameDx: 0, frameDy: 0, insideAtomicInline: 0 };

  // Background phase
  paintBox(ctx, layoutTree, 0, 0, visibleTop, visibleBottom, state, "background");


  // Selection rects (over backgrounds, under text)
  if (selectionRects.length > 0) {
    ctx.fillStyle = SELECTION_FILL;
    for (const rect of selectionRects) {
      if (rect.y + rect.height < visibleTop || rect.y > visibleBottom) continue;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  // Foreground phase (glyphs + decorations)
  paintBox(ctx, layoutTree, 0, 0, visibleTop, visibleBottom, state, "foreground");

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
  decorations: readonly DecorationRect[],
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
    addDecorationDirty(dirty, cache, decorations);

    if (dirty.length > 0) {
      for (const r of dirty) {
        ctx.clearRect(r.x, r.y, r.w, r.h);
      }

      // White background (re-paint only over dirty areas is sufficient
      // because clearRect already erased those pixels; paint the full box
      // so that cleared regions within the page get the white fill back).
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, pageBox.width, pageBox.height);

      // Two-phase paint (#397): page white bg (above) → background phase →
      // (incl. decorations) → selection
      // overlay → foreground (text) phase → cursor.
      const state: PaintState = { lastFont: "", imageCache, decorations: indexDecorations(decorations), frameDx: 0, frameDy: 0, insideAtomicInline: 0 };
      // pageBox.x/y are document-relative (the page's offset within the wrapping
  // root BlockBox). The canvas paints in page-local coordinates (origin at the
  // page's top-left). Pass negative pageBox offsets so paintBox's first
  // computed absY is 0 — otherwise the page gets viewport-culled because
  // its absY (≈ pageBlockOffset = pageIndex × pageHeight) exceeds the
  // canvas's visible bound (pageBox.height). This bug was latent until P1.B
  // since page 0 has y=0 and rendered correctly by accident.

      // Background phase: content backgrounds, borders, images, highlights.
      paintBox(ctx, pageBox, -pageBox.x, -pageBox.y, 0, pageBox.height, state, "background");


      // Selection rects (over backgrounds, under text)
      // Rects are already page-local and filtered to this page by the controller.
      if (selectionRects.length > 0) {
        ctx.fillStyle = SELECTION_FILL;
        for (const rect of selectionRects) {
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
      }

      // Foreground phase: glyphs + text decorations.
      paintBox(ctx, pageBox, -pageBox.x, -pageBox.y, 0, pageBox.height, state, "foreground");

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

  // Two-phase paint (#397): page white bg (above) → background phase →
  // (incl. decorations) → selection
  // overlay → foreground (text) phase → cursor.
  const state: PaintState = { lastFont: "", imageCache, decorations: indexDecorations(decorations), frameDx: 0, frameDy: 0, insideAtomicInline: 0 };
  // pageBox.x/y are document-relative (the page's offset within the wrapping
  // root BlockBox). The canvas paints in page-local coordinates (origin at the
  // page's top-left). Pass negative pageBox offsets so paintBox's first
  // computed absY is 0 — otherwise the page gets viewport-culled because
  // its absY (≈ pageBlockOffset = pageIndex × pageHeight) exceeds the
  // canvas's visible bound (pageBox.height). This bug was latent until P1.B
  // since page 0 has y=0 and rendered correctly by accident.

  // Background phase: content backgrounds, borders, images, highlights.
  paintBox(ctx, pageBox, -pageBox.x, -pageBox.y, 0, pageBox.height, state, "background");


  // Selection rects (already page-relative and filtered by pageIndex)
  if (selectionRects.length > 0) {
    ctx.fillStyle = SELECTION_FILL;
    for (const rect of selectionRects) {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  // Foreground phase: glyphs + text decorations.
  paintBox(ctx, pageBox, -pageBox.x, -pageBox.y, 0, pageBox.height, state, "foreground");

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
      if (a === undefined || b === undefined) {
        throw new Error(`canvas-renderer: selection rect at ${i} unexpectedly undefined`);
      }
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

/**
 * If the decoration fragments changed since the last paint, push union(prior,
 * curr) into `dirty`. Decoration changes (a host `setDecorations`, a find
 * next/prev flipping the active fill, a comment hover) leave the layout + cursor
 * reference-equal; without this the incremental short-circuit would skip the
 * repaint. The snapshot carries each fragment's geometry PLUS its look (fill +
 * underline), so a colour-only change (same geometry) is still detected; the
 * decoration id is not compared (it never affects pixels). Clearing (curr empty)
 * dirties the prior fragments so the old band is erased.
 */
function addDecorationDirty(
  dirty: Rect[],
  cache: PaintCache,
  decorations: readonly DecorationRect[],
): void {
  const last = cache.getLastDecorationRects();
  // Inflated by 1px: antialiased stroke edges may bleed past the fragment rect.
  const current: DecorationRectSnapshot[] = decorations.map((r) => ({
    x: r.x - 1,
    y: r.y - 1,
    w: r.width + 2,
    h: r.height + 2,
    look: decorationLook(r),
  }));
  let same = last !== null && last.length === current.length;
  if (same && last !== null) {
    for (let i = 0; i < current.length; i++) {
      const a = last[i];
      const b = current[i];
      if (a === undefined || b === undefined) {
        throw new Error(`canvas-renderer: decoration rect at ${i} unexpectedly undefined`);
      }
      if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.look !== b.look) {
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
    cache.setLastDecorationRects(current);
  }
}

/** Every pixel-affecting property of a decoration fragment other than its rect. */
function decorationLook(r: DecorationRect): string {
  const u = r.underline;
  return `${r.kind}|${r.backgroundColor ?? ""}|${u === undefined ? "" : `${u.color ?? ""}:${u.style}:${u.vertical ? "v" : "h"}:${u.offset}`}`;
}

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

  // Mirror paintBox's `position: relative` shift: a relatively-positioned box
  // and its descendants paint at `box.{x,y} + relativeOffset`, so the dirty
  // rect AND the child-recursion origin must use the SHIFTED coordinates.
  // Without this, incremental repaint clears the pre-offset region while
  // paintBox draws at the shifted region → stale pixels linger at the shift.
  const rel = box.relativeOffset;
  const absX = parentX + box.x + (rel !== undefined ? rel.dx : 0);
  const absY = parentY + box.y + (rel !== undefined ? rel.dy : 0);

  const currentHash = hashPaintInputs(box);
  const cachedHash = cache.get(box);

  if (cachedHash !== currentHash) {
    // Box changed (or is new): record its region as dirty and update cache.
    // KNOWN v1 LIMITATION (named follow-up — see 1.9-positioning.md): for a
    // `transform`-bearing box the PAINTED bounds (after rotate / large translate)
    // can extend outside this pre-transform `[absX,absY,width,height]` rect, so an
    // incremental repaint may not clear stale pixels at the prior painted position.
    // No functional bug today: a `transform` edit changes the box's computedStyle →
    // a new LayoutBox ref → the root short-circuit breaks and the full walk fires
    // (and transforms aren't user-reachable yet). The fix — expand the dirty rect to
    // the transformed painted bounding box, like the relativeOffset shift above — is
    // deferred, bundled with the transformed-content selection/caret follow-up.
    dirty.push({ x: absX, y: absY, w: box.width, h: box.height });
    cache.set(box, currentHash);
  }

  // Always recurse — children may have changed even if parent hash is the same.
  if ("children" in box) {
    for (const child of box.children) {
      walkAndDetectChanges(child, absX, absY, cache, dirty, false);
    }
  }
  // A MultiColumnBox holds its content under `columns` (NOT `children`), so the
  // generic `"children" in box` recursion above never reaches it. Walk each column
  // BY NAME so a changed column subtree marks its region dirty — same lesson as the
  // header/footer slots below (a painted box absent from this walk leaves stale
  // pixels on incremental repaint). Same page-local origin (absX/absY) the painter
  // uses for the columns.
  if (box.type === "multicolumn") {
    for (const col of box.columns) {
      walkAndDetectChanges(col, absX, absY, cache, dirty, false);
    }
  }
  // POSITIONING slice 3 — abs-pos children are NAMED out-of-flow descendants (NOT in
  // `box.children`), so the recursion above never reaches them. Walk them BY NAME so a
  // changed abs subtree marks its region dirty for repaint AND its old region is
  // cleared — same lesson as the relative-offset dirty-rect (a painted box absent from
  // the dirty walk leaves stale pixels). Same origin (absX/absY) the painter uses.
  if (box.absoluteChildren !== undefined) {
    for (const absChild of box.absoluteChildren) {
      walkAndDetectChanges(absChild, absX, absY, cache, dirty, false);
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
    // DA3: the footnote SLOT is a NAMED field (like header/footer), NOT in
    // `box.children`, so walk it BY NAME — otherwise a changed footnote body
    // never marks its region dirty and the stale text/number is never repainted.
    // Same page-local origin (absX/absY); the slot carries its own page-local x/y.
    if (box.footnoteSlot !== null) {
      walkAndDetectChanges(box.footnoteSlot, absX, absY, cache, dirty, false);
    }
  }
  } finally {
    markEnd("paint.walk", t);
  }
}

/**
 * Two-phase paint (see `docs/architecture/2-print/2.2-canvas-renderer.md`).
 *
 * `phase` selects which visual layer this walk paints, so the caller can
 * interleave the translucent selection overlay BETWEEN them:
 *
 *   paintBox(..., "background")  → content backgrounds, borders, images,
 *                                  text-run highlights, horizontal-line rules
 *   <selection rects>            → the translucent blue tint
 *   paintBox(..., "foreground")  → glyphs + text decorations (under/strike)
 *   <cursor>
 *
 * This matches the browser / Google Docs: the selection composites OVER content
 * backgrounds (so a highlighted run shows blue-over-yellow) and UNDER the text
 * glyphs (which stay crisp). #397.
 *
 * Both phases walk the SAME (virtualized/visible) tree with the SAME clip args,
 * so the same set of draws happens — only split across the two layers. The
 * deliberate double-walk is bounded (it only touches the visible subtree).
 * `phase` threads through the recursion unchanged: children are painted in the
 * same phase as their parent.
 */
type PaintPhase = "background" | "foreground";

/**
 * POSITIONING slice 3 — paint a box's `absoluteChildren` (abs-pos descendants whose
 * abc is this box). They are out-of-flow (not in `box.children`), positioned in the
 * box's own coordinate frame, so they paint with the SAME parent origin the box uses
 * for its in-flow children. Painted in document order (z-index ordering is slice 4).
 * A no-op for the common box with no abs-pos descendants. Shared by every container
 * paint branch that may establish an abc.
 */
function paintAbsoluteChildren(
  ctx: CanvasRenderingContext2D,
  box: LayoutBox,
  absX: number,
  absY: number,
  visibleTop: number,
  visibleBottom: number,
  state: PaintState,
  phase: PaintPhase,
): void {
  if (box.absoluteChildren === undefined) return;
  for (const absChild of box.absoluteChildren) {
    paintBox(ctx, absChild, absX, absY, visibleTop, visibleBottom, state, phase);
  }
}

/**
 * POSITIONING slice 5 — multiply a `transform`-bearing box's matrix into the
 * canvas's current transform. Uses the SAME core helpers the hit-test thread uses
 * (`resolveTransformOrigin` + `fromTransformFns`), so the painted matrix and the
 * baked `inverseTransform` are derived from byte-identical math (paint and
 * hit-test can never diverge). `fromTransformFns` already folds the
 * translate(origin) ∘ fns ∘ translate(−origin) pivot, so a single `ctx.transform`
 * applies the whole thing. The caller has done `ctx.save()` and restores after.
 */
function applyBoxTransform(
  ctx: CanvasRenderingContext2D,
  cs: Readonly<ComputedStyle>,
  absX: number,
  absY: number,
  boxWidth: number,
  boxHeight: number,
): void {
  const origin = resolveTransformOrigin(cs.transformOrigin, absX, absY, boxWidth, boxHeight);
  const m = fromTransformFns(cs.transform, origin.x, origin.y, boxWidth, boxHeight);
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
}

/**
 * POSITIONING slice 6 — `opacity` group compositing.
 *
 * A box with `cs.opacity < 1` is a stacking context (slice 4), so it paints
 * ATOMICALLY — its whole subtree (both paint sub-phases + all descendants, incl.
 * its own transform and its §E.2 stacking children) is one self-contained unit.
 * This routine renders that COMPLETE atomic paint into a temporary offscreen
 * surface at FULL opacity, then composites the surface onto the parent ctx ONCE
 * with `globalAlpha = cs.opacity`. That honors CSS-spec opacity GROUPING: the
 * half-opaque box with overlapping children reads as ONE translucent region (the
 * group composites a single time), NOT additive per-child alpha.
 *
 * The offscreen is sized to the box's painted region and translated so the box's
 * absolute paint origin maps to the surface's top-left (the subtree paints with
 * the SAME absolute coords it would on the parent, minus the box origin, so a
 * single `drawImage(surface.canvas, absX, absY)` lands it back at the right
 * place). The surface is obtained through `createOffscreenSurface` — an injectable
 * factory seam so the path is exercisable under jsdom (which has no real
 * `OffscreenCanvas`); see `offscreen-surface.ts`.
 *
 * Nested opacity composes naturally: an inner opacity<1 descendant recurses
 * through `paintBox` again, allocates ITS own offscreen, and `drawImage`s into
 * THIS group's offscreen ctx — so the inner group composites into the outer
 * group's surface before the outer surface composites onto the page.
 *
 * Called ONLY from the FOREGROUND phase (the box's atomic content spans both
 * sub-phases, but the composite must happen once); the background-phase entry for
 * an opacity box is a no-op (it returns before painting), exactly like a
 * bucket-6/7 stacking child whose atomic paint is gated to the foreground phase.
 */
function paintOpacityGroup(
  ctx: CanvasRenderingContext2D,
  box: LayoutBox,
  absX: number,
  absY: number,
  state: PaintState,
): void {
  const opacity = box.computedStyle.opacity;
  // Painted region: the box's border-box. A transform on the box itself is applied
  // INSIDE the offscreen render (paintBox re-enters with hasOpacity already
  // consumed and applies the transform under the saved offscreen matrix).
  const surface = createOffscreenSurface(box.width, box.height);
  const offCtx = surface.ctx;
  offCtx.textBaseline = "top";
  // Render the WHOLE atomic subtree into the offscreen, translated so the box's
  // absolute origin (absX, absY) maps to the surface origin (0, 0). Both
  // sub-phases run so the group is complete (background fills + foreground glyphs).
  // `state.lastFont` is per-ctx, so use a fresh paint-state for the offscreen ctx
  // (its `ctx.font` starts empty) to avoid a stale-font skip; the image cache is
  // shared (images are ctx-independent).
  // Decoration fragments map into the surface frame: the surface origin is the
  // box's painted origin (`absX`/`absY`).
  const offState: PaintState = {
    lastFont: "",
    imageCache: state.imageCache,
    decorations: state.decorations,
    frameDx: state.frameDx - absX,
    frameDy: state.frameDy - absY,
    insideAtomicInline: state.insideAtomicInline,
  };
  // Visible band = the full surface in surface-local coords; the subtree is small
  // (one box) and already culled by the parent walk, so paint it all.
  const offVisibleTop = -Infinity;
  const offVisibleBottom = Infinity;
  // parentX/parentY are chosen so the box's SHIFTED origin lands at surface-local
  // (0, 0). paintBox computes `absX = parentX + box.x + relativeOffset.dx`, so the
  // relativeOffset must be subtracted HERE too: parentX = -(box.x + rel.dx) → inner
  // absX = 0. The composite below draws at the outer `absX`/`absY`, which ALREADY
  // include the relativeOffset shift; re-adding it inside the surface would
  // double-apply it (off by rel.dx/dy for a position:relative + opacity<1 box).
  const rel = box.relativeOffset;
  const offParentX = -(box.x + (rel !== undefined ? rel.dx : 0));
  const offParentY = -(box.y + (rel !== undefined ? rel.dy : 0));
  paintBox(offCtx, box, offParentX, offParentY, offVisibleTop, offVisibleBottom, offState, "background", true);
  paintBox(offCtx, box, offParentX, offParentY, offVisibleTop, offVisibleBottom, offState, "foreground", true);
  // Composite the finished group onto the parent at the box's painted origin,
  // at the group alpha. Restore globalAlpha to 1 so no alpha leaks to siblings.
  const priorAlpha = ctx.globalAlpha;
  ctx.globalAlpha = opacity;
  ctx.drawImage(surface.canvas, absX, absY);
  ctx.globalAlpha = priorAlpha;
}

// ── POSITIONING slice 4 — z-index + stacking contexts (CSS 2.2 §E.2) ──────────
//
// Within a stacking context the §E.2 painting order is:
//   1. negative-z stacking-context children (z<0, ascending);
//   2. the box's own background + borders;
//   3. in-flow non-positioned BLOCK descendants (recursive, static only);
//   4. floats;
//   5. in-flow non-positioned INLINE content;
//   6. all positioned descendants with z-index auto|0 (relative AND absolute
//      together), in tree (document) order;
//   7. positive-z stacking-context children (z>0, ascending).
//
// Reconciliation with the two-phase (background/foreground) paint: the GLOBAL
// two-phase walk still drives the box's own background (bucket 2, background
// phase) and its in-flow non-positioned descendants (buckets 3–5, both phases).
// Buckets 1/6/7 paint ATOMICALLY — each such child's WHOLE subtree paints in
// BOTH sub-phases via two `paintBox` calls — but gated to run EXACTLY ONCE:
// bucket 1 (negative-z) runs in the BACKGROUND phase, BEFORE the box paints its
// own background, so it sits below; buckets 6/7 run in the FOREGROUND phase,
// AFTER the box's in-flow glyphs, so they sit above. Canvas paint order is
// composite order, so this yields the §E.2 stacking.
//
// COMMON-PATH GUARANTEE: a box with NO stacking-context child and NO non-auto
// z-index child takes the unmodified document-order path (children loop +
// `paintAbsoluteChildren`), byte-identical to the pre-slice-4 painter. Only a
// box that actually carries stacking participants partitions into buckets.

interface StackingPartition {
  /** Negative-z stacking-context children (sorted by z ascending). Bucket 1. */
  readonly negZ: readonly LayoutBox[];
  /** Non-positioned, non-stacking-context children — recurse normally (buckets 3–5). */
  readonly inFlow: readonly LayoutBox[];
  /** Positioned z:auto|0 + opacity/transform stacking contexts with z:auto|0, tree order. Bucket 6. Atomic. */
  readonly bucket6: readonly LayoutBox[];
  /** Positive-z stacking-context children (sorted by z ascending). Bucket 7. Atomic. */
  readonly posZ: readonly LayoutBox[];
}

/** A box is a stacking context iff the factory stamped `stackingContextRole`. */
function isStackingContext(box: LayoutBox): boolean {
  return box.stackingContextRole === "self";
}

/**
 * Whether a box is positioned (participates in stacking buckets 1/6/7). A box is
 * positioned when its computed `position` is relative / absolute. Treats
 * an ABSENT `position` (`undefined`) as NOT positioned (static) — every box laid
 * out through the cascade carries `position: "static"` for the unpositioned case,
 * but defending against absence keeps the reorder gate from false-firing on a box
 * whose computed style omits the field (and `static`/`undefined` are equivalent:
 * "not positioned").
 */
function isPositioned(box: LayoutBox): boolean {
  const p = box.computedStyle.position;
  return p === "relative" || p === "absolute";
}

/**
 * True when ANY direct in-flow child OR `absoluteChild` participates in stacking
 * ordering — i.e. is itself a stacking context, or is positioned (relative /
 * absolute). When false, the box paints in plain document order (the
 * common path). `z-index` only applies to POSITIONED boxes, so a `z-index` on a
 * `position: static` box never trips this gate (it is also never a stacking
 * context via z-index — `computeStackingContextRole` gates on `position`).
 */
function needsStackingReorder(box: LayoutBox): boolean {
  const children = "children" in box ? box.children : [];
  for (const c of children) {
    if (isStackingContext(c) || isPositioned(c)) return true;
  }
  if (box.absoluteChildren !== undefined) {
    // Every absolute child is positioned by definition → always a participant.
    if (box.absoluteChildren.length > 0) return true;
  }
  return false;
}

/**
 * Partition a box's direct children + `absoluteChildren` into the §E.2 buckets.
 * Tree (document) order is `children` first, then `absoluteChildren` (matching the
 * pre-slice-4 paint, which recursed children then abs children). The numeric-z
 * buckets are stably sorted by z ascending with document-order tiebreak.
 */
function partitionStackingChildren(box: LayoutBox): StackingPartition {
  const negZ: { box: LayoutBox; z: number; order: number }[] = [];
  const posZ: { box: LayoutBox; z: number; order: number }[] = [];
  const inFlow: LayoutBox[] = [];
  const bucket6: LayoutBox[] = [];

  const children = "children" in box ? box.children : [];
  let order = 0;
  const classify = (c: LayoutBox): void => {
    const z = c.computedStyle.zIndex;
    const positioned = isPositioned(c);
    const isSC = isStackingContext(c);
    if (isSC && typeof z === "number" && z < 0) {
      negZ.push({ box: c, z, order: order++ });
    } else if (isSC && typeof z === "number" && z > 0) {
      posZ.push({ box: c, z, order: order++ });
    } else if (positioned || isSC) {
      // Positioned (z auto|0), or a static opacity/transform stacking context
      // (a z:0-equivalent context, §E.2 step 6). Painted atomically in tree order.
      bucket6.push(c);
      order++;
    } else {
      // Plain in-flow, non-positioned, non-stacking — recurse normally (both phases).
      inFlow.push(c);
      order++;
    }
  };
  for (const c of children) classify(c);
  if (box.absoluteChildren !== undefined) {
    for (const c of box.absoluteChildren) classify(c);
  }

  // Stable sort by z ascending, document-order tiebreak (the `order` field).
  const byZThenOrder = (a: { z: number; order: number }, b: { z: number; order: number }): number =>
    a.z !== b.z ? a.z - b.z : a.order - b.order;
  negZ.sort(byZThenOrder);
  posZ.sort(byZThenOrder);

  return {
    negZ: negZ.map((e) => e.box),
    inFlow,
    bucket6,
    posZ: posZ.map((e) => e.box),
  };
}

/**
 * Paint a stacking participant ATOMICALLY — its entire subtree, BOTH sub-phases
 * (background then foreground), in a single call. Used for buckets 1/6/7 so a
 * child stacking context paints as one self-contained unit at its z-slot (its own
 * §E.2 walk runs recursively inside the two `paintBox` calls). The global phase
 * gates WHEN this runs (negative-z in background, buckets 6/7 in foreground) so it
 * is invoked exactly once per child.
 */
function paintStackingChildAtomic(
  ctx: CanvasRenderingContext2D,
  child: LayoutBox,
  absX: number,
  absY: number,
  visibleTop: number,
  visibleBottom: number,
  state: PaintState,
): void {
  paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state, "background");
  paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state, "foreground");
}

/**
 * Paint negative-z stacking-context children (bucket 1). Called at the TOP of a
 * container branch, BEFORE the box paints its own background, and ONLY in the
 * background phase (so each runs once and sits BELOW the box's background). A
 * no-op when there is no reorder or no negative-z child — the common path.
 */
function paintNegativeZBeforeBackground(
  ctx: CanvasRenderingContext2D,
  partition: StackingPartition | null,
  phase: PaintPhase,
  absX: number,
  absY: number,
  visibleTop: number,
  visibleBottom: number,
  state: PaintState,
): void {
  if (partition === null || phase !== "background") return;
  for (const c of partition.negZ) {
    paintStackingChildAtomic(ctx, c, absX, absY, visibleTop, visibleBottom, state);
  }
}

/**
 * Paint a container box's children in §E.2 stacking order (replaces the plain
 * `for child of children { paintBox }` + `paintAbsoluteChildren` pair). When
 * `partition` is null (the common path — no stacking participant), it recurses
 * children in document order then abs children, byte-identical to the old path.
 * Otherwise: in-flow non-positioned children recurse normally in the CURRENT
 * phase (buckets 3–5); positioned + stacking children (buckets 6/7) paint
 * ATOMICALLY in the FOREGROUND phase, after the in-flow content. (Bucket 1 is
 * painted separately, before the box's background, by
 * `paintNegativeZBeforeBackground`.)
 */
function paintContainerChildren(
  ctx: CanvasRenderingContext2D,
  box: LayoutBox,
  partition: StackingPartition | null,
  absX: number,
  absY: number,
  visibleTop: number,
  visibleBottom: number,
  state: PaintState,
  phase: PaintPhase,
): void {
  if (partition === null) {
    // Common path — unchanged document order: children, then abs children.
    if ("children" in box) {
      for (const child of box.children) {
        paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state, phase);
      }
    }
    paintAbsoluteChildren(ctx, box, absX, absY, visibleTop, visibleBottom, state, phase);
    return;
  }
  // Reorder path. Buckets 3–5: in-flow non-positioned, recurse in the current phase.
  for (const child of partition.inFlow) {
    paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state, phase);
  }
  // Buckets 6 then 7: positioned auto/0 (tree order), then positive-z (ascending).
  // Atomic (both sub-phases), gated to the FOREGROUND phase so each runs once and
  // composites ABOVE the box's own in-flow content.
  //
  // KNOWN v1 LIMITATION (named follow-up — see 1.9-positioning.md + spec §6):
  // a bucket-6/7 child's OWN background (its backgroundColor fillRect) paints HERE,
  // in the foreground phase, which runs AFTER the global selection rects are drawn
  // (paintCanvas draws selection between the background and foreground passes). So a
  // positioned (relative/absolute) child WITH a non-transparent backgroundColor
  // overpaints the selection tint, making the selection invisible on that child's
  // background region. (Negative-z bucket-1 children are NOT affected — they paint in
  // the background phase, before selection.) The correct fix needs a third paint
  // sub-phase (positioned-backgrounds before selection) or per-box selection
  // compositing — an architectural change deferred to a named v1 follow-up. Not yet
  // user-reachable: positioning is substrate for not-yet-built anchored objects.
  if (phase === "foreground") {
    for (const c of partition.bucket6) {
      paintStackingChildAtomic(ctx, c, absX, absY, visibleTop, visibleBottom, state);
    }
    for (const c of partition.posZ) {
      paintStackingChildAtomic(ctx, c, absX, absY, visibleTop, visibleBottom, state);
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
  phase: PaintPhase,
  // POSITIONING slice 6 — set when this call is the OFFSCREEN render of an opacity
  // group (so the box's own opacity has already been consumed by `paintOpacityGroup`
  // and must NOT re-trigger the offscreen intercept → infinite recursion).
  skipOpacity: boolean = false,
): void {
  const t = markStart("paint.draw");
  try {
  // POSITIONING slice 2 — `position: relative` paint-time visual offset. The
  // box's geometry (box.x/box.y) is PRE-offset; `relativeOffset` is a physical
  // (dx, dy) delta the BFC resolved from the box's `inset*` against its
  // containing block. Adding it to the accumulated origin shifts this box AND
  // all its descendants (they inherit the shifted absX/absY as their parent
  // origin). Paint stays dumb — it reads the pre-resolved delta, never cs.inset*.
  // `undefined` for the un-positioned common case → no offset, no read cost.
  const rel = box.relativeOffset;
  const absX = parentX + box.x + (rel !== undefined ? rel.dx : 0);
  const absY = parentY + box.y + (rel !== undefined ? rel.dy : 0);

  const cs = box.computedStyle;
  const us = box.usedStyle;

  // POSITIONING slice 6 — `opacity < 1` GROUP compositing. An opacity<1 box is a
  // stacking context (slice 4) → it paints atomically; redirect its WHOLE atomic
  // paint into an offscreen surface and composite that once at `globalAlpha =
  // opacity` (CSS opacity grouping: one translucent region, not additive). The
  // composite runs in the FOREGROUND phase only (the atomic content spans both
  // sub-phases, but composites once, above the box's background-phase siblings);
  // the BACKGROUND-phase entry returns as a no-op. `opacity === 1` / `undefined`
  // → the DIRECT path below (ZERO offscreen alloc, `globalAlpha` untouched — the
  // 99.99% common case is byte-identical). `skipOpacity` is set while rendering
  // INTO the offscreen so the box's own opacity is consumed exactly once.
  // `cs.opacity` is `1` by default on cascaded boxes; guard `undefined` for
  // synthetic fixtures whose computedStyle omits positioning fields.
  const hasOpacity = !skipOpacity && cs.opacity !== undefined && cs.opacity < 1;
  if (hasOpacity) {
    if (phase === "foreground") {
      paintOpacityGroup(ctx, box, absX, absY, state);
    }
    return;
  }

  // POSITIONING slice 5 — a `transform`-bearing box paints under a saved canvas
  // matrix: translate→origin, apply each TransformFn in ARRAY order, translate
  // back. A transform-bearing box is already a stacking context (slice 4) so it
  // paints ATOMICALLY (its whole subtree + descendants under the same matrix).
  // The transform-origin is the box's absolute origin + `transformOrigin`
  // resolved against the box's border-box size (`{50%,50%}` default = box center)
  // — the IDENTICAL frame `line-flatten`'s `transformAt` uses for hit-test, so
  // paint and hit-test share the same matrix. UN-transformed boxes take NO
  // save/restore (zero overhead — guarded on `cs.transform.length > 0`).
  // Only a TRANSFORMABLE box applies its transform (CSS Transforms 1 §3:
  // block-level + atomic-inline-level). The IFC STAMPS its block's `computedStyle`
  // (incl. `transform`) onto the generated `line` fragments, and a non-atomic
  // `inline`/`text-run`/`marker` copies a parent cs — so reading `transform` off
  // those fragment types would RE-APPLY the establishing block's transform a
  // second time. The block/inline-block/table* box already applied it for the
  // subtree, so the line/run/etc. paint UNDER that saved matrix without
  // re-applying. (Mirrors `line-flatten.transformAt`'s identical gate so paint and
  // hit-test compose the SAME cumulative matrix.)
  const transformable =
    box.type !== "line" && box.type !== "text-run" &&
    box.type !== "marker" && box.type !== "inline";
  // `cs.transform` is `[]` by default on cascaded boxes; guard `undefined` for
  // synthetic fixtures whose computedStyle omits positioning fields.
  const hasTransform = transformable && cs.transform !== undefined && cs.transform.length > 0;
  if (hasTransform) {
    ctx.save();
    applyBoxTransform(ctx, cs, absX, absY, box.width, box.height);
  }
  try {

  // Viewport culling: skip entire subtree if out of visible range. SKIPPED for a
  // transformed box — its painted bounds can move outside the pre-transform
  // `[absY, absY+height]` band (a translate/rotate can bring it into view), so the
  // pre-transform cull would wrongly drop it. Transformed boxes are rare, so always
  // painting them is acceptable.
  if (!hasTransform && (absY + box.height < visibleTop || absY > visibleBottom)) return;

  if (box.type === "text-run") {
    // Highlight (text background color) — BACKGROUND phase: paint the full run
    // rect so the selection tint composites OVER it. Mirrors the block-branch
    // backgroundColor guard.
    if (phase === "background") {
      if (cs.backgroundColor && cs.backgroundColor !== "transparent") {
        ctx.fillStyle = cs.backgroundColor;
        ctx.fillRect(absX, absY, box.width, box.height);
      }
      // Inline decorations in the run's background slot.
      paintRunDecorations(ctx, state, absX, absY, box.width, box.height, cs.color);
      return;
    }
    // FOREGROUND phase: glyphs + text decorations (painted OVER the selection).
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
    // CSS Text 3 §8: letter-/word-spacing add extra inline advance per cluster.
    // The LAYOUT advances (shapers + IFC, Tasks 1-5) already include this, so the
    // paint loop must add the SAME spacing or painted glyphs drift from the caret
    // (the #330 no-drift requirement). usedStyle spacing is numeric px (or
    // "normal" ≡ 0); resolveSpacingPx/clusterSpacing apply the identical rule.
    const letterPx = resolveSpacingPx(us.letterSpacing);
    const wordPx = resolveSpacingPx(us.wordSpacing);
    // P4-C.1: an odd resolved UAX #9 level paints its clusters RIGHT-to-LEFT.
    // The authoritative signal is `box.bidiLevel` (stamped by the line reorder),
    // NOT `cs.direction` — a Hebrew word in an `ltr` paragraph has bidiLevel 1
    // but direction "ltr", and a reordered box's POSITIONING direction is always
    // "ltr" (the physical-coordinate contract). `undefined`/even ⇒ LTR (the
    // overwhelmingly common case), painted exactly as before.
    const rtl = box.bidiLevel !== undefined && box.bidiLevel % 2 === 1;
    if (rtl) {
      // Place the logically-first cluster at the box's RIGHT edge and walk left.
      // Using the SAME per-cluster advances as the LTR path (so the run still
      // spans exactly [absX, absX + box.width]); only the WITHIN-box placement
      // is reversed. Cluster i's left edge sits at rightEdge − Σadvances(0..=i).
      const rightEdge = absX + box.width;
      let cum = 0;
      for (const cluster of segmentClusters(box.text)) {
        cum += ctx.measureText(cluster).width + clusterSpacing(cluster, letterPx, wordPx);
        ctx.fillText(cluster, rightEdge - cum, baselineY);
      }
    } else {
      let clusterX = absX;
      for (const cluster of segmentClusters(box.text)) {
        ctx.fillText(cluster, clusterX, baselineY);
        clusterX += ctx.measureText(cluster).width + clusterSpacing(cluster, letterPx, wordPx);
      }
    }
    // Text decorations are an INDEPENDENT-FLAG set (CSS text-decoration-line):
    // a run can carry both at once, so paint each with its own `if` (NOT
    // mutually-exclusive). Both use the current fillStyle (= cs.color, i.e.
    // currentColor per CSS text-decoration-color).
    if (cs.underline) {
      const ulY = absY + halfLeading + fontSize + 1;
      ctx.fillRect(absX, ulY, box.width, 1);
    }
    if (cs.lineThrough) {
      // Strikethrough (Google Docs / CSS line-through): a rule through the middle
      // of the text. ~em-box center is a good approximation. Exact y is a pixel
      // detail tunable in-browser.
      const stY = absY + halfLeading + fontSize * 0.5;
      ctx.fillRect(absX, stY, box.width, 1);
    }
    return;
  }

  if (box.type === "marker") {
    // Marker glyph (list bullet/number, footnote marker) — FOREGROUND only;
    // it's text, painted OVER the selection.
    if (phase !== "foreground") return;
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
    // POSITIONING slice 4 — partition once when a stacking participant is present;
    // null (the common path) means plain document-order paint (byte-identical).
    const stack = needsStackingReorder(box) ? partitionStackingChildren(box) : null;
    // Bucket 1 — negative-z stacking contexts paint BELOW this box's background.
    paintNegativeZBeforeBackground(ctx, stack, phase, absX, absY, visibleTop, visibleBottom, state);
    if (phase === "background") {
      // Background
      if (cs.backgroundColor && cs.backgroundColor !== "transparent") {
        ctx.fillStyle = cs.backgroundColor;
        ctx.fillRect(absX, absY, box.width, box.height);
      }
      // Block decorations: over the box's own background, under its
      // borders, image and children (a CSS background on the block element).
      paintBlockDecorations(ctx, state, box.key, absX, absY, box.width, box.height, cs.color);
      // Borders
      paintBorders(ctx, us, absX, absY, box.width, box.height);
      // Image content
      if (box.metadata?.image) {
        const img = box.metadata.image;
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
      // Footnote separator rule: REMOVED (user directive — deliberate deviation
      // from Google Docs). The layout no longer emits a `footnoteSeparator` box,
      // and even if one were present we no longer paint a rule for it. The slot
      // still reserves `FOOTNOTE_SEPARATOR_HEIGHT` as a plain gap above the bodies.
    }
    // POSITIONING slice 4 — children in §E.2 order (buckets 3–7). On the common
    // path (`stack === null`) this is the old children-loop + paintAbsoluteChildren.
    // Abs-pos children whose abc is THIS box are reached here (via the partition's
    // abs walk, or the common-path `paintAbsoluteChildren`) with the SAME parent
    // origin (absX/absY, incl. any relativeOffset) the box uses for `children`.
    paintContainerChildren(ctx, box, stack, absX, absY, visibleTop, visibleBottom, state, phase);
    return;
  }

  if (box.type === "inline-block") {
    // An inline-block is a block-formatting box positioned inline (e.g. a
    // footnote call-marker's superscript glyph). It paints like a block —
    // full-box background + borders (NOT edge-split like an inline fragment) —
    // then recurses into its inner BFC's line boxes.
    const stack = needsStackingReorder(box) ? partitionStackingChildren(box) : null;
    paintNegativeZBeforeBackground(ctx, stack, phase, absX, absY, visibleTop, visibleBottom, state);
    if (phase === "background") {
      if (cs.backgroundColor && cs.backgroundColor !== "transparent") {
        ctx.fillStyle = cs.backgroundColor;
        ctx.fillRect(absX, absY, box.width, box.height);
      }
      // Inline decorations cover non-text inline content too (tabs incl. leader
      // tabs, footnote call markers, inline atomic embeds): its background slot.
      paintRunDecorations(ctx, state, absX, absY, box.width, box.height, cs.color);
      paintBorders(ctx, us, absX, absY, box.width, box.height);
    }
    // Tab-leader (dot / dash / line): a `"tab"` inline embed carries
    // `inlineMeta: { embedType: "tab"; leader }` stamped by the IFC from the
    // destination tab stop. When the leader is not "none", paint it across the
    // tab's inline advance [absX, absX+box.width] at the text baseline, in the
    // computed text color. Leaders are FOREGROUND (drawn over the selection,
    // like text); when the leader is "none" or the box is a non-tab
    // inline-block (no inlineMeta), this is a no-op and the branch behaves
    // exactly as before (background/borders + recurse).
    if (
      phase === "foreground" &&
      box.inlineMeta?.embedType === "tab" &&
      box.inlineMeta.leader !== "none"
    ) {
      paintTabLeader(ctx, box.inlineMeta.leader, absX, absY, box.width, box.height, cs);
    }
    // The atomic box's band already covers its content: its inner runs (a call
    // marker's glyph) must not paint a second, overlapping band.
    state.insideAtomicInline++;
    try {
      paintContainerChildren(ctx, box, stack, absX, absY, visibleTop, visibleBottom, state, phase);
    } finally {
      state.insideAtomicInline--;
    }
    return;
  }

  if (box.type === "line") {
    // Lines don't paint themselves; just recurse into children (same phase).
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state, phase);
    }
    return;
  }

  if (box.type === "inline") {
    if (phase === "background") {
      // Background: full fragment
      if (cs.backgroundColor && cs.backgroundColor !== "transparent") {
        ctx.fillStyle = cs.backgroundColor;
        ctx.fillRect(absX, absY, box.width, box.height);
      }
      // Borders: edge-aware
      paintInlineBorders(ctx, us, absX, absY, box.width, box.height, box.fragmentEdge);
    }
    // Recurse (same phase)
    for (const child of box.children) {
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state, phase);
    }
    return;
  }

  if (box.type === "table" || box.type === "table-row") {
    // Table and table-row don't paint themselves; recurse children in §E.2 order
    // (common path = plain document order). A `position:relative`/transformed table
    // (or table-row) can establish an abc / stacking participants — handled by the
    // partition. Negative-z bucket-1 children paint before (a table has no own bg).
    const stack = needsStackingReorder(box) ? partitionStackingChildren(box) : null;
    paintNegativeZBeforeBackground(ctx, stack, phase, absX, absY, visibleTop, visibleBottom, state);
    // A table / row has no own background; a block decoration on it still fills
    // under its cells.
    if (phase === "background") paintBlockDecorations(ctx, state, box.key, absX, absY, box.width, box.height, cs.color);
    paintContainerChildren(ctx, box, stack, absX, absY, visibleTop, visibleBottom, state, phase);
    return;
  }

  if (box.type === "table-cell") {
    const stack = needsStackingReorder(box) ? partitionStackingChildren(box) : null;
    paintNegativeZBeforeBackground(ctx, stack, phase, absX, absY, visibleTop, visibleBottom, state);
    if (phase === "background") {
      // Background
      if (cs.backgroundColor && cs.backgroundColor !== "transparent") {
        ctx.fillStyle = cs.backgroundColor;
        ctx.fillRect(absX, absY, box.width, box.height);
      }
      // Block decorations: over the box's own background, under its
      // borders, image and children (a CSS background on the block element).
      paintBlockDecorations(ctx, state, box.key, absX, absY, box.width, box.height, cs.color);
      // Borders
      paintBorders(ctx, us, absX, absY, box.width, box.height);
    }
    // Recurse into cell content in §E.2 order (common path = document order).
    paintContainerChildren(ctx, box, stack, absX, absY, visibleTop, visibleBottom, state, phase);
    return;
  }

  if (box.type === "multicolumn") {
    // A MultiColumnBox recurse-paints each column box (each a BlockBox) in order,
    // same phase, then draws the column-rule (CSS `column-rule`) in the BACKGROUND
    // phase. It is otherwise a plain container: the column boxes are positioned in
    // this box's frame, so they recurse with origin (absX, absY). Each column is a
    // BlockBox whose own paint arm handles its background/borders/stacking — so a
    // direct loop over `columns` is the full container paint (the §E.2 stacking
    // partition operates WITHIN each column's block arm, not across columns). NB:
    // the generic `"children" in box` container helpers don't see `columns`, hence
    // the explicit loop here.
    if (phase === "background") paintBlockDecorations(ctx, state, box.key, absX, absY, box.width, box.height, cs.color);
    for (const col of box.columns) {
      paintBox(ctx, col, absX, absY, visibleTop, visibleBottom, state, phase);
    }
    // Abs-pos descendants whose containing block is the multicol box itself
    // (not inside a column) — paint them like every other container arm, else a
    // positioned child anchored to the MultiColumnBox would never paint.
    paintAbsoluteChildren(ctx, box, absX, absY, visibleTop, visibleBottom, state, phase);
    // The column-rule (CSS `column-rule`) — a border-like line painted in EACH
    // gap between adjacent columns. Border-like ⇒ painted in the BACKGROUND phase
    // (same phase as `paintBorders` in the block/cell arms), so it draws exactly
    // once and never double-paints across the foreground pass. The gate short-
    // circuits the common no-rule case (zero overhead). Like `paintBorders`, we
    // draw a SOLID `fillRect` for ANY non-`none` style (no dash/dot rendering),
    // keeping the painter's rule handling consistent with its border handling.
    const rule = box.columnRule;
    if (
      phase === "background" &&
      rule !== null && rule.width > 0 && rule.style !== "none" && box.columns.length > 1
    ) {
      ctx.fillStyle = rule.color;
      // The columns are separated along the INLINE axis. In horizontal-tb that is
      // physical X (a VERTICAL line spanning the box height); in vertical modes it
      // is physical Y (a HORIZONTAL line spanning the box width). Each column's
      // physical position (`col.x` / `col.y`) is in the MultiColumnBox's own frame,
      // painted at origin (absX, absY) — so we add absX / absY. The line spans the
      // BOX's block extent (NOT the column's own, which is 0 for an empty trailing
      // column), so we use box.width / box.height.
      const isVertical = box.writingMode === "vertical-rl" || box.writingMode === "vertical-lr";
      for (let k = 0; k < box.columns.length - 1; k++) {
        const a = box.columns[k];
        const b = box.columns[k + 1];
        if (a === undefined || b === undefined) {
          throw new Error(`canvas-renderer: column-rule columns at ${k}/${k + 1} unexpectedly undefined`);
        }
        if (isVertical) {
          const gapCenterY = absY + (a.y + a.height + b.y) / 2;
          ctx.fillRect(absX, gapCenterY - rule.width / 2, box.width, rule.width);
        } else {
          const gapCenterX = absX + (a.x + a.width + b.x) / 2;
          ctx.fillRect(gapCenterX - rule.width / 2, absY, rule.width, box.height);
        }
      }
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
      paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state, phase);
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
      paintBox(ctx, box.headerSlot, absX, absY, visibleTop, visibleBottom, state, phase);
    }
    if (box.footerSlot !== null) {
      paintBox(ctx, box.footerSlot, absX, absY, visibleTop, visibleBottom, state, phase);
    }
    // DA3: the footnote SLOT is a NAMED field (like header/footer), NOT in
    // `box.children`, so paint it BY NAME — otherwise footnote bodies never
    // render. It sits between the body content and the footer (its own page-local
    // blockOffset). Painted with the same page-local origin as the slots above.
    if (box.footnoteSlot !== null) {
      paintBox(ctx, box.footnoteSlot, absX, absY, visibleTop, visibleBottom, state, phase);
    }
    return;
  }

  // Plan 2/3 types: skip silently (not produced in Plan 1)
  } finally {
    // POSITIONING slice 5 — restore the canvas matrix if this box pushed a
    // transform. In a `finally` so every per-type early `return` (and any throw)
    // still balances the `ctx.save()` above.
    if (hasTransform) ctx.restore();
  }
  } finally {
    markEnd("paint.draw", t);
  }
}

/**
 * Tab-leader paint. A tab whose destination stop carries a leader (dot / dash /
 * line) fills its inline advance [x, x+w] with the leader pattern, drawn at the
 * text baseline in the computed text color.
 *
 * The leader is positioned at the alphabetic baseline (`y + halfLeading +
 * fontSize`, mirroring the text-run branch's underline geometry), so the
 * dots/dashes sit on the same line the surrounding text rests on. The leader is
 * clamped to the box's vertical extent: with `box.height >= fontSize` the
 * baseline lands inside `[y, y+h]`.
 *
 * `leader` is the typed `LeaderStyle`; the caller guarantees it is not "none".
 * The switch is exhaustive over the remaining dot / dash / line cases (the
 * `default` is a type-level guard, never reached at runtime).
 */
function paintTabLeader(
  ctx: CanvasRenderingContext2D,
  leader: LeaderStyle,
  x: number,
  y: number,
  w: number,
  h: number,
  cs: Readonly<ComputedStyle>,
): void {
  if (w <= 0) return;
  const fontSize = cs.fontSize;
  // Mirror the text-run branch: halfLeading centers the em-box in the line, and
  // the alphabetic baseline sits a font-size below the em-box top.
  const halfLeading = (h - fontSize) / 2;
  const baselineY = y + halfLeading + fontSize;
  ctx.fillStyle = cs.color;
  switch (leader) {
    case "none":
      // Caller guarantees leader !== "none"; nothing to paint.
      return;
    case "dot": {
      // A row of small filled circles resting on the baseline, evenly spaced.
      const radius = Math.max(0.5, fontSize * 0.05);
      const gap = Math.max(3, fontSize * 0.35);
      const dotY = baselineY - radius;
      // Start one gap in so the leader doesn't crowd the preceding glyph; stop
      // one gap before the destination so it doesn't crowd the following text.
      for (let dx = gap; dx <= w - gap; dx += gap) {
        ctx.beginPath();
        ctx.arc(x + dx, dotY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case "dash": {
      // A row of short horizontal segments along the baseline.
      const thickness = Math.max(0.5, fontSize * 0.06);
      const dashLen = Math.max(2, fontSize * 0.25);
      const gap = dashLen * 1.5;
      const stride = dashLen + gap;
      const dashY = baselineY - thickness;
      for (let dx = gap; dx + dashLen <= w; dx += stride) {
        ctx.fillRect(x + dx, dashY, dashLen, thickness);
      }
      return;
    }
    case "line": {
      // A single horizontal rule spanning the whole advance at the baseline.
      const thickness = Math.max(0.5, fontSize * 0.06);
      ctx.fillRect(x, baselineY - thickness, w, thickness);
      return;
    }
    default: {
      // Exhaustiveness guard: a new LeaderStyle variant must add a case above.
      const _exhaustive: never = leader;
      return _exhaustive;
    }
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
