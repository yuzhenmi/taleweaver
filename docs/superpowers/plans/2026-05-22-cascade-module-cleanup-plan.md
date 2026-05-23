# Cascade Module Cleanup Plan

> **Status doc.** Lives at `docs/superpowers/plans/2026-05-22-cascade-module-cleanup-plan.md`. Update as work proceeds.

## Goal

Cascade sits between render and layout in Taleweaver's pipeline. It must:
- Translate open-schema attribute bags into declarable `Partial<Style>` via the interpreter registry.
- Compose specified + inherited + initial into `ComputedStyle`.
- Resolve em/rem and other length expressions against own/parent context.
- Provide structural-equality checks that drive incremental layout's reuse decisions.
- Support incremental cascade (`cascadePassIncremental`) for R-D's eventual wiring.

Foundations-before-features: the cascade module is between two layers that have already been cleaned up (state, render). Issues here propagate into every layout decision, every paint, every selection geometry. Per the 2026-05-22 audit, cascade has multiple silent correctness bugs and one CSS-spec violation that produces a visible user-facing symptom.

## Source of findings

The 2026-05-22 audit (controller-dispatched `feature-dev:code-reviewer`) — full report below — produced the findings. Same first-principles framing as state and render: scope to surviving code, no issue downplaying, fix-now-not-later.

## Audit findings (2026-05-22 reviewer report, verbatim)

