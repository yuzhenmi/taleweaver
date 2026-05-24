# Virtualized Layout — Design

**Date:** 2026-05-24
**Status:** designed; revised after spec-review rounds 1–2; awaiting re-review
**Motivation:** `2026-05-24-l-perf-f-shift-tolerant-page-reuse-design.md`
(Enter-at-top is O(N_blocks): the model positions every page every keystroke).
**Goal:** make per-keystroke layout O(visible + dirty) box-allocation,
independent of document length — matching Google Docs and the CLAUDE.md bar.

> **Revision note (round 1):** Two independent reviews corrected the original
> sketch. The load-bearing correction: the measure pass is NOT "read cached
> `.height`" — page boundaries are decided by fragmentation arithmetic
> (remaining space, orphans/widows, hyphenation, `break-*`, margin collapse,
> list-counter seeding). The design now factors that decision logic into a
> **pure fit-core** shared by the measure pass and real layout, so boundaries
> are computed allocation-free but identically to today. The consumer section
> now designs a per-page LineIndex + plan-driven page resolver (the cursor
> modules read a doc-wide flat line array today), and enumerates the
> `layoutTree` type blast radius and the non-incremental `dispatch.layoutTree`
> resize path.
>
> **Revision note (round 2):** Round-2 review accepted the round-1 fixes and
> surfaced: (a) `BlockFitMeta` needs per-line `lineEndsWithHyphen` and the
> fit-core must thread the page-running block offset into `fitLinesInIFC`
> (orphans/widows/hyphen back-off operate on *remaining* space); (b) floats /
> `clear` are non-local and **out of scope for v1** — such docs fall back to the
> legacy full layout; (c) the §C.6 overflow-consumes-whole case is now explicit
> in the fit-core contract; (d) the memo fingerprint includes page dimensions;
> (e) the cross-page same-block soft-wrap caret edge must be plan-aware in
> `findLineForPosition`/`resolvePixelPosition` (not just `moveToLine`);
> (f) `computeSelectionRects` gains a `pageRange` arg; (g) Phase 1 adds a
> non-paginated byte-identical guard.

## The core idea

Today `layoutTreeIncremental` (paginated path) materializes a fully positioned
page tree — a `BlockBox` containing one `PageBox` per page — on **every**
keystroke. The DOM controller paints only the pages the viewport intersects
(it already virtualizes paint via `IntersectionObserver`). The model does all
the work; the view throws most of it away.

Virtualization splits layout into two passes:

1. **Measure / paginate pass** — runs in the reducer every keystroke. Computes
   **page boundaries** (which blocks/line-ranges land on each page) using a
   pure fit-core over cached per-block fragmentation **metadata** — no box
   allocation for unchanged blocks; only dirty blocks refresh their metadata by
   re-running their intrinsic layout. Output is a **page plan** (plain data).
   Cost: O(N) cheap metadata reads + fit arithmetic + O(dirty) intrinsic
   re-layouts. No per-block positioned-box allocation, so the 7677-allocation /
   175ms cost disappears.

2. **Position pass** — on demand, outside the reducer. `getPage(i)` materializes
   a positioned `PageBox` for page `i` by running the existing
   fragmentation-aware `layoutBlock` for that one page, seeded by the plan's
   resume token, then memoizes it. Only the viewport's pages (controller) and
   the cursor / hit-test target page get positioned: O(visible + dirty)
   allocations. `getPage` **trusts the plan** — it never re-derives boundaries;
   it reproduces the page the plan already decided.

The lever that makes the measure pass allocation-free is that fragmentation
*decisions* depend only on per-block metadata (line block-sizes, margins,
break props, orphans/widows, list-item counter contribution), all of which are
derivable from a block's cached intrinsic layout and are position-independent.

## The fit-core (load-bearing refactor)

Page boundaries today are decided inside `bfc.layoutBlock` and
`ifc.layoutInlineContent` as a side effect of producing positioned boxes. The
decision logic is:

