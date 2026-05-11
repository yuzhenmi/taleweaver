# P6 — `state.embedContents` separation + cascade-delete completion

**Subject:** Add `state.embedContents: PersistentMap<BlockId, Block>` as a second map on `State`. Move embed-referenced content blocks (footnote bodies, etc.) from `state.blocks` (where they currently live with `parentId: null`, violating the "only root has null parent" invariant) into `state.embedContents`. Complete `removeBlock`'s cascade-delete logic that's currently TODO.

**Reference:** Strategy doc Decision 3.

**Spec step:** New (preventive cleanup before render/editor migration).

## Goal

Eliminate the invariant violation where embed-content blocks (e.g., footnote bodies) sit in `state.blocks` with null `parentId`. The render and editor migrations will both touch this lifecycle heavily; cleaner to fix the data model now, before P7+ build on top of it. Same cost-benefit reasoning as Phase 4c-2.5 and Phase 4c-4 Task 1 preventive cleanups, just larger scale.

## Dependencies

P4d (clonePastedSubtree). The phase needs all of Phase 4 done so that we can update every Layer 3 operation that touches embed contents.

## Current state

- `/Users/hansyu/code/taleweaver/packages/core/src/state/state.ts` — `State` interface has `rootId` and `blocks` only. The header comment at line 7-8 explicitly says "Embed-referenced sub-trees (footnote bodies) live in a separate map added in a later phase." This phase is that "later phase."
- `/Users/hansyu/code/taleweaver/packages/core/src/state/remove-block.ts` lines 30-37 have a TODO comment: "TODO (future): cascade-delete embed-referenced content blocks from `state.embedContents` for any embeds in the removed subtree's inlineContent. The `state.embedContents` map doesn't yet exist; today no code creates embed-referenced blocks so no orphaning happens for that pathway. When embedContents lands, this function will walk the removed subtree collecting `EmbedItem.properties.contentBlockId` references and remove each from embedContents." This phase resolves that TODO.
- Test fixtures using `fn-body` blocks in `state.blocks` exist in:
  - `packages/core/src/state/clone-pasted-subtree.test.ts` — ~7 tests in embed-content cloning + invariants describe blocks.
  - `packages/core/src/state/merge-blocks.test.ts` — 1 test in invariants block.
  - `packages/core/src/state/delete-range.test.ts` — 1 test in invariants block.
  - `packages/core/src/state/replace-range.test.ts` — 1 test in invariants block.
- `clonePastedSubtree` walks both child-tree and embed-content references. Its walker logic in `collectSubtreeIds` will need to look up blocks in BOTH maps (`state.blocks` for tree blocks, `state.embedContents` for content blocks).

## Files involved

**Modified (state.ts and family):**
- `state.ts` — add `embedContents: PersistentMap<BlockId, Block>` field. Update `createState` to take both maps.
- `initial-state.ts` and `new-initial-state.ts` — initialize `embedContents` as empty.
- `clone-pasted-subtree.ts` — walker looks up blocks in either map; cloned embed-content blocks go to result's `embedContents`, not `blocks`.
- `remove-block.ts` — implement the TODO'd cascade-delete: walk removed subtree's inlineContent for `contentBlockId` references; remove each from `state.embedContents` recursively (footnote bodies can themselves contain footnote anchors).
- Other Layer 3 ops that produce or consume embed-content references should be reviewed (probably none need direct changes — they only handle blocks reachable from the main tree).

**Modified (test-utils):**
- `state-builders.ts` — `buildState` should accept embed-content blocks separately or via a clear convention. Possibly add a `buildStateWithEmbedContents` helper or extend `buildState` to take a separate `embedContents` block list.

**Modified (tests):**
- ~10 test files that build `state.blocks` entries with `parentId: null` for fn-body shapes. Migrate fixtures.

**Modified (operations.ts barrel):**
- Export new types if any (e.g., maybe a helper for getting a block from either map).

## Key technical considerations

1. **Field placement.** Add `embedContents` to `State`. Keep `blocks` for the main tree. Two persistent maps, indexed by the same `BlockId` namespace (no collisions because the allocator produces unique ids).

2. **Lookups.** Many existing operations call `state.blocks.get(id)`. After P6, an embed-content block won't be found via `state.blocks` — only via `state.embedContents`. Operations that need to look up blocks regardless of map (e.g., the renderer enumerating all blocks for paint, `clonePastedSubtree`'s walker) need a helper:
   - `getBlock(state, id): Block | undefined` — checks both maps.
   - Or split: operations on the main tree use `state.blocks.get`; operations on embed contents use `state.embedContents.get`.
   The cleaner split is preferred; rare cases where ambiguity matters (clone walker) use a fallback chain.

