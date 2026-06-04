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

- **`wrap-incremental`** — `findChangePoint` (live: powers the IFC's
  all-or-nothing paragraph reuse) plus `rewrapIncremental`, the
  convergence-detection algorithm for within-paragraph incremental wrap
  (algorithm only; not yet wired into the IFC's main wrap loop — scoped
  to P18, blocked on four integration hazards detailed in
  `1.4.2-ifc.md` "Convergence (incremental wrap)").

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
  | TableCellBox;   // type: "table-cell"
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
}
```

Per-variant additions:

| Type | Adds |
|---|---|
| `block` | `children: readonly LayoutBox[]`; optional `metadata: LayoutBoxMetadata` (typed struct — see below). |
| `line` | `children: readonly LayoutBox[]`; `baseline: number` (offset from top of line). |
| `text-run` | `text: string`. |
| `inline` | `children: readonly LayoutBox[]`; `fragmentEdge: "first" \| "middle" \| "last" \| "only"` (which side has padding/border). |
| `inline-block` | `children: readonly LayoutBox[]`. |
| `marker` | `text: string` (the resolved bullet / digit / roman). |
| `table` | `children: readonly LayoutBox[]`; `columnPxWidths: readonly number[]`. |
| `table-row` | `children: readonly LayoutBox[]`. |
| `table-cell` | `children: readonly LayoutBox[]`. |

Positions are **parent-relative**. Painters/hit-testers walk the tree accumulating offsets cumulatively.

Factories: one per variant (`createBlockBox`, etc.). Each takes logical-axis args plus `containingInlineSize` and runs `logicalToPhysical` to fill `x` / `y` / `width` / `height`. All output is `Object.freeze`d.

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
  readonly contentBlockId?: unknown;  // embed-content root id (from embed `properties`)
}
```

Producers stamp these keys: the `image` / `horizontalLine` components
(read by the canvas renderer), the table layout (`columnWidths`, read by
the Table FC), and `section` / `document` (`blockType` + page-geometry +
header/footer ids, read by `section-plan`); embed anchors stamp
`embedType` + `contentBlockId`.

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

  readonly prevLayoutCache: LayoutBoxCache | null;
  readonly prevFloatEnv:    FloatEnvironment | null;
}

function makeRootContext(rootCs: ComputedStyle, containerInlineSize: number): LayoutContext;
function makeChildContext(parent: LayoutContext, parentCs: ComputedStyle,
                          contentInlineSize: number, contentBlockSize: number | "indefinite"): LayoutContext;
```

`makeChildContext` decides whether the child establishes its own BFC by calling `establishesNewBFC(parentCs)` — which returns `true` for `display: flow-root | inline-block | table-cell`, for any `float != "none"`, for `overflow != "visible"` (when present), and for the document root via the explicit `isBFCRoot` flag passed by `makeRootContext`. When a new BFC is established, the child gets a fresh `FloatEnvironment`; otherwise it shares the parent's so floats rise to the nearest ancestor BFC.

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