- **Block packing with margin collapse.** Adjacent-sibling margins collapse
  (`max(prevEnd, nextStart)`); the first block on a fragment has its
  block-start margin truncated (CSS Fragmentation §5.4). Page fill is the
  running sum of collapsed advances, not `sum(height)`.
- **`break-before` / `break-after` / `break-inside: avoid`** and the §C.6
  overflow rule (a block that can't fit a non-empty fragment is pushed whole;
  if the fragment is empty it overflows).
- **Within-block IFC fragmentation:** given `availableBlockSize`, place as many
  lines as fit, honoring `orphans` / `widows` (back-off that can reduce the
  emitting page's line count) and hyphenation back-off, emit
  `IFCBreakToken{resumeAtLine}`.
- **Within-table fragmentation:** place rows up to the fit, repeat header rows,
  emit `TableBreakToken{resumeAtRow}`.
- **List-counter seeding:** an ordered-list item's number depends on preceding
  list items.

This logic is **extracted into a pure module** (`layout/fit-core.ts`, new) that
operates over metadata, not boxes:

```ts
interface BlockFitMeta {
  readonly kind: "block" | "ifc" | "table";
  readonly marginBlockStart: number;
  readonly marginBlockEnd: number;
  readonly breakBefore: "auto" | "page" | "avoid";
  readonly breakAfter: "auto" | "page" | "avoid";
  readonly breakInsideAvoid: boolean;
  readonly totalBlockSize: number;          // unfragmented height
  // ifc: per-line block-sizes + fragmentation knobs; absent otherwise
  readonly lineBlockSizes?: readonly number[];
  readonly orphans?: number;
  readonly widows?: number;
  // Per-line "this line ends mid-hyphenated-pair" flag. The IFC D.4 hyphen-
  // pair back-off (ifc.ts) can move a break a line earlier; reproducing the
  // boundary requires knowing which line ends a hyphenated pair.
  readonly lineEndsWithHyphen?: readonly boolean[];
  // table: body row block-sizes + header repeat height; absent otherwise
  readonly rowBlockSizes?: readonly number[];
  readonly headerBlockSize?: number;
  // list-item counter contribution (ordered lists)
  readonly listItem?: boolean;
}

// Pure: given the block list's metadata, the page content size, the resume
// state INTO this page, and the running list-counter, decide ONE page.
function fitOnePage(
  metas: readonly BlockFitMeta[],
  startIndex: number,
  resumeInto: BreakToken | null,
  pageContentBlockSize: number,
  listCounterAtStart: number,
): {
  childrenCount: number;        // whole blocks consumed on this page
  resumeOut: BreakToken | null; // null ⇒ doc end
  listCounterAtEnd: number;
};
```

`fitOnePage` threads a **running in-page block offset** as it walks blocks
(accumulating collapsed-margin advances), and passes the page's *remaining*
block size (`pageContentBlockSize − runningOffset`) into `fitLinesInIFC` /
`fitRowsInTable` — the IFC line-fit and orphan/widow/hyphen back-off operate
against remaining space, not the paragraph's full height. `fitOnePage`'s
contract MUST reproduce the §C.6 overflow rule explicitly: a block that is
first-on-fragment and still doesn't fit is **consumed whole and overflows**
(not pushed to the next page) — otherwise `childrenCount` / `resumeOut`
diverge from real layout.

`bfc.layoutBlock` / `ifc.layoutInlineContent` are refactored to call the SAME
`fitOnePage` (and its `fitLinesInIFC` / `fitRowsInTable` helpers) to decide
breaks, then position boxes accordingly. This makes the fit decision a **single
source of truth** consumed by both the measure pass (metadata → boundaries) and
real layout (metadata → boundaries → positioned boxes). The Phase-1 equivalence
test guards against any drift between the two.

`BlockFitMeta` is produced from a block's cached intrinsic `BlockBox`
(line block-sizes are the child line boxes' heights; margins/breaks from
computed style). It is cached per block and refreshed only for `dirtyIds`.

### Out of scope for v1: floats / `clear`

Float placement and `clear` make break decisions **non-local**: a float lives
in a shared `floatEnv` that advances `childBlockOffset` past float bottoms and
reduces the IFC's available space (`bfc.ts` float placement; `ifc.ts` float
push-down). None of that is expressible as per-block `BlockFitMeta`. For v1,
documents containing any float or `clear` **fall back to the current full
(non-virtual) positioned-tree layout** — `layoutTreeIncremental` detects a
float/`clear` in the cascaded tree and takes the legacy path, returning a
positioned `BlockBox` (the `materializeAll()` shape) instead of a
`VirtualLayoutTree`. Word-processor documents rarely float across page
boundaries, so this preserves correctness with no perf regression for the
float-free common case. Extending the fit-core to carry float environment
across page boundaries is a later enhancement, tracked separately.

