# Issue 13 — Long-document virtualization stops at canvases (Minor)

## Summary

The DOM canvas pool releases canvases for off-screen pages — that part
is good. But the **state, render, and layout trees are eagerly held
in full** in memory and rebuilt on every keystroke. For very long
documents (hundreds of pages, hundreds of thousands of words), the
working set grows linearly and per-keystroke layout cost grows with it.

## Where it manifests

### State tree: fully resident

`packages/core/src/state/state-node.ts` — the entire document is one
frozen tree. There's no "load on demand" mechanism. `findPathById` walks
from the root.

### Render tree: fully resident

`packages/core/src/render/render.ts` produces a render node for every
state node. Even if a paragraph is offscreen, it has a render node.

### Layout tree: fully resident, with per-block heights

`packages/core/src/layout/layout-engine.ts` lays out every block, every
line, every word box for the entire document. Pagination then
distributes them into pages.

### Canvases: the only thing that's virtualized

`packages/dom/src/editor-controller.ts:432–464` — `IntersectionObserver`
with `rootMargin: "200px"` releases canvases for offscreen pages.

### History: fully resident

`packages/core/src/editor/editor-state.ts:108–110` — caps at 500
entries. Each entry holds a full `Change { oldState, newState }`. With
structural sharing this is sub-linear in practice, but a 500-step undo
stack of edits to different parts of a 500-page doc retains plenty of
state branches.

## Why it's a problem

1. **Memory grows linearly.** A 500-page novel could be tens of MB of
   state + render + layout trees. Add a 500-step undo stack on top of
   that.
2. **Per-keystroke pagination cost.** `paginateDocument` walks all
   blocks every keystroke. O(blocks).
3. **Garbage churn.** Even with structural sharing, ancestors of any
   change must be rebuilt — for a deep tree (e.g. nested table inside
   a list), this is non-trivial.
4. **Initial layout is O(everything).** Loading a long doc takes a
   beat; nothing renders until the first layout pass completes.

## Fix options

### Option A — windowed layout

Block render nodes outside a "live window" (visible viewport ± N pages)
produce a `LayoutBox` stub carrying only `height` (estimated or
cached). The actual line/text boxes are computed only for the live
window.

```
LayoutBox = { type: "block-stub"; key; height }   // outside window
LayoutBox = { type: "block"; ...lines, text }     // inside window
```

When the user scrolls, the window slides; new blocks are realized,
old blocks are stubbed. Pagination is then O(blocks-in-window) per
keystroke for visible content; offscreen pagination uses cached heights.

Pros: per-keystroke layout becomes O(visible blocks); memory drops to
O(visible × details + offscreen × stubs).

Cons: hit-testing across the boundary (e.g. cursor placed in
offscreen content via Cmd+End) requires realizing the target window
first. Full search/find requires walking the state tree (still resident)
or a separate index.

### Option B — viewport-only initial layout, lazy full layout

On load, lay out only the first viewport. Lay out the rest in chunks
on idle frames. Block until a target block is laid out if the user
jumps to it.

Pros: fast first paint.
Cons: doesn't bound memory; all blocks are eventually fully laid out.

### Option C — chunked state tree

Keep the document in N chunks (e.g. 10-page slabs). State tree is a
list of chunks. Only the chunks intersecting the visible window have
fully-realized state subtrees; offscreen chunks are stored as
serialized blobs that lazy-load.

Pros: memory bounded.
Cons: massive refactor; cursor positions across chunk boundaries get
hairy.

**Recommendation:** Option A. State stays resident (small enough at
typical doc sizes). Render tree probably also stays resident (cheap).
Layout tree is what blows up when blocks are tall — stub those.

## Migration plan (for Option A)

1. Add a `LayoutWindow` parameter to `layoutTree` /
   `layoutTreeIncremental`: `{ start: number; end: number }` in pixel
   space.
2. Add a `BlockStubLayoutBox` to the discriminated union: just `key`
   plus `height` (cached from last full layout, or estimated from
   lineCount × lineHeight when first encountered).
3. The pagination pass works against any mix of stub and full blocks.
4. The DOM controller drives the window: `update()` decides which
   blocks should be realized given the current scroll position.
5. When a block transitions from stub → full (because it scrolled
   into view), allocate its lines/text boxes. Cursor positioning into
   it triggers a force-realize.
6. Cache stub heights across edits so no re-measure is needed if the
   block's render node didn't change.

## Test impact

- Performance benchmark: typing in a 500-page doc must be O(1).
- Regression test: scrolling 500 pages doesn't regress memory beyond
  a budget.
- Cursor tests: jump to end-of-doc (Cmd+End) realizes the target
  block, places cursor correctly.

## See also

- [issue 03](03-inline-layout-not-incremental.md) — line-stable wrap
  is more important than this for the average doc; combine for the
  best result.
- [issue 04](04-pagination-whole-block-only.md) — pagination changes
  must be compatible with windowed layout.
- [architecture/04 layout layer](../architecture/04-layout-layer.md)
- [architecture/07 DOM controller](../architecture/07-dom-controller.md)
