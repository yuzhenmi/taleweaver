# Virtualized Layout — Phase 3 Implementation Plan (the wiring; the win lands here)

> Task-by-task; code-reviewer gate before commit (CLAUDE.md principle 3). TDD.
> **Browser verification is the user's, at the end** (no Playwright) — the
> `__twPerf.traceEnter()` instrumentation is already in the controller.

**Goal:** Wire `layoutTreeIncremental` to produce a `VirtualLayoutTree` and
migrate the DOM controller's hot path (paint + caret resolution) to position
only the visible + cursor pages, so typing and Enter become O(visible) instead
of O(N_blocks). Non-hot interactions (mouse hit-test, arrow nav, multi-page
selection geometry, `findBlockBaseline`, the resize path's consumers) ride a
`materializeAll()` bridge and are fully migrated in **Phase 4**.

**Architecture:** `docs/superpowers/specs/2026-05-24-virtualized-layout-design.md`.

> **State of the world (corrected after plan review):** Phase 2 committed the
> machinery (`makeVirtualLayoutTree`, `measurePass`, `buildBlockFitMetas`,
> `materializeAll`, the `measurePassUnsupported` gate) but it is **UNWIRED** —
> `layoutTreeIncremental` still returns a positioned `BlockBox` via
> `paginateRoot`. Task 1 is what wires it.
>
> **The win is gated on Task 0 (load-bearing).** `buildBlockFitMetas` today
> relayouts EVERY block (`layoutBlock`/`layoutInlineContent`) on every call with
> no cache — so the measure pass is currently O(N) full layouts, NOT the cheap
> "read cached intrinsic heights" the design assumed. Wiring it (Tasks 1–3)
> without Task 0 would ship correctness but NO perf win (and Task 4's guard would
> fail). Task 0 adds the metas cache first.

## Win analysis (what must go O(visible) for typing/Enter)
Keystroke → reducer (`rebuildTrees` → `layoutTreeIncremental`) → React →
`controller.update()`. For typing/Enter to be fast:
- The reducer's `layoutTreeIncremental` must build the plan + virtual tree and
  **position NO pages** (O(measure-arithmetic + dirty-block relayout)).
- `controller.update()` calls only `resolvePixelPosition` (caret;
  `computeSelectionRects` is skipped when the selection is collapsed) + `paint`
  + `syncDom` + `scrollCursorIntoView` — each must be O(visible), via the plan +
  `getPage(visible ∪ cursorPage)`.
Editor-action handlers for INSERT_TEXT/SPLIT_NODE compute the new selection from
STATE (not layout), so they trigger no page positioning. Arrow-nav handlers
(`moveToLine` etc.) DO touch layout — those stay on the bridge (Phase 4); they
are not the reported pain.

---

### Task 0 (prerequisite, load-bearing): incremental `buildBlockFitMetas`

**Files:** `packages/core/src/layout/build-fit-metas.ts` (+ `__tests__/build-fit-metas.test.ts`).

Today `buildBlockFitMetas(cascadedRoot, shaper, pageContentInlineSize)` walks
the tree and lays out EVERY block fresh (`layoutBlock`/`layoutInlineContent`) —
O(N) full layouts per call. Add a cache so unchanged blocks reuse their meta:

- Module-level `WeakMap<ElementBox /* cascaded node */, { width: number; meta: BlockFitMeta }>`.
  For each child node, if the cascaded ElementBox reference is in the map AND
  the entry's `width === pageContentInlineSize`, reuse `meta`; else build it
  (lay out) and store. The incremental cascade preserves ElementBox references
  for UNCHANGED blocks (same structural-sharing L-PERF-C/G rely on), so a
  single-block edit rebuilds only that block's meta (+ its ancestors whose
  child list changed) and ref-reuses the rest. A width change misses (different
  `width`) and rebuilds — correct, since line wrapping depends on width.
- The recursion into containers reuses the same cache per nested node.
- NOTE: a bare inline-run group directly under a container has no stable
  cascaded-ElementBox key (`ifcLeafMetaFromInlineRun` synthesizes a fresh anon
  ElementBox each call), so those metas are intentionally NOT cached and rebuild
  each keystroke. Rare (top-level children are blocks; mixed inline+block
  siblings under one container are uncommon); acceptable for v1 — flag as a
  future optimization, do not block on it.