The float/`clear` detection must read **cheap cascaded-style flags** (a
boolean rolled up during the cascade pass, e.g. `subtreeHasFloatOrClear`), not
a fresh deep walk of the tree per keystroke — otherwise it re-introduces an
O(N) traversal on the float-free hot path.

## Data structures

### PagePlan

```ts
interface PagePlanEntry {
  readonly pageIndex: number;
  readonly blockOffset: number;       // document-y of this page's top
  readonly blockSize: number;         // page block size (constant per config)
  readonly children: readonly RenderNode[]; // cascaded refs on this page
  readonly resumeInto: BreakToken | null;   // resume state INTO this page
  readonly resumeOut: BreakToken | null;    // resume state OUT (null ⇒ last)
  readonly listCounterAtStart: number;      // ordered-list seed (avoids O(start) rescan)
}

interface PagePlan {
  readonly entries: readonly PagePlanEntry[];
  readonly totalBlockSize: number;    // document height (scroll sizing)
  readonly pageInlineSize: number;
  // O(log N) (binary search over blockOffset) or O(1) array lookups:
  pageIndexAtBlockOffset(y: number): number;   // pixel-y → page
  pageIndexOfBlock(blockKey: string): number;   // block → page (built alongside)
}
```

### VirtualLayoutTree (new layout result, discriminated by `type`)

```ts
interface VirtualLayoutTree {
  readonly type: "virtual-root";
  readonly plan: PagePlan;
  readonly inlineSize: number;
  readonly blockSize: number;         // == plan.totalBlockSize
  getPage(pageIndex: number): PageBox;          // memoized
  getPages(from: number, to: number): PageBox[];
}
```

`getPage(i)` runs `layoutBlock(root, margins, offsetForPage(i), ctx, shaper,
{ availableBlockSize: pageContentBlockSize, pageIndex: i, resumeFrom:
plan.entries[i].resumeInto })`, wraps the result in a `PageBox` at
`entry.blockOffset`, and memoizes by index.

