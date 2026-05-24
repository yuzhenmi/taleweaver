# Virtualized Layout — Phase 1 Implementation Plan

> **For agentic workers:** Execute task-by-task with a code-reviewer gate after
> each (per CLAUDE.md principle 3). Steps use `- [ ]`. TDD throughout: write the
> failing test first.

**Goal:** Extract the page-break/fragmentation DECISION logic out of
`bfc.ts`/`ifc.ts`/`table-fc.ts` into a pure `fit-core.ts`, then build a
`measurePass` that computes a `PagePlan` (page boundaries, offsets, resume
tokens, list-counters) allocation-free — and prove it EXACTLY matches the
current positioned-tree boundaries. No consumer changes; the positioned tree
remains the live output. This de-risks the pagination arithmetic in isolation.

**Architecture:** see `docs/superpowers/specs/2026-05-24-virtualized-layout-design.md`
(reviewer-approved). The decision logic becomes a single source of truth called
by both real layout (decide → position boxes) and the measure pass (decide →
boundaries only).

**Tech stack:** TypeScript, vitest, `packages/core`.

**Decision-site map (authoritative source ranges to extract):** the explorer
mapped every break decision with file:line refs — bfc.ts list-counter seed
(268–278), margin collapse + §5.4 truncation (459–484), break-before (517–527),
child fragmentation threading (536–543), §C.6 `applyOverflowRule` (559–567 +
call sites 577/596/628/653), whole-block fit (626–642), break-inside:avoid
(648–665), break-after (711–724), float/clear (398–457, OUT OF SCOPE); ifc.ts
fit-loop (883–893), orphans (900–904), widows (909–916), hyphen back-off
(924–930), IFCBreakToken emit (995); table-fc row fit (~374–404). Keep this
plan open alongside those files.

**Scope guard:** touch ONLY the `fragmentation !== undefined` branches. Never
alter the `fragmentation === undefined` (non-paginated) codepaths. Float/`clear`
docs are out of scope (Task 7 routes them to the legacy path).

**Two corrections from plan review (must hold throughout):**
- **No table header-repeat.** The engine has NO thead/header-repeat feature
  (verified in `table-fc.ts`). `fitRowsInTable(rowBlockSizes, remainingBlockSize,
  startRow)` — no `headerBlockSize`. Do not model or test one.
- **`BlockFitMeta` is RECURSIVE** (mirrors the block tree). A container block
  (list, blockquote, nested BFC) carries `children: readonly BlockFitMeta[]`;
  leaves carry ifc `lineBlockSizes` or table `rowBlockSizes`. `fitOnePage`
  recurses into `children` exactly as `bfc.layoutBlock` recurses, producing the
  recursive `BlockBreakToken.resumeChildToken`. A flat top-level model CANNOT
  reproduce a nested container fragmenting across a page (e.g. a list crossing a
  boundary) — common in real docs.

---

### Task 1: `fit-core.ts` types + signatures (no logic yet)

**Files:**
- Create: `packages/core/src/layout/fit-core.ts`
- Test: `packages/core/src/layout/__tests__/fit-core.test.ts`

- [ ] **Step 1:** Define the RECURSIVE `BlockFitMeta` (exactly the spec's
  interface: `children?: readonly BlockFitMeta[]` for container blocks;
  `lineBlockSizes`/`orphans`/`widows`/`lineEndsWithHyphen` for ifc leaves;
  `rowBlockSizes` for table leaves; NO `headerBlockSize`), and the pure
  signatures. Reuse `BreakToken` from `fragmentation.ts`.
  `fitLinesInIFC(lineBlockSizes, lineEndsWithHyphen, orphans, widows,
  remainingBlockSize, startLine) -> { placedLineCount; resumeAtLine | null }`.
  `fitRowsInTable(rowBlockSizes, remainingBlockSize, startRow) ->
  { placedRowCount; resumeAtRow | null }`. `fitOnePage(metas, startIndex,
  resumeInto, pageContentBlockSize, listCounterAtStart, rootHasTopBoundary) ->
  { childrenCount; resumeOut; listCounterAtEnd }` — internally recurses into a
  container child's `children` (mirroring `bfc.layoutBlock`) to produce nested
  `resumeChildToken`s.
- [ ] **Step 2:** Stub bodies `throw new Error("not implemented")`. Build:
  `npm run build --workspace=packages/core`. Expected: clean.
- [ ] **Step 3:** Commit-gate: reviewer (types-only).

