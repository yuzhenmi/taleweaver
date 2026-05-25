# VL Phase-4 (selection rects): per-page selection geometry, remove the materializeAll bridge

> **For agentic workers:** focused change. TDD (equivalence vs bridge + perf), independent review before commit.

**Goal:** Compute selection-highlight rects PER VISIBLE PAGE (via `getPage`)
instead of over the whole materialized tree, so a drag-select / any render with a
non-collapsed selection on a large paginated doc is O(visible pages), not O(N).
This is the last paginated consumer of the `materializeAll()` bridge — after it,
remove the bridge.

**Why:** `update()` calls `computeSelectionRects(getPositionedTree(), …)` for a
non-collapsed selection; `getPositionedTree()` = `materializeAll()` materializes
ALL pages. During a drag-select every mousemove → render → materialize all
pages → O(N). The controller already paints only visible pages (`paintPages`
iterates `activeCanvases`, calling `getPageBox(idx)` per visible page) and
filters `selectionRects` by `pageIndex` — so the rects for non-visible pages are
computed and discarded.

**Architecture:** `getLineIndex(getPage(p))` gives a correct per-page line index
(page-relative coords, WeakMap-cached). `resolvePixelPosition` resolves the
span's start/end boundary positions per-page (returns `.x` + `.pageIndex`). A new
`computeSelectionRectsForPage(state, span, pageBox, pageIndex, startPos, endPos,
measurer)` emits the rects for the lines of ONE page that fall within the
selection, using the existing per-line rect logic. The controller computes
start/end boundary pixel positions ONCE per paint and calls the per-page function
for each visible page.

**Scope:** `computeSelectionRects` (full-tree) stays — it's the non-paginated
path, the equivalence oracle, AND the spanning-block fallback (below). The
common paginated path goes per-page; the `materializeAll()` bridge is no longer
on the common path but REMAINS as a rare fallback.

## Correctness constraints (from plan review)

- **Spanning-block fallback (load-bearing, mirrors `moveToLineVirtual`).** A
  selection boundary block that spans a page break breaks per-page rects:
  `resolvePixelPosition` snaps a boundary at a block's last line-end on page N
  (block continuing to N+1) to `pageIndex N+1`, so page N's portion of the
  highlight would be silently dropped → a visible gap at the page break. So:
  when the selection's START or END block spans pages
  (`plan.pageSpanOfBlock(blockId)` with `first !== last`), the controller falls
  back to the FULL `computeSelectionRects(getPositionedTree(), …)` for that
  render (filtered per page as today). Rare (a paragraph taller than a page),
  off the hot path. `getPositionedTree()` is therefore KEPT (not deleted) — it
  is now only reachable from: non-paginated identity sizing, and this fallback.
- **Caret-over-selection (`getCursorState`).** `getCursorState()` currently
  hides the I-beam when `selectionRects.length > 0`. After this change
  `selectionRects` is `[]` in paginated mode (rects computed per-page in
  `paintPages`). Replace that test with a cached `hasSelectionHighlight` flag set
  in `update()` = `!isCollapsed(selection)`, so the caret still hides over a
  selection in paginated mode.
- **Resolve boundaries ONCE per update, not per paint.** `paintPages` runs on
  every blink tick and scroll repaint (no `update()`). Cache `selStart`/`selEnd`
  (resolved via `resolvePixelPosition` in `update()`, where `state` is non-null)
  alongside `cursorPos`; `paintPages` reads the cached values — no
  `resolvePixelPosition` per blink. Guard `if (!state) return` where `paintPages`
  newly dereferences `state`.

---

## Task 1: `computeSelectionRectsForPage` in core

**Files:**
- Modify: `packages/core/src/cursor/selection-geometry.ts`
- Test: `packages/core/src/cursor/selection-geometry-virtual.test.ts` (Create)

