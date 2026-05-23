# Render Module Cleanup Plan

> **Status doc.** Lives at `docs/superpowers/plans/2026-05-22-render-module-cleanup-plan.md`. Update as work proceeds.

## Goal

The render module sits between state and cascade/layout in Taleweaver's pipeline. It must walk the state's block tree, dispatch each block through the component registry, expand inline content into `RenderNode`s, compose `ComputedStyle` per block, and emit a `RenderOutput` tree for downstream consumption — **incrementally**, driven by `dirtyIds` from state, with reference-equality preservation for unchanged subtrees.

The 2026-05-22 audit (controller-dispatched `feature-dev:code-reviewer`) revealed:
- Incremental rendering is **not implemented** — every call is a full O(N) rebuild. This is the deepest gap.
- Several smaller correctness / interface-contract issues in inline-item construction, cycle detection, cascade-context plumbing, and atomic-leaf strut handling.
- The architecture doc `1.2-render.md` is completely stale (pre-cutover API).
- A scope question: `cascade/cascade-pass.ts` may be redundant after the inline cascade in `render.ts`.

This plan closes the gaps in priority order so the render foundation is solid before any feature work depends on it. Per `feedback_foundations_before_features` in memory.

## First-principles framing

- **Foundations-before-features.** Render is the second pipeline stage; everything downstream (cascade pass, layout, paint, cursor, editor geometry) depends on render's output and its performance contract. Fix here before adding feature-level UX.
- **Fix-now-not-later, scoped to surviving.** Every issue raised is in surviving code (the P11 cutover replaced the legacy render pipeline; the new module is the design). One scope question — cascade-pass — must be answered first.
- **Document decisions.** Each task's outcome lands in this plan's status table. Each scope decision lands in this doc.
- **Review-until-clean.** Every task gates on a reviewer pass before commit; controller dispatches review, not the implementer.

## Audit findings (2026-05-22 reviewer report, verbatim issues)

### Headline verdicts
- **Types (RenderNode / BlockView):** mostly clean; one inline-item construction issue.
- **Walker (`render.ts`):** fundamentally broken in `visited` cycle-detection logic; cascade composition order correct; embed-content path correctly uses `getEmbedContentIds` (T-B encapsulation holds).
- **Dirty-id consumption:** absent. Full rebuild every call. **Biggest architectural gap.**
- **Cascade/AttrRegistry:** order correct; `CascadeContext` missing.
- **Component dispatch:** mostly clean; atomic-leaf strut sentinel passed by convention only.
- **Tests:** structural breadth adequate; missing integration through the pipeline; no atomic-strut test.

### Surviving-code issues

1. **A1 — `expandInlineItems` double-freeze + new-identity-per-render anti-pattern.** `render.ts` lines 191–206 and the strut on 224. Spreads `createTextBox`/`createElementBox` output into a new object and re-freezes — to attach `computedStyle`. R-pre established that `cascadePass` ALWAYS runs after render and overwrites this `computedStyle` before layout reads it; the pre-fill is therefore redundant. **Resolved fix**: drop the `computedStyle` attachment from `expandInlineItems` entirely. Return the factory result directly. Cascade owns the field per pipeline contract.

2. **A2 — `visited` set is never drained after a subtree completes.** `render.ts` lines 100–103. Acts as ever-visited accumulator, not a true per-walk cycle detector. Benign for tree topology, latent time-bomb. Fix: `visited.delete(block.id)` on exit from the recursive walk.

3. **A3 — `attrRegistry.applyAll` called without `CascadeContext`.** Block-level (line 160) and inline (line 185) both pass no second arg. Any interpreter using `ctx.parentStyle` silently degrades. Fix: pass `{ parentStyle: <parent declared style> }` for block-level calls; inline calls pass the block's resolved style.

4. **A4 — Incremental rendering absent.** `render()` is O(N) every call. No `RenderCache`, no `dirtyIds` consumption. The state module produces `dirtyIds` precisely for this layer. Fix: add a per-State `RenderCache`; pass `dirtyIds` from the caller (editor reducer); render walks only dirty ancestor chains, reuses cached RenderNodes for unchanged subtrees.

5. **A5 — Atomic-leaf strut sentinel passed to atomic components by convention only.** `render.ts` line 210–229. Image and horizontal-line discard the strut by convention; no enforcement. Third-party atomic components could consume it. Fix: check `def.leafShape === "atomic"` and pass `[]` instead of constructing a strut.

6. **A6 — `image` component falls back to `inlineSize: 0` / `blockSize: 0` when attrs missing.** `components/image.ts` lines 26–27. Should be `"auto"` (intrinsic sizing).

