# Layout Module Cleanup Plan

> **Status doc.** Lives at `docs/superpowers/plans/2026-05-23-layout-module-cleanup-plan.md`. Update as work proceeds.

## Goal

Layout is the largest core module (28 source files) and the most consequential — every paint pixel, every hit-test, every selection rect, every cursor position derives from its output. The 2026-05-23 audit revealed multiple silent correctness bugs producing wrong geometry, several performance gaps where the incremental machinery exists but isn't wired in, and one cross-cutting invariant violation enabling the correctness bugs.

This plan closes the surviving-code issues in priority order so the layout layer is solid before R-D (incremental rendering) integrates against it, and before any feature work depends on layout's geometry.

## Source of findings

The 2026-05-23 layout audit — controller-dispatched `feature-dev:code-reviewer` against `packages/core/src/layout/` on branch HEAD `b33be1b`. Full audit report below.

## First-principles framing

- **Foundations-before-features.** Layout sits between cascade and paint; everything visual depends on it. Per the foundations-first ordering, this is the right work to do before R-D, which integrates layout-incremental + cascade-incremental + render-incremental.
- **Scope to surviving code.** Two doomed items noted; everything else is in surviving code.
- **No issue downplaying.** Eight A-class action items raised; eight tasks (or bundles) follow.
- **Browser is the reference** for layout / float / fragmentation behavior. CSS specs are the authority.

## Audit findings (2026-05-23 reviewer report, summary)

