# 04 — Layout Layer

**Path:** `packages/core/src/layout/`

The layout layer turns a render tree + container width into a tree of
absolute boxes. It owns text measurement, line wrapping, block-level
margin collapsing, and pagination. Output is consumed by hit-testing,
cursor positioning, selection geometry, and the canvas painter.

## Files

```
layout/
├── layout-node.ts        discriminated union of LayoutBox + barrel exports
├── block-layout-box.ts   BlockLayoutBox
├── table-layout-box.ts   TableLayoutBox
├── line-layout-box.ts    LineLayoutBox
├── page-layout-box.ts    PageLayoutBox
├── text-layout-box.ts    TextLayoutBox
├── layout-engine.ts      layoutTree + paginateDocument + line wrapping
├── text-splitter.ts      string → WordBox[] (word-boundary, char-fallback)
└── text-measurer.ts      TextMeasurer interface + createMockMeasurer
```

## The discriminated union

```ts
// layout-node.ts
type LayoutBox =
  | BlockLayoutBox     // type: "block"
  | TableLayoutBox     // type: "table"
  | LineLayoutBox      // type: "line"
  | PageLayoutBox      // type: "page"
  | TextLayoutBox;     // type: "text"
```

| Type | Children allowed | Notes |
|---|---|---|
| block | any non-page, non-line where appropriate | `marker?`, `metadata?` propagated from render |
| table | row blocks | Carries `columnWidths`, `rowHeights` |
| line | text only | Throws on non-text child (`line-layout-box.ts:30–35`). Carries `marginTop`, `marginBottom`. |
| page | non-text | Throws on text child (`page-layout-box.ts:24–28`). Used only when paginated. |
| text | none | Carries `text`, `width`, `height`, `styles?` |

All boxes have `{ key, x, y, width, height }`. `x` and `y` are relative to
the parent box, except inside a paginated tree where pages use parent-relative
coordinates and a page's children use page-relative coordinates.

## Coordinate conventions

- Block boxes: `x, y` relative to parent.
- Line boxes: `x, y` relative to enclosing block.
- Text boxes inside a line: `x, y` relative to the line.
- Page boxes: stacked at `y = 0` and reposition children by margins.
- The DOM controller adds an inter-page gap when painting (`pageGap`).

## TextMeasurer

```ts
// text-measurer.ts
interface TextMeasurer {
  measureWidth(text: string, styles: RenderStyles): number;
  measureHeight(styles: RenderStyles): number;
}
```

- The DOM package provides `createCanvasMeasurer(canvas)` using a 2D context.
- The mock (`createMockMeasurer(charWidth, lineHeight)`) is used by core
  tests and integration setup.

The measurer is passed into `layoutTree`, `EditorConfig`, and the controller.
It's the only DOM-flavored dependency that core needs.

## Top-level entry — `layoutTree`

```ts
// layout-engine.ts lines 23–36
layoutTree(renderNode, containerWidth, measurer, pageHeight?, pageMargins?):
  contentWidth = containerWidth − marginsHorizontal
  docBox = layoutNode(renderNode, 0, 0, contentWidth, measurer)
  if (pageHeight === undefined) return docBox
  return paginateDocument(docBox, pageHeight, containerWidth, pageMargins)
```

Recursively dispatches by `renderNode.type` (lines 111–137):

- `"block"` → `layoutBlock`
- `"table"` → `layoutTable`
- `"text"` → `layoutTextNode` (fallback path; usually called from
  inline-content collection, not directly)
- `"inline"` → falls through to `layoutBlock` (defensive — inlines are
  normally consumed by `collectWordBoxes` inside the parent block)

## Block layout — two formatting contexts

`layoutBlock` (lines 168–255) decides which formatting context to use:

```
hasInlineContent = some(child.type === "text" || child.type === "inline")

if hasInlineContent:
   ┌──────── inline formatting context ─────────┐
   │ collectWordBoxes (recursive style merge)  │
   │ wrap into LineLayoutBox sequence          │
   └────────────────────────────────────────────┘

else if no children:
   leaf block (image, hr) — height = paddingTop + paddingBottom

else:
   ┌──────── block formatting context ──────────┐
   │ stack children with:                       │
   │  - line-margin collapsing (overlap min)    │
   │  - block-margin gaps (max)                 │
   └────────────────────────────────────────────┘
```

