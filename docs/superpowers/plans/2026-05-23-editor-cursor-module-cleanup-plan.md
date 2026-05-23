# Editor + Cursor Module Cleanup Plan

> **Status doc.** Lives at `docs/superpowers/plans/2026-05-23-editor-cursor-module-cleanup-plan.md`. Update as work proceeds.

## Goal

Editor + cursor are the orchestration + primitives layer above the cleaned-up state/render/cascade/layout foundations. The 2026-05-23 audit revealed real correctness bugs, mechanical cleanup opportunities, performance hot-paths, layering inversions, and severe architecture-doc drift. This plan closes them in priority order so the editor layer is a solid base for any user-facing feature work.

## Source of findings

The 2026-05-23 editor+cursor audit (controller-dispatched general-purpose agent — canonical `feature-dev:code-reviewer` was credits-failed; fallback applied per `CLAUDE.md` first-principles 3). Full audit captured below.

## First-principles framing

- **Foundations-before-features.** Editor is the orchestration; cursor is the primitives. Issues here ship as user-visible misbehavior. Recent user-reported bug (empty-line selection rect, fixed in `0cf2f40`) was a symptom of the synthetic-strut layering — exactly the cross-cutting concern this audit characterizes.
- **Fix-now-not-later, scope to surviving.** Most findings are in surviving code. The doomed items (D1-D4) get one-line cleanups when natural; the rest are real fix targets.
- **No issue downplaying.** All 17 A-class items are tracked as action items.
- **Browser engine + top word processors as reference.** Action-handler retargeting (E-A13) compares against Google Docs / Word convention.

## Audit findings (verbatim — full report appended below)

### Per-axis verdicts (from auditor)

- **Reducer + handlers:** clean dispatch, highly duplicative handler boilerplate, inconsistent short-circuit pattern.
- **Selection + cursor model:** Span shape right, targetX correctly on EditorState, collapsed-cursor detected by hand at every site.
- **Geometry queries:** functionally correct, well-documented, O(N) per query (full tree re-walk), layering inversion.
- **Action handlers:** systematic correctness bug (selectionAfter wrong for 4 handlers), short-circuit drift across 13 sites.
- **Cursor primitives:** correct; moveByWord cross-block has O(n²) inner loop.
- **Line navigation:** correct in logic, float-Y equality fragile.
- **Hit-test:** functional, hot-path O(N) accumulator + O(n²) findCharOffset.
- **History integration:** commit calls consistent, selectionAfter wrong in 4 handlers, history merging API in doc DOES NOT EXIST in code.
- **#172 LineBox-canonical scope:** 5 geometry call sites all consume the same `collectAllTextBoxes` traversal; synthetic-strut is the band-aid; refactor dissolves 6 separate findings.
- **Pending tasks:** #141, #172, #175 all relevant.

### Surviving-code action items

