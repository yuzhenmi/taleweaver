# State Module Cleanup Plan

> **Status doc.** Lives at `docs/superpowers/plans/2026-05-22-state-module-cleanup-plan.md`. Update as work proceeds.

## Goal

The Taleweaver state module is the document model — single source of truth for content, structure, and selection — and it must be **cleanly and elegantly designed** to handle transformation, history tracking, and dirty-tracking-for-rendering at a Google-Docs-quality bar. The 2026-05-02 block-tree-of-ropes redesign is substantially implemented; this plan closes the remaining gaps surfaced by the 2026-05-22 design review so that the module is in a state where:

- Yjs is fully encapsulated behind the state module's public API (no Y.* leaks into render / cursor / editor).
- The open-attribute-schema design is consistently wired (run-merging consults the interpreter registry).
- Component-type taxonomy is owned by the component registry, not duplicated in the state layer.
- Internal duplication and instrumentation gaps are closed.
- Architecture documentation matches reality.

## Source of findings

`docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md` is the design spec (target).
The 2026-05-22 review (controller-dispatched `feature-dev:code-reviewer` agent, full report logged below) produced the findings this plan acts on.

## Review findings (verbatim, prioritized)

### Headline verdicts
- **Transformation:** clean and elegant — plan/execute split, atomicity-by-transaction, composable ops.
- **History:** elegant — Y.UndoManager wrapper + manual `stopCapturing()` + selection-stack alignment + T33 error-recovery.
- **Dirty tracking:** clean — write-time `dirtyIds` via transaction listener, no-op identity contract documented.

### Surviving-code action items (ranked by reviewer's ROI estimate)

1. **Privatize `State.doc`** (Confidence 92). `state.doc: Y.Doc` is a public field. `render.ts` already imports `getEmbedContentsMap` from `state/yjs-doc` and calls it against `state.doc`, breaking the encapsulation the spec promised. Single biggest architectural breach. Fix: make `doc` private/symbol-keyed, give render a narrow `getAllEmbedContentIds()` (or equivalent) accessor on `state.ts`. Audit ~24 references to `state.doc` outside `state/` — most are inside `state/`; the cross-module ones are `render.ts` and `test-utils/state-builders.ts`.

2. **Rewrite `docs/architecture/1-core/1.1-state.md`.** Completely stale: still describes the path-based StateNode tree, `findDirtyPaths`, `formatting.ts`, etc. — none exist. Zero code change required. Per CLAUDE.md's living-documents rule, this should have shipped with the redesign. Highest-leverage documentation fix.

3. **Wire `AttrRegistry` into `attrsEqual` + run-merge normalizers** (Confidence 88). `attrsEqual` in `attrs.ts` does deep value equality only; the spec committed to per-key interpreter `equals`. Called by `mergeAdjacentTextItems` / `mergeAdjacentSameAttrsTextItems` — so any plugin registering a non-trivial `equals` (e.g., comment ranges with shared id) will see fragmented inlineContent. Correctness gap waiting for first plugin. Fix: thread an optional `AttrRegistry` parameter through, update 4–5 call sites.

4. **`blockKindOf` hardcodes type strings** (Confidence 80). `INLINE_BEARING_LEAF_TYPES = new Set(["paragraph", "heading", "list-item"])` etc. in `block-kinds.ts`. State layer shouldn't know component-type names — delegate to the component registry / a kind-registry populated at component-registration time.

5. **`replaceRange` duplicates `planDeleteRange`'s pre-normalize guards verbatim** (Confidence 82). Comments explain why (preserving error-message contracts before normalize) but the coupling is fragile. Extract a shared `assertDeleteRangeEndpoints(state, span)` helper.

6. **`iterateSpan` / `iterateBlocksInSpan` lack outer cycle/step guard** (Confidence 85). Delegate to internally-guarded `nextBlockInDocOrder`, so a corrupt-state failure surfaces a generic "cycle detected in block traversal" error with no span context. Instrumentation gap, not correctness.

### Cross-cutting design observations (from review)
- Dual normalization paths (JS-side + Y-side) are protected by the T19 property-based drift test — a smart insurance policy worth keeping.
- Plan-then-execute is the dominant pattern; `mergeBlockAttrs` is the one inconsistent op (does its check inside the closure). Minor.
- `deleteRange` refusing cross-parent spans is correct architecturally, but action handlers will duplicate decomposition logic; a forward stub `deleteRangeCrossParent` would signal where this belongs when needed.
- The only cross-module Yjs leak is `render.ts` → `getEmbedContentsMap`. Cursor / editor / layout / cascade / components are clean. Closing item 1 closes the entire encapsulation story.

