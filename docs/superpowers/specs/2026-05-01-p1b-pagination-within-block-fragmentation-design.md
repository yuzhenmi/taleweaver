# P1.B — Pagination Within-Block Fragmentation Design

**Date:** 2026-05-01
**Branch:** `feature/dom-architecture-redesign`
**Status:** Drafted; awaiting user review.

## Goal

Extend P1.A's pagination foundation (whole-block placement) with within-block fragmentation: paragraphs, block containers, and tables can split across page boundaries. Add widows/orphans constraints and `break-*` property consumers. Ship CSS Fragmentation Module Level 4 fidelity for the algorithms applicable to single-flow paged layout.

## Architectural compass

Browser-faithful by default. Modern browsers (Chromium LayoutNG, Gecko continuation frames, WebKit) integrate fragmentation with the layout walk itself — break decisions happen *during* layout, not in a post-hoc pass over an already-laid-out tree. P1.A took the post-hoc shortcut; P1.B pays it back. The architecture doc (`docs/architecture/1-core/1.5-pagination.md`) already specifies the interleaved-with-BFC approach.

## Out of scope (recap with reasons)

- **Page templates / headers / footers / footnotes** → P1.C. `PageBox.headerSlot` / `footerSlot` / `footnoteSlot` remain `null` from P1.B output.
- **`break-before: recto`/`verso`/`left`/`right`** → P1.C (need left/right templates).
- **`break-before: column`/`region`** → out forever (no multi-column or named regions until P26 / never).
- **Generated content / `target-counter()`** → P9a / P9b.
- **Floats spanning pages** → separate piece (call it P1.D, or roll into P12 if positioning lands first). Current float environment is single-fragment-aware.
- **Incremental pagination** (repaginate only from affected page forward) → P18.
- **Per-paragraph line-layout cache** (avoid re-laying-out the prefix at IFC resume) → P18.
- **Cross-page table row-spanning** → irrelevant until P8 introduces rowspan.

---

## 1. Architecture and data flow

**Where pagination integrates.** BFC at the document root. When `EditorConfig.pageConfig` is set, the root BFC produces a sequence of `PageBox`es directly. Inner BFCs (nested block containers) don't decide page breaks themselves — they're placed by their parent BFC, which decides whether the nested BFC fits or needs to fragment.

**A `FragmentationContext` flows down the layout walk:**

```ts
interface FragmentationContext {
  readonly availableBlockSize: number;        // space remaining on the current fragment
  readonly pageIndex: number;
  readonly resumeFrom: BreakToken | null;     // null on first attempt for a fragment
}
```

**BFC's child-placement loop becomes break-aware.** Per child K:

1. Invoke `layoutBlock(child, ctx, childFragmentation)` where `childFragmentation` carries the remaining space and (for the *first* child placed when resuming) the inherited `resumeChildToken`. The call returns `{ box, breakToken }`.
2. `breakToken === null` → child fitted entirely. Place `box`, advance `accumulatedOffset`. Honor `cs.breakAfter` after this step.
3. `breakToken !== null` → child fragmented. `box` is the partial first-part. Place it. Return immediately from BFC with `breakToken: { type: "block", resumeChildIndex: K, resumeChildToken: breakToken }`. The page coordinator wraps the BFC's result into a `PageBox` and re-enters BFC on the next page with the saved token.
4. If the child reports it can't fragment at all on this page (returns `box: null` + `breakToken !== null`) AND the BFC has already placed earlier children on this page → discard the null box; return `breakToken: { type: "block", resumeChildIndex: K, resumeChildToken: null }` to push the whole child to the next page.
5. If `cs.breakInside === "avoid"` AND the child returned a partial result (`box != null` + `breakToken != null`) → discard the partial result, return `breakToken` per (4) to push whole. Exception (overflow rule, Section 2): BFC has placed nothing yet on this page (`accumulatedOffset === 0`) → place the *whole* unfragmented child anyway; the implementation re-invokes `layoutBlock(child, ctx, undefined)` (no fragmentation) and accepts the full box, advancing `accumulatedOffset` past `availableBlockSize`. The page renders the overflowing child past its bottom margin; the next child still pushes cleanly to a new page since `remaining = availableBlockSize - accumulatedOffset` is negative.

