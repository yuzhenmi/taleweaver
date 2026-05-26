# State module S-F cleanup pass — Plan

> **For agentic workers:** subagent-driven-development; fresh implementer per cycle (NO commit
> in implementer instructions); independent code-reviewer gate before the controller commits; TDD
> with behavior/geometry-level tests through the real pipeline where applicable. Serialize implementer
> dispatch (shared checkout — git-race hazard). `cwd: /Users/hansyu/code/taleweaver` on every dispatch.

**Goal:** remediate the findings from the 2026-05-26 four-axis design review of `packages/core/src/state/`
(transformation A−, history B+, dirty-tracking A−, structure A−). The module is already a strong
foundation; these are polish + one perf term + one structural fragility. Foundations-before-features:
done before returning to C.2c (#315) headers/footers T4.

**Scope (6 items):** #267, #317, #318, #319, #320, #321. Findings were vetted against the code by the
controller (not taken on faith): the history "Critical" was confirmed a benign-in-production *Important*
fragility (redo gates on the real Yjs `canRedo()`; stale parallel-stack entry is shadowed at the bottom,
cleared by next commit); the dirty-tracking root-scan was confirmed real (state.ts:179-208 iterate all
map keys per render).

---

## Execution order (minimizes churn/conflicts; serialized)

Edits to state internals (state.ts, snapshot.ts, history.ts) land BEFORE the barrel migration so the
barrel re-exports the final surface; the doc re-sync lands LAST so it reflects everything.

1. **Cycle A — #267 + #319 (cheap, independent).**
2. **Cycle B — #317 (embed/template root-id cache).**
3. **Cycle C — #318 (history tracks Yjs via events).**
4. **Cycle D — #321 (state/index.ts barrel + sibling-import migration).**
5. **Cycle E — #320 (re-sync 1.1-state.md), incl. top-to-bottom coherence pass.**
6. **Phase review — whole-diff reviewer over the cumulative S-F change before declaring the pass done.**

---

## Cycle A — #267 setBlockType no-op + #319 dead exports

**Files:** `packages/core/src/state/set-block-type.ts`, `set-block-type.test.ts`;
`packages/core/src/state/snapshot.ts`, `snapshot.test.ts`.

- **#267:** `setBlockType` (set-block-type.ts:~62) must short-circuit when `type === block.type`,
  returning the literal input state (no spurious `yBlock.set("type", …)` → no dirtyIds → no re-render).
  ⚠ **Ordering (plan-review):** the short-circuit goes AFTER the existing existence (null-block) +
  resolver-registration guards — so a same-type call on an unregistered/invalid type still throws, and
  the cross-kind refusal is unaffected (mirror `set-block-attrs.ts:37-43`'s position, which is after its
  guards). TDD: same-type registered call → `result.state === input.state` and `dirtyIds.size === 0`;
  cross-type call unaffected; cross-kind refusal unaffected; same-type-but-unregistered still throws.
- **#319:** `invalidateAll`/`invalidateSnapshot` (snapshot.ts:184-208) have zero production callers (only
  snapshot.test.ts; grep-confirm before deleting). DELETE both helpers. ⚠ **Test retarget (plan-review):**
  `snapshot.test.ts:~84` ("fresh snapshot after invalidation") exercises a LIVE production mechanic
  (re-snapshot after invalidation, which production drives via `createOverlayCache(base, dirtyIds)`) —
  RETARGET it to drive invalidation through the production overlay-with-dirtyIds path, do NOT just delete
  it (else coverage of a live behavior is silently lost). Tests that only exercise the dead helpers' own
  surface can be deleted.

## Cycle B — #317 embed/template root-id cache

**Files:** `packages/core/src/state/state.ts` (the two ID accessors) + the cache holder (see below);
likely `yjs-doc.ts` (attach the observer on doc creation, next to the map getters). Tests in
`state.test.ts` (+ a recompute-counter perf-shape assertion).

**The accessors must stop scanning every map key per render.** Cache the set of ROOT ids
(`parentId === null`) for the embedContents + templateContents maps.

⚠ **Invalidation trigger — CRITICAL correction (plan-review).** Do NOT key invalidation on "a named
add/remove op." Verified: there is NO named runtime op that adds an embed/template root today, the
removes are raw `yEmbeds.delete(id)` inside `applyOperation` transactions (`remove-block.ts:93-96`,
`delete-range.ts:152-155,193-196`), and undo/redo re-add/re-delete roots via pure Yjs surgery inside
`undoManager.undo()/.redo()` that bypasses ALL op code. A trigger hooked on ops would silently stale the
cache (e.g. undoing a footnote-delete resurrects the root in the map but not in the cache). Instead:

- **Invalidate on the embedContents/templateContents map KEY-SET change**, via a per-`Y.Doc`
  `Y.Map.observe` (flat `observe`, NOT `observeDeep`) on each of the two maps, reacting to
  `event.keysChanged`. A `YMapEvent` fires on every key add/delete INCLUDING those inside UndoManager
  transactions and cascade-deletes — so the set stays correct across cascade-delete and undo/redo.
