# Phase 5+ Sequencing Strategy

**Status:** strategy-and-decisions doc (not an implementation plan). This document decides the order and grain of post-Phase-4 work, encodes lessons from Phase 4 execution, and identifies decisions that need to be settled before any per-phase implementation plan is drafted. After this doc converges, each numbered phase below gets its own per-phase plan written and reviewed in the established cycle.

## Where we are (2026-05-08)

The state-module redesign Phases 1-4 are complete:

- **Phase 1** Layer 1 types: `block.ts`, `state.ts`, `inline-content.ts`, `block-position.ts`, `block-id.ts`, `attrs.ts`, `persistent-map.ts`.
- **Phase 2** Layer 2 utilities: `block-traversal.ts`, `block-compare.ts`, `span-iteration.ts`, plus `findItemAtOffset`, `inlineContentLength`, `splitInlineContentAtOffset`, `mergeAdjacentTextItems`.
- **Phase 3** Cascade attribute-interpreter pipeline: `cascade/attr-registry.ts` plus built-in interpreters.
- **Phase 4** Layer 3 state-mutating operations: `setBlockAttrs`, `setBlockType`, `insertBlock`, `removeBlock`, `insertText`, `applyAttrsToRange`, `splitBlockAtPosition`, `mergeAdjacentBlocks`, `deleteRange`, `replaceRange`, `clonePastedSubtree`. Plus shared helper `updateBlock`.

**Test count:** 1213 passing + 4 skipped. Build green throughout. The state module is purely additive on top of the existing legacy code (`state-node.ts`, `position.ts`, `transformations.ts`, `formatting.ts`, etc.) which still compiles and is still used by the editor/render/cursor/layout/styles modules.

## What's left

The state-redesign master spec (`docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`, "Migration strategy" section) lists steps 8-16 for the rest of the migration. This document maps those steps to Phase 5+ phase numbers, refines their grain, and adds decisions and risk-mitigation patterns informed by Phase 4 execution.

## Strategic decisions to settle before Phase 5 starts

### Decision 1: Migration shape — "allowed broken intermediates" vs "expand-contract"

The master spec chose "allowed broken intermediates" — accept that intermediate commits fail to build, with a final greening pass at the end. Phase 4 worked beautifully with all-green-throughout because Phase 4 was purely additive (new state files alongside untouched legacy files; no consumers cut over). Phase 5+ is different: it's where consumers (render, components, editor, cursor) cut over from `StateNode` to `Block`, which **will** break things.

**Two paths:**

