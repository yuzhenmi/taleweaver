# 1.4 — `layout/`

The layout module produces a `LayoutBox` tree from a cascaded render
tree. Each layout box carries:

- A `ComputedStyle` reference (from the cascade pass).
- A `UsedStyle` — fully numeric resolution of `%`, `auto`, and intrinsic
  keywords against the actual containing block.
- Logical-axis geometry (`inlineOffset`, `blockOffset`, `inlineSize`,
  `blockSize`) and physical-axis geometry (`x`, `y`, `width`, `height`)
  derived from logical via the box's writing-mode.

The layout module is the largest in core. It owns formatting-context
dispatch, anonymous-box generation, real CSS 9.5 floats, intrinsic
sizing, line wrapping, and fragmentation.

## Submodules

### Entry points

- **`dispatch`** — `layoutTree(root, containerWidth, shaper)`. The
  full-tree entry. Constructs the root layout context, dispatches the
  document root through the appropriate formatting context, returns the
  resulting `LayoutBox`.

- **`layout-incremental`** — `layoutTreeIncremental(newRoot, oldRoot,
  oldLayout, containerWidth, shaper)`. The incremental entry. Builds a
  `LayoutBoxCache` from the previous layout and threads it into the
  root context so formatting contexts can short-circuit on unchanged
  subtrees. Used by the editor reducer.

- **`layout-engine`** — re-exports the entry points for downstream
  consumers.

### Formatting contexts

Each formatting context is a layout algorithm that handles one class of
content. The dispatcher in `dispatch.ts` selects the right one based on
each box's `display` value.

- **`bfc`** (Block Formatting Context, file `bfc.ts`) — lays out blocks
  vertically. Owns margin collapsing, clearance, list-marker generation,
  and the BFC's own float environment when the box establishes a new
  BFC. See [`1.4.1-bfc.md`](1.4.1-bfc.md).

- **`ifc`** (Inline Formatting Context, file `ifc.ts`) — lays out
  inline content into lines. Owns line wrapping, baseline alignment,
  cluster-level bidi reorder, hyphen handling, inline-block sizing.
  See [`1.4.2-ifc.md`](1.4.2-ifc.md).

- **`table-fc`** (Table Formatting Context, file `table-fc.ts`) — lays
  out tables. Owns column-width resolution (auto-layout from per-cell
  intrinsics), row heights, anonymous-row/cell synthesis. See
  [`1.4.3-table-fc.md`](1.4.3-table-fc.md).

### Layout context

- **`layout-context`** — `LayoutContext` carries cross-cutting state
  through the layout pass: writing-mode, direction, containing-block
  dimensions, the float environment, the intrinsic-sizes cache, the
  IFC-state cache, the previous-layout cache, the previous float
  environment, the BFC-root flag. Constructed at the root via
  `makeRootContext`; descended via `makeChildContext` which adjusts
  fields as the layout descends into child boxes.

### Anonymous-box generation

- **`group-children`** — `groupChildren(elementBox)` partitions an
  element's children into runs that need anonymous wrappers (per CSS:
  inline runs adjacent to block siblings get wrapped in an anonymous
  block; block-level cells outside a row get wrapped in anonymous rows;
  etc.). Consumed by the BFC (mixed block+inline children) and the
  Table FC (anonymous rows and cells).

- **`bfc-establishment`** — `establishesNewBFC(computedStyle)` returns
  whether a box establishes its own BFC. Used to decide whether the BFC
  inherits its parent's float environment or starts a fresh one.

### Float environment

- **`float-context`** — `FloatEnvironment` manages CSS 9.5 floats within
  one BFC. Provides `placeFloat(side, requestedBlockOffset, inlineSize,
  blockSize, containingInlineSize)` with full push-below-if-needed
  semantics, `availableInlineSizeAt(blockOffset)` for IFC line
  placement, `clearance(side, blockOffset)` for `clear` property
  resolution, and `dirtyBlockOffsetSince(prev)` for incremental layout
  invalidation.

### Intrinsic sizing

- **`intrinsic-sizes`** + **`intrinsic-sizes-pass`** — computes
  min-content and max-content per render node. `IntrinsicSizes` holds
  the values; `IntrinsicSizesCache` memoizes them per render-node
  reference. The BFC consults intrinsic sizes for shrink-to-fit
  inline-blocks and floats; the Table FC uses them for auto-layout
  column widths.

