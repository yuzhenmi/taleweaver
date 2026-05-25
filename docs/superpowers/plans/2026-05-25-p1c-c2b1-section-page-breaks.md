# P1.C.2b-1 — Section page breaks (uniform geometry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (one implementer per task; spec + quality review; controller commits). Steps use checkbox syntax.

**Goal:** Make a `section` block force a page break at its start, so each section begins on a
new page — WITHOUT touching `display: contents` transparency (sections still generate no box)
and WITHOUT per-section page geometry (every page keeps the doc-wide `PageConfig`; per-section
geometry is C.2b-2). After this, an explicit-section document paginates with a page break at each
section boundary; a section-less document paginates EXACTLY as today.

**Architecture:** Sections are `display: contents` → C.1a's `flattenContents` splices them OUT of
the child list the measure pass iterates, so the paginator can't see them. C.2b-1 adds a pure
**section-structure pre-pass** that walks the UNFLATTENED cascaded doc-root children and produces
a `SectionPlan` (ordered boundaries as indices into the FLATTENED child list). The measure pass
consumes the `SectionPlan` as an explicit input: it forces a page break before the flattened child
that begins a new section, and tags each `PagePlanEntry` with `activeSectionId` + `sectionPageIndex`
(for C.2c). The break is NOT encoded as a `breakBefore` meta flag (metas are `ElementBox`-ref-keyed
and section membership is not a block property — a `SECTION_BREAK` leaves body refs unchanged, so a
meta flag would stale-reuse). Instead the `SectionPlan` is carried on `PagePlan` and is an explicit
input to the incremental carry-forward reuse gate. Spec:
`docs/superpowers/specs/2026-05-25-p1c-c2-section-pagination-design.md` (§ "Central decision",
§ C.2b-1, § "Resolved during design review" item 2).

**Tech Stack:** TypeScript, vitest. All changes in `packages/core/src/layout/`.

## Key design facts (verified against the real code)
- `measurePass(metas, pageConfig, rootChildren?, prevPlan?)` (`measure-pass.ts`) runs a per-page
  loop; `startIndex` is the first FLATTENED child on each page; `fitOnePage(metas, startIndex,
  resumeInto, pageContentBlockSize, listCounterAtStart)` greedily fits children onto one page and
  returns `{ childrenCount, resumeOut, listCounterAtEnd }`.
- `virtual-producer.ts` calls `measurePass(metas, pageConfig, flattenContents(cascadedRoot.children),
  prevTree?.plan)`. The `metas` come from `buildBlockFitMetas(cascadedRoot, ...)` which uses
  `groupChildren` (also flattening). So `metas` and `rootChildren` are both the FLATTENED list,
  1:1 — the `SectionPlan` boundary indices must be into that same flattened list.
- The incremental carry-forward reuse gate (`canReusePage` + the reuse block in `measurePass`)
  reuses a prior page when `startIndex` matches, `resumeInto` is structurally equal, and the
  influencing children are reference-equal. A section break does NOT change those (bodies keep
  their refs) — hence the gate must additionally compare section-boundary status.

---

## File structure
- Create `packages/core/src/layout/section-plan.ts` — `SectionPlan` type + `buildSectionPlan` + `sectionStateAt`.
- Modify `packages/core/src/layout/fit-core.ts` — `fitOnePage` gains `stopBeforeIndex`.
- Modify `packages/core/src/layout/measure-pass.ts` — thread `SectionPlan`; force break; `PagePlanEntry`/`PagePlan` fields; reuse-gate.
- Modify `packages/core/src/layout/virtual-producer.ts` — build the `SectionPlan`, pass it.
- Tests alongside each.

---

## Task 1: `SectionPlan` type + section-structure pre-pass

**Files:** Create `packages/core/src/layout/section-plan.ts`; Modify
`packages/core/src/components/section.ts` (stamp the `{ blockType: "section" }` metadata marker —
C-1); Tests: `packages/core/src/layout/section-plan.test.ts` + a `section.test.ts` assertion for
the marker.

