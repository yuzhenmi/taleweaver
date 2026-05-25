# P1.C.2b-2 — Per-section page geometry Implementation Plan

> **For agentic workers:** subagent-driven-development; one implementer per task; an
> independent code-reviewer gate before each commit; TDD (behavior-level where it touches
> caret/paint/nav). Design spec (reviewer-approved):
> `docs/superpowers/specs/2026-05-25-p1c-c2-section-pagination-design.md` § "C.2b-2".
> Plan-reviewed 2026-05-25 (2 Critical + 4 Important + 1 Minor resolved inline below).

**Goal:** A `section` may carry page-geometry overrides (`pageInlineSize`, `pageBlockSize`,
`pageMargins`, `pageGap`) in its `attrs`; its pages adopt that geometry. Pages are no longer
uniform — page block-offsets become a RUNNING SUM. A geometry change on one section must
invalidate only that section's pages onward. No-override docs paginate BYTE-IDENTICALLY to today.

**Invariant (no-regression):** when every section's resolved `PageConfig` equals the doc-wide
config (the common case), the running sum reduces to `pageIndex*(H+gap)` and the plan is identical
to C.2b-1. The VL equivalence harness + a "uniform == today" assertion guard this at each layer.

## Resolved API decisions (from plan review — DO NOT re-litigate at implementation time)
1. **Section attrs reach `buildSectionPlan` via `metadata`, NOT a new ElementBox field.**
   `ElementBox` has only `{key, style, computedStyle, metadata, children}` — no `attrs`. So the
   `section` component MUST stamp the geometry attrs into `metadata` alongside `blockType:"section"`
   (the same mechanism C.2b-1 used for the marker). This is a fact; it's T1 step 1, not a TBD.
2. **`SectionBoundary.pageConfig` is OPTIONAL (`pageConfig?: PageConfig`).** A real section's
   boundary gets a resolved config; the implicit (`sectionId:null`) boundary and any boundary
   without overrides leave it `undefined`. `measurePass` resolves the EFFECTIVE per-page config as
   `boundary.pageConfig ?? docWidePageConfig` (the doc-wide `pageConfig` param measurePass already
   receives). ⇒ `IMPLICIT_SECTION_PLAN` STAYS a static const (its boundary has no `pageConfig`);
   every existing `IMPLICIT_SECTION_PLAN` / equivalence-harness caller is UNCHANGED and
   byte-identical. No `implicitSectionPlan(docWide)` function, no sentinel.
3. **`measurePass` keeps its doc-wide `pageConfig` param** — used as (a) the per-page fallback for
   sections without overrides, and (b) the doc-wide default exposed as `PagePlan.pageContentBlockSize`.
4. **`PagePlan.pageContentBlockSize` is KEPT** as the doc-wide default (NOT dropped). The carry-
   forward whole-plan-refuse guard that compared it becomes a PER-ENTRY geometry comparison (see T2).
   `PagePlanEntry` additionally carries `pageConfig` (the effective geometry for that page).
