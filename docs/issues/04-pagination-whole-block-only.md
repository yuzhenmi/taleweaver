# Issue 04 — Pagination is whole-block only (Major)

## Summary

`paginateDocument` distributes blocks into page boxes top-to-bottom but
never splits a block across pages. A paragraph taller than the available
page content height has undefined behavior (overflows the page or
wedges layout). For an editor whose marketing claim is *word-processor
pagination*, this is the differentiating feature, not a polish item.

## Where it manifests

`packages/core/src/layout/layout-engine.ts:42–109`:

```ts
function paginateDocument(docBox, pageHeight, containerWidth?, margins?) {
  const contentHeight = pageHeight - margins.top - margins.bottom;
  // ...
  for (const child of docBox.children) {
    if (currentPageChildren.length > 0 &&
        currentPageContentHeight + child.height > contentHeight) {
      // flush current page, start new
    }
    // place block on current page
  }
}
```

The comment at line 42 confirms it:

> **Whole-block only — blocks don't split across pages.**

If `child.height > contentHeight`:
- `currentPageChildren.length > 0`: it is placed on a fresh page that
  is still too small for it — overflow.
- `currentPageChildren.length === 0`: the test fails (still nonempty
  fail predicate), so it goes onto the page anyway and overflows.

In either case the painted output extends past the page bottom edge.
The visible result depends on whether the canvas height is clamped
(it is, from `pageHeight × dpr`), so glyphs simply get clipped.

## Why it's a problem

1. **It's the core feature.** The README pitches "word-processor-style
   pagination" as the reason this engine exists. Cross-page block flow
   is what real word processors *do*; if Taleweaver doesn't, it's just
   a contentEditable replacement with extra steps.
2. **Long content is unusable.** A paragraph that exceeds page height
   (very common in legal, academic, or fiction docs) silently overflows.
3. **Tables and images are extra-broken.** A tall table that would
   fit on two pages either overflows or skips a page entirely.
4. **Widow / orphan control is unaddressed.** Even with whole-block
   splitting it would be missing, but it's the next feature you need
   after splitting.

## Fix options

### Option A — split blocks at line boundaries

For block content, the natural split unit is a `LineLayoutBox`. The
algorithm:

1. Lay out blocks against `availableWidth`, ignoring page height.
2. For each block, walk its lines; each line has a height.
3. If block won't fit on remaining current-page space, start filling
   from line zero. When the next line wouldn't fit, finalize a "head
   slice" of the block on the current page, and a "tail slice" carrying
   the remaining lines on the next page.
4. Recursively (block within block: a list-item containing a paragraph)
   the slicing logic must walk to the inline-formatting block to do the
   line-by-line split, and rebuild the block ancestors around each slice.

Pros: matches the way Word and CSS regions work; preserves margins.
Cons: cursor and selection geometry must walk slices correctly; line
boxes need parentage info or pages need to carry pointers back to the
state node so hit-tests work.

### Option B — split tables row-by-row (separate from blocks)

Tables are the simpler case — split between rows, optionally repeating
the header row. A first deliverable; covers many real docs.

Pros: contained, ships a feature.
Cons: doesn't address paragraphs.

### Option C — keep whole-block, page-grow

Detect oversize blocks and grow their page to fit (so the page is a
*minimum* height, not exact). Aesthetically poor for word-processor
intent, but lets large content render.

Not recommended — undermines the whole point.

**Recommendation:** Option A, with B as an explicit milestone along the
way. Add widow/orphan control as a follow-up.

## Concrete plan for Option A

1. Restructure `paginateDocument` into a streaming algorithm that
   accepts blocks and emits page boxes:

   ```
   accumulator: currentPageChildren, currentY
   for each block:
     while block doesn't fit:
       headSlice, tailSlice = sliceBlockToHeight(block, contentHeight - currentY)
       if headSlice nonempty:
         push headSlice; flush page; currentY = 0
         block = tailSlice
       else:
         flush page (block didn't fit at all on current page, will fit alone next)
   ```

2. Define `sliceBlockToHeight(block, available)`. Recursive on block
   children:
   - inline-content block: walk lines; emit head with lines that fit,
     tail with the rest; need to clone metadata/marker properly (marker
     only on head, no marker on tail? — needs decision).
   - block-formatting block: walk children, recursively slicing the one
     that crosses the boundary.
   - table: punt to a separate row-slicer.
   - leaf block (image): no split — push to next page if it doesn't
     fit alone.

3. **Hit-testing impact.** Currently `resolvePositionFromPixel` looks at
   one page at a time. After splits, the same paragraph appears on two
   pages — hit-testing must merge slices when computing positions, and
   `computeSelectionRects` must walk both slices.

4. **Cursor positioning.** `resolvePixelPosition` must know which slice
   contains the position; this needs `pageIndex` plus per-slice line
   offset info on the layout boxes.

5. **Widow/orphan.** Add `widowCount` and `orphanCount` configuration
   on `PageMargins` (or similar). Slicing avoids leaving fewer than
   N lines orphaned at top of next page or widowed at bottom of current.

## Test impact

- Add a test fixture: 200-line paragraph, 100px page, ensure all 200
  lines render across N pages, no overflow.
- Cursor on line 99 of a paragraph that spans pages 1–4 — hit-test and
  pixel-resolve must round-trip.
- Tall table with 30 rows splitting across 3 pages.
- Widow control: paragraph of 3 lines starting at line 26 of a 27-line
  page should bump entirely to next page.
- Snapshot test for cross-page selection rects (highlight crosses page
  boundary).

## See also

- [issue 03](03-inline-layout-not-incremental.md) — incremental layout
  must compose with whatever pagination shape this issue lands on.
- [issue 13](13-long-document-virtualization.md) — pages currently
  hold all blocks alive in memory.
- [architecture/04 layout layer](../architecture/04-layout-layer.md)
