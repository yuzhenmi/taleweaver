# Plan 3.J — Follow-ups

**Status as of Plan 3.J completion (2026-04-29):**
- 5 tasks. Task 5 (Plan 3 summary doc) was completed early as part of
  the gap-inventory work; Tasks 1-4 closed via subagent dispatches.
- Build clean across all packages.
- Test suite green: 756 core / 133 dom / 10 react. 3 skipped tests in
  `value-resolution.test.ts` document deferred features (`rem` unit;
  cross-references to existing intrinsic-sizing coverage).

---

## Items closed by 3.J

- **D11** (retrospective): Value-resolution pipeline test gap. Closed
  by Task 1 (`958438f`) — 9 active + 3 skipped scenarios in
  `packages/core/src/integration/value-resolution.test.ts`.
- **F1.F6.x** (Plan 1 deleted-tests-for-deferred-features): inline-block
  intrinsic sizing edge cases. Closed by Task 2 (`6b1745d`) — 3 new
  scenarios in `packages/core/src/integration/intrinsic-sizing.test.ts`.
- **F1.F6.x** (Plan 1): floats edge cases. Closed by Task 3 (`586f703`)
  — 3 new scenarios in `packages/core/src/integration/floats-real.test.ts`.
- **Plan 1 F7.x** (preexisting): `bfc.ts` unreachable code at
  `resolveMarkerText`. Closed by Task 4 (`ab67ce3`) — replaced with an
  exhaustiveness `default: never` check that catches future
  ListStyleType additions.

## New findings recorded during 3.J

### F3J.1 — Inline-block does not clamp to container width (CSS shrink-to-fit divergence)

**File:** `packages/core/src/layout/ifc.ts:213` (in the inline-block branch
of `collectInlineTokens`).

**What:** When an inline-block has `inlineSize: "auto"`, the IFC computes
its size as `intrinsic.maxContent` directly, with no clamping to the
available inline-size. CSS shrink-to-fit per CSS Sizing 3 §10.3.5 is:

```
shrinkToFit(available) = min(maxContent, max(minContent, available))
```

I.e., the inline-block should not exceed the available width — and if its
max-content does, it should clamp to `max(minContent, available)`.

**User-visible effect:** an inline-block whose content is wider than its
containing block will overflow horizontally (its `inlineSize` exceeds
the container's). Floats already clamp correctly (see `bfc.ts` float
branch); only inline-blocks have this divergence.

**Test that documents the current behavior:** see "content wider than
container — does NOT clamp (current v1 behavior)" in
`intrinsic-sizing.test.ts`.

**Fix scope:** small — change `inlineSizePx = intrinsic.maxContent;`
to use the shrink-to-fit formula. Need to also expose `intrinsic.minContent`
(already computed by `computeIntrinsicSizes`).

**Priority:** medium. Affects layouts with long unbreakable inline-block
content. Plan 4 (text & typography) is a natural home; or a focused
followup commit. Not on the Plan 3.K perf critical path.

## Inherited still-unresolved

(Same as Plan 3.I followups. Plan 3.K.2 closed F3I.4, F4.1, F3H.1,
F3H.2 in code; the remaining followups are unchanged.)

## Going into Plan 3 closure

Plan 3.J is the final phase of Plan 3 by the original decomposition.
Remaining work in Plan 3.K:
- 3.K.2 Tasks 1-3 shipped; total per-keystroke / per-cursor-move work
  is now O(local-edit) via three coupled fixes (paint cache wiring +
  root short-circuit; renderTreeIncremental; renderNodesLayoutEquivalent
  reuse gate).
- 3.K.2 Task 4 (re-measurement at 100p / 500p / 1K to validate the
  predicted O(1) targets are met) is deferred at user request — pending
  user greenlight to run the dev server again.

After 3.K.2 Task 4 lands, Plan 3 is complete and the project moves to
Plans 4-8 (text & typography, pagination, visual chrome, positioning,
word-processor primitives) under the original 6-plan decomposition.