```typescript
import type { RenderNode, ElementBox } from "../render/render-node";
import { flattenContents } from "./group-children";

/** One section boundary: the section starts at flattened-child index `startFlattenedIndex`. */
export interface SectionBoundary {
  readonly startFlattenedIndex: number;
  /** The `section` block's id, or null for the implicit (section-less) leading section. */
  readonly sectionId: BlockId | null;
}
export interface SectionPlan {
  /** Ordered by startFlattenedIndex ascending; boundaries[0].startFlattenedIndex === 0 always. */
  readonly boundaries: readonly SectionBoundary[];
}

/** The active section + the next boundary at/after a flattened-child index. */
export interface SectionStateAt {
  readonly activeSectionId: BlockId | null;
  /** startFlattenedIndex of the next boundary strictly AFTER `index`, or null if none. */
  readonly nextBoundaryIndex: number | null;
}
```

- `buildSectionPlan(cascadedRoot: ElementBox): SectionPlan`: walk `cascadedRoot.children`
  (UNFLATTENED). Maintain a running `flattenedCount` (starts 0). For each child in order:
  - If `isSectionBox(child)` (see "Detecting a section" — a metadata marker, verified): open a
    boundary `{ startFlattenedIndex: flattenedCount, sectionId: child.key }` (push only if it
    doesn't coincide with an already-pushed boundary at the same index — DE-DUP), then add
    `flattenContents([child]).length` to `flattenedCount`.
  - Else: add `flattenContents([child]).length` to `flattenedCount` (normally 1; a non-section
    `display:contents` wrapper correctly expands — robustness from C.1a's recursive flatten).
  - **Implicit leading section:** if no boundary exists at index 0 after the walk (the first child
    is not a section), PREPEND `{ startFlattenedIndex: 0, sectionId: null }`. (A section-less doc
    yields exactly `[{0, null}]`.)
  - **De-dup coincident boundaries** (e.g. an empty section contributing 0 flattened children →
    its boundary index equals the next section's): **keep the LAST section opened at a given
    index** (its body, if any, belongs to it). `applySectionBreak` never produces empty sections,
    so this is defensive.
- **INVARIANT (I-2):** after `buildSectionPlan` completes, `boundaries` is sorted with STRICTLY
  increasing `startFlattenedIndex` — no two entries share an index (the de-dup guarantees this).
  This is what makes T2's `stopBeforeIndex > startIndex` assertion always hold: a page that starts
  at boundary B's index has `nextBoundaryIndex` = the strictly-greater next boundary (or null).
- Export `IMPLICIT_SECTION_PLAN: SectionPlan = { boundaries: [{ startFlattenedIndex: 0,
  sectionId: null }] }` — a single implicit section. Passed by `measurePass` callers that have no
  section structure (tests / equivalence oracle); forces NO breaks (no `nextBoundaryIndex` ever),
  reproducing today's pagination byte-identically. (I-1)
- `sectionStateAt(plan: SectionPlan, index: number): SectionStateAt`: binary-search `boundaries`
  for the last boundary with `startFlattenedIndex <= index` → its `sectionId` is `activeSectionId`;
  the next boundary's `startFlattenedIndex` (if any) is `nextBoundaryIndex`. O(log boundaries).

**Detecting a section (C-1 — DECIDED, metadata marker; keeps `buildSectionPlan` a pure function
of the cascaded tree, no state-threading ripple):** `ElementBox` already carries an optional
`metadata?: Readonly<Record<string, unknown>>` field, and `createElementBox(key, style, children,
metadata?)` accepts it (verified). So:
- **Modify the section component** (`packages/core/src/components/section.ts`, added to T1's
  files): its `render` stamps the marker —
  `createElementBox(view.id, { display: "contents" }, childRenderNodes, { blockType: "section" })`.
- `isSectionBox(node: RenderNode): boolean` (in section-plan.ts): `node.type === "element" &&
  node.metadata?.blockType === "section"`. `sectionId = node.key` (the section block id).
This is the ONLY new signal needed; `buildSectionPlan(cascadedRoot)` reads it from the cascaded
tree — NO predicate parameter, NO threading section ids through `buildVirtualPaginatedTree`/
`layoutTree`. (Add a section.test.ts assertion that the section component's ElementBox carries
`metadata.blockType === "section"`.)

- [ ] **Step 1: Write failing tests** (build cascaded ElementBox trees via the existing
  render→cascade harness used in `display-contents.test.ts`, or hand-built ElementBoxes with the
  section element marked): section-less doc → `[{0,null}]`; `[p1, section(a,b), p2]` → boundaries
  `[{0,null},{1,sec}]` (p1 at flat-index 0; section's body a,b start at flat-index 1); two sections
  `[section1(a), section2(b,c)]` → `[{0,sec1},{1,sec2}]`; `sectionStateAt` returns correct
  (activeSectionId, nextBoundaryIndex) for indices spanning + past the last boundary; nested
  `display:contents` inside a section body counts correctly (flattened length); empty section
  de-dup.
- [ ] **Step 2: Run, confirm fail.** Run: `npm test --workspace=packages/core -- --run section-plan`
- [ ] **Step 3: Implement** the metadata marker on `section.ts` + `isSectionBox` + `buildSectionPlan`
  + `sectionStateAt` + `IMPLICIT_SECTION_PLAN`.
- [ ] **Step 4: Run section-plan + section tests + `npm run build`** (the section.ts metadata change
  must not break C.1b's transparency tests — display:contents is unchanged; metadata is additive).
- [ ] **Step 5: Commit** (controller, post-review).

## Task 2: `fitOnePage` `stopBeforeIndex` (forced break before a child index)

**Files:** Modify `packages/core/src/layout/fit-core.ts`; Test: `packages/core/src/layout/fit-core.test.ts`.

`fitOnePage` gains an optional `stopBeforeIndex?: number` — an EXCLUSIVE upper bound on the child
index this page may place. When the fit would place the child at `stopBeforeIndex` (i.e. it has
fit `[startIndex, stopBeforeIndex)` and the next child would be `stopBeforeIndex`), it STOPS as if
that child had `breakBefore: "page"`: returns `childrenCount = stopBeforeIndex - startIndex`,
`resumeOut` = a top-level block token resuming at `stopBeforeIndex`, and the correct
`listCounterAtEnd` for the placed range. If the page fills (runs out of block-size) BEFORE reaching
`stopBeforeIndex`, behavior is unchanged. `stopBeforeIndex` omitted/`null`/`<= startIndex` → no cap
(current behavior). Model it on the EXISTING `breakBefore: "page"` forced-break path already in
`fitOnePage` (find it — the section cap is the same "stop before this child, resume there" shape,
just driven by a parameter instead of the child's meta).

Edge cases the implementer must handle: `stopBeforeIndex === startIndex` should not happen (the
measure pass only passes a boundary strictly greater than `startIndex` — assert/guard); a single
child taller than the page that is also the last before the boundary still resumes normally (the
cap only prevents STARTING the boundary child, it doesn't change mid-child fragmentation).

- [ ] **Step 1: Write failing tests:** metas `[a,b,c,d]` all one-line (fit many per page),
  `fitOnePage(metas, 0, null, bigBlockSize, 0, /*stopBeforeIndex*/ 2)` → `childrenCount === 2`,
  `resumeOut` is a block token resuming at index 2 (NOT null), correct `listCounterAtEnd`; with
  `stopBeforeIndex` larger than what fits by height, the height limit wins (cap not reached);
  `stopBeforeIndex` omitted → identical to today (regression). Mirror existing `breakBefore:page`
  fit-core tests.
- [ ] **Step 2: Run, confirm fail.** Run: `npm test --workspace=packages/core -- --run fit-core`
- [ ] **Step 3: Implement** (additive param; default preserves all existing callers).
- [ ] **Step 4: Run fit-core + measure-pass tests + `npm run build`** (measurePass calls fitOnePage
  without the new arg — confirm the default keeps it byte-identical; run the VL equivalence harness).
- [ ] **Step 5: Commit** (controller, post-review).

## Task 3: `measurePass` section-awareness + reuse gate + `virtual-producer` wiring

**Files:** Modify `packages/core/src/layout/measure-pass.ts`, `packages/core/src/layout/virtual-producer.ts`;
Test: `packages/core/src/layout/measure-pass.test.ts` (+ a section-pagination integration test).

Changes:
1. **`PagePlanEntry`** gains `readonly activeSectionId: BlockId | null;` and
   `readonly sectionPageIndex: number;` (0-based within the active section). Set both on BOTH the
   re-fit push and the reuse push.
2. **`PagePlan`** gains `readonly sectionPlan: SectionPlan;` — REQUIRED, not optional (I-4). Every
   plan `measurePass` produces carries it; within a session `prevPlan` is always same-version, so
   no "absent older plan" guard is needed.
3. **`measurePass` signature** gains the `SectionPlan`: `measurePass(metas, pageConfig, sectionPlan,
   rootChildren?, prevPlan?)`. Insert `sectionPlan` after `pageConfig`. **Update ALL SIX caller
   sites** (grep `measurePass(`; the TS build catches misses, but enumerate so none surprise you):
   `virtual-producer.ts` (production); `measure-pass.test.ts` (direct calls); the VL equivalence
   oracle `measure-pass-equivalence.test.ts` (~lines 148 + 302); **`measure-pass-incremental.test.ts`**
   (its `planFrom` helper ~line 96 + several direct calls); **`virtual-layout-tree.test.ts`** (its
   plan-building helper + ~4 direct calls). Callers without a section structure pass the exported
   `IMPLICIT_SECTION_PLAN` (I-1) — single boundary at index 0, `nextBoundaryIndex` always null ⇒ NO
   breaks ⇒ byte-identical to today.
4. **Force the break:** in the loop, before calling `fitOnePage`, compute
   `const st = sectionStateAt(sectionPlan, startIndex);` and pass `st.nextBoundaryIndex ?? undefined`
   as `fitOnePage`'s `stopBeforeIndex`. (The boundary at `startIndex` itself is the section this
   page BELONGS to — `activeSectionId = st.activeSectionId`; the cap is the NEXT boundary, which
   ends this section.) The "first boundary never breaks" rule falls out naturally: boundary 0 is at
   index 0 = the very first page's startIndex, never a `nextBoundaryIndex` for a prior page.
5. **`activeSectionId` / `sectionPageIndex` — single running pair (C-2/I-3 — the `resumeInto ===
   null` guard is WRONG; do NOT use it).** Maintain TWO loop variables updated on EVERY iteration
   (both the re-fit AND the reuse path): `currentActiveSectionId: BlockId | null` and
   `currentSectionPageIndex: number`. At the top of each page: compute `const activeSectionId =
   sectionStateAt(sectionPlan, startIndex).activeSectionId;` then — if `activeSectionId !==
   currentActiveSectionId` (section changed vs the previous page, OR first page) set
   `currentSectionPageIndex = 0`, else `currentSectionPageIndex += 1`; set `currentActiveSectionId
   = activeSectionId`. Stamp BOTH `activeSectionId` + `currentSectionPageIndex` on the entry. (Note:
   section 2's first page has `resumeInto !== null` — it resumes from the forced break at the
   boundary — so a `resumeInto === null` test would FAIL to reset there. The `activeSectionId`-change
   trigger is the only reliable signal.) The reuse path reads these SAME running vars (it must not
   copy the prior entry's `sectionPageIndex`, which is position-dependent).
6. **Reuse gate (the load-bearing correctness):** the prior-plan reuse is allowed at `startIndex`
   ONLY IF, in addition to the existing checks, the section-boundary status at `startIndex` is
   unchanged between `prevPlan.sectionPlan` and the current `sectionPlan`. Add to the reuse
   precondition (alongside `breakTokensEqual(reusable.resumeInto, resumeInto)` and `canReusePage`):
   `sectionStatesEqual(sectionStateAt(sectionPlan, startIndex), sectionStateAt(prevPlan.sectionPlan,
   startIndex))` where `sectionStatesEqual` compares `activeSectionId` AND `nextBoundaryIndex`.
   Rationale: `activeSectionId` unchanged ⇒ the page belongs to the same section; `nextBoundaryIndex`
   unchanged ⇒ the forced cap (`stopBeforeIndex`) that shaped the page is identical ⇒ the reused
   boundary is still valid. A `SECTION_BREAK` that inserts a boundary changes `nextBoundaryIndex`
   for the pages of the section it split (refit) while leaving earlier sections' pages' status
   unchanged (reuse) — preserving O(pages-in-and-after-the-changed-section). `prevPlan.sectionPlan`
   is always present (required field, I-4) so no absent-plan guard. The reuse push stamps
   `activeSectionId`/`sectionPageIndex` from the running vars (item 5), NOT the prior entry.
7. **`virtual-producer.ts`:** before `measurePass`, build the `SectionPlan` via
   `buildSectionPlan(cascadedRoot)` — NO extra params (sections self-identify via the
   `metadata.blockType === "section"` marker stamped by the section component, C-1). Pass the plan
   to `measurePass`. Thread `prevTree?.plan` as today (its `.sectionPlan` is now populated). NOTE:
   getPage / materialization needs NO change in C.2b-1 — the forced break is fully encoded in the
   plan's per-page `startIndex`/`children`; geometry stays uniform; `activeSectionId`/
   `sectionPageIndex` are carried for C.2c, not consumed by getPage yet.
8. **`maxPages` bound (M-2):** the existing `maxPages = metas.length * 2 + 2` bound REMAINS VALID —
   section breaks add at most one page per section, and section count ≤ metas.length (empty sections
   contribute 0 metas). No change; note it so the implementer doesn't second-guess.

- [ ] **Step 1: Write failing tests** (integration via the real render→cascade→layoutTree with a
  paginated `PageConfig`, mirroring `display-contents.test.ts`'s paginated harness + the existing
  measure-pass tests):
  - Two-section doc where section 1's body would leave room on its last page: section 2's first
    body block starts a FRESH page (assert the page plan: the page index where section 2's first
    block lands is a new page, not appended to section 1's last page). `pageIndexOfBlock` /
    `pageSpanOfBlock` reflect the break.
  - `activeSectionId` per entry is correct; `sectionPageIndex` resets to 0 at each section's first
    page and increments within.
  - **Section-less doc paginates IDENTICALLY to today** (no behavior change): equivalence vs a
    measurePass called with the implicit single-section plan (or vs the pre-C.2b-1 output captured
    in the test) — same entries, same boundaries.
  - C.1b transparency still holds WITHIN a section body (the body blocks lay out at the same
    intra-section positions as if the section weren't there — minus the page break).
  - **Incremental — text edit within a section (concrete, M-1):** call `measurePass(metas,
    pageConfig, sectionPlan, rootChildren)` once → `plan1`; reset the counter
    (`__resetFitOnePageCallCountForTest`); produce `metas2`/`rootChildren2` where ONLY section 2's
    body changed (a body RenderNode ref differs in section 2; section 1's refs identical) with the
    SAME `sectionPlan`; call `measurePass(metas2, pageConfig, sectionPlan, rootChildren2, plan1)` →
    assert `__getFitOnePageCallCountForTest()` counts ONLY section-2 (+ trailing) pages, NOT
    section-1 pages (they reused).
  - **Incremental — sectionPlan change (concrete, M-1):** build `plan1` from a section-LESS doc
    (`sectionPlan = IMPLICIT_SECTION_PLAN`); reset counter; call `measurePass(sameMetas, pageConfig,
    /*new*/ sectionPlanWithBoundaryAtIndex3, rootChildren, plan1)` → assert pages covering flattened
    indices [0,3) show 0 `fitOnePage` calls (reused — their `(activeSectionId,nextBoundaryIndex)`
    at those startIndexes is unchanged... NOTE: adding a boundary at 3 changes `nextBoundaryIndex`
    for the page starting at 0 from null→3, so page 0 REFITS; assert instead that pages whose
    startIndex ≥ 3 and whose section-status is unchanged reuse, and the boundary page refits — pick
    a 3-section setup so an UNAFFECTED earlier section's pages demonstrably reuse). Keep the
    assertion about the boundary-status comparison, not a naive "before index 3 reuses".
  - **Single section, no leading implicit block (missing-case):** a doc that is exactly one
    `section(a,b,c)` → SectionPlan `[{0, sec}]` (no implicit `null` boundary needed; section starts
    at 0) → NO break fires (first boundary never breaks) → paginates like the section-less body.
  - **Section break at an EXACT page boundary (missing-case):** section 1's body fills exactly to
    the page edge, then section 2 starts → the break fires but produces NO empty trailing page for
    section 1 (section 2's first page is the next page, not an extra blank one).
  - **Multi-page section body (missing-case):** a section whose body spans ≥2 pages → its pages
    carry a constant `activeSectionId` with `sectionPageIndex` incrementing 0,1,2…; the NEXT
    section resets to 0.
- [ ] **Step 2: Run, confirm fail.** Run: `npm test --workspace=packages/core -- --run measure-pass`
- [ ] **Step 3: Implement** items 1–8.
- [ ] **Step 4: Run measure-pass + the VL equivalence harness + `npm run build` + FULL core suite
  + dom suite** (measurePass is consumed by virtual-producer → layout → dom; the signature change
  ripples; confirm all callers updated and no behavior change for section-less docs).
- [ ] **Step 5: Commit** (controller, post-review).

---

## Out of scope for C.2b-1 (do NOT build here)
- Per-section page GEOMETRY (different page size/margins per section) → C.2b-2. Geometry stays
  uniform here; the `pageIndex * (pageBlockSize + pageGap)` blockOffset formula is UNTOUCHED.
- Headers/footers / PageBox slots / templateContents consumption → C.2c.
- getPage/materialization changes → none needed (the break is encoded in the plan entries).
- Section-attrs interpreter → C.2b-2 (no section attrs are read here).

## Status — COMPLETE (2026-05-25)

- [x] **T1** — `section-plan.ts` (`SectionPlan`/`buildSectionPlan`/`sectionStateAt`/
  `IMPLICIT_SECTION_PLAN`/`isSectionBox`) + `section.ts` `metadata.blockType="section"`
  marker. Commit `b9b587b`.
- [x] **T2** — `fitOnePage` `stopBeforeIndex` (forced break before a top-level child
  index, gated on `fragmentHasContent` like break-before:page; top-level only).
  Commit `e790e74`.
- [x] **T3** — `measurePass` section-awareness: `SectionPlan` input, forced break via
  `stopBeforeIndex`, `PagePlanEntry.activeSectionId`/`sectionPageIndex`, required
  `PagePlan.sectionPlan`, section-status reuse gate (`sectionStatesEqual`),
  `virtual-producer` wiring (`buildSectionPlan(cascadedRoot)`). Commit `0c1996d`.

Each task gated on an independent code-reviewer (review-until-clean) before commit;
all findings applied. Section-less docs paginate byte-identically (equivalence harness +
`IMPLICIT_SECTION_PLAN` callers). Full core suite 1559 pass / 4 skip; dom 145 pass.

**Carried for C.2c (not consumed yet):** `activeSectionId` / `sectionPageIndex` per page.
**Not browser-verified yet** (the user browser-verifies): an explicit-section doc should
show each section starting on a fresh page; a section-less doc should paginate exactly as
before.

## Self-review (writing-plans checklist)
- **Spec coverage:** pre-pass + SectionPlan (T1), the forced-break mechanism as a fit input not a
  meta flag (T2 stopBeforeIndex + T3 wiring), SectionPlan-as-explicit-reuse-input carry-forward
  proof (T3 item 6), PagePlanEntry.activeSectionId/sectionPageIndex (T3 item 1), first-boundary-
  never-breaks (T3 item 4), uniform geometry (out-of-scope note). ✓
- **Type names consistent:** `SectionPlan`/`SectionBoundary`/`SectionStateAt`/`buildSectionPlan`/
  `sectionStateAt`/`sectionStatesEqual` used identically across tasks. ✓
- **Ordering/deps:** T1 (pure pre-pass) → T2 (pure fitOnePage param) → T3 (measurePass uses both +
  wiring). Each builds + tests green independently; T3's signature change is the only ripple.
- **Open risk flagged:** the section-detection signal (T1) — the plan instructs the implementer to
  find the reliable "is this RenderNode/id a section?" signal and prefer a state-derived predicate;
  STOP+BLOCKED if the cascaded tree can't identify sections, rather than guess.