- **Path A (spec default — allowed broken intermediates).** Each phase deletes legacy code in the same commit it introduces the replacement. Build is broken from Phase 5 commit-1 until the final greening pass. Pros: smaller diff, no parallel implementations. Cons: review discipline degrades when build is red (reviewer can't trust "tests pass" signal); accepting a broken main-of-feature-branch for weeks is risky if other work needs to land.

- **Path B (expand-contract, slightly more work).** For each consumer module, build a parallel new implementation that consumes the new state. Cut over consumers one at a time. Delete the old implementation only after every consumer has migrated. Pros: build stays green throughout; review discipline preserved; smaller per-commit blast radius. Cons: short-term parallel implementations bloat the codebase; bookkeeping during cutover.

**Recommendation:** **Path B** with one strategic exception. The Phase 4 experience showed how much value the "build green throughout" invariant provides — every reviewer trusted `npm run build` and `npm test` results, and 4 architectural fixes were caught precisely because reviewers could verify behavior under green builds. Losing that for Phase 5+ means losing the review-discipline gradient that's been catching real bugs.

The exception: the **final cleanup commit** (Phase 16 below) IS allowed to be a single drop of legacy files. By that point everything has cut over and the legacy files are unreferenced; deleting them is purely scoring out dead code.

If the user prefers Path A (sticking with the spec), the per-phase plans will need explicit "intermediate-state expectations" sections (what's broken, what's not) and the post-phase greening criteria will only apply to the final phase.

**This decision impacts every per-phase plan below.** The phase grain in the proposal below assumes Path B.

### Decision 2: Enable `noUnusedLocals` in tsconfig (small infra fix)

Phase 4 caught **two** unused-import bugs that `npm run build` missed because `tsconfig.json` lacks `noUnusedLocals: true`. The IDE caught both post-commit; one required a fix-up commit. Enabling the flag is a one-line tsconfig change that prevents the entire class of bug — and Phase 5+ will produce many more import edits than Phase 4 (consumer cutovers heavily refactor imports).

**Recommendation:** **Enable `noUnusedLocals` (and `noUnusedParameters` if it's clean) before Phase 5 starts.** A trivial first phase. Any pre-existing unused imports surface, get cleaned in the same commit, and the rest of Phase 5+ benefits.

Risk: the legacy code (`state-node.ts`, `transformations.ts`, etc.) might have unused imports/locals that surface when the flag is enabled. TypeScript does NOT support enabling `noUnusedLocals` for a subdirectory within a single compilation unit — the flag applies to the entire `packages/core` workspace at once. If too many legacy violations surface, the realistic options are: (a) clean them up in the same P5 commit (most likely small — these files have been well-maintained), (b) suppress at the offending location with `// @ts-expect-error: <one-line reason>` per location (NOT `// @ts-ignore`, NOT `// eslint-disable` — the latter does not suppress the TypeScript-compiler error TS6133), or (c) split `packages/core` into separate TypeScript project references — a significant infra change and probably overkill. Default expectation: option (a).

### Decision 3: `state.embedContents` map — introduce now or defer?

Embed-content blocks (footnote bodies referenced via `EmbedItem.properties.contentBlockId`) currently live in `state.blocks` with `parentId: null`. This is a known invariant violation ("only the root has null parentId"), tracked as a TODO in `remove-block.ts`. Phase 5+ will exercise this code path heavily:
- Render needs to render footnote bodies (in some special document-zone layer).
- Editor's footnote-anchor lifecycle (create, delete, copy/paste cascade).
- `removeBlock` needs the full cascade-delete logic that's currently TODO'd.

**Two paths:**

- **Path A — defer.** Continue with the current arrangement (footnote bodies as null-parented blocks in `state.blocks`). Cascade-delete is added to `removeBlock` as part of editor migration. `state.embedContents` is introduced in Phase 14 cleanup or later.

- **Path B — introduce now (a "Phase 5.0" preventive cleanup).** Add `state.embedContents: PersistentMap<BlockId, Block>` as a separate map on `State`. Move existing test fixtures to use it. Update `removeBlock`, `clonePastedSubtree`, etc. to walk both maps where appropriate. Render and editor build on top of this from the start.

**Recommendation:** **Path B**. Introducing the separation now is a well-defined cleanup (one new field on State + helpers + migration of test fixtures). Test-fixture migration touches the embed-path tests across ~3-4 test files (clone-pasted-subtree.test.ts has ~7 tests in its embed-content cloning + cycle-defense + invariants describe blocks that use `fn-body`-in-`state.blocks`; merge-blocks / delete-range / replace-range each have 1-2 embed-content tests). Larger than the typical preventive cleanup, but still well within a single phase's budget. Doing it after editor cutover means migrating editor code TWICE — once to use `state.blocks` for footnote bodies, then again to use `state.embedContents`. Same cost-benefit reasoning as Phase 4c-2.5 (`mergeAdjacentTextItems` + `updateBlock` extractions) and Phase 4c-4's Task 1 (`splitInlineContentAtOffset` extraction) preventive cleanups, just at a slightly larger scale.

### Decision 4: Editor module sub-phasing

The master spec's step 10b ("Editor module rewrite") is the single largest chunk and explicitly suggests "can be split into per-action-family commits if needed." Phase 4's experience confirms: small, focused phases with full review cycles produce better outcomes than monolithic refactors.

**Recommendation:** Split the editor rewrite into **four sub-phases by action family**:

- **P11.1 — Inline-text actions:** typing, deleting characters, formatting toggle. Builds on `insertText`, `deleteRange`, `replaceRange`, `applyAttrsToRange`.
- **P11.2 — Block-structure actions:** Enter (split paragraph), Backspace-at-block-start (merge), list-indent/outdent, set-block-type. Builds on `splitBlockAtPosition`, `mergeAdjacentBlocks`, `setBlockType`, `setBlockAttrs`, `insertBlock`, `removeBlock`.
- **P11.3 — Selection actions:** cursor movement, hit-testing, selection extension. Depends on cursor module being migrated (P10).
- **P11.4 — Layout-coupled actions:** anything touching `selectionGeometry`, paint, scroll-to-selection.

Each sub-phase is independently reviewable and shippable.

### Decision 5: Pre-execution review cycles for Phase 5+

Phase 4's pattern of 2-4 fresh-context pre-execution review rounds caught real architectural concerns every time (3 leaky-abstraction fixes, 2 typo fixes, multiple test-coverage gaps). Phase 5+ is more complex — render, editor, cursor are inherently more interconnected than state operations.

**Recommendation:** **Mandatory pre-execution AND post-execution review cycles for every phase that introduces new code or migrates consumers.** Pre-execution catches plan-level issues; post-execution catches drift between plan and shipped code. The "until no more feedback" convergence rule applies to both.

Exception for pure-infra phases (P5 tsconfig hardening, P15 legacy-file deletion, P16 docs update, P17 final greening run): post-execution review is replaced with a build-green / test-green confirmation. Pre-execution plan review still applies (these phases still have plans worth reviewing for scope and ordering), but the post-execution-review-until-convergence pass adds no value when there's no meaningful code to drift from the plan.

## Risk mitigation patterns to apply going forward (lessons from Phase 4)

1. **Leaky-abstraction error contracts.** When operation A delegates to operation B (insert/delete/...) and B has a generic error message, A's stated contract may get shadowed by B's actual error. Pattern: validate locally **before** delegating, OR position B's call so its prefixed error wins. Caught and applied in 4c-1, 4c-4, 4c-5.

2. **DRY cleanups proactively before second caller materializes.** Helpers that get inlined twice tend to get inlined three more times before anyone fixes the duplication. Pattern: when a phase needs a helper that already exists privately in another file, extract it as a preventive cleanup. Applied in 4c-2.5 (`mergeAdjacentTextItems`, `updateBlock`) and 4c-4 (`splitInlineContentAtOffset`).

3. **Implementer escalation on file-create-collision.** Saved feedback memory: when a plan task says "Create: <path>" and the file already exists, the implementer must STOP and report `BLOCKED`, never silently refactor or consolidate. Held throughout Phase 4.

4. **Math-typo defense in tests.** Computed text expectations have been wrong in 2 plans (Phase 4c-4 Task 3, Phase 4c-5 Task 6). Pattern: implementer re-verifies the math by hand for any test with computed text, before running.

5. **Manual unused-import scan after every file edit.** Build doesn't catch them (tsconfig lacks `noUnusedLocals`). Decision 2 above proposes fixing this systemically.

6. **Cycle defense in any tree-walking algorithm.** Even when the data model says cycles can't exist, defensive `visited`-set guards prevent infinite recursion on malformed input. Applied in `clonePastedSubtree`, `removeBlock`'s `collectSubtreeIds`, etc.

## Proposed phase numbering for Phase 5+

Each phase below corresponds to one (or a small group) of per-phase implementation plans. The grain is set so each phase is independently reviewable, shippable, and doesn't block on the next phase's design.

| Phase | Subject | Builds on | Spec step |
|---|---|---|---|
| **P4e** | **Rebase state module on Yjs primitives.** Y.Doc replaces PersistentMap. Block / InlineContent / TextItem etc. become facades over Y.Map / Y.Array / Y.Text. Layer 3 ops become Yjs transactions. History via Yjs's UndoManager. Single-user editing runs entirely on Yjs locally; collab is genuinely additive when a sync transport is later added. See decisions.md decision C. | P4d | (new — Decision C) |
| **P5** | tsconfig hardening (`noUnusedLocals`, `noUnusedParameters`) + small infra cleanups | P4e | (new — Decision 2) |
| **P6** | `state.embedContents` separation + `removeBlock` cascade-delete completion (both maps now Y.Map at Y.Doc root) | P4e | (new — Decision 3) |
| **P7** | Render module rewrite (Phase A: BlockView + plumbing, parallel to old code) | P3, P4 | step 8 partial |
| **P8** | Components rewrite (Phase A: container components on BlockView, parallel) | P7 | step 9 partial |
| **P9** | Cursor types + position math (parallel to old cursor — see Open Question 6) | P1 | step 10a |
| **P10** | Cursor: hit-testing + selection-geometry on new types (parallel) | P9 | step 10c partial |
| **P11.0** | EditorState type flip + document-construction migration (`State` only — keep calling old render pipeline) | P4 | step 10b prereq |
| **P11.1** | Editor: inline-text action family | P11.0, P9 | step 10b |
| **P11.2** | Editor: block-structure action family | P11.1 | step 10b |
| **P11.3** | Editor: selection action family | P10, P11.2 | step 10b |
| **P11.4** | Editor: layout-coupled action family | P11.3 | step 10b |
| **P12** | Layout/styles consumers cut over to new types | P7-P11 | step 11 |
| **P13** | Integration tests rewrite | P11-P12 | step 12 |
| **P14** | Performance benchmarks per spec acceptance criteria | P11+ | step 13 |
| **P15** | Cleanup commit (delete all legacy state-module files + finalize public exports) | All above | step 14 |
| **P16** | Architecture docs update | P15 | step 15 |
| **P17** | Final greening pass | All above | step 16 |

**Estimated commits:** ~150-200 across the 18 phases (P4e + P5-P17 with P11 split into P11.0-P11.4). Per-phase plans typically produce 7-10 commits; smaller phases like P5 (tsconfig), P15 (legacy delete), P16 (docs), and P17 (greening) likely come in below 5. P4e is the largest single phase (~30-50 commits across the Yjs rebase) since it restructures Phase 1-4 internals.

**Notes on Path B (expand-contract):**
- P7-P10 introduce NEW modules in parallel with the old ones; old modules continue to compile and be used by editor.
- **P11.0 — EditorState type flip prerequisite (added in round 1 review):** before any action handler can be migrated, the `EditorState.state` field type must flip from `StateNode` to `State`, and the document-construction path (`createEmptyDocument`, `initialEditorState`, `editor-state.ts` constructors) must produce the new type. This is non-trivial: the editor's history mechanism, undo/redo, and selection types may all touch the legacy `Position` type. P11.0 lands this transition in one focused phase before family-by-family handler migration begins. Action handlers in P11.1+ then mutate the already-typed-correctly `EditorState.state` via Layer 3 operations.
  
  **P11.0 scope clarification (added in round 2 review, refined in round 4):** P11.0 does NOT rewire the render pipeline AND does NOT touch the `EditorState.selection` field (selection still uses legacy `Position`-by-path until P11.3). The `EditorState.state` field flips to `State`, but the existing call to `renderTree(...)` continues to operate (it can be kept compatible by either a small bridge that converts the new `State` to the legacy `StateNode` shape for render input, OR by P11.0 carrying both representations during the editor's transition window — the per-phase plan picks the mechanism). Render-pipeline rewiring is the responsibility of P11.1+ (each action handler updates its render expectations as part of the family migration), or alternatively defers entirely to P12 (layout/styles consumer cleanup). Therefore P11.0 depends ONLY on **P4 (Layer 3 ops)** — NOT on P7, P8, or P9. Cursor types (P9) become a dependency at P11.1, when action handlers start calling cursor-ops helpers.
- P11.1-P11.4 cut over editor action families one at a time. After each sub-phase, the editor uses some old + some new handlers; build stays green because the cutover is per-handler.
- P12 cleans up layout/styles consumers (they reference state types directly; the cleanup is mechanical once render/editor are migrated).
- P15 is the big delete: legacy state-module files (`state-node.ts`, `transformations.ts`, etc.) get removed. By then every consumer has migrated; build stays green.

**Cursor-ops as a P11.x dependency (added in round 1 review):**

Inline-text and block-structure action handlers (P11.1, P11.2) call cursor-navigation helpers (`moveByCharacter`, `moveByWord`, etc.) that currently live in `cursor/cursor-ops.ts` and import legacy `getNodeByPath` from `state/operations`. Two ways to reconcile:
- **Strict approach:** require P9 (cursor types + position math on new state) to land before P11.1 (so action handlers compose only new helpers). The dependency table reflects this: P11.0 builds on P9.
- **Pragmatic approach:** allow P11.1/P11.2 action handlers to call legacy cursor-ops temporarily (with explicit per-handler comments), and migrate cursor-ops calls in P11.3 alongside selection actions.

**Recommendation: strict.** Cursor ops feed every action handler and have their own correctness invariants (grapheme clusters, line breaks). Mixing legacy-cursor calls into new-state action handlers creates type-coercion fragility (action handlers receiving new `State` would need to convert to `StateNode` for cursor calls — hostile). P9 lands before P11.1 (the first action family). P11.0 itself doesn't depend on P9 because it doesn't touch action handlers or cursor — only the EditorState type field and document-construction.

## Per-phase quality gates (apply to ALL phases)

1. **Pre-execution plan review:** dispatch fresh-context reviewer agents until convergence (no actionable feedback). Same pattern as Phase 4. Round count varies (Phase 4 phases needed 1-4 rounds).
2. **Post-execution code review:** after the 7-task subagent-driven implementation, dispatch fresh-context reviewers on the actual shipped code. Until convergence.
3. **Build green at end of each phase.** Per Decision 1 (Path B), this is non-negotiable.
4. **Browser smoke test for any UI-touching phase.** P7-P11 minimum. Run `npm run dev --workspace=examples/react`, exercise the feature manually before declaring done.
5. **Math-typo defense.** Per Risk Mitigation pattern 4.
6. **Manual unused-import scan.** Mostly subsumed by Decision 2's tsconfig fix, but stays as a safety net during the migration window.

## Open questions / risks not yet decided

1. **Workflow for Path B parallel implementations.** When P7 (render) introduces a new render module alongside the old one, what controls dispatch — a build-time flag? A naming convention? Each phase's plan should propose its specific cutover mechanism.

2. **Test fixture migration for legacy `StateNode`-based tests.** Legacy tests in `state/transformations.test.ts`, `state/formatting.test.ts`, `extract-text.test.ts` still test the old code. They get deleted in P15 — but we should not lose the COVERAGE they provide. Each new operation should have equivalent test coverage on the new type before its corresponding legacy test gets deleted. Track coverage explicitly during P11.

3. **Browser smoke test scope.** Phase 4 didn't need browser smoke (state-only). Phase 7+ inherently does. Define a minimum smoke checklist: type text, format bold, create paragraph break, undo/redo, copy/paste. Add to per-phase quality gates.

4. **Editor history collapse.** Spec step 10b says "history collapsed with state-module history." Currently the editor has `editor-state.ts` history; the state module has `state/history.ts`. Combining is a design decision worth its own brainstorm before P11.1.

5. **`react/` package adaptation.** `useEditor`, `EditorView` etc. — what changes? The state shape changes propagate through here. Likely small surface area but should be checked as part of P12 or earlier.

6. **Cursor module: P9/P10 file boundary.** The cursor module (`cursor-ops.ts`, `cursor-position.ts`, `hit-test.ts`, `line-navigation.ts`, `selection-geometry.ts`, `selection.ts`) is heavily layout-coupled and currently lives entirely in the legacy path-based `Position` world; there's no clean existing seam between "position math" and "hit-testing" — those are interleaved in `cursor-ops.ts`. Spec step 10a says "adopt new Position. Port grapheme-cluster logic." Step 10c says "anything in cursor that depends on editor's hit-test or selection-geometry, after editor stabilizes." Under Path B, P9 introduces NEW cursor files in parallel with the old (likely a `cursor/v2/` directory or `cursor/cursor-ops.ts` replaced incrementally — naming convention TBD in the P9 per-phase plan). Old cursor files stay until P15 cleanup. The P9 plan must explicitly enumerate which files it creates/modifies vs. defers to P10.

## Definition of done for "Phase 5+ overall"

When all of the following are true (matches the master spec's "Definition of done" with our phase numbering):

- All `StateNode` references removed (`grep -r "StateNode" packages/core/src/` returns nothing).
- All `Position` is `{ blockId, offset }` everywhere — no path-based positions.
- All Layer 3 operations return `OperationResult` (or `ClonedSubtree` for paste).
- `dirtyIds` is produced at write-time, never via post-hoc comparison.
- No orphaned blocks invariant test passes.
- Inline content normalized invariant test passes.
- Performance benchmarks pass per the spec's acceptance criteria.
- `npm run build` clean. `npm test` 100% pass. Browser smoke passes. Integration tests pass.
- Architecture docs updated.

## Next step

Review and converge on this sequencing strategy. Then write the per-phase plan for **P5** (tsconfig hardening) — the smallest, lowest-risk phase, which serves as a warm-up for the Phase 5+ workflow under Path B.
