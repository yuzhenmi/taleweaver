# 2.2 — `layout/` (geometric box-layout engine)

> **Ownership note.** The GEOMETRIC box-layout engine this
> file describes — formatting-context dispatch (BFC/IFC/Table FC), anonymous-box
> generation, real CSS 9.5 floats, fragmentation, the `LayoutBox`/`PageBox` tree,
> the virtual-layout-tree, used-style resolution — lives in
> `@taleweaver/print` (`packages/print/src/layout/`). `@taleweaver/core` is
> headless/geometry-free; what STAYS in `core/src/layout/` is only the
> **text-core** mechanics that need no positioned geometry: UAX #14 line-break
> (`uax14/`), UAX #9 bidi (`uax9/`), grapheme clustering (`graphemes.ts`), the
> `TextShaper`/`TextMeasurer` interfaces (+ mocks), intrinsic-size measurement
> (`intrinsic-sizes.ts`), the `mat2d` affine primitive, text-transform/tokenize/
> spacing, and the `Hyphenator` interface — documented in
> [`1-core/1.4-text.md`](../../1-core/1.4-text.md). The geometric-layout
> architecture documented below describes the `@taleweaver/print` engine; see
> [`2-print/overview.md`](../overview.md).

The geometric layout engine (now in `@taleweaver/print`) produces a `LayoutBox`
tree from a cascaded render tree. Each layout box carries:

- A `ComputedStyle` reference (from the cascade pass).
- A `UsedStyle` — fully numeric resolution of `%`, `auto`, and intrinsic
  keywords against the actual containing block.
- Logical-axis geometry (`inlineOffset`, `blockOffset`, `inlineSize`,
  `blockSize`) and physical-axis geometry (`x`, `y`, `width`, `height`)
  derived from logical via the box's writing-mode.

It owns formatting-context dispatch, anonymous-box generation, real CSS 9.5
floats, intrinsic sizing, line wrapping, and fragmentation. (The
intrinsic-size measurement primitive `computeIntrinsicSizes` and the
shaper/measurer interfaces it consumes are the geometry-free pieces that STAY in
`@taleweaver/core`.)

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

### Formatting contexts

Each formatting context is a layout algorithm that handles one class of
content. The dispatcher in `dispatch.ts` selects the right one based on
each box's `display` value.

- **`bfc`** (Block Formatting Context, file `bfc.ts`) — lays out blocks
  vertically. Owns margin collapsing, clearance, list-marker generation,
  and the BFC's own float environment when the box establishes a new
  BFC. See [`2.2.1-bfc.md`](./2.2.1-bfc.md).

- **`ifc`** (Inline Formatting Context, file `ifc.ts`) — lays out
  inline content into lines. Owns line wrapping, baseline alignment,
  cluster-level bidi reorder, hyphen handling, inline-block sizing.
  See [`2.2.2-ifc.md`](./2.2.2-ifc.md).