**Each formatting context owns its own fragmentation logic:**

- **BFC** (block container) — fragments at child boundaries. Recursive: a nested BFC can produce a partial first-part containing only some of its children.
- **IFC** (paragraph) — fragments at line boundaries with widows/orphans + hyphen-pair constraint.
- **Table FC** — fragments at row boundaries; `<thead>` rows repeat at the top of each table-fragment.
- **Atomic boxes** (images, hr) — non-fragmentable; treated as `break-inside: avoid` implicitly.

**`paginate.ts` shrinks to a page-by-page coordinator.** Outer loop:

1. Initialize `FragmentationContext { availableBlockSize: pageContentSize, pageIndex, resumeFrom }`.
2. Drive `layoutBlock(rootNode, ctx, fragmentation)` over pending content.
3. Receive `{ box, breakToken }`; emit a `PageBox` wrapping `box`; carry `breakToken` as `resumeFrom` for the next iteration.
4. Loop until `breakToken === null`.
5. Empty input → emit one blank page (P1.A behavior preserved).

**P1.A's surface that survives unchanged.** `PageBox`, `PageConfig`, `PageMargins`, `EditorConfig.pageConfig` wiring, paint-cache PageBox case, canvas-renderer PageBox case, public API exports.

**What gets rewritten.** `paginateRoot`'s body and `withBlockOffset` (no longer needed — children compute their own positions during BFC layout in the new fragment context).

---

## 2. Fragmentation algorithm

**Paragraph (IFC) split-point search.** Given available block size `A` on the current page, find the largest `k` where:

- `sum(lineHeights[0..k])` fits in `A`,
- `k >= orphans` (≥ orphans lines stay on the current page),
- `lines.length - k >= widows` (≥ widows lines go to the next page),
- `lines[k]` doesn't end with a hyphenation continuation that begins on `lines[k+1]` (CSS L4 §5: the hyphenated word stays whole on one page).

If no valid `k`, return `(firstPart=null, remainder=whole-paragraph)`. BFC pushes the entire paragraph to the next page. Per CSS L4 §5.4, this is permitted when widows/orphans cannot be satisfied.

**BFC recursive fragmentation.** A non-paragraph block container that doesn't fit fragments via the same `layoutBlock(node, ctx, fragmentation)` entry point — the dispatch is uniform across paragraph / table / nested block container based on the node's `display`. The nested BFC's child-placement loop (described above) runs against `availableBlockSize = remainingSpace`. Its result is a `box` containing only the children that fitted plus a `breakToken` of the form `{ type: "block", resumeChildIndex: i, resumeChildToken: ... }` pointing into the nested BFC's own children. When the nested call's `box` is null (couldn't fit even its first child), the outer BFC handles it per step 4 above.

**Table FC fragmentation.** Split at row boundaries. The remainder fragment carries `<thead>` rows repeated at its top — the original `<thead>`'s rows are referenced (cascade output is reference-stable, so the same row instances are reused) into the remainder. Rows themselves are atomic in P1.B; tall single rows that don't fit a page are pushed whole.

**Margin collapsing across breaks (CSS L4 §5.4).** "Margins are truncated such that no margin spans the fragmentation break." Two truncation points:

1. **First child of a new fragment.** When BFC starts placing children on a fresh page (or resuming after a page break), the first child placed has its top margin treated as 0 — its `cs.marginTop` does not contribute to `accumulatedOffset`. Implementation: BFC's "is-first-on-this-fragment" flag drives margin suppression.
2. **Last child of a finished fragment.** When BFC closes a page, the most-recently-placed child's bottom-margin is dropped from the page's used block-size.

**`break-before` consumer.** In BFC's child-placement loop, before laying out child K (skip for the first child of the current fragment): inspect `cs.breakBefore`.