### Per-axis verdicts
- **LayoutBox type vocabulary:** clean.
- **Top-level dispatch:** clean except auto-cascade detection (C4 — will conflict with R-D).
- **BFC:** structurally sound, margin-collapse correct, fragmentation correct. Two issues (A1 float positioning, A7 inlineSize:0 fallback).
- **IFC:** wrap correct, strut correct, but `rewrapIncremental` is dead code (A5) and `applyVerticalAlign` breaks frozen-box invariant (A2). Confirmed #172 (text-run-driven design — `LineBox` not the canonical anchor for cursor / hit-test).
- **Table FC:** two-pass structure correct. `groupTableRows` doesn't recognize thead/tfoot row groups (gap, not regression).
- **Floats + Fragmentation:** structurally sound. One real bug (A1).
- **Intrinsic sizing:** mostly correct; mixed-children heuristic wrong (C3 / A-class candidate).
- **Used-style:** C-B's lineHeight fix is correct; otherwise clean.
- **Incremental layout:** spec-correct; `prevFloatEnv` hardcoded null (logged deferred).
- **Text shaping interface:** `createCanvasMeasurer` not deprecated; react example uses it; production geometry is wrong (A8, task #164).

### Surviving-code action items (A1–A8)

| # | Location | Issue | Confidence |
|---|---|---|---|
| A1 | `bfc.ts:298` | Float box `Object.freeze({...floatLayout, x, y})` bypasses factories; logical ≠ physical | 92 |
| A2 | `ifc.ts:881` | `applyVerticalAlign` spread-patches `y`, leaves `blockOffset` stale | 90 |
| A3 | `ifc.ts:1075` | `extractAncestorKey` uses `lastIndexOf("-")` but ancestor keys contain dashes | 88 |
| A4 | `ifc.ts:159-163` | `collectTokens` cursor desync on collapsed whitespace (dormant unless pre-wrap) | 82 |
| A5 | `wrap-incremental.ts` not consumed | `rewrapIncremental` is dead code; IFC does full re-wrap every keystroke | 85 |
| A6 | `ifc.ts:218` | Inline-block uses `makeRootContext` → loses `prevLayoutCache` | 85 |
| A7 | `bfc.ts:645-646` | `resolveBoxInlineSize` treats explicit `inlineSize: 0` as auto | 82 |
| A8 | `react/use-editor.ts:21` (task #164) | Production passes `createCanvasMeasurer` → lossy per-char measurement | 95 |

### Cross-cutting observations
- **C1** — Frozen-box invariant violations (A1+A2) need a structural prevention mechanism (brand symbol or dev-mode validate).
- **C2** — Orphans/widows read from anonymous-wrapper parent style, not the paragraph element's own style.
- **C3** — `intrinsic-sizes-pass` `hasInlineChildren` heuristic uses `some()` then iterates ALL children inline-style — inflates max-content for mixed-content blocks.
- **C4** — `dispatch.ts` auto-cascade will need replacement at R-D integration time (already flagged in R-D spec).

### Doomed code (one-liners only)
- `float-context.ts:205-209` — deprecated `FloatContext` / `createFloatContext` aliases.
- `layout-engine.ts` — single-line incomplete façade. Either expand or delete.

### Architecture-doc drift
Minor only. `1.4-layout/overview.md` says `layout-engine` "re-exports the entry points"; actually re-exports only `layoutTree`. Other docs accurate.

## Decision: work sequence

Ordered by criticality (silent correctness bugs first) then complexity (small fixes before big ones):

1. **L-A: Fix frozen-box invariant violations (A1 + A2 + C1).** Replace the two `Object.freeze({...box, physicalField})` sites with proper factory-based reconstruction; add a dev-mode invariant check (or brand symbol) so this anti-pattern can't recur. These are the two MAJOR correctness bugs. Bundle.
2. **L-B: Replace `createCanvasMeasurer` with shaper in react example (A8, closes #164).** User-visible production geometry bug. Plus add a deprecation warning on `createCanvasMeasurer` if we keep it exported, OR remove it.
3. **L-C: Fix `extractAncestorKey` for dashed keys (A3).** Replace string-derived ancestor extraction with an explicit `ancestorKey` field on `InlineBox`.
4. **L-D: Inline-block context — use `makeChildContext` (A6).** One-line fix; large perf restoration for inline-block-heavy documents.
5. **L-E: Wire `rewrapIncremental` into IFC (A5).** Largest incremental-layout performance hole; algorithm exists, integration needs work. Bigger task — likely its own spec doc + brainstorm.
6. **L-F: Bundle small correctness fixes (A4 + A7 + C2 + C3).** Each is a small targeted change.
7. **L-G: Doomed-code cleanup.** Remove `float-context.ts` deprecated aliases (after confirming no consumers), expand or delete `layout-engine.ts`.
8. **L-H: Architecture-doc minor drift fix** (`1.4-layout/overview.md`'s `layout-engine` description).

C4 (auto-cascade for R-D integration) is NOT a layout-cleanup task; it lands when R-D ships and is already documented in the R-D spec.

Each task ends with implementer → reviewer → commit per the standing review-until-clean rule.

## Status tracker

| Task | Status | Commit(s) | Notes |
|------|--------|-----------|-------|
| L-A: Frozen-box invariant fixes (A1+A2+C1) | not started | — | Two correctness bugs + prevention mechanism. TDD with geometric assertions. |
| L-B: createCanvasMeasurer → shaper in react (A8/#164) | not started | — | Production user-visible. |
| L-C: extractAncestorKey via explicit field (A3) | not started | — | Add `ancestorKey` field to InlineBox. |
| L-D: Inline-block makeChildContext (A6) | not started | — | One-line fix. |
| L-E: Wire rewrapIncremental into IFC (A5) | not started | — | Largest perf gap. Needs spec/brainstorm. |
| L-F: Bundle small fixes (A4+A7+C2+C3) | not started | — | Sub-10-line each. |
| L-G: Doomed-code cleanup | not started | — | float-context aliases + layout-engine façade. |
| L-H: Minor arch-doc drift fix | not started | — | One line in `1.4-layout/overview.md`. |

## References

- Audit findings (verbatim, above).
- Architecture docs: `docs/architecture/1-core/1.4-layout/overview.md` and sub-files.
- P1.B pagination spec: `docs/superpowers/specs/2026-05-01-p1b-pagination-within-block-fragmentation-design.md`.
- R-D spec (depends on layout being clean): `docs/superpowers/specs/2026-05-22-render-incremental-design.md`.
- #172 LineBox refactor (architectural; outside this plan's scope): existing task.
- Branch: `feature/dom-architecture-redesign`.
- Related memory: `feedback_foundations_before_features.md`, `feedback_fix_scope_to_survival.md`, `feedback_no_issue_downplaying.md`, `feedback_browser_as_reference.md`.