**Memo guarantee (paint-cache warmth):** when a new `VirtualLayoutTree` is
produced, a page whose `PagePlanEntry` fingerprint (children refs + resumeInto
+ resumeOut + blockOffset + **`pageInlineSize` + `pageContentBlockSize`**) is
unchanged from the prior tree returns the prior tree's already-materialized
`PageBox` *by reference* (carry-forward memo). Including the page dimensions in
the fingerprint prevents reusing a stale `PageBox` laid out at an old width
after a resize. This
preserves the per-index `PaintCache` and per-page `LineIndex` warmth that
L-PERF-C/-D provide today. The per-page `prevLayoutCache` (built from the prior
page's BlockBox via `buildLayoutBoxCacheFromTree`) and `ifcStateCache` are owned
by the `VirtualLayoutTree` and threaded into `getPage` so block-subtree reuse
(L-PERF-A/-G) still applies when a page IS re-materialized.

## Pipeline changes

`layoutTreeIncremental` paginated path:

```
metas      = buildBlockFitMetas(cascadedRoot, dirtyIds, prevMetas, shaper)  // O(dirty) refresh
plan       = measurePass(cascadedRoot.children, metas, pageConfig)           // pure fit-core
return makeVirtualLayoutTree(plan, cascadedRoot, prevTree, ctx, shaper, pageConfig)
```

The unpaginated path (no `pageConfig`) is unchanged (single positioned
`BlockBox`; nothing to virtualize).

**Non-incremental `dispatch.layoutTree` (resize path).** `handleSetContainerWidth`
calls `layoutTree(...)` (full, non-incremental) and stores the result in
`editorState.layoutTree`. This path is enumerated and routed through the same
virtual production (a `layoutTree` paginated full build returns a
`VirtualLayoutTree` with an empty prev cache). So `editorState.layoutTree` is
ALWAYS a `VirtualLayoutTree` in paginated mode, never a raw positioned tree.

## EditorState.layoutTree type blast radius (enumerated)

`editorState.layoutTree` changes type from `LayoutBox` to
`LayoutBox | VirtualLayoutTree` (discriminated by `type`; paginated mode always
the latter). The ripple, to be handled deliberately (not discovered
mid-build):

- `packages/core/src/editor/editor-state.ts` — field type.
- `packages/core/src/editor/actions/helpers.ts` — `rebuildTrees` assigns it.
- `packages/core/src/editor/actions/set-container-width.ts` — resize path.
- `packages/core/src/layout/dispatch.ts` — `layoutTree` return type (paginated).
- Cursor signatures that take the tree: `resolvePixelPosition`,
  `resolvePositionFromPixel`, `computeSelectionRects`, `moveToLine`,
  `moveToLineBoundary` (in `packages/core/src/cursor/*`). `computeSelectionRects`
  gains an optional `pageRange?: { from: number; to: number }` parameter so the
  controller can scope materialization to visible pages + the cursor page (see
  Consumer changes); without it, it walks the full selection span.
- `packages/core/src/index.ts` — public exports (`LayoutBox`,
  `collectLineBoxes`, `findLineForPosition`, and the new `VirtualLayoutTree`).
- `packages/dom/src/editor-controller.ts` — `state.layoutTree` reads + the
  `import type { LayoutBox }`.

These functions take `VirtualLayoutTree` (paginated) and internally resolve to
pages via the plan; the unpaginated single-`BlockBox` path is retained for the
no-pageConfig case.

## Consumer changes

### Cursor / hit-test / selection / line-navigation — per-page LineIndex + plan resolver

Today `getLineIndex(root)` (`cursor/line-flatten.ts`) walks the WHOLE tree once
and returns `{ all, byBlock }`; the consumers read the doc-wide flat `all`
array:

- `selection-geometry` slices `all[startLineIdx..endLineIdx]`.
- `line-navigation.moveToLine` indexes `all[currentLineIdx ± 1]` to cross page
  boundaries.
- `hit-test` filters `all` by `pageIndex`.

The design replaces the doc-wide index with a **per-page LineIndex** (built by
`getLineIndex(getPage(i))`, memoized per page via the existing WeakMap, keyed on
the materialized `PageBox`) plus a **plan-driven page resolver**:

- **Position → page.** `plan.pageIndexOfBlock(block)` gives the cursor block's
  page; `getPage` it; run the per-page LineIndex logic. Cursor lands on exactly
  one page (O(1) pages materialized).
- **Cross-page same-block soft-wrap edge (Position→line).** Today
  `findLineForPosition` / `resolvePixelPosition` scan the doc-wide `all` array
  forward for the *next same-block line* when the caret sits at a soft-wrap edge
  (`offset === inlineOffsetEnd`), so the caret snaps to the visual next line
  (Word/Docs convention). When that next line is on the **next page** (a
  paragraph spanning a page boundary), a purely page-local lookup finds no
  successor on page N and would wrongly pin the caret to page N's bottom. The
  page-local rewrite MUST be **plan-aware**: at a block's last line on page N
  with `offset === inlineOffsetEnd`, if `plan` shows the block continues onto
  page N+1, fetch `getPage(N+1)` and return its first same-block line. This
  applies to BOTH `findLineForPosition` and `resolvePixelPosition` (not just
  `moveToLine`). Bounded to 2 pages.
- **Pixel-y → page.** `plan.pageIndexAtBlockOffset(y)` gives the page; `getPage`
  it; run per-page hit-test. `resolvePositionFromPixel`'s current global
  `allLines.filter(l => l.pageIndex === idx)` and the
  `allLines.some(l => l.pageIndex > 0)` pagination heuristic are **removed** —
  the input is already a single page's LineIndex, and the caller resolved the
  page via the plan.
- **Cross-page line navigation.** `moveToLine` resolves the current line's page
  via the plan; if stepping past the page's first/last line, advance to the
  adjacent page (`getPage(i±1)`) and take its boundary line. Stitching is
  bounded to the 2 pages at the boundary, not the whole doc.
- **Multi-page selection geometry.** `computeSelectionRects` walks pages from
  the selection's start page to its end page (`getPages(startPage, endPage)`),
  emitting rects per page — but accepts an optional `pageRange` arg so the
  controller scopes it to visible pages + the cursor page. Off-screen selection
  rects are computed lazily as those pages scroll into view (the controller
  re-runs `computeSelectionRects` with the new visible range on scroll). A
  select-all without a `pageRange` still materializes every spanned page —
  inherent to drawing the full selection; the controller avoids that by always
  passing the visible range. **Open sub-decision flagged below.**

`findLineForPosition` and `moveToLine` are rewritten to operate **page-locally**
(take a per-page LineIndex + a plan resolver) rather than over a global `all`
array. This is the bulk of the consumer-migration work and is a Phase-4 task in
its own right.

`findBlockBaseline` (the `box.type === "page"` recursive fallback in
`cursor-position.ts`, for blocks with null inlineContent) is redirected through
`getPage` over the plan-resolved page.

### DOM controller (`editor-controller.ts`)

- `syncDom` / `syncPageCanvases`: size page slots from `plan.entries`
  (`pageIndex`, `blockOffset`, `blockSize`) — off-screen slots need no
  positioned box.
- `paintPages`: for each active (visible) canvas index, `getPage(idx)` and paint
  (paint logic unchanged; `paintBox` already takes a `PageBox`).
- Scroll height / spacer: `plan.totalBlockSize`.
- `resolveMouseToLayout`: map click pixel-y via `plan.pageIndexAtBlockOffset`
  (authoritative), not `floor(visualY / (pageHeight + pageGap))` arithmetic.
- The `IntersectionObserver` already chooses active indices; it now also drives
  which pages get positioned.
- `computeSelectionRects` is scoped to visible pages + cursor page in the
  controller's `update`, so a selection spanning off-screen pages doesn't force
  materialization until those pages scroll in.

### Paint cache

`paint-cache.ts` WeakMaps key on `LayoutBox` (PageBox) references; the
controller's `pageCaches: Map<number, PaintCache>` keys by index. The memo
guarantee (same plan entry ⇒ same `PageBox` ref) keeps these warm. When a page
IS re-materialized (its content changed), a new ref → full repaint of that page
(correct, perf-neutral — it changed).

## Interaction with shipped L-PERF pieces

- **L-PERF-A/-G** (per-block subtree cache + reposition-on-clone): the engine of
  `getPage`'s positioning and of metadata refresh. Unchanged.
- **L-PERF-C** (page reuse via `_paginationCache` WeakMap keyed on the positioned
  root): **removed** — virtual mode produces no such root. Its job (reuse an
  unchanged page) is taken over by the `VirtualLayoutTree` carry-forward memo.
- **L-PERF-D** (LineIndex): becomes **per-page**, keyed on the materialized
  PageBox; the consumers gain a plan-driven page resolver to stitch across
  pages.
- **L-PERF-E** (snapshot chain compaction): orthogonal (state layer).

## Phasing (each phase ships green + reviewed; browser smoke where noted)

1. **`fit-core.ts` extraction + measure pass, behind the existing positioned
   output.** Extract the fragmentation decision logic into pure
   `fitOnePage`/`fitLinesInIFC`/`fitRowsInTable`; refactor `bfc`/`ifc` to call
   it — touching ONLY the break-decision branches (`fragmentation !== undefined`),
   never the `fragmentation === undefined` non-paginated codepaths (IFC cache,
   empty-block/strut rules). Prove no behavior change: existing tests pass AND a
   new test asserts the non-paginated `layoutTree` output is byte-identical
   before/after the extraction. Add the float/`clear` detection that routes such
   docs to the legacy full path. Build `buildBlockFitMetas` + `measurePass`;
   assert the plan's boundaries / offsets / resume tokens / list-counters
   EXACTLY match the current positioned tree on the fixture set. No consumer
   changes.
2. **`VirtualLayoutTree` + `getPage` + carry-forward memo.**
   `layoutTreeIncremental` (paginated) returns the virtual tree; add
   `materializeAll()` (build the old positioned `BlockBox` from `getPage` over
   all pages) so existing consumers/tests pass unchanged; assert
   `materializeAll()` deep-equals today's output (positions, sizes,
   breakTokens) on the fixtures. Route `dispatch.layoutTree` resize through the
   virtual path.
