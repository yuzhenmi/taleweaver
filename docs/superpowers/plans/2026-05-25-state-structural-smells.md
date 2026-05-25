# State Module — Structural Smell Remediation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with an
> independent code-reviewer pass (review-until-no-more-feedback) BEFORE commit.
> TDD throughout. Steps use `- [ ]`.

**Goal:** Remove the two structural smells surfaced in the 2026-05-25 state-module
design review, without changing observable behavior (A) and without regressing
paste correctness (B).

**Context (the review's findings):**

- **Smell A — the three-tree dimension (`blocks` / `embedContents` /
  `templateContents`) is triplicated rather than abstracted.** It shows up in
  `SnapshotCache` (3 snapshot maps + 3 invalidation sets, all seeded with the
  same `dirtyIds`), in `captureDirtyIds` / `findOwningBlockId` (3 hand-written
  map checks), and in `getYBlock` (nested ternary on `kind`). Adding a 4th
  top-level tree (comments, eventually) means editing ~8 sites.
- **Smell B — snapshot-cache chain complexity exists largely to compensate for a
  missing bulk-insert primitive.** Paste integrates a cloned subtree per-block,
  chaining thousands of `applyOperation` calls → deep cache chains → the
  `chainDepth`/`compactCache`/depth-64 machinery. A single-transaction
  bulk-insert collapses the paste path to ONE cache layer.

**Load-bearing invariant (makes Smell A safe):** BlockIds are globally unique
across all three trees. The codebase already relies on this everywhere
(`invalidateSnapshot` deletes from all three maps "because the id can live in
at most one"; `resolveBlock` treats cross-tree collision as not-supposed-to-
happen; `id-collision-check.ts` defends allocation). So the per-tree split of
the *cache* buys nothing: one snapshot map + one invalidation set is
behaviorally identical, and `kind` is needed only to pick which Y.Map to read
on a cold miss.

---

## Task A1: Collapse `SnapshotCache` to a single map + single invalidation set

**Files:**
- Modify: `packages/core/src/state/snapshot.ts`
- Modify (TDD): `packages/core/src/state/snapshot.test.ts`
- No change needed: `state.ts` (calls `createSnapshotCache`/`createOverlayCache`/
  `compactCache`/`chainDepth`/`getXSnapshot` — all signatures preserved).

**New shape:**
```ts
export interface SnapshotCache {
  /** Per-layer block snapshots across ALL THREE trees. BlockIds are globally
   *  unique across main/embed/template, so one map suffices; `kind` is only
   *  consulted on a cold Y.Doc read to pick which map to fall through to. */
  readonly snapshots: Map<BlockId, Block>;
  /** Ids whose `base` entry is stale at this layer (re-read from Y.Doc). */
  readonly invalidated: Set<BlockId>;
  readonly base: SnapshotCache | null;
}
```

**Design:**
- `walkChain(cache, id)` drops the `kind` param (walks the single `snapshots` /
  `invalidated`).
- The cold-read Y.Map choice moves into the three accessors via a shared
  `readSnapshot(doc, id, cache, readYMap)` helper; `getBlockSnapshot` /
  `getEmbedContentSnapshot` / `getTemplateContentSnapshot` pass `getBlocksMap` /
  `getEmbedContentsMap` / `getTemplateContentsMap` respectively.
- `createOverlayCache(base, dirtyIds)` → `{ snapshots: new Map(),
  invalidated: new Set(dirtyIds), base }`.
- `compactCache(prev, dirtyIds)` → single collected map + single
  `invalidatedAbove`.
- `invalidateSnapshot(cache, id)` → `snapshots.delete(id); invalidated.add(id)`.
- `invalidateAll(cache)` → clear `snapshots`; seed `invalidated` from base
  chain's `snapshots` keys.
- Delete `LayerKind`, `OWN_MAP_KEY`, `INVALIDATION_KEY` tables (no longer
  needed). Document the global-uniqueness assumption at the interface.

**Steps:**
- [ ] Update `snapshot.test.ts`: replace `.blocks`/`.embedContents`/
  `.templateContents` field reads with `.snapshots`, and any invalidation-set
  field reads with `.invalidated`. Keep ALL behavioral assertions (identity
  reuse, re-snapshot after invalidation, fall-through, promotion across depth-3
  chain, compaction carry / drop). Run → RED (shape mismatch / compile).
- [ ] Rewrite `snapshot.ts` to the new shape. Run targeted tests → GREEN.
- [ ] `npm run build --workspace=packages/core` + full `npm test
  --workspace=packages/core` → all green.
- [ ] Independent code-reviewer on the diff → iterate to approved → commit.

## Task A2: Collapse three-map iteration in `yjs-doc.ts`

**Files:**
- Modify: `packages/core/src/state/yjs-doc.ts`
- Guarded by: `yjs-doc.test.ts`, `perf-find-owning-block.test.ts`

**Design:** introduce one source of truth for the tracked top-level trees:
```ts
type TreeKind = "block" | "embedContent" | "templateContent";
function getTreeMap(doc, kind): Y.Map<Y.Map<unknown>> { ... }   // table, not ternary
function getTreeMaps(doc): readonly Y.Map<Y.Map<unknown>>[] { ... }
```
- `captureDirtyIds` loops `getTreeMaps(doc)` for the `tx.changed.get(map)` event
  scan (instead of 3 hand-written blocks).
- `findOwningBlockId` / `findOwningBlockIdMemoized` test `parent` membership
  against the tree-map set (instead of `=== a || === b || === c`).
- `getYBlock` selects via `getTreeMap(doc, kind)` (drops the nested ternary).
- Adding a 4th tree becomes a one-line edit to the table.

**Steps:** TDD (existing tests already cover dirty capture + owning-block walk);
add a test asserting a 4th-tree-style addition is table-driven if cheap. Build +
full test → reviewer → commit.

## Task B: Atomic bulk-insert primitive + paste migration (closes #268)

**Files:**
- Create: `packages/core/src/state/insert-subtree.ts` (+ test)
- Modify: `packages/core/src/state/operations.ts` (barrel export)
- Modify: paste action handler (`packages/core/src/editor/actions/paste.ts` or
  equiv) to use the bulk op.
- Behavior-level regression: paste through the real editor + controller.

**Design:** `clonePastedSubtree` already produces a `ClonedSubtree` (fresh ids,
rewired refs) as plain JS. Add a Layer-3 op that integrates the whole subtree —
all blocks into `blocks`, embed-content refs into `embedContents`, and the
child-list relink into the destination parent — inside ONE `applyOperation`
transaction. Migrate paste to call it. Result: the paste path produces ONE cache
layer instead of N, so the `chainDepth`/`compactCache` machinery stops being
load-bearing for paste (keep it as a backstop; do NOT remove without a
measurement showing it's dead).

**Steps:** TDD the op (single transaction; dirtyIds = all inserted ids; parent
relink correct; embed refs land in embedContents). Then migrate paste + add a
behavior-level paste regression. Build + full test + browser smoke → reviewer →
commit.

---

## Status

- [x] T1 (C.2b-1) committed `b9b587b` — clean base for this work.
- [ ] A1 — in progress.
- [ ] A2.
- [ ] B.
