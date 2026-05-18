# P4e — Rebase state module on Yjs primitives

**Subject:** Replace `PersistentMap`-backed state storage with Yjs primitives (`Y.Doc`, `Y.Map`, `Y.Array`, `Y.Text`). Layer 3 operations become Yjs transactions. History uses Yjs's UndoManager. Single-user editing runs entirely on Yjs locally; collab sync transport is added in a separate future phase without modifying the state module.

**Reference:** Decisions log entry C (`decisions.md`).

## Goal

After Phases 1-4 we have a fully working state module on top of `PersistentMap<BlockId, Block>` with pure-functional Layer 3 operations. To make collab a future-additive concern (rather than a future-rewrite concern), this phase rebases the state module on Yjs CRDT primitives. The public API surface (Block, State, Position, Span, Layer 3 ops) stays roughly the same; internals change.

## Dependencies

P4d (clonePastedSubtree) — Phase 4 complete. All 11 Layer 3 ops shipped; tests cover them.

## Current state (pre-P4e)

Working state module in `packages/core/src/state/`:
- `state.ts`: `State { rootId, blocks: PersistentMap<BlockId, Block> }`. (P6 will add `embedContents`.)
- `block.ts`: `Block` as frozen interface with id/type/attrs/parent/sibling/child/inlineContent fields.
- `inline-content.ts`: `InlineContent { items: ReadonlyArray<InlineItem> }`, `TextItem`, `EmbedItem`.
- `persistent-map.ts`: wrapper around plain `Map<K, V>` with persistent-update semantics.
- `block-id.ts`: branded `BlockId`, `IdAllocator`.
- `attrs.ts`: `ReadonlyAttrs = Readonly<Record<string, unknown>>`, `attrsEqual`.
- `block-position.ts`: `Position { blockId, offset }`, `Span`.
- 11 Layer 3 ops (`set-block-attrs.ts`, `insert-block.ts`, `remove-block.ts`, `set-block-type.ts`, `insert-text.ts`, `apply-attrs.ts`, `split-block.ts`, `merge-blocks.ts`, `delete-range.ts`, `replace-range.ts`, `clone-pasted-subtree.ts`).
- Helpers: `updateBlock` (block.ts), `mergeAdjacentTextItems`/`splitInlineContentAtOffset`/`findItemAtOffset` (inline-content.ts).
- `history.ts`: snapshot-based history wrapping `Change`.
- `change.ts`: `Change { oldState, newState, timestamp }`.

Build green. 1213 tests passing + 4 skipped.

## Target state (post-P4e)

`@taleweaver/core` has `yjs` as a runtime dependency.

State storage:
- `Y.Doc` is the root. Holds:
  - `Y.Map` for blocks (key: `BlockId`, value: `Y.Map` representing one block).
  - `Y.Map` for embedContents (same shape; introduced in P6 but the slot is reserved in P4e).
  - `Y.Map` for meta (e.g., `rootId` reference).
- Each block is a `Y.Map` with fields:
  - `type: string`
  - `attrs: Y.Map<string, unknown>`
  - `parentId: BlockId | null`
  - `prevSiblingId: BlockId | null`
  - `nextSiblingId: BlockId | null`
  - `firstChildId: BlockId | null`
  - `lastChildId: BlockId | null`
  - `inlineContent: Y.Array<Y.Map> | null` (null for container blocks)
- Each inline item is a `Y.Map` with fields:
  - For TextItem: `kind: "text"`, `text: Y.Text` (carries per-character CRDT + formatting), `attrs: Y.Map`.
  - For EmbedItem: `kind: "embed"`, `embedType: string`, `attrs: Y.Map`, `properties: Y.Map<string, unknown>`.

Public API surface (mostly preserved):
- `State` exported as an opaque type wrapping `Y.Doc` + accessor helpers.
- `Block`, `InlineContent`, `TextItem`, `EmbedItem` exported as immutable snapshot view interfaces (frozen JS objects produced by snapshot accessors).
- `getBlock(state, id): Block | undefined` produces a frozen snapshot view of a Y.Map; consumers don't access Y types directly.
- All 11 Layer 3 ops keep their signatures. Internally they open Yjs transactions.
- `OperationResult { state, dirtyIds }` unchanged.
- History API mirrors Yjs's UndoManager but exposes our names.

Files affected:
- All of `packages/core/src/state/` is rewritten internally (interfaces stay; bodies use Yjs).
- `persistent-map.ts` DELETED.
- `change.ts` likely DELETED or simplified (Yjs UndoManager replaces it).
- `history.ts` rewritten as a thin wrapper over `Y.UndoManager`.
- `state-builders.ts` (test utils) rewritten to construct Y.Doc-backed state.

