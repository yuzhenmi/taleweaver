# Plan 3 — Retrospective After 3.A + 3.B; Revisions to Roadmap

**Date:** 2026-04-29
**Branch:** `feature/dom-architecture-redesign`
**Phases shipped:** 3.A (logical axes, 12 tasks) + 3.B (value resolution, 11 tasks)
**Phases drafted:** 3.C (TextShaper expansion, 10 tasks)

This document is a self-critique of what we built, the design flaws we
introduced or carried forward, and a revised roadmap that pulls fix-it tasks
forward instead of leaving them to drift in followups indefinitely.

The goal: don't accumulate the kind of "we know it's broken but it'll never
get fixed" debt that Plan 1's followups risk becoming. Each design problem
identified below has an owner phase or a new explicit task.

---

## 1. What worked well

- **Logical-axis abstraction landed cleanly.** The Style schema is now
  logical-only end-to-end. RTL physical mapping works at the document level.
  The seam to vertical writing modes (Plan 4) is small.
- **Value-resolution pipeline is correct.** `Length → ComputedLength →
  UsedLength` is the right CSS-faithful shape. `lengthToPx` casts (F5.1)
  and the em-fallback hack (F7.6) are gone.
- **Subagent-driven development scaled** — 23 implementation tasks across
  two phases, each with its own commit. Reviews caught at least one real
  semantic bug (outer-factory writing-mode mistake in 3.A Task 6).
- **Worktree discipline held** — no subagent drifted to main checkout.
- **Test suite stayed green** at every phase boundary; never had to roll
  back.

---

## 2. Design flaws introduced or carried forward

These are issues that will compound if not fixed. Don't leave them in
followups indefinitely — wire fix-it tasks into upcoming phases.

### D1 — `containingInlineSize` factory parameter has wrong default

**Where:** `packages/core/src/layout/layout-box-v2.ts`, all 9 factories.

**The problem:** The parameter is `containingInlineSize?: number` defaulting
to `?? inlineSize` (commit `08eadff`). For LTR this is correct (LTR ignores
`containingInlineSize`). For RTL, the default produces
`x = inlineSize - inlineOffset - inlineSize = -inlineOffset` — meaningless.
Currently every call site in BFC/IFC/Table FC passes an explicit value, so
the bug is dormant. But the type system doesn't enforce it; a future
caller could forget and silently break RTL.

**Why dormant ≠ acceptable:** the engine WILL gain new factory call sites
in Plans 3.D-3.J (intrinsic sizing, anonymous boxes, fragmenter). Each one
is a chance to forget. Asymmetry between "works in LTR test, broken in RTL"
is the worst kind of bug.

**Fix:** drop the default. Make `containingInlineSize: number` required.
Compiler errors at every call site; we visit each and pass the right value
explicitly.

**New task:** **insert as Plan 3.D Task 0 (prerequisite)** — drop the
default before any new factory call sites are added.

---

### D2 — `usedStyle.blockSize === 0` for `auto`-sized boxes is misleading

**Where:** `packages/core/src/layout/used-style.ts:computeUsedStyle`,
default `fallbackForAutoBlockSize = 0`.

**The problem:** When a block has `block-size: auto`, `computeUsedStyle`
produces `usedStyle.blockSize = 0`. The BFC then OVERRIDES the box's
physical `height` from the post-layout content extent (`childLayout.height`),
but `usedStyle.blockSize` STAYS 0. Painter reads `box.usedStyle.blockSize`
and gets 0; falls back to `box.height` (physical-derived). It works but
the contract is muddy: the value of `usedStyle.blockSize` is sometimes
authoritative (when blockSize was explicit) and sometimes not (when it
was auto).

**Why this matters:** any consumer that reads `usedStyle.blockSize`
expecting truth will get wrong answers for the `auto` case. Today the
painter knows to fall back; future consumers (incremental layout's
sub-tree reuse check; intrinsic sizing) won't necessarily.