3. **Migrate DOM controller** to `getPage` for visible pages + `plan` for slot
   sizing/scroll/mouse. **Browser-verify.** *Perf win lands here* — assert
   Enter-at-top on an N-page doc materializes only O(visible) pages
   (`bfc.layoutBlock` count independent of N; the L-PERF-F red test becomes the
   green guard).
4. **Migrate cursor / hit-test / selection / line-nav** to per-page LineIndex +
   plan resolver (rewrite `findLineForPosition` / `moveToLine` /
   `selection-geometry` page-locally; redirect `findBlockBaseline`).
   **Browser-verify** each interaction (click, arrows across page boundaries,
   shift-select across pages, Cmd+End).
5. **Remove `materializeAll()`** and any now-dead full-tree paths. Final review.
6. **(Optional, later) Incremental measure pass.** Replace the O(N) metadata
   sweep with an O(dirty + log N) Fenwick/prefix structure if the O(N)
   arithmetic sweep ever becomes the bottleneck (it is allocation-free, sub-ms
   for thousands of blocks, so not needed for the initial win).

## Testing strategy (TDD, geometry-level)

- **Phase 1 equivalence fixtures** (the critical de-risk) MUST include:
  - exactly-full pages (the cascade case),
  - a paragraph spanning a page boundary with non-default `orphans`/`widows`,
  - hyphenation back-off at a boundary,
  - a table spanning pages (with header repeat),
  - an **ordered list spanning pages** (list-counter seeding),
  - a forced `break-before` mid-page and a `break-inside: avoid` block that
    overflows.
  Assert plan boundaries, offsets, resume tokens, and list-counter starts equal
  the current positioned tree's.