Tests:
- ALL 1213 existing tests need fixture migration (build state via Y.Doc-backed builders instead of PersistentMap-backed).
- Some tests checking PersistentMap-specific behaviors are dropped.
- New tests for Yjs-specific concerns: transaction atomicity, undo manager behavior, Y.Text CRDT semantics for inline text.

## Key technical considerations

1. **Public API stability.** Consumers of `Block`, `State`, `Position`, Layer 3 ops should ideally see no change. Internal refactor; external API preserved.

2. **Snapshot views are immutable JS objects.** When `getBlock(state, "p1")` is called, it walks the Y.Map at "p1" and returns a frozen JS interface. Mutation of the snapshot has no effect on the Y.Doc. Caching: the snapshot can be invalidated when the underlying Y.Map changes; recomputed on next access. For perf at scale, snapshots are computed lazily and cached per id with version tracking.

3. **Transactions and OperationResult.** Each Layer 3 op opens a single Yjs transaction (`doc.transact(...)`). During the transaction:
   - Mutations applied to Y types.
   - Yjs's transaction tracks which Y types changed; we map back to BlockIds → `dirtyIds`.
   - On commit, the next `state` snapshot reflects the new Y.Doc state.
   - Inverse op is captured by Yjs's UndoManager (which records its own undo info inside the transaction context).

