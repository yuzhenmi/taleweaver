# Plan 3.K — Performance Design Spec

**Status:** approved 2026-04-29; supersedes the original "Plan 3.J → Plans 4–8" ordering. Plan 3.J defers behind 3.K.

**Branch:** `feature/dom-architecture-redesign`.

---

## Why this exists

After Plans 3.A–3.I shipped the layout/paint incremental infrastructure,
user testing on a large document (~10,000 paragraphs / ~800K chars) showed
that BOTH character insertion AND cursor movement are perceptibly slow.
The infrastructure is in place, but key paths still run O(document-size)
work per interaction:

- Cascade pass walks the full render tree on every edit (F4.1, Plan 1).
- `layoutTreeIncremental` rebuilds a fresh `LayoutBoxCache` from
  `oldLayout` on every call (F3H.2).
- IFC has paragraph-identity cache only; convergence-detection algorithm
  exists but isn't wired into the wrap loop (F3G.3, F3H.1).
- `walkAndDetectChanges` traverses the full layout tree to hash every box
  on every paint pass (F3I.4).
- Paint strategy is "clear-dirty + full-repaint" (F3I.1).
- **Cursor-slowness signal**: the read path (selection geometry, hit-test,
  React subscription/re-render) hasn't been profiled and may also be O(N).

Plan 3.K closes the perf gap before we layer Plans 4–8 features on top.

## Scope

**In:**
- Per-keystroke and per-cursor-move profiling on the React example app at
  10K-paragraph fixture scale.
- Fix the bottlenecks that profiling identifies, in priority order, until
  we hit the target or diminishing returns.
- Both mutation-path bottlenecks (cascade, layout, IFC re-wrap, paint) and
  read-path bottlenecks (selection geometry, hit-test, React re-render).
- Persistent `console.time` / `performance.mark` instrumentation behind a
  feature flag for ongoing perf work.

**Out:**
- True skip-painting (per-box composited layers, F3I.1). This needs a new
  rendering architecture (compositing layers per box) that v1 does not
  have. The current "clear-dirty + full-repaint" is the v1 ceiling for
  paint correctness without compositor work.
- React virtual-DOM optimization or migration to a different framework.
  Selective re-render is in scope; framework rewrite is not.
- Plan 4–8 features. Performance work fixes existing code only.
- First-paint optimization on document load (rare event; lower bar).

## Target

**Steady-state editing must be O(1) — i.e., per-keystroke and per-cursor-move
work must be independent of document size.**

Concrete bar on a 10K-paragraph fixture in the React example app:
- Single character insertion in the middle of a paragraph: < 16ms total
  (one frame). Stretch: < 8ms.
- Arrow-key cursor move within or across paragraphs: < 16ms. Stretch: < 8ms.
- Selection extension by one character: < 16ms.

**Where O(1) is fundamentally not achievable** (e.g., outer container
width change forces re-layout of every block; first paint of a fresh doc
must walk every box once), document the lower bound and accept O(N) for
those rare events.

## Approach — profile-driven, not speculation-driven

We have hypotheses but not data. The order of work is:

1. **Build the fixture.** A 10K-paragraph synthetic doc loaded into the
   React example app. Each paragraph ~80 chars. ~50K–100K layout boxes
   when fully laid out.

2. **Instrument.** Wrap the key passes with `performance.mark` /
   `performance.measure` so per-keystroke and per-cursor-move latency
   breaks down by phase. Phases to instrument:
   - **Mutation path:** state-action dispatch, cascade pass, layout pass
     (overall + per-FC), IFC re-wrap, paint walk, paint draw, total.
   - **Read path:** cursor-position resolution, hit-test, selection-geometry
     computation, React state-subscription notification, React component
     render time, total.
   - Keep all instrumentation behind a `PERF_TRACE` feature flag (env
     var, build flag, or runtime switch) so it doesn't ship.

3. **Baseline measurement.** Reproduce the user's slow-insertion and
   slow-cursor scenarios. Capture per-phase ms breakdown at three sizes
   (e.g., 1K / 5K / 10K paragraphs) to see scaling behavior.