### Task 2: `fitLinesInIFC` — extract IFC D.1–D.4

**Files:**
- Modify: `packages/core/src/layout/fit-core.ts`
- Test: `packages/core/src/layout/__tests__/fit-core.test.ts`

- [ ] **Step 1 (failing test):** Port representative cases from
  `ifc-fragmentation.test.ts` (greedy fit, orphans push-whole, widows back-off,
  hyphen back-off, resume-at-line) as DIRECT assertions on `fitLinesInIFC` over
  hand-built `lineBlockSizes` arrays. Include the currently-skipped hyphen case.
- [ ] **Step 2:** Implement `fitLinesInIFC` as a faithful port of ifc.ts
  883–930: greedy loop on the suffix from `startLine` against `remainingBlockSize`;
  orphans (`placedLineCount < orphans` ⇒ push whole, resumeAtLine = startLine);
  widows back-off loop; hyphen back-off loop; re-check orphans after each
  back-off. Return `resumeAtLine = startLine + placedLineCount` (or null if all
  remaining lines placed).
- [ ] **Step 3:** Run the test; iterate to green.
- [ ] **Step 4:** Reviewer gate.

### Task 3: `fitRowsInTable` — extract table row fit

**Files:** as Task 2.

- [ ] **Step 1 (failing test):** Port `table-fc-fragmentation.test.ts` row-split
  + resume cases as direct `fitRowsInTable` assertions. (No header-repeat case —
  the feature does not exist.)
- [ ] **Step 2:** Implement faithful port of table-fc ~374–404 (place body rows
  up to remaining; emit resumeAtRow). No header logic.
- [ ] **Step 3:** Green. **Step 4:** Reviewer gate.

> **Refinement (2026-05-24, after reading bfc.ts 240–739):** Two changes to how
> Task 4 is built, learned from the code:
> 1. **Oracle-driven, not hand-computed expectations.** `fitOnePage` reimplements
>    ~470 lines of interacting bfc decisions; manually computing expected
>    `childrenCount`/`resumeOut` per fixture is error-prone. Instead build the
>    **Task-8 equivalence harness FIRST** (run real `paginateRoot`, extract page
>    boundaries) and use REAL bfc output as the oracle that drives `fitOnePage`'s
>    TDD across 4a→4b→4c. Real layout is the ground truth; the harness is the
>    failing test. (Task 8 then becomes the comprehensive fixture sweep, not the
>    first proof.) The Task-5 pre-refactor paginated snapshot remains the anchor
>    that guards against bfc itself changing.
> 2. **list-counter is pass-through, not a boundary input.** Ordered-list
>    numbering affects only rendered marker TEXT, never where pages break. So
>    `fitOnePage` does not need it to decide boundaries; `measurePass` computes
>    `listCounterAtStart` per page separately (a simple running count of
>    `display:list-item` blocks consumed) for `getPage` to seed. Keep
>    `listCounterAtStart` in `PagePlanEntry`; drop it from `fitOnePage`'s
>    decision logic.
> 3. **Task 5 scope (confirmed leaf-only for v1).** Routing bfc's BLOCK-level
>    packing through `fitOnePage` would require inverting bfc into
>    measure-then-position (large, risky). Phase 1 routes only the LEAF decisions
>    (ifc → `fitLinesInIFC`, table → `fitRowsInTable`) through the shared core;
>    the block-level packing is reproduced in `fitOnePage` and kept consistent
>    with bfc via the equivalence harness + snapshot anchor (the co-drift posture
>    the plan review already accepted under I2/I3). Full unification of
>    block-level packing is a later refactor, once the measure pass is proven.

### Task 4a: `fitOnePage` — block packing (margins, collapse, §5.4, list-counter)

**Files:** as Task 2.

- [ ] **Step 1 (failing test):** `BlockFitMeta[]` fixtures asserting `fitOnePage`
  reproduces, for one page of leaf blocks only (no break-* yet, no fragmentation):
  childrenCount, listCounterAtEnd, and that the running offset matches — for:
  adjacent-sibling margin collapse (`max(prevEnd, nextStart)`), §5.4
  first-on-fragment top-margin truncation, `rootHasTopBoundary=false` first-child
  suppression (only when `startIndex===0 && resumeInto===null`), ordered-list
  counter accumulation (incl. nested list-item via a container meta).