### Inline formatting context

`layoutInlineContent` (lines 322–404):

1. Resolve top/bottom line margins as `ratio × resolveHeight`.
2. `collectWordBoxes` recursively flattens inline + text descendants into
   per-word boxes carrying merged styles.
3. Greedy word wrap: while a word would overflow `availableWidth` and the
   line is non-empty, finalize the line.
4. Lines are emitted as `LineLayoutBox` carrying their own marginTop /
   marginBottom for the parent block to consume.

`splitTextIntoWords` (in `text-splitter.ts`) handles oversized words by
character-breaking them when `maxWidth` is provided.

### Block formatting context

Stack children top-to-bottom, computing the inter-block gap as:

```ts
lineOverlap = min(prev.lineMarginBottom, child.lineMarginTop)
lineGap     = prev.lineMarginBottom + child.lineMarginTop − lineOverlap
blockGap    = max(prev.blockMarginBottom, child.blockMarginTop)
extraSpace  = max(0, blockGap − lineGap)

childY    -= lineOverlap
childY    += extraSpace
```

This gives **max-collapsing block margins** (CSS-like) layered on top of
**min-overlap line margins**. Components express both via render styles.

## Table layout

`layoutTable` (lines 258–320):
- Resolves fractional `columnWidths` to pixels.
- For each row, lays out each cell at its column x with column width.
- Row height = `max(maxCellHeight, explicitRowHeight)`.
- Wraps cells in a row-block, then wraps rows in a `TableLayoutBox`.

## Pagination — `paginateDocument`

```ts
// layout-engine.ts lines 42–109
paginateDocument(docBox, pageHeight, containerWidth, margins):
  contentHeight = pageHeight − margins.top − margins.bottom
  for child in docBox.children:
    if currentPage non-empty AND currentHeight + child.height > contentHeight:
      flush current page
    push child onto current page
  flush last page
```

**Whole-block only** — blocks are never split mid-page. A block taller
than `contentHeight` overflows. See [issue 04](../issues/04-pagination-whole-block-only.md).

## Incremental layout

`layoutTreeIncremental` (lines 451–566):

```
if newRenderNode === oldRenderNode AND containerWidth unchanged → reuse
if newRenderNode is "text" or unsupported → full layoutTree
if newRenderNode is "table" → full layoutTree (incremental TBD)
if hasInlineContent → full layoutTree (line wrapping is global to the block)
else (block formatting context):
  match children by KEY
  for each new child:
    if child === oldChild AND width unchanged → reposition only
    else if same type → recurse incrementally
    else → full layoutNode
```

**Critical limitation:** an inline edit causes a full re-wrap of its
enclosing block — fine for a paragraph, costly for a 5,000-word block.
See [issue 03](../issues/03-inline-layout-not-incremental.md).

`repositionBox` (lines 569–572) is a fast path: same content, new x/y.

## Public exports

See `packages/core/src/index.ts` lines 80–101:
- types: `LayoutBox`, `BlockLayoutBox`, `TableLayoutBox`, `LineLayoutBox`,
  `PageLayoutBox`, `TextLayoutBox`, `TextMeasurer`, `WordBox`, `PageMargins`
- constructors: `createBlockLayoutBox`, etc.
- entry: `layoutTree`, `layoutTreeIncremental`, `splitTextIntoWords`, `createMockMeasurer`

## See also

- [03 render layer](03-render-layer.md) — input.
- [06 cursor & selection](06-cursor-selection.md) — uses layout for hit-testing and pixel cursors.
- [07 DOM controller](07-dom-controller.md) — consumes the layout for painting.
- [issue 03](../issues/03-inline-layout-not-incremental.md) — full re-wrap on inline edits.
- [issue 04](../issues/04-pagination-whole-block-only.md) — blocks can't span pages.