**Fix options:**
- **(a)** Two-phase UsedStyle. The factory takes a "pre-layout UsedStyle"
  (with placeholders for content-derived values) and produces a "post-
  layout UsedStyle" (filled in from actual post-layout dimensions) before
  freezing the LayoutBox. The output `usedStyle` is always authoritative.
- **(b)** Remove `inlineSize` and `blockSize` from `UsedStyle` entirely
  and expose only `box.inlineSize`/`box.blockSize` (the layout-derived
  numeric fields, already on `LayoutBoxBase`). `UsedStyle` then only
  carries fields that resolve at cascade-or-layout-time without needing
  layout output (margins, padding, borders, sizing keywords pre-resolution).

**Recommendation:** **(b)**. Drop `inlineSize`/`blockSize`/`min*`/`max*`
from `UsedStyle`. Painter and consumers read sizes from the LayoutBox's
own `inlineSize`/`blockSize` fields (which are already there and always
authoritative). `UsedStyle` becomes a leaner type that holds resolved
margins/padding/borders/typography only.

**New task:** **insert as Plan 3.D Task 1** — refactor `UsedStyle` to drop
the layout-derived sizing fields. Painter and other consumers updated to
read from LayoutBox.

---

### D3 — Block-axis percent resolution against inline-size is wrong

**Where:** `packages/core/src/layout/used-style.ts:computeUsedStyle`.

**The problem:** Block-axis percents (e.g., `paddingBlockStart: 10%`)
should resolve against the containing block's BLOCK-axis size per CSS.
We resolve against `containingInlineSize`. For most documents, this
doesn't matter (percent block-axis values are rare). But it's wrong.

**Fix:** Plan 3.D refines `computeUsedStyle` to take `containingBlockSize`
as a separate parameter. When the containing block has `auto` block-size
(common), the percent resolves to `auto` per CSS — implementations vary
on what that means; we'll choose: treat as 0 for now and document the
limitation.

**New task:** **insert as Plan 3.D Task 2** — add `containingBlockSize`
parameter to `computeUsedStyle`; resolve block-axis percents correctly.

---

### D4 — Marker-box writing-mode asymmetry is hard to read

**Where:** `packages/core/src/layout/bfc.ts`, the 5 factory call sites
inside `layoutBlock`.