5. **`EditorControllerOptions.pageHeight` is KEPT** as the doc-wide default + the gate that
   activates paginated mode. Per-page heights come from `plan.entries[i]` (blockOffset + the
   entry's `pageConfig.pageBlockSize`). No rename (avoids a `packages/react` ripple).

---

## Task 1: section-attrs PageConfig validator + metadata stamping + SectionBoundary.pageConfig

**Files:** Create `packages/core/src/layout/section-page-config.ts` (+ test); Modify
`packages/core/src/components/section.ts` (stamp geometry attrs into metadata) + its test;
Modify `packages/core/src/layout/section-plan.ts` (SectionBoundary.pageConfig?; buildSectionPlan
takes docWide config + resolves per-boundary; isSectionBox unchanged) + test.

- **section.ts:** `render` stamps geometry attrs into the metadata object next to `blockType`:
  `createElementBox(view.id, { display: "contents" }, childRenderNodes, { blockType: "section",
  pageInlineSize: view.attrs.pageInlineSize, pageBlockSize: view.attrs.pageBlockSize, pageMargins:
  view.attrs.pageMargins, pageGap: view.attrs.pageGap })`. (`view.attrs` is the `ContainerBlockView`
  attrs — available at render; values may be `undefined`.) Add a section.test assertion that the
  geometry attrs round-trip into `metadata`. **Confirm `view.attrs` is reachable in the section
  component's render signature** (block-view.ts `ContainerBlockView.attrs`); if not, STOP+report.
- **section-page-config.ts:** `resolveSectionPageConfig(docWide: PageConfig, sectionMetadata:
  Readonly<Record<string, unknown>> | undefined): PageConfig` — pure validator/normalizer (NOT a
  cascade Style interpreter). Reads `pageInlineSize`/`pageBlockSize`/`pageGap` (accept only finite
  numbers: `> 0` for sizes, `>= 0` for gap) and `pageMargins` (an object with finite `blockStart/
  blockEnd/inlineStart/inlineEnd >= 0`); returns `{ ...docWide, ...validatedOverrides }` (and a
  merged `pageMargins` = `{ ...docWide.pageMargins, ...validatedMarginOverrides }`). Invalid/absent
  → fall back to docWide (ignore; do NOT throw — attrs are open-schema). Reject configs that would
  make content block-size `<= 0` (margins ≥ pageBlockSize) by falling back, mirroring measurePass's
  existing guard.
- **section-plan.ts:** `SectionBoundary` gains `readonly pageConfig?: PageConfig`.
  `buildSectionPlan(cascadedRoot: ElementBox, docWide: PageConfig): SectionPlan` — NEW 2nd param.
  For each section boundary, resolve `pageConfig = resolveSectionPageConfig(docWide, sectionBox.metadata)`
  (omit/leave undefined when it deep-equals docWide, OR always set it — either is fine since
  measurePass falls back; prefer: set it only when an override is present, so unchanged sections
  stay `undefined` and the no-regression path is obvious). The implicit leading boundary: no
  `pageConfig`. Update the SINGLE production caller `buildSectionPlan(` in `virtual-producer.ts` to
  pass the doc-wide `pageConfig` (the one it already passes to measurePass). `IMPLICIT_SECTION_PLAN`
  unchanged (const; boundary has no pageConfig).

**TDD:** validator (docWide on null/empty/all-invalid metadata; valid pageBlockSize override;
reject negative/NaN/non-number → fallback; partial pageMargins merge; content-size-<=0 → fallback);
section.ts metadata round-trip; buildSectionPlan stamps per-boundary pageConfig (section with a
pageBlockSize attr → boundary.pageConfig.pageBlockSize === override; section with no overrides →
undefined; implicit → undefined). Build + full suite (the `buildSectionPlan(` signature ripple is
just virtual-producer + tests) → reviewer → commit.

## Task 2: measure-pass per-page geometry (running-sum offset + per-page PageConfig)

**Files:** Modify `packages/core/src/layout/measure-pass.ts` (+ tests).

- `PagePlanEntry` gains `readonly pageConfig: PageConfig` (the EFFECTIVE geometry for that page =
  `sectionStateAt(...).pageConfig ?? docWidePageConfig`). `blockSize` = that config's `pageBlockSize`.
- In the loop, per page: compute the active section's effective config; derive that page's
  `pageContentBlockSize` (`cfg.pageBlockSize − cfg.pageMargins.blockStart − .blockEnd`) and pass IT
  to `fitOnePage`; compute `blockOffset` as a RUNNING SUM (`runningOffset`, seeded 0; after each
  page `runningOffset += thisPageBlockSize + thisPageGap`). Keep the per-page `stopBeforeIndex` cap
  (C.2b-1) + the `activeSectionId`/`sectionPageIndex` running vars unchanged.
- `sectionStateAt` (or the boundary lookup) must surface the active boundary's `pageConfig` so the
  loop can resolve it. (Add `pageConfig?: PageConfig` to `SectionStateAt`, resolved from the active
  boundary; the loop applies the `?? docWide` fallback.)
- **Carry-forward reuse gate — make geometry PER-ENTRY (Critical):** the existing
  `prevPlan.pageContentBlockSize === pageContentBlockSize` WHOLE-PLAN-REFUSE guard
  (~measure-pass.ts:239) must NOT nuke all reuse when one section's geometry changes. Replace it:
  keep the doc-wide guard only for a DOC-WIDE config change (compare `prevPlan.pageContentBlockSize`
  to the new doc-wide `pageContentBlockSize`); for per-section changes, the existing per-page reuse
  precondition gains a geometry check — a prior entry is reusable at `startIndex` only if its
  `pageConfig` deep-equals the current page's effective config (alongside `sectionStatesEqual` +
  `breakTokensEqual` + `canReusePage`). NOTE the running-sum `blockOffset` is position-dependent:
  a geometry change in section K shifts `blockOffset` for every page from K onward, so those pages
  naturally re-fit/re-position; earlier sections keep identical `blockOffset` + `pageConfig` ⇒ reuse.
  Confirm the reuse push rebuilds `blockOffset` from the running sum (it already rebuilds position-
  dependent fields) and stamps the current `pageConfig`.
- `PagePlan.totalBlockSize` = the running sum over per-page heights (last page: no trailing gap).
- `PagePlan.pageContentBlockSize` stays = the DOC-WIDE content size (decision 4).
- `maxPages` bound unchanged.

**TDD (unit + equivalence + incremental harnesses):** uniform config ⇒ byte-identical to C.2b-1
(vs IMPLICIT_SECTION_PLAN AND vs captured uniform plan); section-2 with larger pageBlockSize ⇒
section-2 pages taller, blockOffsets are the running sum, section-1 pages' blockOffset unchanged;
incremental — a geometry change on section 2 refits only section-2+ pages (fitOnePage call-count),
section-1 reuse; running-sum blockOffset correctness across a geometry boundary; a DOC-WIDE config
change still full-refits (guard preserved). Build + equivalence harness + full suite → reviewer →
commit.