- [ ] **Step 2:** Implement the block-walk skeleton of bfc.ts 251–278 + 459–484:
  parse resumeInto, seed/accumulate list counter (recursing into container
  children), accumulate running in-page offset with collapse/truncation/
  suppression. Leaf fit only (no break props / no fragmentation yet — those are 4b/4c).
- [ ] **Step 3:** Green. **Step 4:** Reviewer gate.

### Task 4b: `fitOnePage` — break-before/after/inside + §C.6 overflow

**Files:** as Task 2.

- [ ] **Step 1 (failing test):** Fixtures asserting resumeOut + childrenCount for:
  break-before:page (mid-page), break-after:page, break-inside:avoid (discard
  partial → push whole), and ALL FOUR §C.6 overflow sites — (i) whole-block
  too-tall first-on-fragment consumed whole; (ii) break-inside:avoid block that
  is empty-fragment → overflow-consume-whole (bfc.ts:654). Cover first-on-fragment
  (`childrenCount===0`) vs non-empty fragment branches.
- [ ] **Step 2:** Implement bfc.ts 517–527 (break-before), 711–724 (break-after),
  648–665 (break-inside:avoid), and §C.6 (559–567 + sites 577/598/630/654):
  first-on-fragment non-fitting ⇒ consume whole + overflow; non-empty fragment ⇒
  emit `BlockBreakToken{resumeChildIndex, resumeChildToken:null}`.
- [ ] **Step 3:** Green. **Step 4:** Reviewer gate.

### Task 4c: `fitOnePage` — recursion + ifc/table leaf delegation + resumeOut threading

**Files:** as Task 2.

- [ ] **Step 1 (failing test):** Fixtures asserting nested `resumeChildToken`:
  (i) an ifc leaf child that fragments → `{block, resumeChildIndex,
  resumeChildToken:{ifc, resumeAtLine}}`; (ii) a table leaf child → nested
  `{table, resumeAtRow}`; (iii) a **container block child** (nested BFC) that
  itself fragments → `{block, resumeChildIndex, resumeChildToken:{block, ...}}`
  (recursive). Each with `remaining = pageContentBlockSize − runningOffset`.
- [ ] **Step 2:** Wire `fitOnePage` to delegate: ifc leaf → `fitLinesInIFC`;
  table leaf → `fitRowsInTable`; container block → RECURSE `fitOnePage`-equivalent
  over the child's `children` with the child's reduced remaining space, mirroring
  bfc.ts 536–543 (child fragmentation threading) + 593–673 (nested token build).
  Thread the final `resumeOut` up. **The recursive container call MUST also
  thread `listCounterAtEnd` out**, so an ordered list that fragments across a
  page continues its numbering correctly on the next page (the ordered-list
  spanning fixture in Task 8 guards this).
- [ ] **Step 3:** Green. **Step 4:** Reviewer gate.

### Task 5: Refactor bfc/ifc/table-fc to call the fit-core (single source of truth)

**Files:**
- Modify: `packages/core/src/layout/bfc.ts`, `ifc.ts`, `table-fc.ts`
- Test: existing `__tests__/*-fragmentation.test.ts` + new non-paginated guard.

- [ ] **Step 1 (failing/guard tests):** Capture TWO ground-truth snapshots of
  the CURRENT (pre-refactor) output and assert deep-equality after the refactor:
  (a) the NON-paginated `layoutTree(...)` output (guards the untouched path);
  (b) the PAGINATED `paginateRoot`/`layoutTreeIncremental` positioned tree
  (children slices, box offsets/sizes, break tokens) on the Task-8 fixture set
  (guards that the refactored paginated DECISION path stays byte-identical).
  Snapshot (b) is the pre-refactor anchor that Task 8 relies on (see I3).
- [ ] **Step 2:** In the `fragmentation !== undefined` branches ONLY, replace the
  inline break-decision arithmetic with calls to `fitLinesInIFC` /
  `fitRowsInTable` / the relevant `fitOnePage` sub-decisions, then position boxes
  per the returned counts/tokens. The `fragmentation === undefined` branches are
  untouched. Goal: real layout and the measure pass now share the decision code.
- [ ] **Step 3:** Run ALL of `packages/core` tests — every existing fragmentation
  + pagination + incremental test must pass unchanged, plus the non-paginated
  guard. Iterate to green.
- [ ] **Step 4:** Reviewer gate (this is the highest-risk task — emphasize
  behavior-equivalence in the review prompt).

### Task 6: `buildBlockFitMetas`

**Files:**
- Create: `packages/core/src/layout/build-fit-metas.ts` (+ test)