### Per-axis verdicts
- **AttrRegistry/AttrInterpreter:** clean surface; built-in coverage is the gap (7 interpreters, 0 for block-level format attrs).
- **composeComputed:** mechanically correct; type signature claims `Readonly<Style>` but accepts `Partial<Style>`.
- **flatten-lengths / resolve-length:** em handling correct EXCEPT `letterSpacing`, `wordSpacing`, `textIndent` pass through unresolved.
- **cascade-pass:** `cascadePass` clean; `cascadePassIncremental` matches R-D spec; `COMPUTED_STYLE_KEYS` is a hardcoded drift hazard.
- **Render-module interaction:** the two-path overlap (render's `composeBlockStyle` + cascade-pass) is correct by design; latent coherence risk only matters when context-sensitive interpreters appear.

### Surviving-code action items

1. **A1 — `flattenLengths` omits `letterSpacing`, `wordSpacing`, `textIndent`** (Confidence 92). Silent miscomputation: em values pass into layout's `resolveUsedLength` which treats them as percent against containing-inline-size, producing garbage. Fix: add `flattenLengthOrNormal(cs.letterSpacing, fontSize)`, `flattenLengthOrNormal(cs.wordSpacing, fontSize)`, `flattenLength(cs.textIndent, fontSize)` to the spread in `flattenLengths`.

2. **A2 — `COMPUTED_STYLE_KEYS` is manually maintained** (Confidence 88). Drift hazard. When a new property is added to `Style`/`ComputedStyle`/`PROPERTY_META`, `COMPUTED_STYLE_KEYS` must be updated or `computedStylesEqual` silently skips it — meaning layout's incremental reuse cache stale-reuses across the new property. Fix: derive from `PROPERTY_META`: `const COMPUTED_STYLE_KEYS = Object.keys(PROPERTY_META) as (keyof ComputedStyle)[]`. (Cross-checking confirms the two lists currently match — no silent bug today, but drift WILL bite when properties are added.)

3. **A3 — `builtin-attrs.ts` missing interpreters for primary document-format attrs** (Confidence 85). Missing: `textAlign`, `lineHeight`, `listStyleType`, `headingLevel`, `textIndent`, `letterSpacing`, `wordSpacing`. Without interpreters, these attrs can't be authored via the open-schema bag — they silently drop. (Severity depends on whether components are setting these styles directly bypassing the registry. Needs investigation per attr.)

4. **A4 — `composeComputed` parameter typed `Readonly<Style>` but accepts `Partial<Style>`** (Confidence 80). Type lie. Implementation iterates `Object.keys(PROPERTY_META)` checking `specified[key] !== undefined`, so partial input is handled correctly. The signature misleads readers. Fix: change to `Partial<Style>` to match both callers and the implementation.

5. **A5 — `textDecoration: { inherits: true }` is incorrect per CSS spec** (Confidence 80). CSS Text Decoration Module Level 3 says `text-decoration` does NOT inherit. The "underline-spans-across-children" visual is achieved by painting the decoration at the ancestor box — not by inheritance. Current bug: a child span trying to remove `underline: false` produces `{}` from the interpreter; cascade then inherits parent's `underline` back. User can't remove underline from sub-runs. Fix: set `textDecoration: { inherits: false }` in `PROPERTY_META`.

### Cross-cutting observations

- **C1** — Two cascade paths with potentially divergent parent-style semantics. Latent coherence risk when context-sensitive interpreters appear. Defer until first such interpreter lands.
- **C2 / #166** — `flattenLineHeight` leaves unitless `lineHeight` (e.g. `1.5`) as a raw number; `UsedStyle.lineHeight: number` passes it directly; IFC treats `1.5` as `1.5px` line height instead of `1.5 × fontSize px`. Cascade's responsibility (or split between cascade and layout's used-style). Confirmed known issue (#166).

### Architecture-doc drift

Minor: `docs/architecture/1-core/1.3-cascade.md` claims `INITIAL_COMPUTED_STYLE.display: "block"` in a footnote area; actual value is `display: "inline"` per `property-meta.ts`. Doc error, not a code error.

### Top-3 highest-ROI fixes (reviewer's ranking)

1. **A1 — fix `flattenLengths` to resolve `letterSpacing`/`wordSpacing`/`textIndent`** (silent miscomputation).
2. **A5 — fix `textDecoration` inheritance flag** (user-visible underline-removal bug).
3. **A2 — derive `COMPUTED_STYLE_KEYS` from `PROPERTY_META`** (drift hazard removal).

## Decision: work sequence

Selected per first principles:
- **Silent correctness bugs first** (A1, A5, C2/#166 — symptoms users actually see).
- **Drift hazards before they bite** (A2).
- **Type-truth fixes for clarity** (A4).
- **Coverage gaps with design decisions** last (A3 — each missing interpreter needs to confirm "is the attr in scope" vs "is the component setting it directly").
- **Defer C1** (latent, no current consumer).

Task ordering:

1. **C-A: Bundle small correctness + clarity fixes (A1 + A2 + A4 + A5 + doc-drift fix).** All are sub-10-line fixes touching `flatten-lengths.ts`, `cascade-pass.ts`, `compose.ts`, `property-meta.ts`, and `1.3-cascade.md`. TDD per fix. Single commit if scope holds.
2. **C-B: Fix unitless line-height resolution (C2 / closes #166).** Slightly bigger — must decide whether cascade's `flattenLineHeight` does the multiplication (producing px) or whether `UsedStyle.lineHeight` does it (preserving the unitless ratio at ComputedStyle for inheritance purposes). Per CSS spec, the unitless ratio inherits; that argues for layout-side resolution. Investigate before deciding.
3. **C-C: Add missing builtin interpreters (A3).** For each of the 7 missing attrs: confirm whether components currently set the style directly (bypassing the registry) or expect an interpreter. Add interpreters where needed; document component-side conventions where the attr is intentionally outside the registry.
4. **C-D: Defer.** Cross-cutting C1 has no current consumer; revisit when the first context-sensitive interpreter lands.

Each task ends with implementer → reviewer → commit per the standing review-until-clean rule.

## Status tracker

| Task | Status | Commit(s) | Notes |
|------|--------|-----------|-------|
| C-A: Bundle small fixes (A1, A2, A4, A5, doc drift) | not started | — | All sub-10-line. TDD per fix. |
| C-B: Unitless line-height resolution (closes #166) | not started | — | Decide: cascade-side flatten vs layout-side UsedStyle resolution. |
| C-C: Add missing builtin interpreters (A3) | not started | — | Per attr: needs component-side audit before adding |
| C-D: Cross-cutting parent-style coherence (C1) | deferred | — | No current consumer; revisit when context-sensitive interpreter lands |

## References

- Audit findings (verbatim, above).
- Architecture doc (cascade): `docs/architecture/1-core/1.3-cascade.md`.
- State spec's cascade section: `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md` (§ "Cascade attribute-interpreter pipeline").
- R-D design (cascade-incremental wiring): `docs/superpowers/specs/2026-05-22-render-incremental-design.md`.
- State cleanup precedent: `docs/superpowers/plans/2026-05-22-state-module-cleanup-plan.md`.
- Render cleanup precedent: `docs/superpowers/plans/2026-05-22-render-module-cleanup-plan.md`.
- Branch: `feature/dom-architecture-redesign`.
- Related memory: `feedback_foundations_before_features.md`, `feedback_fix_scope_to_survival.md`, `feedback_no_issue_downplaying.md`, `feedback_document_decisions_and_plans.md`.