- [ ] **Step 1 (failing tests):** (a) **correctness** — `buildBlockFitMetas`
  output is deep-equal whether or not the cache is warm (build twice on the
  same cascaded root; equal). (b) **incrementality** — instrument a build
  counter; build metas for an N-block doc, then rebuild after replacing ONE
  child's cascaded node ref (simulating a dirty block) while keeping the other
  refs identical; assert only ~1 block was re-laid-out, not N. (c) **width
  guard** — a `pageContentInlineSize` change rebuilds (cache miss).
- [ ] **Step 2:** implement the WeakMap cache + width guard.
- [ ] **Step 3:** green; full `npm test --workspace=packages/core` green
  (the existing equivalence harness still passes — cached metas are identical).
- [ ] **Step 4:** reviewer gate.

### Task 1 (de-risk): wire through the `materializeAll()` bridge — ZERO behavior change

**Files:**
- `packages/core/src/layout/layout-incremental.ts` (paginated path returns `VirtualLayoutTree`)
- `packages/core/src/layout/dispatch.ts` (`layoutTree` full build, paginated path)
- `packages/core/src/editor/editor-state.ts` (`layoutTree: LayoutBox | VirtualLayoutTree`)
- NEW `packages/core/src/layout/positioned-tree.ts`: `resolvePositionedTree(lt: LayoutBox | VirtualLayoutTree): LayoutBox` = `lt.type === "virtual-root" ? lt.materializeAll() : lt`.
- **Every CURRENT reader** of `editorState.layoutTree` / a passed layout tree that expects a positioned `LayoutBox` — enumerate per the design's "EditorState.layoutTree type blast radius" section AND grep to confirm. Known set: `packages/dom/src/editor-controller.ts` (`syncDom` `tree.children`/`tree.type==="block"`, `paintSingle` `tree.width`/`tree.height`, `paintPages`, the spacer `tree.height`, `resolveMouseToLayout`); `packages/dom/src/canvas-renderer.ts` (`paintCanvas` `.children` walk); `cursor/*` (`resolvePixelPosition`, `resolvePositionFromPixel`, `computeSelectionRects`, `moveToLine`, `moveToLineBoundary`, `findBlockBaseline`); the editor actions that pass `editor.layoutTree` into nav fns (`move-line.ts`, `move-line-boundary.ts`, `delete-line.ts`, `expand-line.ts`, `expand-line-boundary.ts`) and `set-container-width.ts` (stores it). Insert `resolvePositionedTree(...)` at EACH entry so it operates on the materialized tree. **Including the controller** — in Task 1 the controller is FULLY on the bridge (`syncDom`/paint read `resolvePositionedTree(state.layoutTree)`), so it compiles and behaves identically; Task 2 moves it off the bridge.
- `packages/core/src/index.ts`: export `VirtualLayoutTree` type + `resolvePositionedTree`.

