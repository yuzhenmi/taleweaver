# Plan 3.I — Paint Incremental Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip repainting layout regions that haven't changed. After Plan 3.I, the canvas painter detects which `LayoutBox` instances are reference-equal between layouts (via Plan 3.H's reuse machinery) and only repaints regions whose paint inputs changed. For long documents, this drops paint cost from O(visible-pages) to O(dirty-region-area).

**Architecture:** A LayoutBox's paint output depends on `(parent-relative-position, size, computed-style subset, used-style subset, paint-time inputs like font cache state)`. We hash these per box; on paint, compare to the previous hash; skip if unchanged. Dirty regions are computed as union of (old-rect, new-rect) for changed boxes. The canvas is split into page-layer regions; only affected layers repaint.

**Spec reference:** `2026-04-29-plan-3-architectural-foundation-rewrite.md` §8.5.

**Branch:** `feature/dom-architecture-redesign`.

---

## Worktree discipline

All work in `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`. Pre-flight check on every task. Use absolute paths and `git -C <worktree>` for git.

---

## Task list overview

| Task | Subject |
|---|---|
| **1** | Define `PaintInputHash` type and `hashPaintInputs(box)` function |
| **2** | `PaintCache`: per-box hash storage; per-paint-pass diff |
| **3** | DOM canvas-renderer consults cache; skips boxes whose hash matches cached value |
| **4** | Dirty-region tracking: union of (old-rect, new-rect) for changed boxes |
| **5** | Page-level layering: each page's paint is independent; repaint only affected pages |
| **6** | Integration test + smoke + perf anecdote |

---

## Task 1: `PaintInputHash` and `hashPaintInputs`

**Files:**
- Create: `packages/dom/src/paint-cache.ts` — `PaintInputHash`, hash function.
- Tests.

```ts
import type { LayoutBox, ComputedStyle, UsedStyle } from "@taleweaver/core";

/**
 * A hash representing all paint-relevant inputs for a LayoutBox.
 * Two boxes with the same hash produce identical paint output.
 *
 * Includes: parent-relative position, size, computed-style subset (color,
 * font, decoration, border colors/styles, background), used-style subset
 * (padding, margin, borders, font-size, line-height).
 */
export type PaintInputHash = string;

/**
 * Compute a paint-input hash for a layout box. Inexpensive (concatenated
 * string); not a cryptographic hash. Two equal hashes → equal paint output.
 *
 * Excludes: render-node identity (paint shouldn't depend on it), layout-tree
 * children identity (children are hashed separately).
 */
export function hashPaintInputs(box: LayoutBox): PaintInputHash {
  // Position + size
  let h = `${box.x}:${box.y}:${box.width}:${box.height}`;
  // Computed style for paint-relevant fields
  const cs = box.computedStyle;
  h += `|cs:${cs.backgroundColor}:${cs.color}:${cs.fontFamily}:${cs.fontSize}:${cs.fontWeight}:${cs.fontStyle}:${cs.textDecoration}`;
  h += `:${cs.borderBlockStartStyle}:${cs.borderBlockEndStyle}:${cs.borderInlineStartStyle}:${cs.borderInlineEndStyle}`;
  h += `:${cs.borderBlockStartColor}:${cs.borderBlockEndColor}:${cs.borderInlineStartColor}:${cs.borderInlineEndColor}`;
  h += `:${cs.direction}`;
  // Used style for sizing
  const us = box.usedStyle;
  h += `|us:${us.paddingBlockStart}:${us.paddingBlockEnd}:${us.paddingInlineStart}:${us.paddingInlineEnd}`;
  h += `:${us.borderBlockStartWidth}:${us.borderBlockEndWidth}:${us.borderInlineStartWidth}:${us.borderInlineEndWidth}`;
  // Type-specific: TextRunBox carries text; LineBox carries baseline; etc.
  if (box.type === "text-run") {
    h += `|text:${box.text}`;
  } else if (box.type === "marker") {
    h += `|marker:${box.text}`;
  } else if (box.type === "line") {
    h += `|baseline:${box.baseline}`;
  } else if (box.type === "inline") {
    h += `|fragment:${box.fragmentEdge}`;
  }
  return h;
}
```