3. **Cascade-delete in `removeBlock`.** When a block is removed, walk its inlineContent items collecting `EmbedItem.properties.contentBlockId` references. For each, recursively remove the referenced block + ITS descendants + ITS embed-content references. Cycle defense (visited set) per Phase 4d's `clonePastedSubtree` pattern.

4. **`clonePastedSubtree` update.** Walker discovers embed-content references in both `state.blocks` (children) and `state.embedContents` (looked up by contentBlockId). Cloned embed-content blocks land in the result's `embedContents`. The result's shape becomes:
   ```typescript
   interface ClonedSubtree {
     blocks: ReadonlyMap<BlockId, Block>;       // tree blocks
     embedContents: ReadonlyMap<BlockId, Block>; // embed-content blocks
     rootId: BlockId;
   }
   ```
   Or alternatively keep one `blocks` map (semantically: "all cloned blocks"). The caller assembles the correct destination split when inserting.
   **Decision needed in P6 plan.**

5. **History.** Each `OperationResult.dirtyIds` could potentially distinguish between blocks vs embed-content blocks, but the dirty-ids contract is just "ids whose entry differs." Renderer / consumer needs to look up by id; if `state.embedContents` is queryable, the contract holds without changes. No history schema change needed.

## Risks and patterns to apply

- **Test-fixture migration:** ~10 test files affected. Methodical migration: for each fixture using `fn-body` in `state.blocks`, move to `embedContents`. Verify visually before running.
- **Cascade-delete cycle defense** (per Phase 4d): visited set, `add` before recursion.
- **Backward-compatible assertions:** existing tests like `result.state.blocks.has("fn-body")` need updating to `result.state.embedContents.has("fn-body-id")`. Mechanical but error-prone — use grep to find every assertion that touches a fn-body id.
- **DRY discipline:** if multiple ops need a `getBlockFromEither(state, id)` helper, extract it to `state.ts` or a new util file. Per Phase 4 cleanup pattern, do this preventively.

## Test strategy

Per Phase 4 pattern: 5-7 task plan with TDD per task.

- Task 1: add `embedContents` field to `State`, update `createState`, update `initial-state.ts`. Tests: existing tests still pass; new tests assert the field exists.
- Task 2: migrate test fixtures across ~10 files. Tests: all migrated tests still pass.
- Task 3: update `clonePastedSubtree` walker + return shape. Tests: existing 19 clone-pasted-subtree tests + maybe new tests for the embedContents output split.
- Task 4: implement `removeBlock` cascade-delete. Tests: new tests covering cascade-delete of footnote bodies + nested footnote-in-footnote.
- Task 5: helper(s) for cross-map lookup. Tests: unit tests.
- Task 6: barrel/operations.ts update + final verification. Full suite green.

Estimated test count delta: +10-15 (cascade-delete tests, helpers).

## Resolved questions (see `decisions.md`)

1. ✅ **A — Two separate maps.** Decided 2026-05-10. `State.blocks` for main tree; `State.embedContents` for embed-content blocks. `clonePastedSubtree` returns `{ blocks, embedContents, rootId }`. Helper `getBlockFromEither(state, id)` for rare cross-map lookups.
2. ✅ **C — Yjs primitives for state storage.** Decided 2026-05-10. After P4e, both `state.blocks` and `state.embedContents` are `Y.Map<BlockId, Y.Map>` at the Y.Doc root. P6 introduces the `embedContents` slot on top of the Yjs-backed state (rather than the original PersistentMap-backed state).

## Open questions (phase-local; resolve in P6 per-phase plan)

1. **`buildState` test helper signature change:** is the migration purely mechanical (add an `embedContents: []` parameter), or do we want a more ergonomic builder pattern? Decide in plan.

2. **History schema:** does adding `embedContents` to `State` break the existing `Change` type that wraps state? Likely yes — `Change` carries `prevState`, which now has the new field. Verify and migrate.

## Success criteria

- `State` has `embedContents` field, populated correctly by all factories.
- `removeBlock` cascade-deletes embed-content blocks (TODO at remove-block.ts:30-37 resolved).
- `clonePastedSubtree` produces a clean two-map result (or one-map with caller-side split per design decision).
- Test fixtures migrated; no `fn-body` blocks remain in `state.blocks` of test fixtures.
- All Phase 4 tests still pass after migration.
- `grep -r "fn-body.*state.blocks" packages/core/src/` returns nothing (or only documented exceptions).

## Review cycle expectations

Pre-execution review: yes. Post-execution review: yes. Standard "until convergence" pattern.

## Estimated commits

~7-10.
