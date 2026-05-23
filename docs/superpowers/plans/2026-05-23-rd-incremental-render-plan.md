# R-D — Incremental rendering implementation plan

> Plan for R-D of the render-module cleanup. Spec at
> `docs/superpowers/specs/2026-05-22-render-incremental-design.md`.
> All gating items resolved: cascade audit + cleanup (C-A through C-C)
> done, layout audit + cleanup (L-A through L-H) done, LineBox-
> canonical refactor (E-E.1 through E-E.7) done. R-D is now unblocked.

## Goal

The render module is O(N) per call (full tree rebuild every keystroke).
The state module already produces `dirtyIds: Set<BlockId>` per
operation; layout consumes them via `layoutTreeIncremental`. Render
must do the same so unchanged subtrees flow through by reference,
preserving ref-equality through the whole pipeline (render → cascade
→ layout → paint).

**Target contract** (from spec):
- Reference equality on unchanged subtrees: `render(state, prev)` →
  the RenderNode for any unchanged block is `===`-equal to the
  previous output's RenderNode for that block.
- Work is O(dirty-subtree-size + dirty-ancestor-chain), not O(N).

**Performance acceptance** (from spec): per-keystroke render at 1,000
blocks < 1 ms; at 10,000 blocks < 5 ms.

## Decisions (already recorded in the spec)

- **Q1 → stateless API.** `render(state, ..., options?: { prev,
  prevState, dirtyIds })`. Editor threads the prev chain.
- **Q2 → pull pipeline up to editor.** Editor calls render → cascade
  → layout explicitly. Each stage's incrementality is a top-level
  reducer decision, not hidden inside layout.
- **Q3 → pre-compute dirtyAncestors.** Walk each dirty id up to root,
  build a `Set<BlockId>`, then the render walk is a simple `id ∈
  dirtyOrAncestor` check.

## Task sequence

Each task ends with implementer → reviewer-until-clean → commit per
the standing rule.

### R-D.1 — `renderIncremental` core + RenderCache type

- Add the optional `options` param to `render()`:
  `{ prev?: RenderOutput, prevState?: State, dirtyIds?: ReadonlySet<BlockId> }`.
- Implement the incremental walk:
  - Pre-compute `dirtyAncestors: Set<BlockId>` from `dirtyIds` by
    walking up via `Block.parentId`.
  - For each block during the walk: if `id ∉ dirtyIds ∪
    dirtyAncestors` AND `getBlock(state, id) === getBlock(prevState,
    id)`, return `prev`'s RenderNode for that id.
  - Otherwise re-render; recurse into children reusing cached
    RenderNodes for unchanged children.
- Same for embed-contents (parallel map).
- All new params optional → existing callers (full-rebuild) unchanged.
- Tests:
  - Identical state twice → root ref-equal.
  - Single dirty block → siblings ref-equal across calls.
  - Deep dirty block → ancestor chain rebuilt, sibling subtrees
    ref-equal.
  - Empty `dirtyIds` → returns prev as-is.
  - Drift property: incremental output structurally equal to
    non-incremental output for arbitrary edit sequences.

NOTE: at this point the editor reducer still calls
`render(...)` without options — incremental rendering is wired but
not consumed. Subsequent tasks plumb cascade and the editor
reducer.

### R-D.2 — Cascade incremental wired into editor reducer

- `cascadePassIncremental` already exists (`packages/core/src/cascade/`).
  Verify its contract: `cascadePassIncremental(newRoot, oldRoot,
  oldCascadedRoot)` preserves ref-equality on unchanged subtrees.
- Editor reducer change: instead of `layoutTreeIncremental(newRoot,
  oldRoot, oldLayout, ...)` which auto-cascades, call explicitly:
  1. `cascaded = cascadePassIncremental(renderOutput.root,
     prevRenderOutput.root, prevCascaded)`.
  2. `layout = layoutTreeIncremental(cascaded, prevCascaded,
     prevLayout, ...)` with a new `options.skipCascade: true` (or
     a `cascadedInput: true` flag).
- `EditorState` extends to carry `previousRenderOutput`,
  `previousCascaded`. Existing `renderTree` and `layoutTree` remain.
  (Or: store these on a `RenderCache` field on the EditorState
  alongside renderTree.)
- Tests:
  - End-to-end pipeline: single-keystroke edit on a 100-block doc;
    assert only the touched block's render+cascade+layout subtrees
    are recomputed (ref-equality on siblings).

### R-D.3 — Layout `skipCascade` / cascaded-input flag

- `layoutTreeIncremental` currently calls `cascadePass(newRoot)`
  internally (auto-cascade). Add a way to tell it the input is
  already cascaded:
  - Option A: new param `cascadedInput?: boolean`.
  - Option B: separate factory `layoutTreeFromCascaded(...)`.