**Tests:** roundtrip, equal-input → equal-hash, different-position → different-hash, different-color → different-hash.

## Task 2: `PaintCache` per-paint-pass diff

```ts
export interface PaintCache {
  /** Get a previously-computed hash by box reference. */
  get(box: LayoutBox): PaintInputHash | undefined;
  /** Set the hash for a box. */
  set(box: LayoutBox, hash: PaintInputHash): void;
  /** Clear the cache. */
  clear(): void;
}

export function createPaintCache(): PaintCache {
  const map = new WeakMap<LayoutBox, PaintInputHash>();
  return { get: (b) => map.get(b), set: (b, h) => { map.set(b, h); }, clear: () => { /* WeakMap auto-clears */ } };
}
```

(WeakMap means freed boxes don't leak. The cache lives across paints.)

## Task 3: Painter consults cache; skips unchanged boxes

In `canvas-renderer.ts`, before painting each box:

```ts
function paintBox(ctx: CanvasRenderingContext2D, box: LayoutBox, cache: PaintCache, parentX: number, parentY: number, dirtyRegions: Rect[]): void {
  const hash = hashPaintInputs(box);
  const prev = cache.get(box);
  if (prev === hash) {
    // Box's paint inputs are unchanged. Skip ALL drawing for this box.
    // (But still recurse to children — their paint inputs may differ.)
  } else {
    // Box changed: paint normally, record new hash, add to dirty regions.
    paintBoxContent(ctx, box, parentX, parentY);
    cache.set(box, hash);
    dirtyRegions.push({ x: parentX + box.x, y: parentY + box.y, w: box.width, h: box.height });
  }
  if ("children" in box) {
    for (const c of box.children) {
      paintBox(ctx, c, cache, parentX + box.x, parentY + box.y, dirtyRegions);
    }
  }
}
```

(Caveat: if a parent box's BACKGROUND wasn't repainted but a CHILD's paint output changes, child's repaint may need to also clear the parent's region under the child first — depends on whether old paint is stale or already cleared. Simplest approach: if any descendant changed, re-clear and repaint the entire parent region. But that defeats the purpose. Real engines use composited layers per box; for v1 simpler: clear+repaint affected BOX rects only, accepting that overlapping painting may show artifacts in edge cases.)

## Task 4: Dirty-region tracking

The painter accumulates `dirtyRegions`. After the paint pass, the dirty regions can be reported (e.g., for canvas invalidation). Plan 3.I Task 4 just collects them; Task 5 uses them for layered painting.

## Task 5: Page-level layering

Each page in a paginated layout has its own canvas (or canvas region). When dirty regions are confined to one page, only that page repaints. Other pages' canvases are reused.

**Files:**
- Modify: `packages/dom/src/canvas-renderer.ts` — split paint by page.
- Modify: `packages/dom/src/editor-controller.ts` — manage per-page canvases.

(Nuanced because Plan 3 doesn't have pagination yet — `Plan 5` adds pagination. For Plan 3.I, "page" = the visible canvas as a whole. Layering activates in Plan 5 when there are multiple pages.)

For Plan 3.I, ship the structure (per-page canvas, dirty-region per canvas) but with one canvas; activate when pagination lands.

## Task 6: Integration test + smoke

- Test: paint twice with identical layout → second paint pass calls `paintBoxContent` zero times.
- Test: paint twice with one paragraph changed → only that paragraph's boxes paint.
- Smoke: dev server.

---

## Phase exit criteria

- All 6 tasks committed.
- Build clean.
- Tests green.
- Paint tests verify hashing detects unchanged boxes.
- Dev server boots; visual output unchanged from before.

## New followups likely

- Per-box paint output may overlap with parent's paint (e.g., child draws over parent's background). Handling overlap correctly without re-painting unchanged parent backgrounds is a real engine concern. Document the v1 limitation.
- WeakMap-based cache means boxes that get garbage-collected are auto-removed; but if the same box reference is used across many paint passes, the cache keeps growing per box (only one entry per box). Should be fine.