- Phase 2: `materializeAll()` deep-equals today's `layoutTreeIncremental`
  output on those fixtures.
- Phase 3 perf: Enter-at-top on an N-page doc → `bfc.layoutBlock` call count is
  O(blocks-per-page × small constant), independent of N.
- Phase 4: existing cursor/selection/nav behavior tests pass; add tests that a
  cursor at page 50 positions only page 50 (and its neighbor when navigating
  across the boundary), not pages 0–49. **Add a cross-page caret-edge test:** a
  paragraph spanning pages N/N+1, caret at the soft-wrap offset at the bottom of
  page N, asserts `findLineForPosition` / `resolvePixelPosition` return page
  N+1's first same-block line (not page N's bottom). Also test arrow-down and
  shift-select across that boundary.
- Browser smoke after phases 3 and 4.

## Open sub-decisions (resolved, flagged for user review)

- **Measure pass O(N) arithmetic for v1** (not incremental). Allocation-free;
  sub-ms for thousands of blocks. Fenwick incremental is Phase 6 if needed.
- **Layout is pull-based `getPage` outside the reducer** (not viewport-threaded
  into the reducer) so Cmd+End / arbitrary positional queries position one page
  without coupling the reducer to scroll state.
- **`computeSelectionRects` scoping.** v1: the controller scopes it to visible
  pages + the cursor page, so off-screen selection rects materialize lazily on
  scroll. Alternative: compute the full selection eagerly (materializes all
  spanned pages). v1 chooses lazy/visible-scoped; revisit if selection rendering
  during scroll shows artifacts.