- [ ] **Step 1:** route `layoutTreeIncremental` / `dispatch.layoutTree` paginated paths through `buildBlockFitMetas` (now cached, Task 0) + `measurePass` + `makeVirtualLayoutTree(plan, cascadedRoot, rootCtx, shaper, pageConfig, prevTree?)` — pass the `rootCtx` already built in `layoutTreeIncremental`; pass `oldEditor.layoutTree` as `prevTree` ONLY when it is `virtual-root` (thread it via `rebuildTrees`). When `measurePassUnsupported(cascadedRoot)` OR unpaginated, return the legacy positioned `BlockBox` (current behavior). Change the `layoutTree` field type to `LayoutBox | VirtualLayoutTree`.
- [ ] **Step 2:** add `resolvePositionedTree` and apply it at EVERY consumer entry above (controller included). Fix all type errors from the union.
- [ ] **Step 3:** full `npm test --workspace=packages/core` + `--workspace=packages/dom` + build green. Behavior is UNCHANGED (everything materializes — Phase-2 proved `materializeAll() ≡ paginateRoot`); this step only proves the type ripple + wiring + Task-0 cache are correct. **No perf win yet** (the controller still materializes all pages via the bridge).
- [ ] **Step 4:** reviewer gate (focus: type-union completeness — every reader handled incl. the controller's `syncDom`/`paintSingle`; `materializeAll()` ≡ old output so zero regression).

### Task 2: controller paint + slot sizing via plan / `getPage(visible)`

**Files:** `packages/dom/src/editor-controller.ts`.

- [ ] **Step 1:** `syncDom`/`syncPageCanvases`: size page slots from `vtree.plan.entries` (pageIndex, blockOffset, blockSize) when the tree is virtual — NO `materializeAll`. Scroll spacer / total height from `plan.totalBlockSize`. `paintPages`: for each active (visible) canvas index, `vtree.getPage(idx)` and paint. `resolveMouseToLayout` page mapping via `plan.pageIndexAtBlockOffset`.
- [ ] **Step 2:** keep `resolvePixelPosition`/`computeSelectionRects`/hit-test on the bridge for now (Task 3 migrates the caret). Build + the dom test suite green.
- [ ] **Step 3:** reviewer gate. (Partial win: paint/slots O(visible); caret still materializes — Task 3 finishes it.)

### Task 3: migrate `resolvePixelPosition` (caret) to O(visible)

**Files:** `packages/core/src/cursor/cursor-position.ts` (+ `line-flatten.ts` if a per-page LineIndex helper is needed), `packages/core/src/layout/__tests__` / `packages/core/src/cursor/__tests__`.

- [ ] **Step 1 (failing test):** `resolvePixelPosition(state, position, virtualTree, measurer)` must (a) resolve the cursor block's page via `plan.pageIndexOfBlock`, `getPage` it, run the existing per-page LineIndex/`byBlock` logic on that ONE page; (b) handle the cross-page soft-wrap caret edge — at a block's last line on page N with `offset === inlineOffsetEnd`, if the plan shows the block continues onto N+1, `getPage(N+1)` and return its first same-block line (per the spec). Assert (i) it returns the SAME PixelPosition as the materialized-tree path on multi-page fixtures incl. the cross-page edge, and (ii) it materializes only the cursor page (+ neighbor at the edge), NOT all pages (driver-count or getPage-call assertion).
- [ ] **Step 2:** implement. The controller's `update()` calls the migrated `resolvePixelPosition` with the virtual tree directly (no `resolvePositionedTree`). `computeSelectionRects` stays on the bridge (Phase 4) — but the controller already skips it when the selection is collapsed (the typing/Enter hot path), so the win lands.
- [ ] **Step 3:** full core + dom suites + build green; the equivalence between migrated and bridge paths holds.
- [ ] **Step 4:** reviewer gate.

### Task 4: perf guard + hand-off for browser verification

**Files:** test in `packages/core/src/integration/` or `packages/dom`.

- [ ] **Step 1:** an integration/perf test: on an N-page paginated fixture, a SPLIT_NODE at the top drives `bfc.layoutBlock` O(visible-ish), independent of N — i.e. the reducer no longer positions all pages. (The Phase-1 L-PERF-F red test, now green via the full pipeline.) Assert the `editorState.layoutTree` is a `virtual-root` after a paginated edit.
- [ ] **Step 2:** reviewer gate (whole-Phase-3 review).
- [ ] **Step 3 (USER):** hand off a `npm run dev --workspace=examples/react` build. User loads `?perfFixture=110`, places caret at top, runs `__twPerf.traceEnter()`, confirms `layoutTreeIncremental` is now small and Enter feels instant; spot-checks paint correctness, caret position (incl. a paragraph spanning a page boundary), scrolling, and that clicking/selecting still works (bridge). Controller commit waits on the user's smoke result per the browser-verification rule.

---

## Done-when
Tasks 1–3 green + reviewer-approved; Task 4 perf guard green; AND the user's
browser smoke confirms the Enter/typing win + no paint/caret/scroll regressions.
Mouse hit-test, arrow nav, multi-page selection geometry, `findBlockBaseline`
remain on the `materializeAll()` bridge (correct, not yet O(visible)) → Phase 4.

## Risks / notes
- **Browser-first rule (CLAUDE.md):** unit tests assert structure; only the
  browser exercises coordinates/paint. Do NOT mark Phase 3 done on green tests
  alone — the user's smoke is the gate.
- The carry-forward memo (`prevTree`) only helps if `rebuildTrees` threads the
  prior `VirtualLayoutTree`; ensure the old editor's `layoutTree` (when virtual)
  is passed into `makeVirtualLayoutTree`.
- Keep `materializeAll()` correctness intact (Phase-2 equivalence) — it's the
  bridge the un-migrated consumers depend on until Phase 4.
- Implementer subagents do NOT commit; controller reviews then commits; and the
  controller-touching commit additionally waits on the user's browser smoke.
