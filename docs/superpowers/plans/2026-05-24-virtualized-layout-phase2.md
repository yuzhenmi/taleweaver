# Virtualized Layout — Phase 2 Implementation Plan

> Execute task-by-task; code-reviewer gate before commit (CLAUDE.md principle 3).
> TDD; oracle-driven (real `paginateRoot` is ground truth). Steps use `- [ ]`.

**Goal:** Build the on-demand page-materialization machinery — a
`VirtualLayoutTree` carrying the `PagePlan` (from Phase-1 `measurePass`) plus a
memoizing `getPage(i)` that positions ONE page on demand — and PROVE that
positioning each page independently from the plan reproduces the real
sequential `paginateRoot` output exactly. **Stays unwired** (like Phase 1):
`layoutTreeIncremental` is NOT changed; consumers are NOT touched. Wiring +
controller migration + the type-union ripple are Phase 3 (where the perf win
lands and we browser-verify).

**Architecture:** `docs/superpowers/specs/2026-05-24-virtualized-layout-design.md`
(reviewer-approved; see "VirtualLayoutTree", "Memo guarantee", "PagePlan").

**Why this is the crux validation:** `getPage(i)` seeds its per-page
`layoutBlock` from `plan.entries[i].resumeInto` (computed by `measurePass`),
NOT from the sequential previous-page break token. Proving
`getPage(i) ≡ paginateRoot`'s page i validates that the measure pass's resume
tokens are correct enough to position any page in isolation — the property
virtualization depends on.

---

### Task 1: `PagePlan` accessor helpers (`pageIndexAtBlockOffset`, `pageIndexOfBlock`)

**Files:**
- Modify: `packages/core/src/layout/measure-pass.ts` (the `PagePlan` it returns)
- Test: `packages/core/src/layout/__tests__/measure-pass.test.ts`

The spec's `PagePlan` needs O(log N)/O(1) resolvers used by `getPage` callers
and (Phase 4) the cursor. Add to the `PagePlan` produced by `measurePass`:
- `pageIndexAtBlockOffset(y: number): number` — binary search over entries'
  half-open intervals `[entry.blockOffset, nextEntry.blockOffset)`, with the
  FINAL page extending to `plan.totalBlockSize` (no trailing pageGap on the last
  page — `totalBlockSize` uses `pageCount-1` gaps). Clamp out-of-range `y` to
  `[0, last]`. (Do NOT reconstruct `blockOffset + blockSize + pageGap` per page —
  that over-adds a gap to the last page.)
- `pageIndexOfBlock(blockKey: string): number` — built alongside the plan
  (a `Map<blockKey, pageIndex>` over each entry's top-level children keys);
  returns the page whose `children` slice contains the block; -1 if absent.
  SEMANTIC: a block that SPANS pages appears only in the entry where it makes
  whole-block progress (measure-pass slices `children` per page), so this
  returns that page, not necessarily the page where the block visually starts —
  the Task-1 test must assert accordingly.

- [ ] **Step 1 (failing test):** assert both resolvers on a known multi-page
  plan (y in the middle of page 2 → 2; y in the inter-page gap → the page above;
  y past `totalBlockSize` → last; y < 0 → 0; a block key on page 3 → 3; unknown
  key → -1).
- [ ] **Step 2:** implement; keep `measurePass` allocation-light (build the map
  in the existing single pass).
- [ ] **Step 3:** green. **Step 4:** reviewer gate.

### Task 2: `getPage` / `getPages` + `makeVirtualLayoutTree`

**Files:**
- Create: `packages/core/src/layout/virtual-layout-tree.ts`
- Test: `packages/core/src/layout/__tests__/virtual-layout-tree.test.ts`

Define `VirtualLayoutTree` (discriminated `type: "virtual-root"`, per spec) and
`makeVirtualLayoutTree(plan, cascadedRoot, ctx, shaper, pageConfig)`:
- At tree-build time, replicate `paginateRoot` setup ONCE (paginate.ts:139–169):
  `pageContentBlockSize`/`pageContentInlineSize` from margins; `rootComputed =
  cascadedRoot.computedStyle`; `rootUsedStyle = computeUsedStyle(rootComputed,
  pageConfig.pageInlineSize, "indefinite")`; `contentCtx = { ...ctx,
  containingInlineSize: pageContentInlineSize }`.
- `getPage(i)`: position page `i` by running the SAME per-page layout
  `paginateRoot` runs — `layoutBlock(cascadedRoot, margins.inlineStart,
  margins.blockStart, contentCtx, shaper, { availableBlockSize:
  pageContentBlockSize, pageIndex: i, resumeFrom: plan.entries[i].resumeInto })`.
  Then wrap via `createPageBox` with the EXACT args paginate.ts:228–237 uses:
  `key = `page-${i}``, `inlineOffset = 0`, `blockOffset = entries[i].blockOffset`
  (note this equals `i * (pageBlockSize + pageGap)` — use the plan's value, do
  not recompute), `inlineSize = pageConfig.pageInlineSize`,
  `blockSize = pageConfig.pageBlockSize` (the PAGE size, NOT the content size),
  `writingMode`/`direction` from the OUTER `ctx` (not contentCtx),
  `computedStyle = rootComputed`, `usedStyle = rootUsedStyle`,
  `children = box ? [box] : []` (the BFC BlockBox can be null — guard it),
  `pageIndex = i`, `containingInlineSize = pageConfig.pageInlineSize`. Memoize by
  index (Map).
- `getPages(from, to)`: `[from..to]` via `getPage`, inclusive, clamped.
- `inlineSize` / `blockSize` from the plan (`pageInlineSize` / `totalBlockSize`).

- [ ] **Step 1 (failing test, ORACLE):** build a cascaded multi-page doc; run
  real `paginateRoot` → its `PageBox[]`. Build the `VirtualLayoutTree` from
  `measurePass` of the same root. For EACH page index, assert
  `getPage(i)` deep-equals `paginateRoot`'s page `i` (x/y/width/height,
  children structure + offsets, `pageIndex`, key). Use fixtures: leaf
  paragraphs multi-page, a spanning paragraph, a table spanning, a nested
  container spanning. (Reuse the Phase-1 equivalence fixtures.)