| # | Severity | Issue | Confidence |
|---|---|---|---|
| E-A1 | Boilerplate (cross-cutting) | 8 handlers duplicate same 20-line deletion preamble | 95 |
| E-A2 | Boilerplate | `isCollapsed(span)` hand-rolled at ~13 sites | 100 |
| E-A3 | Drift (#141) | 13 sites use `dirtyIds.size === 0` vs 1 site uses `result.state === editor.state` | 100 |
| **E-A4** | **Correctness bug** | 4 handlers commit `{before: sel, after: sel}` — undo/redo violates T4 contract | 90 |
| E-A5 | Performance | `collectAllTextBoxes` re-walks full tree per geometry query (4 call sites) | 100 |
| E-A6 | Performance | Hit-test offset accumulator walks all text-runs in document per click | 100 |
| E-A7 | Performance | `findCharOffset` O(n²) per character (re-measures prefix instead of reusing) | 100 |
| E-A8 | Performance | `moveByWord` cross-block O(n²) inner double-loop | 90 |
| E-A9 | Layering inversion | `cursor/*` imports from `editor/layout-utils` | 100 |
| E-A10 | Architecture (#172) | Synthetic-strut machinery is band-aid for text-run-canonical model | 95 |
| E-A11 | Latent (#172) | Line-navigation lineY equality is float-fragile (`Math.abs(...) < 1`) | 70 |
| E-A12 | Perf-minor | `selectionAllHaveAttr` whole-block O(items × span) walk per toggle | 60 |
| **E-A13** | **Correctness bug** | `set-block-type` / `toggle-list` walk to root child, retypes outermost ancestor (wrong for tables/lists) | 75 |
| E-A14 | Confirmed-fine | `handleSetContainerWidth` doesn't commit history (matches doc) | 100 |
| E-A15 | Latent | `moveToLineBoundary` end-of-line back-up cross-block defense gap | 60 |
| E-A16 | Possibly-correct | PASTE doesn't trim leading whitespace from blocks | 50 |
| E-A17 | Type-safety | Redundant `as BlockId` cast in hit-test (already typed) | 30 |

### Doomed code

- **D1.** `editor/actions/helpers.ts:25-46` `rebuildTrees` `_oldEditor` unused param "for signature stability." Trim once incremental (R-D) is wired.
- **D2.** `cursor/selection.ts` header docstring references legacy `createSelection` helpers that no longer exist.
- **D3.** `editor/layout-utils.ts collectBlockBoundaryLines` becomes dead under #172.
- **D4.** `layout-utils.ts:139-142` TODO Plan 2 — line margin forced to 0. Either wire or remove TODO.

### Cross-cutting (#172) observations

The text-run-driven line model is the source of:
- `collectAllTextBoxes` existing + called 4 times (E-A5).
- `lineMap = Map<number, AbsoluteTextBox[]>` reconstructed per query (E-A5).
- Synthetic-strut entries existing (E-A10) + edge cases (#202 inline-block-only).
- Float-Y line equality being the line-identity primitive (E-A11).
- `parseInlineBoxKey` running on every text-run during hit-test offset accumulation (E-A6).

Under #172: geometry layer walks LineBox directly; LineBox carries owning blockId + absolute coords + offsetStart/offsetEnd. Five call sites convert cleanly. Synthetic-strut machinery disappears.

### Architecture-doc drift (severe)

`docs/architecture/1-core/1.7-editor.md` is ~60% accurate. 8 distinct drifts:

1. **History merging API is fiction.** Doc spells out `EditorHistoryEntry`, `pushEditorChange(history, entry, mergeTag?)`, `MAX_HISTORY_DEPTH`, `lastEditTimestamp`, `lastEditTag`, per-tag merge rules. None exists. Actual is `History` in `state/history.ts` (Y.UndoManager-backed) with `commit(opResult, {before, after})`. No merging.
2. **EditorState shape:** doc lists `nextId`, code doesn't.
3. **EditorConfig:** doc lists `measurer | registry | containerWidth | pageConfig`; code has `attrRegistry` too.
4. **EditorAction INSERT_NODE:** doc lists `NewNode`, code uses `BlockInit` (renamed in #160).
5. **IME composition spec is aspirational** — code only listens to start/end, doc describes full state machine.
6. **Sub-file inventory wrong:** doc lists `editor/cursor-position`, etc.; code has these in `cursor/`.
7. **`reduceEditor` reference flow:** doc says renderTreeIncremental + cascadePassIncremental + layoutTreeIncremental; code calls render + layoutTree (full rebuild every action — incremental is R-D / L-E future work).
8. **The doc's status note promises "P16 rewrites this doc" — overdue.**

## Decision: work sequence

Ordered by criticality (correctness bugs first) + size (small-fix-first within criticality):

1. **E-A: Bundle correctness bugs (E-A4 + E-A13).** Two real user-visible correctness bugs. E-A4 = 4 handlers commit wrong selectionAfter (undo/redo lands cursor wrong). E-A13 = set-block-type/toggle-list retype outermost ancestor instead of leaf (broken inside lists/tables). Bundle since both are in `editor/actions/` and both affect SET_BLOCK_TYPE / TOGGLE_LIST.
2. **E-B: #141 short-circuit migration + boilerplate extraction (E-A1 + E-A2 + E-A3).** Mechanical cleanup, ~13 sites, ~30% code reduction. Closes #141.
3. **E-C: Rewrite `1.7-editor.md`.** 8 drifts; doc currently misleading. Zero-code-change leverage.
4. **E-D: Performance hot-path bundle (E-A6 + E-A7 + E-A8).** Quadratic loops that should be linear. Small fixes. E-A5 is bigger (introduces a per-LayoutBox index) and may be subsumed by #172.
5. **E-E: #172 LineBox-canonical refactor (E-A5 + E-A9 + E-A10 + E-A11 + D3 + #202).** Architectural refactor. Likely needs its own spec doc + brainstorm. Substantial work (~4-6 commits, 950-line test rewrite).
6. **E-F: Smaller items (E-A12, E-A15, E-A16, E-A17, D1, D2, D4).** Bundle.
7. **E-G: #175 Ctrl+ArrowLeft keybinding fix** (Linux/Windows). Lives in `dom/key-handler.ts`. Small.

Each task ends with implementer → reviewer → commit per the standing review-until-clean rule.

## Status tracker

| Task | Status | Commit(s) | Notes |
|------|--------|-----------|-------|
| E-A: Correctness bugs (E-A4 + E-A13) | ✅ done | `260c04c` | E-A13 fixed (handlers retype the cursor's leaf, not the outermost ancestor — pre-fix silently broke inside lists / tables). E-A4 investigated: false positive for these handlers (selection genuinely preserved). INSERT_NODE cursor-positioning carved out as task #210. +2 tests. Two reviewer passes. |
| E-B: #141 + isCollapsed extraction (E-A2 + E-A3) | ✅ done | `24fa40c` | #141 short-circuit consistency migrated (10 sites in editor/actions now use the T7 `result.state === editor.state` identity check). New `isCollapsed(span)` helper added to `cursor/selection.ts`; 11 hand-rolled predicates in editor/actions + 3 in dom/editor-controller collapsed to one helper. E-A1 (deletion preamble extraction across 8 delete-* handlers) carved out as task #211 — bigger refactor than E-B's mechanical-cleanup scope. Two reviewer passes (one issue found + fixed: dead insert-node guard removed; one issue tightened: split-node comment now enumerates all 3 subcases). |
| E-C: Rewrite 1.7-editor.md | ✅ done | `8feb097` | All 8 audit-flagged drifts corrected (fictional History merging API replaced with the real Y.UndoManager-backed `History`; `EditorState`/`EditorConfig` shapes corrected; `INSERT_NODE.node: BlockInit`; IME composition marked `[partial]` against target state machine; sub-file inventory corrected — geometry queries live in `cursor/` not `editor/`; `rebuildTrees` flow marked `[partial]` against incremental target; stale "P16 rewrites this doc" status note removed). `isCollapsed` added to `overview.md` Cursor exports; `moveToLine`/`moveToLineBoundary` added to `editor/` bullet. Two reviewer passes. |
| E-D: Perf hot-paths (E-A6 + E-A7 + E-A8) | ✅ done | `9ec0c9c` | Three perf fixes bundled: (E-A8) `moveByWord` cross-block backward now precomputes per-item cumulative offsets in one O(n) forward pass instead of O(n²) inner double-loop. (E-A7) `findCharOffset` rewritten as binary search over prefix widths with memoization — O(log n) measureWidth calls instead of O(n) calls each measuring duplicate prefixes. (E-A6) Per-block hit-test offset accumulator moved from O(N) per-click walk to O(1) lookup via new `AbsoluteTextBox.prefixOffsetInBlock + .blockId` fields populated during `collectAllTextBoxes` (with a `Map<BlockId, number>` accumulator threaded through recursion, including across page boundaries). Two reviewer passes (one followup batch: page-branch comment clarity + dead ternary removal). |
| E-E: #172 LineBox-canonical refactor | not started; needs spec | — | Architectural. Spec first. Closes #172. |
| E-F: Smaller items (E-A12 + D4) | ✅ done | `<E-F-commit>` | Two items shipped: (E-A12) `selectionAllHaveAttr` now starts at the first overlapping item via `findItemAtOffset`, exits on `cursor >= rangeEnd`, and early-returns false on the first non-attr text item. Prior implementation walked every item in every spanned block. (D4) `collectAllTextBoxes` LineBox-margin TODO replaced with a stable comment describing why margins are zeroed at the LineBox boundary. Inadvertently-resolved siblings tracked separately: D2 fixed by E-B (cursor/selection.ts header rewrite); E-A17 fixed by E-D (hit-test rewrite eliminated the `as BlockId` cast). Deferred siblings carved out: D1 (rebuildTrees unused param — coupled to incremental wiring, pending), D3 (collectBlockBoundaryLines — dissolves with E-E), E-A15 (moveToLineBoundary cross-block back-up defense gap — task #212), E-A16 (PASTE leading-whitespace policy — task #213). One reviewer pass. |
| E-G: #175 Ctrl+ArrowLeft keybinding | not started | — | Lives in dom/key-handler.ts. Closes #175. |

## References

- Audit findings (verbatim, above).
- Architecture doc (editor): `docs/architecture/1-core/1.7-editor.md` (severe drift).
- State-of-branch: `docs/architecture/state-of-branch.md`.
- Earlier cleanup precedents: `docs/superpowers/plans/2026-05-22-{state,render,cascade}-module-cleanup-plan.md` and `2026-05-23-layout-module-cleanup-plan.md`.
- R-D spec (depends on editor being clean): `docs/superpowers/specs/2026-05-22-render-incremental-design.md`.
- L-E spec: `docs/superpowers/specs/2026-05-23-ifc-incremental-wrap-wiring-design.md`.
- Branch: `feature/dom-architecture-redesign`.
- Related memory: `feedback_foundations_before_features.md`, `feedback_fix_scope_to_survival.md`, `feedback_no_issue_downplaying.md`, `feedback_review_until_clean_default.md`.
