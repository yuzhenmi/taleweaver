# State Module Design Review — 2026-05-23

> Independent design-quality review of `packages/core/src/state/` after the
> state-model redesign + state-cleanup T-A..T-F bundle (shipped 2026-05-22).
> Triggered by the user's report of noticeable performance degradation
> editing a ~192-page mostly-empty document.

## Verdict

The state module is **mostly well-designed**. Layering (Layer 1 types /
Layer 2 utilities / Layer 3 ops) is consistently enforced. Yjs
encapsulation is good. Plan/execute separation in the complex ops is a
real strength. History is tightly reasoned and well-tested.

**However**, the perf complaint has three concrete foundational causes,
all in the state module, none of which are the renderer's fault:

1. `runTransaction` walks `changedParentTypes` un-deduplicated — every
   touched Y type pays `findOwningBlockId(depth)`, so a wide-selection
   format pays O(items × depth). The dirty-tracking pipeline collapses
   to O(unique-dirty-blocks) only AFTER this walk.
2. `applyOperation`'s snapshot-cache carry-forward copies the entire
   cache on every mutation — O(N_cached) per keystroke even when only
   2 blocks are dirty.
3. `undo`/`redo` produce no `dirtyIds`. Every undo on a long document
   forces a full re-render.

Plus several smaller correctness and debt issues. Total: 15 actionable
items, prioritized below.

## Use-case-by-use-case findings

### Transformation
- ✅ Plan/execute separation in `insertText`, `deleteRange`,
  `replaceRange` is clean. Pure planning reads from snapshot; execution
  opens one transaction. Eliminates stale-snapshot bugs by construction.
- ✅ `applyOperation` no-op identity contract is uniformly respected.
- ❌ `setBlockAttrs` has no no-op short-circuit, unlike its sibling
  `mergeBlockAttrs`. Same-value writes dirty the block.
- ❌ `removeBlock` writes parent `firstChildId` + `lastChildId`
  unconditionally even when neither value changed, dirtying the parent.
- ❌ Cross-block `deleteRange` walks the full sibling chain anchor→focus
  in the planning phase. No O(1) primitive possible — but document the
  cost.
- ❌ `splitBlockAtPosition` lacks an optional `newType`/`newAttrs` for
  the split-then-retype atomic-action case (Enter on heading).
- ❌ `clonePastedSubtree` id-collision check runs against SOURCE doc,
  not destination — latent bug for cross-document paste.

### History tracking
- ✅ Selection-stack alignment invariant precisely stated, asserted in
  dev at every entry point, exercised by explicit desync injection
  tests.
- ✅ Error recovery (single try/catch wrap) leaves stacks untouched on
  throw.
- ❌ `History.commit` pre-condition check fires AFTER mutating
  `currentState` / calling `stopCapturing` — partial mutation on throw.
- ❌ `UndoRedoResult` exposes no `dirtyIds` — primary perf cost on
  undo/redo in long docs.
- ❌ `history.ts` defines its own `isDevMode()` instead of importing
  from `dev-mode.ts`.
- ❌ No `maxDepth` cap — long sessions accumulate Y.Doc snapshots
  unboundedly.

### Dirty tracking for rendering
- ✅ Core contract is sound: dirty IDs captured from Y.Doc's
  `afterTransaction` change event at write-time, not via tree
  comparison. Architecturally precise.
- ✅ `findOwningBlockId` is O(depth) via `_item.parentSub`, with a
  Yjs-internal-field smoke test guarding it.
- ❌ `runTransaction` walks `changedParentTypes` without deduping by
  block — explained above, hottest path on wide-selection format ops.
- ❌ `applyOperation` snapshot-cache carry-forward is O(N_cached) per
  mutation — explained above, hottest path on every keystroke once the
  cache is warm.
- ❌ `setBlockAttrs` produces spurious dirty events on same-value writes
  (cross-listed with Transformation).

### Cross-cutting
- ❌ `Selection` alias for `Span` in `block-position.ts` — two names for
  one concept. No external consumers to protect.
- ❌ `maxSteps` computation called fresh inside every traversal step;
  hoist out.
- ❌ `clonePastedSubtree` exported through the Layer-3 mutations barrel
  despite being pure — misleads the layering.
- ❌ `removeBlock` calls `collectSubtreeIds` unconditionally; leaf
  shortcut is one-line.

## Prioritized action items

Each item gets a tracked task (S-A* / S-B* / S-C* / S-D*).

**Bundle S-A — perf-critical (blocks 192-page editing feel)** — **LANDED 2026-05-23**
| # | Task | File | Cost-on-skip | Commit |
|---|------|------|--------------|--------|
| S-A1 | Dedupe `changedParentTypes` walk | yjs-doc.ts | O(items × depth) per wide-format op | 28f2a17 |
| S-A2 | Lazy overlay snapshot cache | state.ts, snapshot.ts | O(N_cached) per keystroke | 6224c95 |
| S-A3 | `dirtyIds` on undo/redo | history.ts, editor/actions/undo.ts, redo.ts | Full re-render on every undo | 2414786 |

**Bundle S-B — correctness gaps**
| # | Task | File |
|---|------|------|
| S-B1 | `setBlockAttrs` no-op short-circuit | set-block-attrs.ts |
| S-B2 | `History.commit` pre-condition ordering | history.ts:148 |
| S-B3 | `removeBlock` conditional parent writes | remove-block.ts:119 |
| S-B4 | `clonePastedSubtree` destination collision check | clone-pasted-subtree.ts:94 |

**Bundle S-C — design debt**
| # | Task | File |
|---|------|------|
| S-C1 | Dedupe `isDevMode` | history.ts:14 |
| S-C2 | Remove `Selection` alias | block-position.ts:38 |
| S-C3 | Hoist `maxSteps` | block-traversal.ts, span-iteration.ts |
| S-C4 | Move `clonePastedSubtree` out of mutations barrel | operations.ts |
| S-C5 | `removeBlock` leaf shortcut | remove-block.ts:77 |
| S-C6 | `History` `maxDepth` cap | history.ts |

**Bundle S-D — documentation / forward-looking**
| # | Task | File |
|---|------|------|
| S-D1 | Document `deleteRange` O(K) cost | delete-range.ts:401 |
| S-D2 | `splitBlockAtPosition` optional newType/newAttrs | split-block.ts:95 |

## Sequencing recommendation

S-A first — these are the foundation perf fixes the 192-page complaint
demands. Once S-A is in, profile again to confirm the keystroke cost is
now dominated by render / layout (not state bookkeeping).

S-B in parallel or directly after — correctness, low coupling to S-A.

S-C and S-D after — low-urgency cleanup.

## How this review fits the project's first principles

- **Foundations before features (P1)**: state is the deepest layer; the
  perf bottleneck is foundational and must be fixed before further
  feature work. Hyperlinks (HL.4–HL.6) and render-incremental polish
  (R-D.4, R-D.5) wait.
- **Fix-now-not-later, scoped to surviving code (P2)**: every file in
  `packages/core/src/state/` is surviving code. All 15 items are
  surviving-code fixes; none are doomed-code skip flags.
- **Review-until-no-more-feedback (P3)**: this doc IS the independent
  review output. Implementation cycles for each bundle will gate on
  their own reviewer dispatch per the standing rule.
- **No issue downplaying (P4)**: 15 findings, all tracked as TaskCreate
  items, none dropped to "observation" / "minor".
- **Document decisions to disk (P5)**: this file.
- **Browser/word-processor engine as reference (P6, P7)**: `History`
  `maxDepth` cap explicitly mirrors Word/Google Docs convention.
