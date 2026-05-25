# VL Phase-4 (line-navigation): migrate keyboard line-nav off the materializeAll bridge

> **For agentic workers:** focused change. TDD, behavior-equivalence + perf bench, independent review before commit.

**Goal:** Make `moveToLine` / `moveToLineBoundary` resolve against a
`VirtualLayoutTree` per-page (caret page + at most one adjacent page) instead of
forcing `materializeAll()`, so the first arrow keypress after an edit on a large
paginated doc is O(1 page), not O(N_pages).

**Why:** `handleMoveLine` (and the line-relative action family) pass
`resolvePositionedTree(editor.layoutTree)` = `materializeAll()` into
`moveToLine`. On a fresh post-edit virtual tree this materializes ALL pages
(~110 at `perfFixture=5000`). User-observed: noticeable delay on the FIRST
ArrowUp after Enter, then instant (warm page memo). This is the O(1)-per-
keystroke target leaking on caret nav.

**Architecture:** `getLineIndex` is WeakMap-keyed per `LayoutBox` and
`collectLineBoxes` emits **page-content-relative** coords + `pageIndex`. So
`getLineIndex(tree.getPage(P))` yields a correct, cached per-page line index, and
`resolvePositionFromPixel(state, tree.getPage(targetPage), …, target.absoluteY,
targetPage)` resolves within one page (its `hasPagination` filter is a no-op on
a single-page box). `resolvePixelPosition` already returns the caret's
`pageIndex`. Mirror the fallback philosophy of `resolveInVirtualTree`: when the
plan can't cleanly localize (block spans pages, or page resolution fails), fall
back to `materializeAll()` for that one query — rare, off the flat-doc hot path.

**Scope:** ONLY `moveToLine` + `moveToLineBoundary` (the keyboard line-nav). Mouse
hit-test and selection-drag geometry stay on the lazy bridge (separate follow-up
— not the reported symptom). No behavior change for the positioned
(non-virtual) path.

---

## Task 1: `moveToLine` accepts a virtual tree (per-page resolution)

**Files:**
- Modify: `packages/core/src/cursor/line-navigation.ts`
- Test: `packages/core/src/cursor/line-navigation-virtual.test.ts` (Create)

- [ ] **Step 1 — Write failing equivalence + perf tests.** Build a paginated
  multi-page doc (mock shaper, small page so several pages). For a set of start
  positions (within-page, first line of a non-first page, last line of a
  non-last page, doc top, doc bottom) and both directions, assert
  `moveToLine(state, pos, virtualTree, m, dir, tx)` deep-equals
  `moveToLine(state, pos, virtualTree.materializeAll(), m, dir, tx)` (the bridge
  = ground truth). Perf: on a ≥30-page tree, `__resetGetPageDriverCountForTest()`
  then one `moveToLine` ⇒ `__getGetPageDriverCountForTest() <= 3` (NOT O(N)).

- [ ] **Step 2 — Verify the tests FAIL** (signature rejects the virtual tree /
  perf hook reports O(N) via the bridge). `npm test --workspace=packages/core -- --run line-navigation-virtual`.