4. **Fix top offender.** Pick the phase with the highest absolute cost
   AND a clear scaling-with-N pattern. Implement the fix that closes
   that phase's O(N) behavior. Re-measure. Iterate.

5. **Iterate** until the per-keystroke and per-cursor-move targets are met
   on the 10K fixture, or until measurements show we've hit the
   diminishing-returns floor.

6. **Document.** Mark closed followups in the Plan 3 summary; create the
   3.K followups doc; record before/after numbers per fixture size.

## Likely fixes (expected-impact order, pre-data)

These are the candidates I'd expect data to surface, ranked by expected
impact. Final prioritization comes from the baseline measurement.

| ID | Fix | Why it matters |
|---|---|---|
| F3I.4 | Short-circuit `walkAndDetectChanges` on root reference equality. If `newRoot === prevRoot`, return zero dirty regions immediately; don't recurse. | Few lines. Eliminates paint-walk cost on cursor moves and on edits where Plan 3.H subtree-reuse already preserved most subtrees. Possibly the highest-impact-per-line fix in the list. |
| F4.1 | `cascadePassIncremental` — walk the render tree but skip subtrees where the input render-node is reference-equal to the prior pass's input (and the parent's `ComputedStyle` is unchanged). | Cascade currently runs full-tree on every edit, including cursor moves. This is structurally an O(N) path that should not be triggered by selection-only changes at all. |
| F3H.2 | Persist `LayoutBoxCache` across keystrokes keyed by EditorState identity, instead of rebuilding from `oldLayout` per call. | Removes O(layout-tree-size) cache rebuild per keystroke. |
| (read path) | React subscription / re-render — investigate whether the React example app re-renders the full document tree on every state change. | Cursor-slowness signal points here. May need `React.memo` on per-block components, or selective subtree-update via key-stable props. |
| (read path) | Selection-geometry — investigate whether `selection-geometry.ts` walks the full layout tree per cursor move, vs only the active block / line. | Same direction as the React fix. |
| F3G.3 | Wire convergence detection into IFC's wrap loop. Hyphen-handling complicates extracting `wrapOneLine`. Approach: pre-shape hyphen-split tokens at tokenization so the wrap loop sees a flat token array. | Within-paragraph re-wrap on every keystroke is O(paragraph length). Only matters if profiling shows IFC dominates. Biggest engineering lift; defer if data doesn't justify. |

## Plan-doc structure

Plan 3.K will be split across multiple sub-plan docs because the fix list
depends on measurement data:

- **Plan 3.K.1 — Measurement.** Fixture, instrumentation, baseline. Concrete
  task list, written now.
- **Plan 3.K.2+ — Fixes.** One sub-plan per top offender, written after
  3.K.1 lands data. Each fix gets its own phase doc + followups doc per
  the existing per-phase pattern.

## Success criteria

- 10K-paragraph fixture exists and loads in the React example app.
- Profiling instrumentation lives behind a flag in the codebase.
- Per-keystroke insertion latency on 10K fixture: < 16ms.
- Per-cursor-move latency on 10K fixture: < 16ms.
- Both numbers approximately invariant across 1K / 5K / 10K fixture sizes
  (i.e., O(1) confirmed, not just "fast enough" at one size).
- Followups doc captures any remaining perf debt for Plan 4+.

## Decision log

- **2026-04-29:** Plan 3.J (test housekeeping) defers behind 3.K. Rationale:
  3.J's tasks are mechanical test additions and a small code cleanup; they
  don't move us toward perf, they don't block 3.K, and they can be
  finished after the perf gap closes. Plan 3.J's tasks #161–#164 remain
  queued; #165 (the summary doc) was completed inline as part of the gap
  inventory.
- **2026-04-29:** O(1) target accepted for steady-state editing. Lower
  bound documented for fundamentally O(N) events (first paint, outer
  resize).
- **2026-04-29:** Read-path profiling included in scope after the user
  reported cursor-movement slowness — the bottleneck is not exclusively
  on the mutation path.
