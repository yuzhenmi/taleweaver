# Plan 3.I — Follow-ups, Hacks, and Deferred Cleanups

**Status as of Plan 3.I completion (2026-04-29):**
- 3 commits on `feature/dom-architecture-redesign` for Plan 3.I
- Build clean across all packages
- Test suite green: 724 core / 128 dom / 10 react

---

## Items closed by 3.I

None directly closed prior followups; Plan 3.I added new infrastructure (paint cache, dirty regions).

## New followups from 3.I

### F3I.1 — "Clear-dirty + full-repaint" strategy, not "true skip-painting"

**File:** `packages/dom/src/canvas-renderer.ts`

**What:** Plan 3.I ships a conservative strategy: when a `PaintCache` is provided, the renderer detects changed boxes (via `hashPaintInputs` diff), clears only their rects, then RE-PAINTS THE FULL TREE. Unchanged boxes are repainted on top of their still-valid pixels — paint calls aren't actually skipped.

**Why:** "True" skip-painting (zero canvas calls for unchanged boxes) requires careful management of parent-background regions. If a parent's background isn't repainted but a child's content changes, the child's new paint may overlap the stale parent background visibly. A real engine handles this with composited per-box layers; v1 doesn't have that machinery.

**Benefit even with the conservative strategy:** the canvas's full clearRect is avoided when no boxes change (`dirty.length === 0` path early-returns). The bulk-clearing-then-redrawing-everywhere of large canvases is the common slow case in browsers; skipping it on identical re-paints is a real win.

**Plan to fix:** future "compositor" plan introduces per-box layer caching with proper background-handling rules. Out of v1 scope.

**Priority:** medium. The conservative strategy works correctly; just leaves perf on the table.

### F3I.2 — Rect type lives in paint-cache.ts (not a layout primitive)

**File:** `packages/dom/src/paint-cache.ts`

**What:** `Rect` is exported alongside `PaintInputHash`/`PaintCache`. It's a generic geometric primitive that other consumers might want.

**Concern:** if hit-test, selection-geometry, or other modules want their own Rect type, they'll either (a) import from paint-cache (awkward — paint-cache isn't the obvious source), or (b) define their own (duplication).

**Fix:** move `Rect` to a shared module (e.g., `packages/core/src/layout/geometry.ts`) when a second consumer appears. For now, OK.

**Priority:** low.

### F3I.3 — Page layering structure documented but not yet exercised

**File:** `packages/dom/src/canvas-renderer.ts:paintPage`

**What:** Plan 3.I Task 5 was scoped to "page-level layering structure". Since pagination doesn't ship until Plan 5, the per-page canvas concept is documented but not yet wired (the example app uses one canvas). When pagination lands, each page's canvas gets its own `PaintCache`.

**Priority:** picks up automatically with Plan 5.

### F3I.4 — `walkAndDetectChanges` recurses entire layout tree

**File:** `packages/dom/src/canvas-renderer.ts`

**What:** The change-detection walk visits every box in the tree, hashes each, and compares to the cache. For 100-page documents with many boxes, this is O(N) per paint pass.

**Concern:** if the layout tree is heavily reused (Plan 3.H subtree reuse), most boxes are reference-equal across paints. We could short-circuit: if a box is the SAME REFERENCE as in the previous paint, skip its hash + compare AND don't recurse (its descendants are also unchanged by definition).

**Fix:** track previous-paint root per cache; on a paint pass, if the root reference equals the previous root, return zero dirty regions immediately.

**Priority:** medium. A reasonable optimization. Plan 3.J or future.

## Inherited still-unresolved

(Same as Plan 3.H followups — nothing newly resolved or added beyond F3I.1-F3I.4.)

## Going into Plan 3.J (test cleanup)

Plan 3.J is the final phase of Plan 3. Scope:
- Restore tests deleted during Plans 1+2 G-cleanup that are now relevant (the "Plan 1 followups F6.x — tests deleted for deferred features" list).
- Add a value-resolution-pipeline test suite covering em / percent / auto resolution end-to-end (per retrospective D11).
- Close the followups doc — mark items resolved or deferred to Plan 4-8.