- [ ] **Step 2:** implement `getPage`/`getPages`/`makeVirtualLayoutTree`.
- [ ] **Step 3:** green. **Step 4:** reviewer gate.

### Task 3: `materializeAll()` + equivalence to `paginateRoot`'s outer tree

**Files:**
- Modify: `packages/core/src/layout/virtual-layout-tree.ts`
- Test: `packages/core/src/layout/__tests__/virtual-layout-tree.test.ts`

`materializeAll(): BlockBox` — build the legacy outer `BlockBox` whose children
are `getPage(0..N-1)`, sized exactly as `paginateRoot`'s outer box
(mirror paginate.ts:295–305: `totalBlockSize = pageCount * pageBlockSize +
(pageCount-1) * pageGap`, root key/styles).

- [ ] **Step 1 (failing test):** `makeVirtualLayoutTree(...).materializeAll()`
  deep-equals `paginateRoot(...)` (the whole tree: outer box + every page +
  descendants) on all Task-2 fixtures.
- [ ] **Step 2:** implement.
- [ ] **Step 3:** green. **Step 4:** reviewer gate.

### Task 4: carry-forward memo (same plan entry ⇒ same PageBox ref)

**Files:**
- Modify: `packages/core/src/layout/virtual-layout-tree.ts`
- Test: `packages/core/src/layout/__tests__/virtual-layout-tree.test.ts`

`makeVirtualLayoutTree(..., prevTree?)`: when building a new tree, a page whose
`PagePlanEntry` fingerprint (children refs + `resumeInto` + `resumeOut` +
`blockOffset` + `listCounterAtStart` + `pageInlineSize` + `pageContentBlockSize`)
is unchanged from `prevTree`'s entry returns `prevTree`'s already-materialized
`PageBox` by reference (only if that page was materialized; else materialize
fresh). `listCounterAtStart` MUST be in the fingerprint: bfc generates
ordered-list marker text from the running counter, so two otherwise-identical
pages with different list seeds render different markers — reusing across a seed
change would show stale numbers. Memo is lazy — carry-forward checks happen in
`getPage`, not eagerly.

- [ ] **Step 1 (failing test):** build tree A, call `getPage(i)` for all pages.
  Build tree B from a plan that changed only page 0 (e.g. edited the first
  paragraph; trailing pages' children refs + tokens identical). Assert
  `B.getPage(k) === A.getPage(k)` (reference) for every unchanged page `k>0`,
  and `B.getPage(0) !== A.getPage(0)`. Also assert a page whose
  `pageInlineSize` changed is NOT reused (width-change guard).
- [ ] **Step 2:** implement the fingerprint + carry-forward.
- [ ] **Step 3:** green. **Step 4:** reviewer gate.

### Task 5: "materializes only requested pages" guard

**Files:**
- Test: `packages/core/src/layout/__tests__/virtual-layout-tree.test.ts`

- [ ] **Step 1:** with perf-trace enabled (or a `bfc.layoutBlock` counter),
  build a 20-page `VirtualLayoutTree` and call only `getPage(19)`; assert the
  number of per-page `layoutBlock` driver invocations is 1 (not 20) — i.e.
  positioning page 19 does NOT position pages 0–18. This is the property the
  Phase-3 win relies on.
- [ ] **Step 2:** if the assertion fails, fix `getPage` to be truly
  independent (it should already be — it seeds from the plan, not sequentially).
- [ ] **Step 3:** green. **Step 4:** final Phase-2 reviewer gate.

---

## Done-when
All 5 tasks green + reviewer-approved; `getPage(i)` and `materializeAll()`
provably equal `paginateRoot` on the fixture set; carry-forward memo preserves
PageBox refs for unchanged pages; `getPage(i)` materializes only page `i`. No
consumer / `layoutTreeIncremental` change (that's Phase 3). Full
`packages/core` suite stays green.

## Notes
- Do NOT wire into `layoutTreeIncremental` or change `EditorState.layoutTree`
  — Phase 3.
- `getPage` reuses paginate.ts's per-page recipe; factor a shared helper if it
  reduces duplication, but do not modify `paginateRoot`'s behavior.
- The unsupported-doc gate (`measurePassUnsupported`) is a Phase-3 wiring
  concern; Phase-2 fixtures stay within the supported subset.
- Implementer subagents do NOT commit; controller reviews then commits.