**The problem:** The outer-return `createBlockBox` (creating THIS node's
own box) uses function-param `writingMode`/`direction`. The inner
`createMarkerBox` and inner-block `createBlockBox` use `cs.writingMode`/
`cs.direction`. The reasoning is correct (the outer box's containing
block is the parent; inner boxes' containing block is THIS node) but
reading the code requires holding both rules in your head.

**Fix:** introduce a `LayoutContext` value passed down through layout that
contains `writingMode`, `direction`, and `containingInlineSize`. The
factory takes the context object instead of three separate params. Each
recursion explicitly creates a child context: `const childCtx = makeChildContext(ctx, cs, contentInlineSize);`. Confusion goes away because there's
only one rule: the factory takes a context; the caller decides which
context to pass.

**New task:** **insert as Plan 3.D Task 3** — refactor BFC/IFC/Table FC
to thread a `LayoutContext` instead of three separate params. Same
behavior, clearer contract.

---

### D5 — Editor utilities don't read computedStyle at all (verified gap)

**Where:** `packages/core/src/editor/cursor-position.ts`, `hit-test.ts`,
`selection-geometry.ts`, `layout-utils.ts`, `line-navigation.ts`.

**The discovery (Plan 3.B Task 11):** these files contain ZERO reads of
`box.computedStyle.X` for any property. They only use
`box.x/y/width/height`.

**Why this is a problem:** cursor positioning for sub/super-script needs
font baseline. Hit-test inside a tall line needs to know whether the
click is on the cap-height or the descender. Selection geometry over
inline-block needs to know vertical-align. None of this is currently
correct because the utilities never consult font metrics.

**Why it works today:** the IFC pre-positions everything within line
boxes, so `box.x/y/width/height` gives the right rectangle. But "right
rectangle for the cluster" doesn't equal "right cursor position within
the cluster" or "right baseline for hit-test."

**Fix:** Plan 3.G (line-stable IFC) + Plan 3.C (TextShaper) need to flow
font-metric data (ascent, descent, baseline) into LayoutBox. Cursor
positioning and hit-test then consume it.

**Risk:** punting this until Plan 3.G defers a real correctness gap.
Mitigation: cursor positioning is currently "good enough" for ASCII
sans-serif text but breaks down for unusual fonts, super/subscript,
ligatures.

**New task:** **track explicitly in Plan 3.C exit criteria** — when
`ShapedRun.{ascent, descent}` is on every cluster, cursor-position and
hit-test must be updated to use them. Add to Plan 3.C Task 10 (smoke
test) or a new Task 11.

---

### D6 — Schema gaps still missing

**Where:** `packages/core/src/styles/style.ts`.

Missing: `widows`, `orphans`, `text-align`, `text-indent`, `text-wrap`,
`hyphens`, `letter-spacing`, `word-spacing`, full `text-decoration` (line,
style, color, thickness, skip-ink), `text-transform`, `font-feature-settings`.

**Risk:** adding them later means revisiting every Style/ComputedStyle/
UsedStyle declaration, INITIAL_COMPUTED_STYLE, and PROPERTY_META — same
multi-file pattern we just spent two phases setting up.

**Fix:** add the schema reservations in Plan 3.C (TextShaper expansion
already needs `text-wrap` and `hyphens` interface reservations per spec
§9.7-9.8). Bundle the rest of the typography schema additions there too,
even if their values aren't yet consumed. The schema being complete keeps
INITIAL_COMPUTED_STYLE and PROPERTY_META in their final shape — no churn
later.

**New task:** **insert as Plan 3.C Task 0** — schema additions for
typography + pagination properties. Reserve values; provide initials.
Consumed by later phases.

Properties to reserve (all initial values, no consumers yet):
- `widows: number` (initial: 2)
- `orphans: number` (initial: 2)
- `textAlign: "start" | "end" | "center" | "justify"` (initial: "start")
- `textIndent: ComputedLength` (initial: 0)
- `textWrap: "wrap" | "nowrap" | "balance" | "pretty" | "stable"` (initial: "wrap")
- `hyphens: "none" | "manual" | "auto"` (initial: "manual")
- `letterSpacing: ComputedLength | "normal"` (initial: "normal")
- `wordSpacing: ComputedLength | "normal"` (initial: "normal")
- `textTransform: "none" | "capitalize" | "uppercase" | "lowercase"` (initial: "none")
- `fontFeatureSettings: string[]` (initial: [])
- `tabSize: number` (initial: 4) — for word-processor tab stops in Plan 8

---

### D7 — Defensive `as unknown as Length` cast in `resolveFontSize`

**Where:** `packages/core/src/cascade/cascade-pass.ts:~102`.

**The problem:** Defensive code that probably never executes (since
`fontSize` is typed `number` in ComputedStyle by the time the function
runs). Type-unsafe.

**Fix:** Replace with a typed `assertNumber(cs.fontSize)` helper that
throws on unexpected input, or simplify to `cs.fontSize` direct access
(trusting the type).

**New task:** **insert as Plan 3.D Task 4** (small cleanup) — drop the
defensive cast, simplify `resolveFontSize`.

---

### D8 — Factory body duplication is no longer "premature"

**Where:** `packages/core/src/layout/layout-box-v2.ts`, 9 factories.

**The problem:** 9 factory bodies with ~10 lines of nearly identical
boilerplate. Plan 3.A justified this on YAGNI grounds. After Plan 3.B
added a `usedStyle` parameter to all 9, the duplication grew.

**Risk:** Plan 3.D may add `containingBlockSize` or other parameters,
extending the duplication further. Plan 3.E may add anonymous-box
factories. Plan 3.G may add fragmentation-related factory variants.

**Fix:** introduce a `createBoxBase` helper that takes the shared params
and produces the shared fields. Each factory invokes it then adds
type-specific fields. Reduces 9 × 10 = 90 lines of boilerplate to ~20
lines of helper + 9 × 3 lines of factory glue.

**New task:** **insert as Plan 3.D Task 5** — refactor LayoutBox factories
to use a shared base helper.

---

### D9 — `computedStylesEqual` casts for shallow iteration

**Where:** `packages/core/src/cascade/cascade-pass.ts:~191`.

**The problem:** `as unknown as Record<string, unknown>` cast to iterate
over properties for shallow equality. Type-unsafe.

**Fix:** define a typed property-key list and write the equality as an
explicit per-property comparison. ~50 lines but type-safe and faster
(no Object.keys allocation).

**New task:** **insert as Plan 3.H Task X** (incremental machinery) —
when revisiting incremental cascade for subtree-granularity reuse,
replace the cast-based iteration with typed comparison.

---

### D10 — Subagent dispatch friction patterns

**Observed across 23 dispatches:**

- Outer vs inner factory parameter confusion (caught by review, fixed in
  follow-up commit).
- Unused-import warnings introduced and fixed in separate commits (3-4
  occurrences across 3.A and 3.B).
- One subagent reported "DONE" with the build failing in expected
  downstream files; review didn't catch it because the failure was
  expected per spec.
- Subagents occasionally combined adjacent tasks beyond their scope (e.g.,
  Task 4 implementer also touched compose.test.ts).

**Fix:** subagent dispatch prompts in upcoming phases should include:
- An EXPLICIT "do NOT touch" file list (e.g., "do NOT modify ifc.ts in
  this task").
- A "verify no new unused imports" sub-step before commit.
- A "report failing build error count and confirm it's expected per
  task spec" check.

**New task:** **update the implementer-prompt template** in
`/Users/hansyu/.claude/plugins/cache/claude-plugins-official/superpowers/`
... wait, that's a global skill. We can't modify it for this project.

**Alternative:** **bake these guards into each task's prompt** for Plans
3.C-3.J. Add a "Self-Review BEFORE commit" section to every task with
the unused-imports check.

---

### D11 — Test design gap: percent / em / auto resolution end-to-end

**The problem:** Most tests verify positions and structure. Few tests
verify SPECIFIC styling values flow through cascade → layout → painter
correctly. We added one smoke test for percent (Plan 3.B Task 11) but it's
isolated.

**Fix:** add a "value-resolution pipeline" integration test suite that
verifies for each interesting value form:
- `em` cascade resolution against parent's font-size
- `percent` layout resolution against containing-block inline-size
- `auto` margin/padding resolution
- `inherit`/`initial`/`unset`/`revert` keywords (when added in a future plan)
- Mixed-direction inheritance (paragraph with explicit `direction: rtl`
  inside an LTR document)

**New task:** **insert as Plan 3.J Task X** (test cleanup) — add a
dedicated value-resolution-pipeline test suite covering each form.

---

## 3. Things working well that should NOT change

- **Spec → plan-doc → subagent-task-prompt cadence.** It scaled. Don't
  refactor this loop.
- **One commit per task.** Easy to bisect, easy to review individually.
- **Followups doc per phase.** Clear paper-trail for everything that
  didn't make it.
- **Pre-flight check + worktree discipline.** Caught zero subagent drift
  to main. Continue verbatim.
- **Style schema explicit interface (vs Required<Style>).** Tighter typing
  pays off; build catches mismatches early.

---

## 4. Things to do DIFFERENTLY in upcoming phases

### Plan-doc length

Plan 3.A's plan was 1879 lines. Plan 3.B was 1233. Plan 3.C is 582.
The trend is healthy. Aim for 500-800 lines per plan. Less hand-holding
of mechanical steps; more focus on architectural intent. Subagents can
fill in the small steps from context.

### Plan-doc structure

Move the "rename table" pattern from inline-per-task to a shared appendix
referenced by multiple tasks. Less duplication.

### Spec compliance reviews

User cancelled the spec compliance reviewer dispatch in Plan 3.A Task 8
("/exit") — implicit signal that the per-task two-stage review is too
much overhead for mechanical tasks. Going forward:

- For purely mechanical tasks (rename, file-shape change): SKIP the
  separate spec compliance review. The implementer's self-check + the
  verify-build-passes step IS the spec compliance check.
- For tasks involving design judgment (e.g., new helpers, refactors):
  KEEP the two-stage review.
- For the LAST task in a phase: KEEP the full review since it gates the
  phase exit criteria.

### Tests-must-pass discipline

A few times we saw tests pass at vitest level but the build was failing
(strict mode unused-imports). Make `npm run build` and `npm test` BOTH
required gates per task — codify this in the task prompts.

### Schema additions ahead of consumers

Per D6: bundle schema additions in the EARLIEST phase that needs even
ONE of them. This avoids 5 separate phases each tweaking the schema.

---

## 5. Revised roadmap

### Plan 3.C — TextShaper expansion (REVISED)

Add **Task 0**: schema additions for typography + pagination (per D6).

Add to Task 10 exit criteria: cursor-position / hit-test consume font
metrics from ShapedRun (per D5 — at minimum, ensure baseline-aware
positioning works for sub/super-script).

Existing 10 tasks unchanged in shape; tighten dispatch prompts per D10.

**Total:** 11 tasks (Task 0 + 10 existing).

### Plan 3.D — Multi-pass intrinsic sizing (REVISED)

Insert at the front:
- **Task 0**: drop `containingInlineSize` factory default; require it (per D1).
- **Task 1**: refactor `UsedStyle` to drop layout-derived sizing fields (per D2).
- **Task 2**: add `containingBlockSize` parameter to `computeUsedStyle` for block-axis percents (per D3).
- **Task 3**: introduce `LayoutContext` value to thread writing-mode + direction + containing-block sizes through FC algorithms (per D4).
- **Task 4**: drop the defensive `as unknown as Length` cast in `resolveFontSize` (per D7).
- **Task 5**: refactor LayoutBox factories with shared base helper (per D8).

THEN the original Plan 3.D scope (intrinsic sizing two-traversal,
min-content/max-content/fit-content, per-render-node cache, BFC/IFC/Table
FC integration).

**Total:** 6 architectural cleanup tasks + ~7 intrinsic-sizing tasks = 13.

### Plan 3.E onward

No structural changes; the cleanup is largely upstream. Plan 3.E
(anonymous boxes), 3.F (real floats), 3.G (line-stable IFC), 3.H
(incremental), 3.I (paint), 3.J (test cleanup) keep their scope.

Plan 3.H gets one addition:
- Replace `computedStylesEqual` cast-based iteration with typed comparison (per D9).

Plan 3.J gets one addition:
- Value-resolution-pipeline test suite (per D11).

### Plan 4-8

Unchanged.

---

## 6. The honest summary

We shipped 3.A and 3.B cleanly — tests green, build clean, dev server
boots. The architectural shape is right.

The bad bits we introduced:
- Two factory-API issues (D1, D8) that risk cascading into later phases.
- A muddy contract on `UsedStyle.blockSize` (D2) that needs cleaning before
  intrinsic sizing makes it worse.
- Confusing dual-rule for which writing-mode value goes into which factory
  call (D4).
- Two type-unsafe casts (D7, D9) we live with for now.

The bad bits we let slide:
- Editor utilities never read computedStyle (D5) — known gap; deferred.
- Schema gaps for typography (D6) — deferring would multiply the cost
  later, so we're pulling it forward into 3.C.

The plan revisions above pull each fix-it task into a specific upcoming
phase. None of them remain as "followup" — they're all on the work
schedule with an owner phase.
