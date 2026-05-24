# Enter-at-top O(N) layout — root cause + the virtualization fork

**Date:** 2026-05-24
**Status:** investigated; content-keyed page reuse REJECTED; escalating the
architectural fork
**Module:** `packages/core/src/layout/{paginate,layout-incremental,bfc}.ts`
**Relates to:** task #247 (L-PERF-F, deferred), task #249 (ENTER 150ms)

## Measured root cause

In-browser perf trace, single Enter at the top of a ~110-page fixture
("mostly empty lines"):

| label | totalMs | count |
|---|---|---|
| `layoutTreeIncremental` | 175.3 | 1 |
| `bfc.layoutBlock` | 203.4 | **7677** |
| paint / syncDom / scroll / cursor | < 6 | — |

The cost is entirely in the model-layer layout pass. A unit diagnostic
(`SPLIT_NODE at top of 500-paragraph doc`) makes the shape explicit:

```
[ENTER@top N=500] hits=498 fulls=30 misses{pos=498 renderInequiv=16}
```

- `renderInequiv=16` — blocks genuinely re-laid-out (the split block, the new
  block, plus the ripple). Small and bounded.
- `pos=498` — blocks that **only shifted position** (content identical) and
  were re-emitted as repositioned clones.

Inserting one line at the top of an exactly-full document pushes every
subsequent block down by one line. Because the pages were full, the last
block of each page overflows onto the next page: **every page boundary shifts
by one block, and every one of the ~N blocks after the edit gets a freshly
allocated repositioned box.** That allocation × N is the 175ms.

This is fundamental to the current layout model: each keystroke materializes
a fully positioned page tree for the **entire** document, so any edit whose
height delta ripples to the end is O(N_blocks) — regardless of how cheap each
per-block step is.

## Why content-keyed page reuse does NOT fix it (rejected)

The natural extension of L-PERF-C is to match cached pages by **content**
(first-child render-node reference) instead of absolute child index, and
reposition the cached `PageBox` to its new offset (page-level
reposition-on-clone). I implemented and tested this. It does not help the
reported workload:

- Reuse requires a new page to **start at the same block** a cached page
  started at. In the cascade case every page now holds a *different* block
  set (shifted by one block), so no new page start coincides with any cached
  page's first child. The content-keyed lookup never hits.
- It only helps when boundaries happen to **realign** (insertion of an exact
  multiple of a page's content). That is rare and not the user's case.

It was reverted to keep `paginate.ts` clean (no half-measure that adds code
paths without solving the problem). Tasks #247 / L-PERF-F are closed as
"won't fix via page reuse — superseded by virtualization below."

## The real fix: virtualize layout to the visible region

The DOM controller already virtualizes **paint**: only pages intersecting the
viewport (via `IntersectionObserver`, `rootMargin: 200px`) get a canvas and
get painted. The model layer does **not** virtualize **layout** — it builds a
positioned box for every page on every keystroke. Aligning the model with the
existing paint virtualization is the fix and the path to the CLAUDE.md bar
("O(1) per keystroke regardless of document size").

Sketch (to be designed properly before building):

1. **Per-block layout cache, position-free.** Keep each block's intrinsic
   size + internal line layout cached per block (already true via L-PERF-G's
   subtree cache). Crucially, store block heights so the document's vertical
   extent is known without materializing positions.
2. **Lazy vertical offsets.** Maintain block (or page) heights in a structure
   that supports O(log N) point-update (one block's height changed) and
   O(log N) "which block/page is at document-y Y" query — e.g. a Fenwick /
   order-statistics tree over block heights. An edit updates O(dirty) entries;
   total document height is a prefix-sum query.
3. **Materialize only visible pages.** `layoutTreeIncremental` (paginated
   path) produces positioned `PageBox`es only for the page range the
   controller asks for (viewport ± margin). Off-screen pages are represented
   by lightweight placeholders (index + offset + height) so scrollbars and
   page-slot DOM sizing stay correct.
4. **Consumers read positions lazily.** Paint already only touches visible
   pages. Cursor / hit-test / selection-geometry must resolve a position by
   asking the offset structure for the containing page and laying that page
   out on demand (cache it). L-PERF-D's `LineIndex` is the precedent for
   on-demand, cached positional lookup.

Result: a keystroke re-lays-out only the dirty page(s) + visible pages =
O(visible + dirty), independent of document length. Matches how Google Docs
and browser layout virtualization behave.

## Scope / risk

This is **cross-cutting** (CLAUDE.md coordination-protocol trigger): it
changes the shape of the paginated layout tree and touches every consumer
that walks pages — paint, cursor-position, hit-test, selection-geometry,
line-navigation, scroll sizing. It is a multi-session effort and needs its own
spec + plan + phased implementation with the review gate at each step.

It also interacts with already-shipped pieces: L-PERF-C (page reuse),
L-PERF-D (LineIndex), L-PERF-G (subtree reposition) become either subsumed or
the building blocks of the lazy structure.

## Decision needed (escalated to user)

Three options, in priority order of my recommendation:

1. **Commit to virtualized layout now** (foundations-before-features; the only
   path to true O(1)). Largest effort; correct long-term.
2. **Reduce the O(N) constant** as a stopgap (make reposition-on-clone
   cheaper — e.g. skip re-freezing, pool boxes), buying maybe 2-4× while the
   virtualization is designed. Still O(N); only delays the wall.
3. **Defer** — accept current Enter-at-top cost on very long docs, focus
   elsewhere, revisit when virtualization is scheduled.