### Doomed/legacy code in `state/`
**None.** The entire module is the new design — no legacy survives. So the "scope to surviving code" filter (per `feedback_fix_scope_to_survival.md`) did not eliminate any item; everything above is in surviving code.

## Decision: work sequence

Selected per first principles:
- **Fix-now-not-later** (issues compound as scope grows) applies to every item.
- **Document-before-act** says we start with the architecture-doc rewrite — it codifies what the module IS, which is the prerequisite for all subsequent work touching it.
- **Highest-ROI-first** otherwise dictates: encapsulation breach (item 1) before attribute-registry gap (item 3) before taxonomy leak (item 4) before duplication (item 5) before instrumentation (item 6).

Ordering:

1. **T-A: Architecture-doc rewrite** — rewrite `docs/architecture/1-core/1.1-state.md` to match the actual Y.Doc-backed block-tree model. Zero code change. Cross-link to the spec. Includes top-down coherence pass per CLAUDE.md.
2. **T-B: Privatize `State.doc`** — symbol-keyed or accessor-gated. Give render module the narrow accessor it needs (`getAllEmbedContentIds` or `iterateEmbedContents`). Update `render.ts` and any test-utils to use it. TDD as usual.
3. **T-C: Wire `AttrRegistry` into `attrsEqual` + run-merge normalizers** — extend `attrsEqual` signature, thread registry through the two normalizers, update call sites. TDD with a new test that registers a custom `equals` and verifies run-merging respects it.
4. **T-D: Delegate `blockKindOf` to component registry** — design the kind-registration mechanism (most likely a property on the component definition), populate at registration, update `setBlockType` to consult the registry. TDD.
5. **T-E: Extract shared `assertDeleteRangeEndpoints`** — pure refactor from `delete-range.ts` and `replace-range.ts`. Existing tests cover behavior.
6. **T-F: Add outer cycle/step guard to `iterateSpan` / `iterateBlocksInSpan`** — instrument with contextual error message. Tiny.

Each task ends with the standing review-until-clean discipline (per `feedback_review_until_clean_default.md`): implementer → spec reviewer → code-quality reviewer → only then commit.

## Status tracker

| Task | Status | Commit(s) | Notes |
|------|--------|-----------|-------|
| T-A: Architecture doc rewrite | ✅ done | `bafbef3` | 1.1-state.md rewrite + 1-core/overview.md + overview.md coherence pass; added `WritingMode` to root barrel (was missing). Three reviewer passes, all clean. |
| T-B: Privatize State.doc | ✅ done | (this commit) | STATE_INTERNAL symbol introduced; render.ts uses new `getEmbedContentIds` accessor; test-utils delegates to new state-module-internal `buildStateFromBlocks`; encapsulation breach closed and asserted by compile-time test. |
| T-C: AttrRegistry into attrsEqual + merges | ✅ done | `acb9dd7` | Optional registry on attrsEqual + both mergers + 5 Layer 3 ops; merge-block-attrs intentionally not threaded (idempotency guard, not run-merge). +11 tests. Two reviewer passes, all clean. |
| T-D: blockKindOf → component registry | ✅ done | (this commit) | Added `leafShape` field on LeafComponentDefinition; ComponentRegistry extends new `BlockKindResolver` interface; state's hardcoded type-string Sets deleted; setBlockType + insert-node + toggle-list now thread the resolver. +8 tests. Two reviewer passes; second-pass action item was state test importing component registry — closed by hand-rolled resolver literal. |
| T-E: Extract shared delete-range guard | not started | — | Pure refactor |
| T-F: iterateSpan cycle guard | not started | — | Instrumentation only |

## References

- Design spec: `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`
- Stale arch doc (T-A target): `docs/architecture/1-core/1.1-state.md`
- Branch: `feature/dom-architecture-redesign`
- Reviewer agent (still alive): `a71145c3e92de7784` (use SendMessage if needed)
- Related memory files:
  - `feedback_fix_scope_to_survival.md`
  - `feedback_document_decisions_and_plans.md`
  - `feedback_review_until_clean_default.md`
  - `feedback_browser_as_reference.md`
  - `feedback_top_word_processors_as_reference.md`
  - `project_state_model_redesign.md`