4. **Snapshot identity for structural sharing.** `OperationResult.state` after an op should be a NEW snapshot reference that compares-not-equal to the old one (so consumers can do `if (oldState !== newState)` to detect changes). But unaffected sub-snapshots (e.g., a block that wasn't touched) should ideally share identity with the old version.

   Implementation: snapshot views cache by id + Y.Map version. If the Y.Map hasn't changed (no version bump), the cached snapshot is returned. Consumers comparing `oldState.blocks.get(id) === newState.blocks.get(id)` see identity for unchanged blocks.

5. **Yjs UndoManager wiring.** Yjs's `UndoManager` is attached to a set of Y types. When ops occur within tracked transactions, the manager records them; `undo()` rolls them back; `redo()` replays. We wrap this:
   - `History` is a facade exposing `pushHistoryEntry`, `undo`, `redo`, `canUndo`, `canRedo`.
   - Selection is tracked separately (not in Yjs; selection isn't shared with peers in our model). On `undo`, the wrapper restores the selection from the entry's metadata.
   - mergeTag uses Yjs's transaction origin tracking (each transaction has an `origin`; setting it to the mergeTag value enables grouping).

6. **`BlockId` from Yjs ids.** Each block's id should be a Yjs-friendly id. Yjs internally uses `{clientID, clock}` pairs for its own items but consumers usually generate ids however they want (UUIDs, strings, etc.). Our `BlockId` stays as a branded string; the `IdAllocator` continues to produce them. Yjs's client-id-based id system applies to Y type IDs (one level below), not our BlockId space.

7. **`Y.Text` for text items.** A TextItem's `text` field is a `Y.Text` (per-character CRDT + formatting marks). The "attrs" field on TextItem holds run-level attrs that apply to the whole text run; if we want truly per-character attrs (e.g., one char bold within an italic run), Y.Text supports format markers that span ranges. The design choice: keep run-level attrs as a Y.Map (simple, common case), and use Y.Text format markers only when needed (advanced cases). Phase 4e plan decides exact shape.

8. **`Y.Array` for inline content.** `Block.inlineContent` is a `Y.Array<Y.Map>`. Inserts/removes are id-based (CRDT). Items have stable identity across edits.

9. **`PersistentMap` deletion.** P4e deletes `persistent-map.ts`. Y.Map replaces it. All Layer 2 utilities and Layer 3 ops that referenced PersistentMap are updated. Existing tests that called `state.blocks.get(id)`, `state.blocks.set(id, block)`, etc. are updated to use snapshot-view accessors and op-based mutations.

10. **`Change` and history.** The legacy `Change { oldState, newState, timestamp }` model is replaced by Yjs's UndoManager (which records per-transaction undo info internally). The public history API stays (`pushHistoryEntry`, `undo`, `redo`).

## Files involved

**Modified (internals rewritten, public API preserved where possible):**
- `state/state.ts`
- `state/block.ts`
- `state/inline-content.ts`
- `state/attrs.ts`
- `state/block-id.ts` (IdAllocator may evolve)
- `state/block-position.ts` (Position/Span unchanged at type level)
- `state/block-traversal.ts`, `state/block-compare.ts`, `state/span-iteration.ts` (Layer 2 utilities — rewritten to use Yjs accessors)
- All 11 Layer 3 op files
- All test files (fixture migration)
- `state/history.ts` (rewritten as Yjs UndoManager wrapper)
- `state/operations.ts` (barrel exports may change slightly)
- `test-utils/state-builders.ts` (rebuilt to construct Y.Doc-backed state)

**Created:**
- `state/yjs-doc.ts` (or similar): Y.Doc initialization, transaction helpers, snapshot accessors. Possibly multiple files.
- `state/get-block.ts` (or merged into state.ts): snapshot accessors with caching.
- `state/snapshot.ts` (if substantial): the snapshot-view facade pattern.

**Deleted:**
- `state/persistent-map.ts` and `state/persistent-map.test.ts`.
- `state/change.ts` and `state/change.test.ts` (likely; UndoManager replaces it).

**Added dep:**
- `yjs` in `packages/core/package.json` dependencies.

## Risks and patterns to apply

1. **Public API preservation as a hard invariant.** This phase changes a LOT of internals. The public API surface must remain compatible — consumers (P5+) write to the same Block/State/Position/Layer 3 op signatures. Pre-execution review verifies this contract.

2. **Snapshot view caching correctness.** Naive snapshot recomputation on every read is correct but slow. Caching needs version-tracking to invalidate correctly. Get this right or perf collapses.

3. **Transaction atomicity.** Each Layer 3 op = one Yjs transaction. Mid-transaction state mustn't leak. Use `doc.transact(...)` callback pattern.

4. **Test fixture migration is massive.** ~1213 existing tests construct state via PersistentMap-shaped fixtures. Migration to Y.Doc-shaped fixtures is mechanical but error-prone. Build robust test-utils first (e.g., `buildState({ rootId, blocks })` builder that constructs the Y.Doc internally); migrate fixtures next.

5. **Yjs's undo semantics differ from snapshot-based undo.** Yjs records what changed within a transaction; undo rolls back those specific changes. Tests that assert "undo restores state X" should still pass because state X is preserved structurally. But tests checking specific reference equality (e.g., `result.state.blocks === prevState.blocks`) need updating because Yjs's mutation model means the underlying Y.Map IS the same reference (different version), but snapshot views reflect the change.

6. **Yjs's id generation vs our `IdAllocator`.** Coordinate carefully. Our `BlockId` is a branded string the allocator produces; Yjs's internal struct ids are separate. The allocator continues to produce BlockIds; Yjs handles its own internal IDs without us caring.

7. **Document persistence considerations.** Yjs has well-defined update-encoding for persistence (`Y.encodeStateAsUpdate(doc)`, `Y.applyUpdate(doc, bytes)`). For now we don't serialize; later phases can add persistence cheaply.

## Test strategy

P4e tests fall into categories:

**Migration tests (preserve existing behavior):**
- All ~1213 existing Layer 1/2/3 tests should still pass after migration. Fixtures change; assertions stay (modulo reference-equality vs value-equality nuances).

**New Yjs-specific tests:**
- Transaction atomicity: ops inside a transaction don't appear externally until committed.
- Undo manager: single-step undo, multi-step undo, redo after non-undo op, mergeTag grouping.
- Snapshot caching: same id queried twice without underlying change returns the same reference; with change returns a different reference.
- Yjs interop: encoding/decoding a Y.Doc update round-trips state.

**Removed:**
- `persistent-map.test.ts` (file deleted).
- `change.test.ts` (likely deleted).
- Tests asserting PersistentMap-specific internals (replaced by Y.Map equivalents).

## Open questions

1. ✅ **Snapshot view caching strategy.** Per-id Map keyed by BlockId, invalidated via `applyOperation`'s carry-forward cache: each op produces a fresh `SnapshotCache` that copies non-dirty entries forward from the input state's cache. Preserves both structural sharing (snapshots of unchanged blocks reference-equal across ops) AND per-State view stability (pre-op cache untouched). See `state/state.ts:applyOperation`.

2. ✅ **`Y.Text` vs `Y.Array<{char, attrs}>` for text items.** Y.Text per Decision C — per-character granularity required for Google Docs-grade collab.

3. ✅ **Y.Text format marks for inline attrs.** Attrs stored as a `Y.Map<string, unknown>` field at the TextItem level (whole-run formatting). Format marks NOT used — deferred. The simpler shape was sufficient for P4e; per-character attrs via format marks can be added later if/when a use case demands it.

4. ✅ **History entry shape with Yjs UndoManager.** `History` is a class wrapping `Y.UndoManager` with parallel `selectionStack` / `redoSelectionStack` arrays. `captureTimeout: 0` + explicit `push()` calls control grouping (1:1 alignment between selection entries and UndoManager stack entries). See `state/history.ts`.

5. ✅ **Task decomposition.** Final sub-phases shipped:
   - **4e.1**: Yjs infrastructure (Tasks 1-5: dep, yjs-doc, snapshot, y-block, pathToBlockId).
   - **4e.2**: Replace State internals + builders + Layer 2 utilities (Tasks 6-11).
   - **4e.3**: Layer 3 ops migration (Tasks 12-23: applyOperation + 11 ops; getYBlock and y-utils extracted as cross-cutting helpers).
   - **4e.4**: History migration (Tasks 24-25: rename legacy + new Y.UndoManager wrapper).
   - **4e.5**: Cleanup + deletions (Tasks 26-31: block/inline-content trim, delete PersistentMap, mark Change deprecated, update barrel).
   - **4e.6**: Integration verification (Tasks 32-34: encoding round-trip, snapshot cache stress, full build).
   - **4e.7**: Perf benchmark (Task 36, optional).

6. ✅ **Phase 1-4 PR commit history.** Continued forward; no rewrites.

## Success criteria

- `yjs` listed in `packages/core/package.json` runtime dependencies.
- `state.ts` exports `State` opaque type backed by Y.Doc.
- `state.blocks.get(id)`, `state.embedContents.get(id)` (post-P6) produce immutable snapshot views.
- All 11 Layer 3 ops produce `OperationResult { state, dirtyIds }` via Yjs transactions.
- `state/persistent-map.ts` deleted.
- `state/change.ts` deleted or thinned to a trivial alias.
- History API (`createHistory`, `pushHistoryEntry`, `undo`, `redo`) wraps Yjs's UndoManager.
- All existing tests still pass (with migrated fixtures).
- New tests cover Yjs-specific concerns (transactions, undo manager, snapshot caching).
- Public API surface (consumer-facing types and op signatures) unchanged where possible; documented diff where changes are unavoidable.

## Review cycle expectations

Pre-execution: extensive. P4e is the largest single phase by code-touch, and its design (Yjs facade layer, snapshot caching, transaction semantics) is intricate. Multiple review rounds expected.

Post-execution: extensive. Verify public API preservation, no behavior regressions, performance acceptable.

## Estimated commits

~30-50 across the sub-phases listed in Open Questions item 5.

## Reference: Yjs documentation

- Yjs docs: https://docs.yjs.dev
- Y.Doc: https://docs.yjs.dev/api/y.doc
- Y.Map: https://docs.yjs.dev/api/shared-types/y.map
- Y.Array: https://docs.yjs.dev/api/shared-types/y.array
- Y.Text: https://docs.yjs.dev/api/shared-types/y.text
- UndoManager: https://docs.yjs.dev/api/undo-manager
- Sync protocol: https://docs.yjs.dev/getting-started/a-collaborative-editor

(Per-phase plan author should re-verify these are current at the time of writing the P4e plan.)

## Plan executed

P4e shipped 2026-05-17. Plan: `docs/superpowers/plans/2026-05-16-p4e-yjs-rebase.md`. 43 commits across the seven sub-phases, from `551f53b` (Task 1: add yjs dep) through current HEAD. All 1254 prior tests pass on Y.Doc-backed state; new P4e tests cover Y.Doc encoding round-trip, snapshot-cache stress (100-block doc with reference-equality assertion), Y.UndoManager wrapper semantics, getYBlock helper, mergeAdjacentSameAttrsTextItems helper, and Strategy A/B Y.Text identity preservation for insertText.

Notable design decisions made during execution:
- Introduced `getYBlock(doc, id, opName, kind?)` helper to standardize inside-transaction reads across all 11 Layer 3 ops (eliminates per-op defensive narrowing duplication; avoids `!` non-null assertions per CLAUDE.md).
- Extracted `y-utils.ts` for shared `yMapAsObject`, `cloneInlineItem`, `mergeAdjacentSameAttrsTextItems` helpers used across multiple ops.
- `applyOperation` carry-forward cache (after Task 17 review feedback) preserves both structural sharing AND per-State view stability — superseded the initial fresh-cache-per-op design that broke the legacy immutability contract.
- `insertText` Strategy B (Y.Text-identity preservation) ships alongside Strategy A fallback with a bail-on-pre-existing-unnormalized-pair scan to preserve the mergeAdjacentTextItems invariant.
- `state/change.ts` deferred to P11.4 cutover (many legacy consumers remain).