### Cross-cutting observations (audit "C" section)

- C1: `RenderContext.getView` / `getEmbedContent` are P10 stubs that throw. Type signature suggests they're callable. Consider `@throws` JSDoc.
- C2: `visited` design smell — confirmed by A2.
- C3: No integration test piping `render → cascade → layout`.

### Doomed/scope question

- **Q1: `cascade/cascade-pass.ts` survival status.** The post-render `cascadePass()` function plus `COMPUTED_STYLE_KEYS` manual list. With `render.ts` doing inline cascade per-block (`AttrRegistry.applyAll → composeComputed → flattenLengths`), is `cascade-pass.ts` still in the pipeline, or has it been superseded? Must be answered before any work touches the cascade boundary.

### Architecture-doc drift

- `docs/architecture/1-core/1.2-render.md` is completely stale (pre-cutover API). Defers rewrite to "P16" — that deferral is itself a documentation-debt deferral; per CLAUDE.md's living-documents rule, the doc should at minimum be reduced to a stub pointing at the current spec/code rather than describing the inverse of reality.

## Decision: work sequence

Selected per first principles:

1. **R-pre: Answer Q1 (cascade-pass survival)** before touching anything downstream. Five-minute investigation. Updates the plan doc.
2. **R-A: Architecture-doc rewrite (1.2-render.md)** — same pattern as state's T-A. Zero-code-change leverage; aligns doc with code so any future contributor reads the truth. Independent of the code fixes.
3. **R-B: Bundle of small fixes (A1 + A2 + A3 + A5 + A6)** — all small, all surviving-code, no interlock with R-D. Land as one logical commit if scoped right, or split if they touch unrelated parts of the file.
4. **R-C: Integration test (C3)** — pipe a realistic doc through `render → cascade → layout` and assert no crashes / valid output shape. Cheap insurance before R-D.
5. **R-D: Incremental rendering (A4)** — the big one. Design first (new spec doc; brainstorm with user), then implement against the spec.

R-pre / R-A / R-B / R-C are bounded enough to land sequentially in this session. R-D requires a separate design pass (spec doc, decision-on-scope with user) and will likely be its own multi-commit subseries.

## Status tracker

| Task | Status | Commit(s) | Notes |
|------|--------|-----------|-------|
| R-pre: Resolve `cascade-pass.ts` survival status | ✅ done | — | `cascadePass` IS surviving — called by `layout/dispatch.ts:42` and `layout/layout-incremental.ts:51` on every render. Canonical post-render cascade. `render.ts`'s `composeBlockStyle` is the per-block precursor that feeds `BlockView.computedStyle` for components' use; `cascadePass` runs after and fills `ComputedStyle` into every RenderNode (including inline children, where `expandInlineItems` redundantly pre-fills it — A1 fix is to drop that pre-fill, let cascadePass own the field). |
| R-A: Rewrite `1.2-render.md` to match push-model code | ✅ done | `233a7ec` | Full rewrite + coherence pass on `1-core/overview.md` render bullet (removed aspirational "driven by `dirtyIds`"). Two reviewer passes: first flagged image display fabrication + cascade pipeline mis-description; both fixed. `[partial]` flag on incremental rendering points at R-D. |
| R-B: Bundle small fixes (A1, A2, A3, A5, A6) | ✅ done | (this commit) | All five fixes landed in `render.ts` (A1+A2+A3+A5) + `components/image.ts` (A6). +13 tests including a DAG-diamond test that falsifies the A2 drain. `composeBlockStyle` refactored to return `{ specified, computed }` to thread parent-style context. Two reviewer passes (first flagged weak A2 tests + missing renderBlock JSDoc; both fixed). |
| R-C: Integration test `render → cascade → layout` | not started | — | Single happy-path doc; assert structural output shape |
| R-D: Incremental rendering (`RenderCache` + dirty-id consumption) | not started | — | Spec first; implementation second. Probably its own plan doc. |

## References

- Render audit (verbatim, this plan doc § "Audit findings")
- State-module cleanup precedent: `docs/superpowers/plans/2026-05-22-state-module-cleanup-plan.md`
- Architecture doc (target of R-A): `docs/architecture/1-core/1.2-render.md`
- Block-tree-of-ropes spec: `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`
- Branch: `feature/dom-architecture-redesign`
- Related memory:
  - `feedback_foundations_before_features.md`
  - `feedback_fix_scope_to_survival.md`
  - `feedback_document_decisions_and_plans.md`
  - `feedback_review_until_clean_default.md`