- **The cache rides the shared `Y.Doc`, NOT `State`** (the doc is shared across all State versions via
  structural sharing). This needs NO `State`-shape change — so the coordination-STOP trigger does not
  apply here. ⚠ There is currently NO observer anywhere in `state/` (grep: zero `.observe`); this
  introduces a new, minimal lifecycle concern — attach once at doc creation; keep the handler cheap (only
  react to changed keys; for an ADDED key read that one block's `parentId` to decide root membership — a
  body child added to the map is NOT a root; do not rescan or cache "all keys").
- **Justification the observer is sufficient (keep this reasoning):** an embed/template block's
  root-status changes ONLY via a map add/remove, never an in-place `parentId` flip — confirmed: no code
  writes `parentId` into an embed/template block (`reparentChildren` validates via `getBlock`, which reads
  only the MAIN map, so it provably cannot touch embed/template parentId; zero non-test
  `getYBlock(…, "embedContent"|"templateContent")` hits). So watching the key-set (not parentId writes)
  is complete.
- **TDD:** multi-level body → accessor returns only roots (lock #313); adding/removing a root updates the
  set; **recompute-counter (named perf-shape test):** N keystrokes that touch only main-tree blocks →
  **0** root-set recomputes; one root add or remove → exactly **1**; an UNDO that re-adds a root →
  the set reflects it (covers the Yjs-surgery path). Don't hand-wave "structural reasoning" — assert the
  counter. YAGNI: no 4th-tree abstraction; the snapshot cache's `TREE_KINDS` pattern is there if ever
  needed later.

## Cycle C — #318 history tracks Yjs stacks via events

**Files:** `packages/core/src/state/history.ts`, `history.test.ts`.

Eliminate the parallel-array fragility: weld the selection to the Yjs stack item so it travels with the
item across undo↔redo and can never index-desync. Confirmed feasible against installed Yjs `~13.6.18`:
`StackItem.meta: Map<any,any>` exists (docstring: "save and restore metadata like selection range");
events `'stack-item-added'`/`'stack-item-popped'`/`'stack-item-updated'`/`'stack-cleared'` all exist.

- **Required mechanism — `.meta`, write-at-commit / read-at-pop (plan-review):**
  - At `commit` (after `stopCapturing()` closes the group), write the `SelectionEntry` onto the
    just-closed item: `undoManager.undoStack[undoManager.undoStack.length-1].meta.set(SEL_KEY, entry)`.
    ⚠ Do NOT use a `'stack-item-added'` handler — under `captureTimeout: MAX_SAFE_INTEGER` a multi-`transact`
    action MERGES into one item firing `'stack-item-updated'` (not a 2nd `-added`), and `-added` fires
    during `doc.transact` BEFORE `commit` has the before/after pair. Write-at-commit sidesteps both.
  - At `undo`/`redo`, read the `SelectionEntry` from the POPPED item's `.meta` (via the
    `'stack-item-popped'` event's `stackItem`, or `undoManager.currStackItem` per the Yjs API). The
    `.meta` read happens AFTER the `captureDirtyIds(doc, () => undoManager.undo())` closure returns —
    orthogonal to the dirtyId channel; no ordering hazard.
- **`'stack-cleared'` is SUPPLEMENTARY, not a replacement (plan-review).** It only zeroes the redo stack
  on a new commit; it does NOT cover the maxDepth front-trim (a partial splice). With selection on
  `.meta`, the redo-clear is already handled (cleared items carry their own meta away), so `'stack-cleared'`
  may not even be needed — decide during impl; do not rely on it as the desync fix.
- **maxDepth front-trim (#234) — KEEP, simplified.** Still required: `undoManager.undoStack.splice(0, excess)`.
  With selection on `.meta`, the parallel `undoSelectionStack.splice` DISAPPEARS (meta rides the item).
- **Moot alignment assertions — replace, don't orphan (plan-review).** Once selection lives on `.meta`
  there is no second stack to misalign, so the `undoSelectionStack.length === undoStack.length`
  assertions (history.ts:188-219, 246-256, 296-306) become moot. EXPECTED edit: replace them with a
  lighter dev check (e.g. "popped item has a SelectionEntry in `.meta`"); do not leave dead assertions
  referencing a deleted array.
- **Preserve:** error-recovery ordering (T33 — and note it's strictly safer now: no parallel-stack
  mutation step to order), dirtyIds surfacing (S-A3), meta-map non-undoability, captureTimeout grouping,
  the no-op commit guard.
- **TDD (the regressions that were missing):** (1) mutate-then-throw-BEFORE-commit (simulate paste.ts's
  invariant-throw path) followed by undo/redo must NOT desync, must NOT return a wrong selection, must NOT
  spuriously throw a dev assertion for that benign state; (2) maxDepth front-trim under the new model —
  commit past the cap, undo to the trim boundary returns the correct selection / no desync; (3) all
  existing commit/undo/redo/grouping/error-recovery/meta-map tests stay green.
- Most delicate item — implementer reads the full history.ts contract docstrings first. The public
  `UndoRedoResult`/`SelectionEntry` shapes should NOT change (selection storage moves internally to
  `.meta`); if the impl finds it must change either, STOP and surface to the controller.

## Cycle D — #321 state/index.ts barrel + sibling migration (SPLIT D1 → D2)

⚠ **Split into two cycles (plan-review):** ~42 intra-core files deep-import state subfiles (21 in
`editor/actions`, 7 layout, 7 cursor, 2 render, 2 editor, 1 components, 1 cascade, + the cross-package
`index.ts`). Create-and-validate the barrel BEFORE 42 files churn against it, so each reviewer diff stays
legible and a paused D2 still leaves a usable barrel. `state/index.ts` does NOT exist (no Create-collision).

**D1 — create the barrel.** New `packages/core/src/state/index.ts`, grouped + commented by layer
(L1 types/access, L2 utils, L3 ops). Do NOT re-export `STATE_INTERNAL`, `y-block`, `y-utils`, `yjs-doc`,
`snapshot`, `state-internal` (infra stays private). Keep `clonePastedSubtree` (#232) and
`reparentChildrenInTx`/`BlockFieldWrite`/`ReparentPlan` OUT of the consumer-facing op surface (a
clearly-marked internal seam, or omit). The barrel must compile and a thin test must confirm it surfaces
the accessors the doc names. ⚠ The cross-package `packages/core/src/index.ts` re-export list must stay
**byte-stable** (downstream packages + `encapsulation.test.ts` depend on it) — D1 does NOT touch it yet.

**D2 — migrate consumers.** Rewrite the ~42 intra-core deep-importers to import from the barrel.
MECHANICAL (import-path changes only, NO logic changes). Migrate the cross-package `index.ts`'s state
deep-imports too, keeping its external named-export list byte-identical. If a sibling needs an accessor
not yet in the barrel, add it to D1's barrel deliberately (don't widen the surface accidentally). Full
build + core + dom + `examples/react` + `encapsulation.test.ts` green.

## Cycle E — #320 doc re-sync

**Files:** `docs/architecture/1-core/1.1-state.md` (+ coherence check on `overview.md`, `1.2-render.md`).

- Update to the THREE-tree model (main + embedContents + templateContents); add `getTemplateContent`,
  `getTemplateContentIds`, `getBlockFromEither`, `resolveBlock`/`ResolvedBlock`/`ResolvedBlockKind` to
  Layer-1 access; add `insertBlocksAfter`, `reparentChildren`, `applySectionBreak`,
  `mergeSectionWithPrevious` to the Layer-3 index; document the new `state/index.ts` barrel as the
  intra-core contract and clarify the two surfaces (cross-package index.ts vs intra-core barrel); reflect
  the #317 root-id cache in the perf-contract section. Doc-only; run the top-to-bottom coherence pass per
  CLAUDE.md. (Reviewer for a doc-only change may be lighter, but still gate per the absolute rule.)

---

## Verify (every cycle)
`npm run build --workspace=packages/core` clean; FULL core + dom green; `examples/react` builds.
Independent code-reviewer gate, then controller commits. Final phase-level reviewer over the cumulative
S-F diff before resuming C.2c.

## Status
- [ ] Cycle A (#267 + #319)
- [ ] Cycle B (#317)
- [ ] Cycle C (#318)
- [ ] Cycle D1 (#321 — create barrel)
- [ ] Cycle D2 (#321 — migrate ~42 consumers)
- [ ] Cycle E (#320)
- [ ] Phase review

## Plan-review resolutions (2026-05-26, APPROVED WITH CHANGES)
- **B (Critical):** invalidation keyed on the embed/template map KEY-SET change via a per-`Y.Doc`
  `Y.Map.observe` (covers raw cascade-`delete` + undo/redo Yjs surgery; ops have no chokepoint to hook).
  Cache rides the shared `Y.Doc`, not `State` (no State-shape change). "parentId never flips in-place" is
  the justification the observer is sufficient. Recompute-counter is the named perf test.
- **C:** `.meta` write-at-commit / read-at-pop is the REQUIRED mechanism (Yjs 13.6.18 has `StackItem.meta`
  + the events). `'stack-cleared'` is supplementary, can't replace the maxDepth front-trim (kept). The
  parallel-array alignment assertions become moot → replace with a lighter `.meta`-present dev check.
  New tests: throw-before-commit + maxDepth-trim-under-new-model.
- **D:** split D1 (barrel) / D2 (migrate ~42 importers). `state/index.ts` absent (no collision);
  cross-package `index.ts` external surface byte-stable.
- **A:** `setBlockType` short-circuit AFTER existence+registration guards; RETARGET `snapshot.test.ts:~84`
  to the production overlay path (don't just delete).