- Spec says Q2 = pull cascade up to editor, so layout should support
  receiving an already-cascaded tree. Choose the simplest non-
  breaking API.
- Tests: layout produces the same output whether it auto-cascades
  vs. consumes a pre-cascaded tree.

### R-D.4 — Performance benchmarks

- Add a perf-trace test (or a separate bench script under
  `examples/perf-bench/`) that:
  - Builds a 1,000-block doc via state builders.
  - Times one full render + cascade + layout (cold).
  - Times one incremental render + cascade + layout after a single
    INSERT_TEXT (warm).
  - Asserts cold < warm × 100 (sanity check; not a regression gate
    unless the values stabilize).
- The numbers themselves go into a `BENCH.md` under `docs/`, not
  baked into tests (unstable references per CLAUDE.md).

### R-D.5 — Architecture doc updates

- `docs/architecture/1-core/1.2-render.md`: update perf-contract
  section to mark the O(D) target as `[implemented]` instead of
  `[partial]`.
- `docs/architecture/1-core/1.7-editor.md`: same for the reducer
  flow's `rebuildTrees` annotation.
- Cross-link to R-D commit history in tracker.

## Risk table

| Risk | Likelihood | Mitigation |
|---|---|---|
| Pre-computing `dirtyAncestors` requires `parentId` access on the OLD state for blocks that have since been deleted. Use the NEW state's block-tree to walk up; if the dirty id is a removed block, it has no ancestors in new state but its parent in old state should still be invalidated. | Medium | Walk up via the OLD state for removed blocks; via the NEW state for surviving blocks. Both paths cheap. |
| Cascade-incremental contract isn't quite what the spec assumes. `cascadePassIncremental` may not preserve ref-equality the way render needs. | High | R-D.2 starts with a contract-verification test on `cascadePassIncremental` before any reducer wiring. If broken, add a sub-task to fix it (likely small). |
| Existing reducer callers depend on `rebuildTrees` doing full re-layout each call (e.g., for cache invalidation). Switching to incremental might surface latent bugs in layout-incremental's reuse paths. | Medium | The drift test in R-D.1 + the end-to-end pipeline test in R-D.2 catch incorrect reuse early. |
| Editor tests assume `renderTree` is freshly built. Some may compare reference identities they shouldn't. | Low | Run full test suite after each task; fix any false-fail by relaxing the assertion. |
| Adding `previousCascaded` to EditorState bloats its memory footprint (one extra tree-sized retention per editor). | Low | Architectural cost; mitigates with explicit caching strategy if it shows up in benchmarks. |

## Out of scope

- Painter cache integration in `@taleweaver/dom` (consumes
  ref-equality; lives outside core).
- Property-based fuzz over the full reducer.
- Reworking `cascadePassIncremental`'s parent-style equality check
  beyond what already exists (unless R-D.2 finds it broken).
- Removing the legacy `cascadePass` (still needed for non-
  incremental callers).

## Status tracker

| Task | Status | Commit | Notes |
|------|--------|--------|-------|
| R-D.1 | ✅ done | `17517de` | `renderIncremental` core + 4 tests. Additive — editor reducer unchanged. Embed-content invalidation gap (parentId chain coverage) carved out as task #221. Spec deviation re: `getBlock(state, id) === getBlock(prevState, id)` runtime check documented inline (Y.Doc wrapper identity makes the check useless at runtime; dirtyIds contract is authoritative). |
| R-D.2 | ✅ done | `6add87e` | EditorState extended with `renderOutput` + `cascadedRoot`. `rebuildTrees` does explicit render → cascade → layout incrementally given `dirtyIds`. `insert-text` migrated; end-to-end ref-equality integration test confirms unchanged sibling RenderNodes ref-equal across a keystroke. layoutTreeIncremental's existing skip-cascade-if-computedStyle short-circuit absorbs R-D.3's intended cascadedInput flag — no separate flag needed. |
| R-D.3 | ✅ done | `78e025a` | All 10 state-mutating handlers (delete-* / paste / split-node / insert-node / toggle-style / set-block-type / toggle-list) pass dirtyIds to rebuildTrees. Undo/redo intentionally not migrated (Y.UndoManager doesn't expose dirtyIds). Reviewer-flagged consistency fix folded in: set-block-type / toggle-list moved from `mergedDirtyIds.size === 0` no-op guard to the codebase-standard `attrsResult.state === editor.state` pattern. |
| R-D.4 | not started | — | Performance benchmarks: cold full vs warm incremental at 1000-block / 10000-block docs. Deferred — implementation is correct (verified by tests + browser smoke); benchmarks are needed for the perf-contract verification step but not blocking feature work. |
| R-D.5 | not started | — | Architecture doc updates: mark render + reducer perf-contract O(D) targets as `[implemented]` once R-D.4 confirms. |