- [ ] **Step 1 (failing test):** Assert metas built from a cascaded+laid-out doc
  carry correct `totalBlockSize`, margins, break props, `lineBlockSizes`,
  `lineEndsWithHyphen`, `orphans`/`widows`, table row sizes, `listItem`.
- [ ] **Step 2:** Implement: read each top-level child's cached intrinsic
  `BlockBox` (line box heights → `lineBlockSizes`; `endsWithHyphenContinuation`
  per line → `lineEndsWithHyphen`); computed style → margins/breaks/orphans/
  widows/`listItem`. Refresh only `dirtyIds`; reuse `prevMetas` otherwise.
- [ ] **Step 3:** Green. **Step 4:** Reviewer gate.

### Task 7: `measurePass` + float/clear fallback detection

**Files:**
- Create: `packages/core/src/layout/measure-pass.ts` (+ test)
- Modify: cascade rollup flag if needed for cheap float detection.

- [ ] **Step 1 (failing test):** Assert `measurePass(root.children, metas,
  pageConfig, rootHasTopBoundary)` returns a `PagePlan` with the right entry
  count, per-entry `blockOffset = pageIndex * (pageBlockSize + pageGap)`,
  `children` slices, `resumeInto`/`resumeOut`, `listCounterAtStart`, and
  `totalBlockSize` — on a small multi-page fixture.
- [ ] **Step 2:** Implement the page loop: repeatedly call `fitOnePage`,
  accumulate entries, advance startIndex/resumeInto from resumeOut, compute
  offsets + total height. Add `documentHasFloatOrClear(cascadedRoot)` reading a
  CHEAP rolled-up cascade flag (not a deep walk per keystroke) — returns true ⇒
  caller takes the legacy path.
- [ ] **Step 3:** Green. **Step 4:** Reviewer gate.

### Task 8: Equivalence test — plan == current positioned tree boundaries

**Files:**
- Test: `packages/core/src/integration/measure-pass-equivalence.test.ts`

- [ ] **Step 1:** For each fixture, run `paginateRoot` (positioned tree) and
  extract its per-page boundaries (children slices, page offsets, break tokens,
  ordered-list numbers). Run `measurePass` on the same cascaded root. Assert
  EXACT equality of: page count, per-page `children` (by ref), `blockOffset`,
  `resumeInto`/`resumeOut` (structural), `listCounterAtStart`, `totalBlockSize`.
  **Ground-truth note (I3):** after Task 5 both `measurePass` and `paginateRoot`
  call the SAME fit-core, so this test proves measure-vs-real CONSISTENCY, not
  correctness against original behavior. The correctness anchor is Task 5
  Step 1(b)'s pre-refactor paginated snapshot — keep that snapshot test in the
  suite so a co-drift of both consumers cannot pass silently.
- [ ] **Step 2 — fixtures (MUST include):** exactly-full pages; a paragraph
  spanning a boundary with non-default `orphans`/`widows`; hyphenation back-off
  at a boundary; a table spanning pages (body-row split, no header); an
  **ordered list spanning pages** (recursive `resumeChildToken` + cross-page
  list numbering); a **nested container (blockquote) spanning pages**; a forced
  `break-before` mid-page; a `break-inside: avoid` block that overflows in a
  NON-empty fragment (pushed whole) AND one that is first-on-fragment too-tall
  (§C.6 consume-whole, bfc.ts:654); and `rootHasTopBoundary` both true and false.
- [ ] **Step 3:** Green across all fixtures. This is the Phase-1 acceptance gate.
- [ ] **Step 4:** Final Phase-1 reviewer gate (whole-phase review).

---

## Done-when

All 8 tasks green + reviewer-approved; `measurePass` provably matches the
positioned tree on the fixture set; no consumer changed; no non-paginated
behavior change. Phase 2 (`VirtualLayoutTree` + `getPage` + `materializeAll()`)
follows in its own plan.

## Notes for the executor

- TDD strictly; test geometry/values, not just structure.
- Task 5 is the risk concentrate — if real-layout tests drift, the extraction
  diverged from the original decision; fix the fit-core, don't loosen the test.
- Do NOT commit from implementer subagents; the controller reviews then commits
  (CLAUDE.md principle 3 + workflow).
- The `__twPerf` / `update()` instrumentation currently uncommitted in the
  working tree is useful for Phase 3 verification; leave it or fold it into a
  Phase-3 commit.