- [ ] **Step 1 — Extract a shared per-line rect helper** from
  `computeSelectionRects`'s loop body: `emitLineRect(al, isGlobalFirst,
  isGlobalLast, startPos, endPos, measurer): SelectionRect | null` (returns null
  for width ≤ 0). `computeSelectionRects` calls it with
  `isGlobalFirst = i === startLineIdx`, `isGlobalLast = i === endLineIdx`. No
  behavior change — run existing selection-geometry tests to confirm.

- [ ] **Step 2 — Write failing equivalence test.** Build a multi-page virtual
  tree (mock shaper, small pages → several pages) where every paragraph is a
  single line (NON-spanning blocks — the per-page path's domain). For selections
  spanning: same line, same page multi-line, start page → end page (adjacent),
  start → end across an intermediate fully-selected page: assert
  `flatMap(p => computeSelectionRectsForPage(state, span, tree.getPage(p), p,
  startPos, endPos, m))` over `p in [0..pageCount)` deep-equals
  `computeSelectionRects(state, span, tree.materializeAll(), m)` (the bridge =
  ground truth). `startPos/endPos` resolved via `resolvePixelPosition` on the
  tree. (Spanning-block selections are NOT in this function's domain — the
  controller routes them to the bridge; a separate test asserting the
  controller's spanning fallback covers that.)

- [ ] **Step 3 — Verify it FAILS** (function doesn't exist).

- [ ] **Step 4 — Implement `computeSelectionRectsForPage`:**
  - `if (positionsEqual(span.anchor, span.focus)) return []`.
  - `start = spanStart(state, span)`, `end = spanEnd(state, span)`.
  - `startPage = startPos.pageIndex`, `endPage = endPos.pageIndex`.
  - `if (pageIndex < startPage || pageIndex > endPage) return []`.
  - `pageLines = getLineIndex(pageBox).all`; `if (pageLines.length === 0) return []`.
  - `lo = pageIndex === startPage ? findLineForPosition(pageLines, start) : 0`.
  - `hi = pageIndex === endPage ? findLineForPosition(pageLines, end) : pageLines.length - 1`.
  - `if (lo < 0 || hi < 0) return []` (defensive — boundary line not on its
    expected page; the page contributes nothing).
  - For `i in [lo..hi]`: `emitLineRect(pageLines[i], pageIndex === startPage && i === lo, pageIndex === endPage && i === hi, startPos, endPos, measurer)`; push non-null.
  - Adapt the measurer once at the top (mirror `computeSelectionRects`).

- [ ] **Step 5 — Tests pass** (new + existing selection-geometry). Export
  `computeSelectionRectsForPage` from `packages/core/src/index.ts`.

## Task 2: Controller paints selection rects per-page (bridge → rare fallback)

**Files:**
- Modify: `packages/dom/src/editor-controller.ts`
- Test: `packages/dom/src/editor-controller.test.ts`

New module state (alongside `cursorPos`): `selStart: PixelPosition | null`,
`selEnd: PixelPosition | null`, `hasSelectionHighlight: boolean`,
`selSpanningFallback: boolean`. Helper
`blockSpansPages(plan: PagePlan, blockId): boolean` =
`const s = plan.pageSpanOfBlock(blockId); return s !== null && s.first !== s.last`.
Call it with `layoutTree.plan` — INSIDE the `layoutTree.type === "virtual-root"`
branch `layoutTree` is narrowed to `VirtualLayoutTree` and carries `.plan`
directly. Do NOT read the module-level `virtualTree` here: it is assigned later
in `syncDom()` (which runs AFTER this selection block within `update()`), so it
can be one cycle stale on a tree-type change.

- [ ] **Step 1 — `update()` selection-rect setup.** Replace the current
  `getPositionedTree()` block (~950-959):
  ```
  hasSelectionHighlight = !isCollapsed(state.selection);
  selStart = selEnd = null; selSpanningFallback = false; selectionRects = [];
  if (hasSelectionHighlight) {
    const start = spanStart(state.state, state.selection);
    const end   = spanEnd(state.state, state.selection);
    if (layoutTree.type === "virtual-root") {
      selSpanningFallback = blockSpansPages(layoutTree.plan, start.blockId) || blockSpansPages(layoutTree.plan, end.blockId);
      if (selSpanningFallback) {
        const positioned = getPositionedTree();        // rare fallback
        selectionRects = positioned ? computeSelectionRects(state.state, state.selection, positioned, measurer) : [];
      } else {
        selStart = resolvePixelPosition(state.state, start, layoutTree, measurer);
        selEnd   = resolvePixelPosition(state.state, end,   layoutTree, measurer);
        // rects computed per-page in paintPages
      }
    } else {
      selectionRects = computeSelectionRects(state.state, state.selection, layoutTree, measurer);
    }
  }
  ```

- [ ] **Step 2 — `paintPages()` per-page rects.** Add `if (!state) return;`
  guard. Inside the loop, compute `pageSelRects`:
  ```
  const pageSelRects =
    (layoutTree?.type === "virtual-root" && hasSelectionHighlight && !selSpanningFallback
      && selStart !== null && selEnd !== null)
      ? computeSelectionRectsForPage(state.state, state.selection, page, idx, selStart, selEnd, measurer)
      : selectionRects.filter((r) => r.pageIndex === idx);
  ```
  (Non-paginated, collapsed, and the spanning fallback all use the
  `selectionRects` array; the per-page path uses the cached `selStart/selEnd`
  — NO `resolvePixelPosition` per paint/blink.)
  Import `spanStart`, `spanEnd`, `computeSelectionRectsForPage` from core
  (`isCollapsed` already imported).

- [ ] **Step 3 — `getCursorState()`.** Replace `if (selectionRects.length > 0)
  return "hidden"` with `if (hasSelectionHighlight) return "hidden"` so the caret
  still hides over a selection in paginated mode (where `selectionRects` is now
  empty). Reset `hasSelectionHighlight = false` in `destroy()` / on clear.

- [ ] **Step 4 — Keep the bridge (now off the common path).** `getPositionedTree`
  / `positionedBridge` REMAIN, reachable only from non-paginated identity sizing
  (`paintSingle`, spacer) and the Step-1 spanning fallback. Update the comments
  at the top (~84-90) to say the bridge is now only the non-paginated identity +
  the rare spanning-block selection fallback — NEVER the common paginated
  hit-test / selection path.

- [ ] **Step 5 — Update tests.** The test "materializes (lazy bridge) ONLY when
  a non-collapsed selection needs selection rects" (~line 609) is now WRONG for
  the common case — flip it: a non-collapsed selection over NON-spanning blocks
  on a virtual tree computes rects via `getPage`, NEVER `materializeAll`
  (`makeSpyVirtualTree`'s `pageSpanOfBlock` returns `null` → non-spanning, so the
  per-page path is taken; rects are `[]` since pages are empty — assert the
  WIRING). Add a focused test for the caret-hide: a non-collapsed selection ⇒
  `getCursorState`-driven behavior (cursor hidden) even with empty
  `selectionRects`. Confirm no other controller test asserts `materializeAll`
  IS called.

- [ ] **Step 6 — Build + full suites.** `npm run build` core + dom clean;
  `npm test` core + dom green.

## Task 3: Docs

- [ ] Update `docs/superpowers/specs/2026-05-24-virtualized-layout-design.md`
  "Interaction with shipped L-PERF pieces" / phasing: selection rects + mouse
  hit-test + line-nav now resolve per-page; the `materializeAll()` bridge is OFF
  the common paginated path — it remains only for non-paginated identity sizing
  and the rare spanning-block selection fallback (a paragraph taller than a
  page).

---

## Verification
- Core equivalence: per-page union == bridge across span shapes.
- Controller: non-collapsed selection paints via `getPage`, never `materializeAll`.
- Build + tests green; independent reviewer approves.
- User browser-verifies drag-select latency at `?perfFixture=5000`.