- **`table-fc`** (Table Formatting Context, file `table-fc.ts`) — lays
  out tables. Owns column-width resolution (auto-layout from per-cell
  intrinsics), row heights, anonymous-row/cell synthesis. See
  [`2.2.3-table-fc.md`](./2.2.3-table-fc.md).

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
  Table FC (anonymous rows and cells). Also exports `flattenContents`,
  which implements `display: contents` (CSS Display 3 §3.2): a
  `display: contents` element generates no box, so it is spliced out and
  replaced in place by its own children (recursively). `flattenContents`
  is applied at every child-walk that must agree on this transparency —
  `groupChildren` itself, the intrinsic-sizes pass, the measure/paginate
  fit-meta walk, the IFC inline-token collection, and the layout-reuse
  cache index — so a transparent element (e.g. a `section` block) never
  contributes a box, margin, or break context of its own.

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
  the public `{minContent, maxContent}`; the pass threads an extended
  `IntrinsicContribution` (adds `firstCluster`/`restMin`) so it can apply
  `text-indent` to a block's first formatted line (CSS Text §8 + CSS
  Sizing §5). `IntrinsicSizesCache` memoizes the `IntrinsicContribution`
  per render-node reference (a warm entry short-circuits the whole
  subtree); `computeIntrinsicSizes` derives the `IntrinsicSizes` view at
  its boundary. The BFC consults intrinsic sizes for shrink-to-fit
  inline-blocks and floats; the Table FC uses them for auto-layout
  column widths.

  **Definite-inline-size short-circuit (CSS Sizing 3 §5.1).**
  `computeBlockContribution` short-circuits a block-level box with a
  DEFINITE numeric `inlineSize`: it contributes that fixed size as BOTH
  min-content and max-content, regardless of its children (per CSS Sizing 3
  §5.1 — a definite size IS the intrinsic contribution). This is what lets a
  CHILD-LESS block with an explicit width — the inner image block of an
  inline-image's Option-B render form (see
  [`1.2-render.md`](../../1-core/1.2-render.md#inline-images-in-line-image-embeds)) —
  report a nonzero intrinsic width, so its wrapping shrink-to-fit inline-block
  sizes to the image instead of collapsing to zero.

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

- **`wrap-incremental`** — `findChangePoint` (live: powers the IFC's
  all-or-nothing paragraph reuse) plus `rewrapIncremental`, the
  convergence-detection algorithm for within-paragraph incremental wrap
  (algorithm only; not yet wired into the IFC's main wrap loop — scoped
  to P18, blocked on four integration hazards detailed in
  `2.2.2-ifc.md` "Convergence (incremental wrap)").

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

- **`layout-node`** — re-exports from `layout-box` for downstream
  consumers.

- **`layout-box`** — defines the `LayoutBox` discriminated union
  (`BlockBox`, `LineBox`, `TextRunBox`, `InlineBox`, `MarkerBox`,
  `TableBox`, `TableRowBox`, `TableCellBox`) and the per-type frozen
  factories. Each factory takes logical-axis args, applies `writingMode`
  + `direction` via `logicalToPhysical`, and emits both logical and
  physical fields. Also defines `withInlineOffset` for IFC bidi reorder.

- **`physicalize-vertical`** — `physicalizeVertical(box,
  containerBlockSize)` runs the `vertical-rl` post-layout block-axis mirror
  (see [Logical-axis discipline](#logical-axis-discipline-and-the-vertical-rl-physicalize-pass)
  below).

- **`used-style`** — `computeUsedStyle(computedStyle,
  containingInlineSize, containingBlockSize)` resolves
  declared-but-not-computed length values (`%`, `auto`) against the
  containing block. Called by every formatting context as it lays out
  each box.

  (Note: the layout pass no longer COUNTS list markers — the old
  `layout/list-counter.ts` was deleted. Marker text is computed at render
  time by the numbering service and baked onto the list-item's
  `markerText` style; the BFC reads it and paints it. The shared marker
  formatter is `formatCounter(value, style)` in `styles/format-counter.ts`,
  consumed by the render-time numbering service, not by layout. See
  [`1.2-render.md`](../../1-core/1.2-render.md) "Numbering (list markers)" and
  [`2.2.1-bfc.md`](./2.2.1-bfc.md) "List markers".)

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

## Logical-axis discipline and the vertical-rl physicalize pass

The formatting contexts compute geometry on the **logical** axes, never on
the physical `width`/`height`/`x`/`y`. BFC block-advancement and the final
block-size accumulate the child's `blockSize`; IFC line packing and content
extents use `inlineSize`; inline-block sizing projects the child's physical
box onto the parent IFC's inline/block axes via `axisMapFor`; the bidi
reorder packs visual order into the logical `inlineOffset` so that
`logicalToPhysical` maps it onto the active physical inline axis (x for
`horizontal-tb`, y for the vertical modes). Each box's physical fields are
derived from its logical fields by its factory's `logicalToPhysical` call.
This keeps a single layout algorithm correct across all three writing modes
— the FC code reads no physical coordinate, so the writing mode lives
entirely in the logical→physical mapping.

The one mapping a factory cannot complete eagerly is the `vertical-rl`
block-axis mirror (`x = containingBlockSize − blockOffset − blockSize`): an
auto-size block's block-size is the OUTPUT of laying out its children, so at
factory time the containing block-size is `"indefinite"` and the factory
stores the un-mirrored pending x. `physicalizeVertical(box,
containerBlockSize)` runs after layout (and pagination) finishes, when every
container's `blockSize` is resolved, and recursively bakes the mirror into a
fully-physical tree. It runs at both layout seams — the non-virtual
`paginateRoot` and the virtual `materializePage` — and recurses into a
`PageBox`'s named `headerSlot` / `footerSlot` / `footnoteSlot` as well as its
`children`; the page FRAME itself is not mirrored, only the page CONTENT.
For `horizontal-tb` and `vertical-lr` (no block-axis mirror) it returns the
input box by reference — zero cost, byte-identical for all non-`vertical-rl`
content. After this pass `box.x` / `box.y` are authoritative for every
downstream consumer (paint, hit-test, caret, selection). See
[`1.0-styles.md`](../../1-core/1.0-styles.md#logicaltophysical--full-mapping-for-all-writing-modes)
for the per-mode mapping table.

## Reading order

1. [`2.2.1-bfc.md`](./2.2.1-bfc.md) — BFC algorithm: margin collapsing, floats, list markers, fragmentation entry.
2. [`2.2.2-ifc.md`](./2.2.2-ifc.md) — IFC algorithm: line wrap, baseline alignment, cluster reorder, inline-block sizing.
3. [`2.2.3-table-fc.md`](./2.2.3-table-fc.md) — Table FC algorithm: column widths, row heights, anonymous synthesis.

## Reference

### `LayoutBox` discriminated union

```ts
type LayoutBox =
  | BlockBox        // type: "block"
  | LineBox         // type: "line"
  | TextRunBox      // type: "text-run"
  | InlineBox       // type: "inline"
  | InlineBlockBox  // type: "inline-block"
  | MarkerBox       // type: "marker"
  | TableBox        // type: "table"
  | TableRowBox     // type: "table-row"
  | TableCellBox    // type: "table-cell"
  | MultiColumnBox  // type: "multicolumn" — N side-by-side column tracks (a multicol page body)
  | PageBox;        // type: "page"
```

All variants extend a common base:

```ts
interface LayoutBoxBase {
  readonly key: string;

  // Logical (parent-relative)
  readonly inlineOffset: number;
  readonly blockOffset:  number;
  readonly inlineSize:   number;
  readonly blockSize:    number;

  // Physical (parent-relative; derived from logical via writing-mode)
  readonly x: number;
  readonly y: number;
  readonly width:  number;
  readonly height: number;

  readonly writingMode: WritingMode;
  readonly direction:   Direction;

  readonly computedStyle: Readonly<ComputedStyle>;
  readonly usedStyle:     Readonly<UsedStyle>;

  // Positioning (optional; see 2.4-positioning.md). Omitted on the common path
  // so the un-positioned fast paths stay read-free.
  readonly relativeOffset?:   { readonly dx: number; readonly dy: number };  // position: relative paint-time delta
  readonly absoluteChildren?: readonly LayoutBox[];                          // position: absolute out-of-flow descendants whose abc is this box
}
```

Per-variant additions:

| Type | Adds |
|---|---|
| `block` | `children: readonly LayoutBox[]`; optional `metadata: LayoutBoxMetadata` (typed struct — see below). |
| `line` | `children: readonly LayoutBox[]`; `baseline: number` (offset from top of line). |
| `text-run` | `text: string`; optional `link?: string` — the source hyperlink URL (the inline item's `link` attr), per-run identity metadata OPAQUE to geometry, threaded render `TextBox.link` → IFC `Token.link` → `TextRunBox.link` and copied through every reorder / hyphen-split / bidi-split rebuild; consumed by export (PDF `/Link`). `undefined` for runs with no link. |
| `inline` | `children: readonly LayoutBox[]`; `fragmentEdge: "first" \| "middle" \| "last" \| "only"` (which side has padding/border). |
| `inline-block` | `children: readonly LayoutBox[]`; optional `targetId?: string` — for a cross-reference atom, the target block id it points to (the source render node's `metadata.targetId`), per-box identity metadata OPAQUE to geometry, threaded render `metadata.targetId` → `InlineBlockBox.targetId` and copied verbatim through every rebuild (mirrors `TextRunBox.link`); consumed by export (PDF internal `/Link` `/GoTo`). `undefined` for any inline-block that is not a cross-reference atom. |
| `marker` | `text: string` (the resolved bullet / digit / roman). |
| `table` | `children: readonly LayoutBox[]`; `columnPxWidths: readonly number[]`. |
| `table-row` | `children: readonly LayoutBox[]`. |
| `table-cell` | `children: readonly LayoutBox[]`. |
| `multicolumn` | `columns: readonly BlockBox[]` (N side-by-side column boxes, each holding a contiguous doc-order run). A container variant like `table` — its own type so it can carry distinct paint (column-rule), hit-test (column-X filter), and fragmentation (column distribution) semantics. The generic box-walkers descend `columns` (not `children`); a depth-first walk left-to-right emits lines in visual reading order. Multi-column (Format ▸ Columns); `materializePage` emits one as a multicol page's body box (each column laid into its `ColumnFit` slice at the balanced height). |

Positions are **parent-relative**. Painters/hit-testers walk the tree accumulating offsets cumulatively.

Factories: one per variant (`createBlockBox`, etc.). Each takes logical-axis args plus `containingInlineSize` (and, for `vertical-rl`, an optional `containingBlockSize` — absent at factory time, supplied later by the `physicalizeVertical` pass) and runs `logicalToPhysical` to fill `x` / `y` / `width` / `height`. All output is `Object.freeze`d.

### `LayoutBoxMetadata`

The optional `metadata` carried by `BlockBox` (layout) and `ElementBox`
(render) is a **typed struct of optional fields** — `LayoutBoxMetadata` —
not an untyped `Record<string, unknown>` bag and not a discriminated union.
It is a struct rather than a union because a `section` box carries
`blockType` alongside optional page-geometry and header/footer keys, so no
single field discriminates the shape; every field is optional.

```ts
interface LayoutBoxMetadata {
  // Known-shape keys — strongly typed (these are what removed the prior
  // unchecked `as {...}` casts at the read sites).
  readonly image?: { readonly src: string; readonly width: number; readonly height: number };
  readonly horizontalLine?: boolean;
  readonly tableOfContents?: true;    // table-of-contents anchor marker (render-core TOC branch)
  readonly navTarget?: BlockId;       // TOC-entry click-nav target (the heading to scroll to)
  readonly tocEntry?: true;           // marks a synthesized TOC entry box as clickable
  readonly columnWidths?: readonly number[];
  readonly blockType?: "section";
  readonly embedType?: string;        // EmbedItem kind on an embed-anchor marker box

  // Attrs-/properties-derived values — kept `unknown`, validated/coerced
  // at their read boundaries (resolveSectionPageConfig, coerceBlockId, the
  // footnote-numbering lookup). They ride RAW from open-schema `attrs` /
  // embed `properties` (themselves `unknown`); typing them honestly as
  // `unknown` keeps the validation at the read site instead of pushing it
  // around.
  readonly pageInlineSize?: unknown;
  readonly pageBlockSize?: unknown;
  readonly pageMargins?: unknown;
  readonly pageGap?: unknown;
  readonly headerBlockId?: unknown;
  readonly footerBlockId?: unknown;
  // Per-section multi-column overrides (Format ▸ Columns) — validated/coerced
  // by `resolveColumnConfig` (`section-column-config.ts`).
  readonly columnCount?: unknown;
  readonly columnGap?: unknown;
  readonly columnRule?: unknown;
  readonly contentBlockId?: unknown;  // embed-content root id (from embed `properties`)
}
```

Producers stamp these keys: the `image` / `horizontalLine` components
(read by the canvas renderer), the table layout (`columnWidths`, read by
the Table FC), and `section` / `document` (`blockType` + page-geometry +
header/footer ids + multi-column overrides, read by `section-plan`); embed
anchors stamp `embedType` + `contentBlockId`.

**Multi-column (Format ▸ Columns) — section-scoped, the Google-Docs model.**
A `section` may declare `columnCount` / `columnGap` / `columnRule` in its
attrs; `section-column-config.resolveColumnConfig` validates them over a
doc-default `ColumnConfig` (`column-config.ts`), and `section-plan` threads
the resolved config onto each `SectionBoundary.columnConfig` — stamped ONLY
when it differs from the doc default (the no-override path stays inert),
exactly mirroring the per-section `PageConfig` machinery. The measure pass
distributes a multicol section's content across N columns per page
(`column-fit.ts` — FILL each page, BALANCE the section's final page) and
records the per-page `columnFit` + `balancedColumnHeight` on the
`PagePlanEntry`; `materializePage` consumes those to build the page's
`MultiColumnBox` (each column laid into its `ColumnFit` slice at the balanced
height, side by side at `trackInlineSize = (bodyInlineSize − (N−1)·gap)/N`).
A single-column section is byte-identical to the pre-multicol body. The
column-aware cursor has shipped (hit-test column-X filter via
`column-at-point.ts`; line-nav clamps the goal-X to the target line's column at a
column crossing). STILL PENDING: the column-rule paint (line-between). [partial]

The type **lives in the render layer** (`render/layout-metadata.ts`)
because both `ElementBox` (render) and `BlockBox` (layout) need it and the
established dependency direction is layout → render — layout imports from
render, never the reverse. A render-side leaf module keeps the dependency
one-directional; placing it under `layout/` would invert the layering.

### `UsedStyle`

Same key set as `ComputedStyle`, with `percent` and `auto` resolved to numbers — except sizing fields. Sizing (`inlineSize`, `blockSize`, `min*`, `max*`) lives on the LayoutBox itself, not on `UsedStyle`. So `UsedStyle.boxSizing` is present but `UsedStyle.inlineSize` is not. `UsedStyle.lineHeight` is `number` (no `Length` form).

### `LayoutContext`

```ts
interface LayoutContext {
  readonly writingMode: WritingMode;
  readonly direction:   Direction;
  readonly containingInlineSize: number;
  readonly containingBlockSize:  number | "indefinite";

  readonly intrinsicCache: IntrinsicSizesCache;
  readonly ifcStateCache:  IFCStateCache;

  readonly floatEnv:   FloatEnvironment;
  readonly isBFCRoot:  boolean;

  // Absolute-positioning containing block (see 2.4-positioning.md).
  readonly absoluteContainingBlock:    AbsoluteContainingBlock;
  readonly ownsAbsoluteContainingBlock: boolean;
  readonly originFromAbc: { readonly inlineOffset: number; readonly blockOffset: number };

  readonly prevLayoutCache: LayoutBoxCache | null;
  readonly prevFloatEnv:    FloatEnvironment | null;
}

function makeRootContext(rootCs: ComputedStyle, containerInlineSize: number): LayoutContext;
function makeChildContext(parent: LayoutContext, parentCs: ComputedStyle,
                          contentInlineSize: number, contentBlockSize: number | "indefinite",
                          contentOrigin?: { readonly inlineOffset: number; readonly blockOffset: number }): LayoutContext;
```

`makeChildContext` decides whether the child establishes its own BFC by calling `establishesNewBFC(parentCs)` — which returns `true` for `display: flow-root | inline-block | table-cell`, for any `float != "none"`, for `position: absolute`, for `overflow != "visible"` (when present), and for the document root via the explicit `isBFCRoot` flag passed by `makeRootContext`. When a new BFC is established, the child gets a fresh `FloatEnvironment`; otherwise it shares the parent's so floats rise to the nearest ancestor BFC. Independently, `makeChildContext` resets `absoluteContainingBlock` (a fresh `AbsPosEnvironment` + the box's content frame) when the child establishes one per `establishesAbsoluteContainingBlock(cs)` (`position ∈ {relative,absolute}` or `transform.length > 0`); otherwise it inherits the parent's abc and accumulates `originFromAbc` so a descendant's static position is captured in the abc's frame. See [2.4-positioning.md](../2.4-positioning.md).

### Display → formatting-context dispatch

The dispatcher in `dispatch.ts` selects the FC by `display`:

| `display` | Dispatch | Notes |
|---|---|---|
| `block`, `flow-root`, `list-item` | `layoutBlock` (BFC) | `flow-root` and floats establish new BFC roots. |
| `inline-block` | `layoutBlock` (BFC) for the box, called from inside the IFC | Sized via shrink-to-fit when `inlineSize: auto`. |
| `inline`, `text` | Handled inside the IFC (no top-level dispatch) | |
| `table` | `layoutTable` (Table FC) | |
| `table-row`, `table-cell` | Inside the Table FC's child loop | Anonymous parents synthesized when missing. |
| `none` | Box is omitted from the layout tree | |

Top-level `layoutTree(root, containerInlineSize, shaper)` allows `block` and `table` at the root; `inline` at root is invalid (the document root must establish a containing block).

### Anonymous-box generation (`group-children.ts`)

```ts
type ChildGroup =
  | { kind: "block"; child: RenderNode; positionalIndex: number }
  | { kind: "inline-run"; children: readonly RenderNode[]; positionalIndex: number };

function groupChildren(parent: ElementBox): ChildGroup[];
function anonymousBlockKey(parentKey: string, positionalIndex: number): string;
```

Walks `parent.children` and partitions them by `display`:

- A child whose `display` is block-level (`block`, `flow-root`, `list-item`, `table`, `table-row`, `table-cell`) becomes a `block` group.
- A run of consecutive inline-level children (`inline`, `inline-block`, `text`) becomes one `inline-run` group, to be wrapped in an anonymous block (BFC) or anonymous inline-content holder.

`positionalIndex` is the group's index in the parent; `anonymousBlockKey` derives a stable key from `(parentKey, positionalIndex)` so that anonymous boxes get reuse in subsequent passes.

The Table FC has analogous synthesis: `display: table` children that aren't `table-row` get wrapped in anonymous rows; `table-row` children that aren't `table-cell` get wrapped in anonymous cells.

### Reuse

```ts
interface LayoutBoxCacheEntry {
  readonly box: LayoutBox;
  readonly renderNode: RenderNode;
}

interface LayoutBoxCache {
  get(renderNodeKey: string): LayoutBoxCacheEntry | undefined;
  set(renderNodeKey: string, entry: LayoutBoxCacheEntry): void;
  clear(): void;
}

function createLayoutBoxCache(): LayoutBoxCache;
function buildLayoutBoxCacheFromTree(
  root: LayoutBox,
  renderRoot: RenderNode,
  cache?: LayoutBoxCache,
): LayoutBoxCache;

interface ReuseInputs {
  readonly computedStyle: ComputedStyle;
  readonly availableInlineSize: number;
  readonly writingMode: WritingMode;
  readonly direction: Direction;
  readonly floatEnvDirtyBlockOffset: number;  // +Infinity = no dirty floats
}

function isLayoutBoxReusable(prev: LayoutBox, inputs: ReuseInputs): boolean;
function renderNodesLayoutEquivalent(a: RenderNode, b: RenderNode): boolean;
```

`isLayoutBoxReusable` returns `true` when:
- `prev.computedStyle === inputs.computedStyle` OR `computedStylesEqual(prev.computedStyle, inputs.computedStyle)`.
- `prev.inlineSize === inputs.availableInlineSize`.
- `prev.writingMode === inputs.writingMode` and `prev.direction === inputs.direction`.
- `inputs.floatEnvDirtyBlockOffset > prev.blockOffset + prev.blockSize` (no dirty floats above the box's block-end).

`renderNodesLayoutEquivalent(a, b)` returns `true` when:
- `a === b`, or
- `a.type === b.type`, `a.key === b.key`, `a.computedStyle === b.computedStyle`, AND for elements: same `metadata` reference and per-position children reference-equality.

### `computeUsedStyle` and `resolveBoxInlineSize`

Two helpers that resolve `ComputedStyle` to numeric values per box.

```ts
function computeUsedStyle(
  cs: ComputedStyle,
  containingInlineSize: number,
  containingBlockSize: number | "indefinite",
): UsedStyle;

function resolveBoxInlineSize(
  cs: ComputedStyle,
  containingInlineSize: number,
  isFloat: boolean,
  node: ElementBox,
  shaper: TextShaper,
  ctx: LayoutContext,
): number;
```

#### `computeUsedStyle` algorithm

```
function computeUsedStyle(cs, containingInlineSize, containingBlockSize):
  // Margins — auto resolves per CSS rules:
  //   - For block-level boxes: auto inline-axis margins center when both sides are auto AND inlineSize is explicit.
  //     Implementation handles centering at the BFC layout pass; computeUsedStyle returns 0 for auto here and the BFC
  //     applies centering after it knows the box's resolved inlineSize.
  //   - Block-axis auto margins always resolve to 0 in flow content (CSS spec).
  used.marginBlockStart  = (cs.marginBlockStart  == "auto") ? 0 : resolveLength(cs.marginBlockStart, containingInlineSize, 0)
  used.marginBlockEnd    = (cs.marginBlockEnd    == "auto") ? 0 : resolveLength(cs.marginBlockEnd, containingInlineSize, 0)
  used.marginInlineStart = (cs.marginInlineStart == "auto") ? 0 : resolveLength(cs.marginInlineStart, containingInlineSize, 0)
  used.marginInlineEnd   = (cs.marginInlineEnd   == "auto") ? 0 : resolveLength(cs.marginInlineEnd, containingInlineSize, 0)

  // Paddings — resolve % against containing inline-size (CSS rule: percent paddings always resolve against inline,
  // even for block-axis paddings).
  used.paddingBlockStart  = resolvePercentAgainstInline(cs.paddingBlockStart, containingInlineSize)
  used.paddingBlockEnd    = resolvePercentAgainstInline(cs.paddingBlockEnd, containingInlineSize)
  used.paddingInlineStart = resolvePercentAgainstInline(cs.paddingInlineStart, containingInlineSize)
  used.paddingInlineEnd   = resolvePercentAgainstInline(cs.paddingInlineEnd, containingInlineSize)

  // Border widths — already numeric in ComputedStyle
  used.borderBlockStartWidth  = cs.borderBlockStartWidth
  // ... (same for the other three sides)

  // Typography — em is already resolved at cascade time; pass through
  used.fontSize = cs.fontSize
  used.lineHeight = (cs.lineHeight is number) ? cs.lineHeight * cs.fontSize : resolveLength(cs.lineHeight, containingInlineSize, cs.fontSize)
  used.color = cs.color
  // ... (other typography fields pass through)

  // Sizing fields (inlineSize, blockSize, min/max-*) are NOT on UsedStyle — they live on the LayoutBox itself.
  // resolveBoxInlineSize handles inline-axis; the BFC handles block-axis from content.

  return used

function resolvePercentAgainstInline(value: ComputedLength, containingInlineSize: number): number:
  if value is number: return value
  if value is { unit: "percent", value: pct }: return (pct / 100) * containingInlineSize
  // unreachable for ComputedLength
```

#### Auto-margin centering (BFC follow-up to `computeUsedStyle`)

After the BFC resolves a block child's `inlineSize` and the parent's `containingInlineSize`, it applies centering when both inline-axis margins are `auto` AND the child has a definite (non-auto) `inlineSize`:

```
freeSpace = containingInlineSize - childInlineSize - childUsedStyle.borderInlineStartWidth - childUsedStyle.borderInlineEndWidth
            - childUsedStyle.paddingInlineStart  - childUsedStyle.paddingInlineEnd
if cs.marginInlineStart == "auto" && cs.marginInlineEnd == "auto":
  childUsedStyle.marginInlineStart = freeSpace / 2
  childUsedStyle.marginInlineEnd   = freeSpace / 2
else if cs.marginInlineStart == "auto":
  childUsedStyle.marginInlineStart = freeSpace
else if cs.marginInlineEnd == "auto":
  childUsedStyle.marginInlineEnd = freeSpace
```

This produces CSS-spec margin: 0 auto centering. When `inlineSize` is `auto`, CSS resolves auto margins to 0 first and lets the box fill the container — no centering happens.

#### `resolveBoxInlineSize` algorithm

```
function resolveBoxInlineSize(cs, containingInlineSize, isFloat, node, shaper, ctx):
  // Intrinsic keywords first
  if cs.inlineSize == "min-content":
    return computeIntrinsicSizes(node, shaper, ctx.intrinsicCache).minContent
  if cs.inlineSize == "max-content":
    return computeIntrinsicSizes(node, shaper, ctx.intrinsicCache).maxContent
  if cs.inlineSize == "fit-content":
    intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache)
    available = containingInlineSize - paddingInlineStart - paddingInlineEnd - marginInlineStart - marginInlineEnd
    return min(intrinsic.maxContent, max(intrinsic.minContent, available))

  // Numeric or percent
  if cs.inlineSize is { unit: "percent" }:
    return (cs.inlineSize.value / 100) * containingInlineSize
  if cs.inlineSize is number:
    return cs.inlineSize

  // auto
  if isFloat:
    // Floats with auto inline-size: shrink-to-fit per CSS Sizing 3 §10.3.5
    intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache)
    available = containingInlineSize - paddingInlineStart - paddingInlineEnd
    return min(intrinsic.maxContent, max(intrinsic.minContent, available))

  // Block in flow with auto inline-size: fill the container
  return containingInlineSize - paddingInlineStart - paddingInlineEnd - marginInlineStart - marginInlineEnd
```

The BFC additionally applies `min-inline-size` and `max-inline-size` clamping after this step:
```
result = clamp(resolveBoxInlineSize(...), resolveMin(cs.minInlineSize, ctx), resolveMax(cs.maxInlineSize, ctx))
```
where `resolveMin` returns `0` when the value is `0`, and `resolveMax` returns `+Infinity` when the value is `"none"`.

### Top-level entries

```ts
function layoutTree(
  root: RenderNode,
  containerInlineSize: number,
  shaper: TextShaper | TextMeasurer,
): LayoutBox;

function layoutTreeIncremental(
  newRoot: RenderNode,
  oldRoot: RenderNode | null,
  oldLayout: LayoutBox | null,
  containerWidth: number,
  shaper: TextShaper | TextMeasurer,
): LayoutBox;
```

`layoutTree` runs cascade if the root's `computedStyle` is missing, then dispatches by `cs.display`. `layoutTreeIncremental` adds a whole-tree short-circuit (`newRoot === oldRoot && oldLayout != null && oldLayout.width === containerWidth`) and otherwise builds a `LayoutBoxCache` from `oldLayout` + `oldRoot` and threads it through the root context.

### Performance contracts

- Whole-tree layout (cold start): O(N) where N is render-tree size.
- Incremental layout with single-paragraph edit: O(D) where D is the size of the changed paragraph plus the path from root. Unchanged paragraphs flow through the BFC's reuse gate.
- Document root with all children unchanged but parent rebuilt (e.g., `INSERT_NODE` outside any paragraph): O(1) via `renderNodesLayoutEquivalent`.
