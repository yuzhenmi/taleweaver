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

## Task B: Atomic bulk sibling-block insert primitive + paste migration

**Grounding (corrected after reading the code):** `handlePaste`
(`editor/actions/paste.ts`) does PLAIN-TEXT paste — for k lines it chains
`splitBlockAtPosition` + `insertText` PER LINE (≈2k `applyOperation` calls).
THAT is the deep-chain source the "bulk PASTE of 200 lines" integration test
exercises. (`clonePastedSubtree` exists but is currently unwired — rich paste
is a later concern; its atomic-insert variant is a follow-up, not this task.)

### Task B.1 — `insertBlocksAfter` Layer-3 primitive

**Files:**
- Create: `packages/core/src/state/insert-blocks-after.ts`
- Test: `packages/core/src/state/insert-blocks-after.test.ts`
- Modify: `packages/core/src/state/operations.ts` (barrel export)

**Signature:**
```ts
export interface SiblingBlockInit {
  type: string;
  attrs?: ReadonlyAttrs;
  inlineContent?: InlineContent | null;  // leaf blocks only in v1
}
export function insertBlocksAfter(
  state: State,
  afterBlockId: BlockId,
  inits: readonly SiblingBlockInit[],
  allocator: IdAllocator,
): OperationResult & { readonly newBlockIds: readonly BlockId[] };
```

**Semantics (ONE Y.Doc transaction):** insert `inits` as a contiguous run of
new sibling blocks immediately after `afterBlockId`, preserving order. The run
head's `prevSiblingId = afterBlockId`; the run tail's `nextSiblingId =`
afterBlock's OLD `nextSiblingId`; `afterBlock.nextSiblingId =` run head; the
old next sibling's `prevSiblingId =` run tail (OR, if afterBlock was the
parent's last child, `parent.lastChildId =` run tail). Each new block:
`parentId =` afterBlock's parent, leaf (`firstChildId/lastChildId = null`).
Empty `inits` → no-op (same `State` ref), `newBlockIds = []`.

**Guards/throws:** `afterBlockId` not found; afterBlock has null parent (can't
add siblings to the root). Dev id-collision check on each allocated id
(`assertNoIdCollision` against the same doc, like `insertBlock`).

**dirtyIds:** all new ids + `afterBlockId` + (old next sibling id, or parent id
when appending at the end — matching `insertBlock`'s boundary-only parent-dirty
rule).

**TDD steps:** RED tests first — (a) insert 1 after a middle child relinks
prev/next; (b) insert 3 after the LAST child updates `parent.lastChildId` to the
run tail; (c) insert after a middle child updates the old-next's `prevSiblingId`,
parent NOT dirtied; (d) order preserved + inter-run prev/next chain correct;
(e) empty inits → same-State no-op; (f) throws on missing afterBlock / null
parent; (g) dirtyIds set exact. Build + full suite → reviewer → commit.

### Task B.2 — migrate `handlePaste` multi-line loop

**Files:** Modify `packages/core/src/editor/actions/paste.ts`. Behavior-level
regression in the editor paste test (real editor + controller); browser smoke.

**New flow (constant # of ops, independent of line count k):**
1. (expanded selection) `deleteRange` — unchanged.
2. `insertText(line0 at pos)` — unchanged for the first line.
3. If `k > 1`: `splitBlockAtPosition` at (pos.block, pos.offset + line0.length)
   → original keeps `prefix⊕line0`, new block `N_last` holds the suffix.
4. Prepend `line(k-1)` to `N_last` via `insertText(N_last, 0, line(k-1))`.
5. If `k > 2`: ONE `insertBlocksAfter(original, [para(line1), …, para(line_{k-2})], …)`
   inserting the middle lines as paragraphs between `original` and `N_last`.
   (Replaces the old O(k) split+insert loop.)
6. Cursor: end of `line(k-1)` text in `N_last` (offset = line(k-1).length).

Accumulate dirtyIds across the (now constant-count) ops; preserve the existing
`state === editor.state` no-op short-circuit and `history.commit` +
`rebuildTrees` tail. The "bulk PASTE of 200 lines completes in linear time"
integration test must still pass (and now with a SHALLOW cache chain).

**Steps:** TDD the paste behavior (single line; two lines; k lines with
non-empty suffix after cursor; paste into middle of a block; empty lines in the
middle). Build + full suite + browser smoke (`npm run dev --workspace=examples/react`,
paste a multi-line clipboard) → reviewer → commit.

**Note:** keep the `chainDepth`/`compactCache` machinery as a backstop; do NOT
remove it without a measurement showing it's dead for all bulk paths.

---

## Status — COMPLETE

- [x] T1 (C.2b-1) committed `b9b587b` — clean base for this work.
- [x] A1 — SnapshotCache → per-tree maps + ONE invalidation set. `75f424e`.
      (The first attempt collapsed snapshots to a single id-keyed map; the full
      suite caught the accessor-discrimination break via build-state-from-blocks,
      so per-tree maps are retained and only the invalidation sets collapsed.)
- [x] A2 — yjs-doc dirty-tracking routed through one `TREE_MAP_GETTERS` table
      (captureDirtyIds / findOwningBlockId / getYBlock). `112e0a8`. Subsumes #270.
- [x] B.1 — `insertBlocksAfter` bulk sibling-block insert primitive. `92c48c7`.
- [x] B.2 — `handlePaste` migrated onto it; constant op count; added the
      previously-absent paste characterization suite. `ab73e9b`.

Each cycle gated on an independent code-reviewer pass (review-until-clean) before
commit; all reviewer findings applied (none downplayed). Full suite 1531 pass / 4
skip at close.

**Deliberately NOT done (deferred, with rationale):**
- The `chainDepth`/`compactCache` machinery is KEPT as a backstop. Paste no longer
  builds a deep chain, but the machinery still guards other bulk paths (undo/redo
  of bulk ops, a future rich-paste via `clonePastedSubtree`). Removing it needs a
  measurement showing it's dead for ALL bulk paths — that's a separate follow-up,
  not part of fixing the smell.
- Rich-paste (`clonePastedSubtree`, currently unwired) gets its own atomic-insert
  variant when rich paste is wired; out of scope here.