- `page` or `always` AND the current fragment has placed content → finish current page, return `breakToken: { type: "block", resumeChildIndex: K, resumeChildToken: null }`.
- `page` or `always` AND no content placed yet → no-op (CSS L4 §3.4: no forced break before the first piece of content in a fragmentation flow).
- All other values for P1.B → treat as `auto`.

**`break-after` consumer.** After placing child K, inspect `cs.breakAfter`.

- `page` or `always` AND K+1 exists → finish current page, return `breakToken: { resumeChildIndex: K+1, resumeChildToken: null }`.
- Else → no-op.

**`break-inside: avoid` consumer.** When the layout call for child K returns either `box: null` or a partial result (`box != null` + `breakToken != null`) and `cs.breakInside === "avoid"` (or `avoid-page`):

- Page non-empty (`accumulatedOffset > 0`) → push K whole to next page (BFC returns `breakToken: { resumeChildIndex: K, resumeChildToken: null }`).
- Page empty AND K still doesn't fit whole → place K anyway by re-invoking `layoutBlock(child, ctx, undefined)` (no fragmentation context) and accepting the full unfragmented box. The page overflows past its bottom margin. Per CSS L4 §3.5: avoid is preferred, not mandatory; layout proceeds as if `auto` when no valid break point exists.

**Value normalization.** Single helper `normalizeBreakValue(raw): "auto" | "page" | "avoid"` maps the schema string to the three values BFC actually consumes. `always` → `page`; `avoid-page` → `avoid`; unsupported (`recto`/`verso`/`left`/`right`/`column`/`region`/`avoid-column`/`avoid-region`) → `auto`.

**Edge case — content taller than a page.** A single line with `font-size: 10000px` on a normal page is taller than the page's content area. Pragmatic rule: when `accumulatedOffset === 0` (nothing placed on the current page yet), place the offending line/box anyway (overflow the page bottom). Prevents infinite paginate-empty-page loops. Matches browser behavior for truly oversize content on a paged medium.

---

## 3. Types and interface signatures

```ts
type BreakToken = BlockBreakToken | IFCBreakToken | TableBreakToken;

interface BlockBreakToken {
  readonly type: "block";
  readonly resumeChildIndex: number;            // index of next child to lay out
  readonly resumeChildToken: BreakToken | null; // if that child was mid-fragment
}

interface IFCBreakToken {
  readonly type: "ifc";
  readonly resumeAtLine: number;                // 0-based line index in the paragraph
}

interface TableBreakToken {
  readonly type: "table";
  readonly resumeAtRow: number;                 // 0-based row index in the table body
}

interface FragmentationContext {
  readonly availableBlockSize: number;
  readonly pageIndex: number;
  readonly resumeFrom: BreakToken | null;
}

interface LayoutResult<T extends LayoutBox = LayoutBox> {
  readonly box: T | null;                       // null only in the paginated path when no content was placed on this fragment
  readonly breakToken: BreakToken | null;       // null when layout completed without breaking
}
```

**Generic on the box subtype.** Each FC's entry point advertises the specific kind of `LayoutBox` it produces:
- `layoutBlock` returns `LayoutResult<BlockBox>`
- `layoutInlineContent` returns `LayoutResult<BlockBox>` (a wrapping block of lines)
- `layoutTable` returns `LayoutResult<TableBox>`

Consumers get the narrow type for free — no per-call-site `.type` guards beyond the standard `if (result.box === null) throw` pattern. Mirrors LayoutNG's typed-fragment model where each layout phase produces fragments specific to its layout kind.

**Entry-point signature change.** `layoutBlock` / `layoutInlineContent` / `layoutTable` each gain an optional `fragmentation?: FragmentationContext` parameter and return `LayoutResult<T>` (with `T` specific to the FC) instead of a bare concrete box type. When `fragmentation` is `undefined` (unpaginated path), `box` is always non-null and `breakToken` is always `null`. When `fragmentation` is set, layout may return:
- `{ box: <full>, breakToken: null }` — content fit entirely.
- `{ box: <partial>, breakToken: <resume-state> }` — content fit partially; remainder needs another fragment.
- `{ box: null, breakToken: <resume-from-start> }` — content couldn't fit on this fragment at all (parent must push whole to next).