## Task 3: virtual-layout-tree per-entry geometry (incl. review issue A)

**Files:** Modify `packages/core/src/layout/virtual-layout-tree.ts` (+ tests).

- `materializePage`: use `entry.pageConfig` for (a) `layoutBlock`'s available block-size
  (`entry.pageConfig` content size) and (b) `createPageBox`'s block-size + inline-size + margins —
  REPLACING the closure-captured uniform `pageConfig` (review **issue A**: the `createPageBox(...)`
  blockSize arg currently uses the uniform config → wrong height for every non-default-section
  page). Use `entry.blockOffset` (running sum) for the PageBox y.
- `PageFingerprint` gains the entry's geometry: replace the closure-captured `pageInlineSize` /
  `pageContentBlockSize` fields with PER-ENTRY values from `entry.pageConfig`, and add a deep-equal
  of the entry's `pageConfig` (a section-geometry change must invalidate that section's pages onward
  — mirror the just-landed `stopBeforeIndex` fingerprint fix: add to `PageFingerprint`,
  `fingerprintOf`, AND `fingerprintsEqual`). **Migrate the `fingerprintOf` CALL SITES**
  (~lines 241, 343 — the carry-forward `fingerprintAt` and the build-time fingerprint) off the
  closure-captured uniform `pageInlineSize`/`pageContentBlockSize` to `entry.pageConfig`-derived
  values; otherwise a geometry change won't invalidate the memo. PageConfig deep-equal (objects
  differ by ref across cycles) — compare the scalar fields + pageMargins fields, not `===`.
- `totalBlockSize` / any `pageCount * pageBlockSize + gaps` here → `plan.totalBlockSize` (running
  sum); `materializeAll` uses per-entry heights. `pageIndexAtBlockOffset` already binary-searches
  `entries[i].blockOffset` ⇒ no change beyond correct offsets.

**TDD:** materialized PageBox height/inlineSize/margins == entry.pageConfig for a non-default
section; carry-forward refuses a page whose pageConfig changed (mirror the stopBeforeIndex guard
test) while an earlier-section page reuses; the existing width-change guard test still passes
(pageInlineSize now per-entry); totalBlockSize == running sum. Build + full suite + dom → reviewer
→ commit.

## Task 4: DOM controller per-page geometry (ALL uniform-pageHeight assumptions)

**Files:** Modify `packages/dom/src/editor-controller.ts` (+ tests/dom). `EditorControllerOptions.
pageHeight` stays the doc-wide default + paginate gate (decision 5); per-page geometry comes from
`plan.entries[i]`. Replace EVERY uniform assumption (recon + plan-review enumerated — ALL must change):
- `syncDom` per-page slot sizing → each slot's height/width from `plan.entries[i].pageConfig`.
- textarea/caret Y: `plan.entries[cursorPos.pageIndex].blockOffset + cursorPos.y` (NOT
  `pageIndex*(pageHeight+pageGap)+y`).
- **`scrollCursorIntoView`** (the `cursorPos.pageIndex * (pageHeight + pageGap) + cursorPos.y`
  multiplier) → same `entry.blockOffset + cursorPos.y`.
- **`resolveMouseToLayout`**: after `pageIndexAtBlockOffset(visualY)` picks `idx`,
  `pageLocalY = visualY − plan.entries[idx].blockOffset` (NOT `visualY − idx * slotHeight`), AND the
  clamp `Math.max(0, Math.min(pageHeight, pageLocalY))` → `Math.min(entry.pageConfig.pageBlockSize,
  pageLocalY)` (else a click low on a TALL section page is clamped to the short default height).
- total-doc scroll height / any page-count × uniform-height for scroll bounds → `plan.totalBlockSize`.
- **paint-cache invalidation:** a section-geometry change keeps page INDICES but changes their slot
  heights; `pageCaches` / canvas-pool MUST invalidate the affected pages (the structural diff won't
  catch a pure geometry change) — mirror the recycled-canvas stale-pixel handling. (If this proves
  large, split it into T5; otherwise keep it as the last step of T4.)

**TDD:** dom-level tests where the harness allows (slot heights match per-page geometry; mouse→pos
across a geometry boundary; caret Y at a tall-section page). Then BROWSER smoke (user): a section
with a different page size renders taller pages from its boundary; caret/click/scroll land correctly
across the boundary; no stale paint after a geometry change. Build + full core + dom → reviewer →
commit.

## Out of scope
- Headers/footers / PageBox slots / templateContents consumption → C.2c.
- Section attrs beyond page geometry (columns, etc.) → later. Orientation → swapped inline/block sizes.

## Status
- [ ] T1 — validator + metadata stamping + SectionBoundary.pageConfig.
- [ ] T2 — measure-pass running-sum + per-page PageConfig + per-entry reuse gate.
- [ ] T3 — virtual-layout-tree per-entry geometry (issue A + fingerprint call-site migration).
- [ ] T4 — DOM controller per-page geometry (+ paint-cache invalidation).