### Reuse and incremental machinery

- **`layout-reuse`** — `LayoutBoxCache` (per-render-node-key cache of
  prior layout boxes), `buildLayoutBoxCacheFromTree` (populates a cache
  from a previous layout pass), `isLayoutBoxReusable` (predicate over
  invariants like containing-inline-size, writing-mode, and float-env
  dirty offset), `renderNodesLayoutEquivalent` (extends the predicate
  to the case where a parent was rebuilt with reference-equal children).

- **`ifc-state`** — `IFCState` (per-paragraph wrap state),
  `IFCStateCache` (paragraph-level identity cache). Lets a paragraph
  whose tokens haven't changed reuse its cached line layout wholesale.

- **`wrap-incremental`** — convergence-detection algorithm for
  within-paragraph incremental wrap (algorithm only; not yet wired into
  the IFC's main wrap loop).

### Tokenization and text-measurement

- **`text-shaper`** — the `TextShaper` interface. The contract: given
  text + computed style + options, return positioned glyphs, cluster
  boundaries, break opportunities, bidi levels, and font metrics.
  Hosts implement; layout consumes.

- **`text-tokenize`** — partitions a text run into wrap-units (`Token`s)
  for the IFC. Each token is a contiguous run with shared style and
  break-opportunity semantics.

- **`text-measurer`** — legacy `TextMeasurer` interface (a
  width-only measurer) plus an adapter (`adaptShaperToMeasurer`) that
  bridges old consumers. Sunset path; new code uses `TextShaper`.

- **`mock-shaper`** — a deterministic in-memory shaper used by tests.

### Layout-box types and helpers

- **`layout-node`** — re-exports from `layout-box-v2` for downstream
  consumers.

- **`layout-box-v2`** — defines the `LayoutBox` discriminated union
  (`BlockBox`, `LineBox`, `TextRunBox`, `InlineBox`, `MarkerBox`,
  `TableBox`, `TableRowBox`, `TableCellBox`) and the per-type frozen
  factories. Each factory takes logical-axis args, applies `writingMode`
  + `direction`, and emits both logical and physical fields. Also
  defines `withInlineOffset` for IFC bidi reorder.

- **`used-style`** — `computeUsedStyle(computedStyle,
  containingInlineSize, containingBlockSize)` resolves
  declared-but-not-computed length values (`%`, `auto`) against the
  containing block. Called by every formatting context as it lays out
  each box.

- **`list-counter`** — `formatCounter(value, style)` for ordered-list
  marker text generation. Used by the BFC when emitting marker boxes.

## How the modules connect

The reducer calls `layoutTreeIncremental(newRoot, oldRoot, oldLayout,
containerWidth, shaper)`. This:

1. Builds a `LayoutBoxCache` from `oldLayout` indexed by render-node key.
2. Constructs a root `LayoutContext` containing the cache, the shaper,
   the container size, and a fresh `FloatEnvironment`.
3. Dispatches the root through `dispatch.ts`, which calls the
   appropriate formatting context (BFC for `display: block`, table-fc
   for `display: table`, etc.).

Each formatting context, when entered:

1. Checks the layout-box cache for a reusable subtree — if the box's
   render node is layout-equivalent to the cached entry's, the prior
   `LayoutBox` is returned by reference.
2. Otherwise: computes used style, resolves intrinsic sizes if needed,
   lays out children, and returns a fresh `LayoutBox`.

The float environment threads through every box within a BFC; the IFC
queries it to place lines beside floats; new floats register with it.

The intrinsic-sizes cache sits per-render-node; multi-pass layout (e.g.,
auto-layout tables that compute per-cell intrinsics, then resolve column
widths) calls into it without recomputing.

The IFC-state cache sits per-paragraph; an unchanged paragraph short-
circuits its entire wrap.

## Reading order

1. [`1.4.1-bfc.md`](1.4.1-bfc.md) — BFC algorithm: margin collapsing, floats, list markers, fragmentation entry.
2. [`1.4.2-ifc.md`](1.4.2-ifc.md) — IFC algorithm: line wrap, baseline alignment, cluster reorder, inline-block sizing.
3. [`1.4.3-table-fc.md`](1.4.3-table-fc.md) — Table FC algorithm: column widths, row heights, anonymous synthesis.