**Coordinator loop in `paginate.ts`:**

```ts
function paginateRoot(
  rootNode: RenderNode,
  ctx: LayoutContext,
  pageConfig: PageConfig,
): BlockBox {
  const pages: PageBox[] = [];
  let resumeFrom: BreakToken | null = null;
  let pageIndex = 0;
  const contentSize = pageConfig.pageBlockSize - pageConfig.pageMargins.blockStart - pageConfig.pageMargins.blockEnd;
  if (contentSize <= 0) throw new Error("Invalid PageConfig: page content size is non-positive");
  do {
    const fragmentation = { availableBlockSize: contentSize, pageIndex, resumeFrom };
    const { box, breakToken } = layoutBlock(rootNode, ctx, fragmentation);
    pages.push(createPageBox(pageIndex, box, /* geometry */));
    resumeFrom = breakToken;
    pageIndex++;
  } while (resumeFrom !== null);
  if (pages.length === 0) {
    pages.push(createPageBox(0, /* empty */));
  }
  return wrapPagesAsRoot(pages);
}
```

**IFC resume behavior.** With `resumeFrom: { type: "ifc", resumeAtLine }`, the IFC re-runs line layout from line 0 (line layout is deterministic given content + width), then emits lines starting at `resumeAtLine`. The prefix is re-laid-out and discarded at re-entry. Acceptable for P1.B; per-paragraph line-layout caching is P18.

**Table FC resume behavior.** With `resumeFrom: { type: "table", resumeAtRow }`, rows `0..resumeAtRow-1` are skipped; `<thead>` rows emit at the top of the new fragment regardless; row `resumeAtRow` onward emits in order.

---

## 4. Cursor, hit-test, and selection across fragments

**Invariant: state tree is the source of truth.** Editor actions operate on state-tree positions; fragmentation lives entirely on the layout side. Editor reducers don't need pagination awareness.

**Hit-test.** A fragmented paragraph produces two `BlockBox` instances (one per page), both pointing at the same source `RenderNode`, each containing a subset of `LineBox` children. `LineBox`es preserve their per-character offsets within the paragraph regardless of fragment. `collectAllTextBoxes` (already PageBox-aware from P1.A.14) walks both pages and returns all text boxes with absolute coordinates + `pageIndex`. The character offset in the matched `TextRunBox` maps back to a state-tree position via existing machinery. No new code in `hit-test.ts`; correctness falls out of the partial `BlockBox`es carrying correct line indices.

**Cursor resolution.** `resolvePixelPosition(stateTreePosition)` walks the layout tree, finds the `LineBox` containing the target offset, returns `{ x, y, pageIndex }`. With fragmentation, `collectTextBoxes` (per-`RenderNode` variant in `cursor-position.ts`) finds *both* partial `BlockBox`es for a fragmented paragraph; the caller picks by line offset.

**Arrow-key line navigation across pages.** `line-navigation.ts` already delegates to `layout-utils` helpers, so PageBox traversal works. Arrow-down from the last line on page 1 finds the next line by global line-ordering — line K+1 on page 2 with page-relative `y ≈ 0` and `pageIndex = 1`. **P1.B verifies and tests** that the line-comparison logic orders globally (page-major, then within-page y) rather than within-page y alone. Tests added for arrow-up/down crossing page boundaries.

**Selection rendering.** `computeSelectionRects` already returns per-line rects with `pageIndex`. For a selection spanning page 1 to page 2, the rect collection includes lines from both pages with correct page-relative coords. Already PageBox-aware from P1.A.14.

**Affinity at soft-wrap boundaries.** Soft-wrap positions (end-of-line-K vs start-of-line-K+1, same character offset, different rendering location) become more visually striking when the boundary is also a page boundary. **P1.B does not introduce new affinity behavior**; existing soft-wrap conventions extend across page boundaries. If the affinity convention needs revisiting, that's its own piece (likely P16 — editor utility polish).

**Paint-cache identity.** Fragmented partial `BlockBox`es are distinct instances → distinct `WeakMap` keys → no collision. No paint-cache changes needed.