- [ ] **Step 3 — Implement.** Widen the param to
  `LayoutBox | VirtualLayoutTree`. Branch on `layoutTree.type === "virtual-root"`:
  - **Spanning-block fallback (LOAD-BEARING — do NOT optimize away).** If
    `plan.pageSpanOfBlock(position.blockId)` spans pages (`first !== last`),
    resolve the WHOLE query via `materializeAll()` (the bridge), for ANY caret
    position in that block — not only at the page boundary. **Why:**
    `resolvePixelPosition` returns the caret's page already resolving the
    cross-page soft-wrap edge — for a caret at a block's last line-end on page N
    whose block continues to N+1, it returns `pageIndex = N+1`. Anchoring P to
    that and doing per-page `findLineForPosition` would put `idx === 0` on page
    N+1, so "up" would target the last line of N — the SAME visual line the
    caret sits on → the double-Up regression. `findLineForPosition`'s soft-wrap
    look-ahead also can't see the next fragment across a page split. The
    span-check fallback covers both. Consequence: spanning-block nav is NOT
    O(1 page); it's the rare case (a paragraph taller than a page), off the flat-
    doc hot path. The perf bench MUST use non-spanning blocks for its ≤3 assertion.
  - Otherwise (non-spanning block — the hot path):
    `currentPixel = resolvePixelPosition(...)`; `P = currentPixel.pageIndex`
    (== the block's single page); `x = targetX ?? currentPixel.x`.
  - `pageLines = getLineIndex(tree.getPage(P)).all`;
    `idx = findLineForPosition(pageLines, position)`; if `idx < 0` → fallback
    (defensive; shouldn't happen for a non-spanning mapped block).
  - **up:** `idx>0` → target `pageLines[idx-1]`, page `P`. Else if `P>0` →
    `prev = getLineIndex(tree.getPage(P-1)).all`; **if `prev.length === 0`** (page
    genuinely empty — defensive) → fallback; else target `prev[prev.length-1]`
    DIRECTLY (NOT blockId-filtered — it's just the adjacent visual line), page
    `P-1`. Else → start-of-document (unchanged).
  - **down:** `idx<pageLines.length-1` → target `pageLines[idx+1]`, page `P`.
    Else if `P < plan.entries.length-1` → `next = getLineIndex(tree.getPage(P+1)).all`;
    **if `next.length === 0`** → fallback; else target `next[0]` DIRECTLY, page
    `P+1`. Else → end-of-document (unchanged).
  - `resolvePositionFromPixel(state, tree.getPage(targetPage), m, x, target.absoluteY, targetPage)`.
    NOTE: the target `PageBox`'s lines all carry `pageIndex === targetPage`;
    `hasPagination` inside the hit-test is true for `targetPage > 0` and false for
    `0`, but in both cases the filter keeps every line of the single page — a
    no-op. Add an impl comment to that effect.
  - Positioned path: unchanged (`getLineIndex(layoutTree).all`).

- [ ] **Step 4 — Tests pass.** Run the new file + the existing
  `line-navigation` tests.

## Task 2: `moveToLineBoundary` accepts a virtual tree (single page)

**Files:**
- Modify: `packages/core/src/cursor/line-navigation.ts`
- Test: same `line-navigation-virtual.test.ts`

- [ ] **Step 1 — Failing test.** Assert `moveToLineBoundary(state, pos,
  virtualTree, m, b)` deep-equals the bridge result for start/end on positions
  across several pages (incl. a non-first page).

- [ ] **Step 2 — Implement.** Widen the param. `moveToLineBoundary` needs no X
  measurement, so keep the measurer UNUSED (`_shaperOrMeasurer`) and resolve the
  page WITHOUT `resolvePixelPosition`: use `plan.pageIndexOfBlock(position.blockId)`
  directly (the block's page). Virtual branch:
  - Spanning-block fallback (same predicate as Task 1): if
    `plan.pageSpanOfBlock(position.blockId)` spans pages (`first !== last`) OR
    `plan.pageIndexOfBlock` returns `< 0` → resolve via `materializeAll()`.
  - Else `P = plan.pageIndexOfBlock(position.blockId)`;
    `pageLines = getLineIndex(tree.getPage(P)).all`;
    `idx = findLineForPosition(pageLines, position)`; if `idx < 0` → fallback;
    else `line = pageLines[idx].line`;
    `createPosition(line.ownerBlockId, b==="start"?inlineOffsetStart:inlineOffsetEnd)`.

- [ ] **Step 3 — Tests pass.**

## Task 3: Update callers to pass the raw tree

**Files:**
- Modify: `move-line.ts`, `expand-line.ts`, `move-line-boundary.ts`,
  `expand-line-boundary.ts`, `delete-line.ts` (all in
  `packages/core/src/editor/actions/`)

- [ ] **Step 1** — replace `resolvePositionedTree(editor.layoutTree)` with
  `editor.layoutTree` in each `moveToLine` / `moveToLineBoundary` call; drop the
  now-unused `resolvePositionedTree` import where it becomes unused.

- [ ] **Step 2** — `npm test --workspace=packages/core` green; both packages
  build (`npm run build --workspace=packages/core` + `--workspace=packages/dom`).

## Task 4: Behavior regression test through the real editor

**Files:**
- Test: `packages/core/src/integration/virtual-edit-regression.test.ts` (append)

- [ ] Add: build a multi-page doc via `reduceEditor`, `paintAllPages`
  (controller-faithful), `SPLIT_NODE` (Enter), `paintAllPages`, then
  `MOVE_LINE up` ⇒ assert `editor.selection.focus` equals what a FRESH-layout
  `moveToLine` returns (independent oracle), and that the caret actually moved.
  Guards the wired path (handler → moveToLine → virtual tree), not just the unit.

---

## Verification
- `npm test` core + dom green; both build clean.
- Perf bench proves bounded `getPage` driver calls.
- Independent code-reviewer approves.
- User browser-verifies: `?perfFixture=5000`, Enter at top then ArrowUp ⇒ no
  first-press delay.