---

## 5. Testing strategy

Per CLAUDE.md TDD discipline, tests are written first for each task in the implementation plan.

**Unit tests** in `packages/core/src/layout/__tests__/`:

- **`bfc-fragmentation.test.ts`** — whole-block placement on a fresh fragment; child overflows → push to next; `break-before: page` forces new page (no-op when first); `break-after: page` finishes page; `break-inside: avoid` pushes whole; `break-inside: avoid` alone on empty page → places anyway (overflow); recursive fragmentation of nested block container; margin truncation across forced break; margin truncation across overflow break; resume from `BlockBreakToken` (with and without recursive child token).
- **`ifc-fragmentation.test.ts`** — paragraph fits whole; split at line K with widows/orphans satisfied; widows violation → push whole; orphans violation → push whole; hyphen-pair constraint; resume from `IFCBreakToken`; empty paragraph; single oversize line on empty page → overflow.
- **`table-fc-fragmentation.test.ts`** — table fits whole; split at row K; `<thead>` repetition at top of remainder; single oversize row on empty page → overflow; resume from `TableBreakToken`; table with no `<thead>`.

**Coordinator tests** extend `paginate.test.ts` with: forced break produces an extra page even when content fits on one; mixed `BlockBreakToken` + recursive `IFCBreakToken` chain; resume-from-token correctness across multiple iterations.

**Integration tests** in `packages/core/src/integration/`:

- **`pagination-fragmentation.test.ts` (new)** — multi-page document with paragraph fragmentation; `break-before: page` in editor flow; widows/orphans honored; edits to fragmented content trigger correct re-pagination.
- **`pagination-cursor.test.ts` (extend)** — cursor at end-of-page-1's-last-line vs start-of-page-2's-first-line; arrow-down from end-of-page-1 → moves to page 2; arrow-up symmetric; selection spanning the fragment boundary.

**Test fixture additions.** `createPaginatedHarness(content, pageConfig)` runs cascade + layout + paginate and returns the page list for assertion. Helpers: `assertPageHasLines(page, expected)`, `assertLineOnPage(layout, lineIndex, pageIndex)`.

**Out of scope for the P1.B test suite.** Visual-regression / canvas paint diffing (brittle, font-dependent, infra-heavy; defer until visible bugs argue for it). Perf-regression gating (perf budget for P1.B is "not catastrophically slower than P1.A whole-block-only"; optimization is P18).

---

## 6. Doc updates that ship with P1.B

- **`docs/architecture/1-core/1.5-pagination.md`** — verify pseudocode matches what we ship; correct any drift. After P1.B, the doc should show `paginateRoot` as the page-by-page coordinator calling `layoutBlock(node, ctx, fragmentation)` with the BFC owning the within-page layout + fragmentation logic. Pseudocode update only; conceptual model is unchanged.
- **`docs/architecture/1-core/1.4-layout/1.4.1-bfc.md`** — add a "Fragmentation" subsection: `FragmentationContext`, `LayoutResult`, the child-placement loop's break-aware behavior, margin truncation across breaks (CSS L4 §5.4).
- **`docs/architecture/1-core/1.4-layout/1.4.2-ifc.md`** — add a "Fragmentation" subsection: line-level split-point search, widows/orphans, hyphen-pair constraint.
- **`docs/architecture/1-core/1.4-layout/1.4.3-table-fc.md`** — add a "Fragmentation" subsection: row-level split, `<thead>` repetition.
- **`docs/architecture/state-of-branch.md`** — pagination status remains `[partial]` overall (P1.C still open) but the within-block-fragmentation gap closes. Update the "Still missing" list to drop the items P1.B addresses.
- **`docs/superpowers/plans/2026-04-30-decomposition.md`** — annotate P1.B as shipped; P1.C remains as the next pagination piece.

## 7. Followups

None expected. P1.B's deferred items map to existing pieces (P1.C, P1.D-or-P12, P18). Genuinely new gaps surfaced during implementation get logged into a `<date>-p1b-followups.md` doc parallel to existing followups patterns.
