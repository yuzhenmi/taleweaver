# DOM-Architecture Layout Redesign — Design

**Date:** 2026-04-27
**Status:** Approved (pending writing-plans handoff)

This document specifies a comprehensive redesign of Taleweaver's styling and
layout system to adopt the **architecture** of the DOM/CSS box model, with a
feature subset targeted at word-processor needs. The goal is not full CSS
parity — it is to use the same conceptual model (display-driven dispatch,
formatting contexts, cascade, fragmentation) so that future features extend
the existing architecture rather than inventing parallel mechanisms.

The motivation is documented in
[`docs/issues/`](../../issues/) — particularly issue 04 (whole-block-only
pagination) and the earlier informal observation that today's layout engine
is dramatically narrower than CSS, with ad-hoc additions (e.g., a `marker`
field on block render nodes) that don't compose with future features.

This document is the design specification. The implementation plan is
produced separately by the writing-plans process.

---

## 1. Goals and non-goals

### Goals

1. Layout architecture mirrors DOM/CSS so consumers and future maintainers
   can reason in familiar terms.
2. v1 ships a feature set sufficient to power a working word processor at
   parity with current Taleweaver capabilities — plus floats, full margin
   collapsing, fragmentation, and white-space handling, which today's engine
   lacks.
3. The architecture accommodates v2+ features (positioning, page templates,
   text-align, columns, RTL, etc.) as additive style properties or new
   formatting contexts — never as schema changes.
4. The component contract stays React-shaped: a pure render function of
   `(state, children) → RenderNode`. No special component categories, no
   declarative-only constraints, no context plumbing.

### Non-goals

- Full CSS spec compliance.
- Backward compatibility with today's API. There are no external consumers;
  the redesign is free to break everything.
- Parsing CSS strings (`"10px"`, `calc(...)`). Values are TypeScript-typed.
- Selector-based stylesheets / cascade rules / specificity. v1 has only
  inline styles and inheritance — no named styles, no selectors. Named
  styles (Word/Docs-style centrally-edited styles) were considered and
  dropped: they overlap with the component model (components are the
  customization mechanism) and with inline overrides; consumers can build
  Word-style named-style features on top of inline overrides if needed,
  without engine support. The cascade architecture remains compatible with
  adding a named-style layer later (it would be another priority slot
  between component output and parent inheritance).

---

## 2. Pipeline architecture

The layout pipeline is six stages. Stages 4 and 5 only run when the document
is paginated (`pageHeight` configured); otherwise output flows directly from
stage 3 into stage 6.

```
┌────────────────────┐
│ 1. State tree      │  semantic document — StateNode tree
└─────────┬──────────┘
          │ component.render() per node, bottom-up
          ▼
┌────────────────────┐
│ 2. Render tree     │  ElementBox / TextBox — each carries `style`
└─────────┬──────────┘
          │ cascade pass — walk tree, resolve inheritance and initial values
          ▼
┌────────────────────┐
│ 3. Render tree     │  same shape, now also carries `computedStyle`
│    + computedStyle │
└─────────┬──────────┘
          │ layout dispatch by `display` value
          ▼
┌────────────────────┐
│ 4. Layout tree     │  positioned boxes — BlockBox, LineBox, TextBox,
│    (flowed)        │  MarkerBox, etc.
└─────────┬──────────┘
          │ fragmentation — only runs if paginated
          ▼
┌────────────────────┐
│ 5. Page boxes      │  layout fragments distributed into PageBox containers
└─────────┬──────────┘
          │ page assembly — pass-through in v1; v2 adds page templates
          ▼
┌────────────────────┐
│ 6. Painting        │  canvas rendering
└────────────────────┘
```

Stages 2, 3, 4, and 5 are **incremental** — each maintains structural sharing
and reuses unchanged subtrees by reference equality.

---

## 3. Data model

### 3.1 StateNode

```ts
interface StateNode {
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly style: Readonly<Style>;
  readonly children: readonly StateNode[];
}
```

Differences from today's StateNode:
- `styles: NodeStyles` → `style: Style` (rename + full schema replacement).
- Everything else unchanged.

`properties` remains an open `Record<string, unknown>` for component-specific
data (e.g., `{ content: string }` on text nodes; `{ src, width, height }`
on images). Typing properties per component is out of scope (see issue 02
for that thread).

`style` carries the user's inline overrides — typically a small subset of
`Style` properties (e.g., `{ fontWeight: "bold" }` after the user clicks
Bold). Component defaults and inheritance fill in the rest during cascade.

### 3.2 Length and Color shared types

```ts
type Length =
  | number                                // shorthand for px
  | { unit: "px";      value: number }
  | { unit: "percent"; value: number }
  | { unit: "em";      value: number };

type LengthOrAuto = Length | "auto";
type Color = string;                       // CSS color string for v1
```

`em` is used by component authors for typography-relative spacing (e.g.,
`marginBottom: { unit: "em", value: 0.5 }` on a heading scales with font-size).
End users do not author `em` directly — the toolbar produces `px` values.

Cascade resolves `em` and `percent` to absolute values in the computed-style
output. Layout sees only resolved px values.

### 3.3 Style schema (v1)

Approximately 50 properties grouped into 11 categories. Properties are
optional in `Style` (specified vs. unset distinction); `ComputedStyle` is
the same shape but with all properties resolved to total values.

```ts
interface Style {
  // ── Display & layout participation
  display?: "block" | "inline" | "inline-block" | "list-item"
          | "table" | "table-row" | "table-cell" | "none";

  // ── Sizing
  width?:     LengthOrAuto;
  height?:    LengthOrAuto;
  minWidth?:  Length;
  minHeight?: Length;
  maxWidth?:  Length | "none";
  maxHeight?: Length | "none";
  boxSizing?: "content-box" | "border-box";

  // ── Margin (4 sides)
  marginTop?:    LengthOrAuto;
  marginRight?:  LengthOrAuto;
  marginBottom?: LengthOrAuto;
  marginLeft?:   LengthOrAuto;

  // ── Padding (4 sides)
  paddingTop?:    Length;
  paddingRight?:  Length;
  paddingBottom?: Length;
  paddingLeft?:   Length;

  // ── Border (3 properties × 4 sides)
  borderTopWidth?:    number;
  borderRightWidth?:  number;
  borderBottomWidth?: number;
  borderLeftWidth?:   number;
  borderTopStyle?:    "none" | "solid" | "dashed" | "dotted";
  borderRightStyle?:  "none" | "solid" | "dashed" | "dotted";
  borderBottomStyle?: "none" | "solid" | "dashed" | "dotted";
  borderLeftStyle?:   "none" | "solid" | "dashed" | "dotted";
  borderTopColor?:    Color;
  borderRightColor?:  Color;
  borderBottomColor?: Color;
  borderLeftColor?:   Color;

  // ── Background
  backgroundColor?: Color;

  // ── Typography
  fontFamily?:     string;
  fontSize?:       Length;
  fontWeight?:     "normal" | "bold" | "lighter" | "bolder" | number;
  fontStyle?:      "normal" | "italic" | "oblique";
  textDecoration?: "none" | "underline" | "line-through";
  lineHeight?:     number | Length;        // bare number = multiplier
  color?:          Color;

  // ── Inline / text behavior
  whiteSpace?:    "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line";
  verticalAlign?: "baseline" | "top" | "middle" | "bottom";

  // ── Float / clear
  float?: "none" | "left" | "right";
  clear?: "none" | "left" | "right" | "both";

  // ── Fragmentation (page breaks)
  breakBefore?: "auto" | "page" | "avoid";
  breakAfter?:  "auto" | "page" | "avoid";
  breakInside?: "auto" | "avoid";
  widows?:      number;                    // ≥ 1
  orphans?:     number;                    // ≥ 1

  // ── List markers
  listStyleType?:     "disc" | "circle" | "square" | "decimal"
                    | "lower-alpha" | "upper-alpha"
                    | "lower-roman" | "upper-roman"
                    | "none"
                    | { content: string };
  listStylePosition?: "outside" | "inside";
}
```

#### 3.3.1 Notably absent from v1 (deferred, architecture-compatible)

These can be added to `Style` later as new optional properties. The
architecture does not preclude them.

- `position`, `top` / `right` / `bottom` / `left`, `zIndex`
- `textAlign`, `textIndent`, `letterSpacing`, `wordSpacing`
- `direction`, `writingMode`
- `columnCount`, `columnWidth`, `columnRule*` (multi-column)
- `transform`, `opacity`, `visibility`
- `overflow*`, `clip*`
- Background images, gradients
- `hyphens`
- `sub` / `super` / length values for `verticalAlign`

### 3.4 RenderNode

```ts
type RenderNode = ElementBox | TextBox;

interface ElementBox {
  readonly type: "element";
  readonly key: string;
  readonly style: Readonly<Style>;
  readonly computedStyle?: Readonly<ComputedStyle>;        // populated by cascade
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly children: readonly RenderNode[];
}

interface TextBox {
  readonly type: "text";
  readonly key: string;
  readonly style: Readonly<Style>;                          // user's inline formatting
  readonly computedStyle?: Readonly<ComputedStyle>;
  readonly text: string;
}
```

Differences from today's render tree:

- Today: discriminated union of `block | inline | text | table` with type-specific
  fields (e.g., `columnWidths` on `TableRenderNode`, `marker` on
  `BlockRenderNode`).
- New: only **two** node types — `ElementBox` and `TextBox` — matching the DOM's
  Element/Text distinction.
- `display` is a Style property, not a node type. Layout dispatch reads
  `computedStyle.display`.
- Type-specific data lives in `metadata` (e.g., `metadata.image: { src, width, height }`,
  `metadata.columnWidths` for tables).
- The `marker` field on block nodes is gone; markers are generated by the
  layout engine when it sees `display: list-item` (see §8).

`computedStyle` is `?` because it is populated by the cascade pass (stage 3).
Components produce render nodes carrying only `style`. After stage 3, the
same render tree exists with `computedStyle` filled in.

### 3.5 LayoutBox

The layout tree introduces several box types per formatting context. Unlike
the render tree, layout boxes are *typed* — each carries its own structural
fields (positions, dimensions, FC-specific data).

```ts
type LayoutBox =
  | BlockBox          // block-level box (any display except inline/inline-text)
  | LineBox           // a line within an IFC
  | TextRunBox        // a run of text on a line
  | InlineBox         // inline-level fragment (display: inline) on a line
  | InlineBlockBox    // atomic inline-level box (display: inline-block)
  | TableBox          // display: table
  | TableRowBox       // display: table-row
  | TableCellBox      // display: table-cell
  | MarkerBox         // generated for display: list-item
  | PageBox;          // page container (only when paginated)
```

Common base fields on every layout box:
```ts
{ readonly key: string;
  readonly x: number;           // relative to parent layout box
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly computedStyle: Readonly<ComputedStyle>;  // resolved styles, used by paint
}
```

Per-FC additional fields are declared in §6 (layout engine) and §7 (fragmentation).

The render-vs-layout distinction is:
- Render tree mirrors the document semantically (one ElementBox per state node, one TextBox per text run); shape is uniform.
- Layout tree mirrors the **visual structure** (one LineBox per visual line, one MarkerBox per list-item, one PageBox per page); shape is FC-specific.

---

## 4. Component contract

```ts
interface ComponentDefinition {
  readonly type: string;
  readonly render: (state: StateNode, children: readonly RenderNode[]) => RenderNode;
}
```

That is the entire contract. Pure function of state + already-rendered
children, returns a render node.

Differences from today:
- `createInitialState` is **removed**. Factories live as separate exported
  functions, not on the component definition (see §4.2).
- The render output's style schema is `Style` (full), not `RenderStyles`.

### 4.1 Render function expectations

A component's render function is responsible for:

1. **Mapping properties to style**, e.g., a `heading` component reads
   `state.properties.level` and emits a different `fontSize` per level.
2. **Setting display**, e.g., `display: "block"` for paragraphs,
   `display: "list-item"` for list-items.
3. **Setting type defaults**, e.g., a paragraph's default
   `marginBottom: { unit: "em", value: 0.5 }`.
4. **Merging the user's inline style** from `state.style`. Convention: spread
   `state.style` last so user overrides win.
5. **Producing children** — usually a passthrough (`children`), occasionally
   transformed (e.g., wrapping each child in something).
6. **Carrying metadata** for type-specific data the layout engine or painter
   needs (`metadata.image: { src, width, height }`, `metadata.columnWidths`).

Example:
```ts
const headingComponent: ComponentDefinition = {
  type: "heading",
  render: (state, children) => ({
    type: "element",
    key: state.id,
    style: {
      display: "block",
      fontSize: defaultSizeFor(state.properties.level as number),
      fontWeight: "bold",
      marginTop:    { unit: "em", value: 0.67 },
      marginBottom: { unit: "em", value: 0.67 },
      ...state.style,                    // user inline overrides win
    },
    children,
  }),
};
```

### 4.2 Factories

Each component package exports factory functions for constructing fresh
state nodes:

```ts
type NewNode = {
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly style: Readonly<Style>;
  readonly children: readonly NewNode[];
};

export function createParagraph(): NewNode { ... }
export function createHeading(level: 1|2|3|4|5|6): NewNode { ... }
export function createText(content: string): NewNode { ... }
// etc.
```

`NewNode` is structurally `StateNode` minus the `id` field. The engine
assigns IDs during `INSERT_NODE` action handling. This makes ID allocation
the engine's responsibility and eliminates allocator threading from
consumer code.

### 4.3 Action: INSERT_NODE

```ts
{ type: "INSERT_NODE"; node: NewNode; position?: Position }
```

Replaces today's `INSERT_BLOCK { blockType, properties }`. The action handler:

1. Recursively walks the `NewNode` tree, assigning IDs from the editor's
   internal allocator.
2. Splices the resulting `StateNode` into `state.state` at `position` (or at
   the cursor if omitted).

Consumers construct what they want with factories and dispatch:
```ts
dispatch({ type: "INSERT_NODE", node: createParagraph() });
```

---

## 5. Cascade

The cascade pass (stage 3) takes a render tree carrying only `style` per
node and produces the same tree with `computedStyle` populated on every
node. Layout reads `computedStyle`; nothing past stage 3 reads `style`.

### 5.1 Composition order

For each property on each node:

```
1. If node.style[prop] is defined           → use it
2. Else if PROPERTY_META[prop].inherits     → use parent.computedStyle[prop]
3. Else                                     → use PROPERTY_META[prop].initialValue
```

There is no cascade *source* layer — no UA stylesheet, no author stylesheet,
no inline-style-attribute distinction. The render-fn output IS the source
of specified values for each node, because the component's render function
is the analogue of "the type's default styles plus the user's inline
overrides."

### 5.2 Property metadata

Static table per-property: `{ inherits: boolean, initialValue: T }`. Used
by the cascade resolver.

#### Inherits = true
```
fontFamily, fontSize, fontWeight, fontStyle, textDecoration, lineHeight,
color, whiteSpace, listStyleType, listStylePosition, widows, orphans
```

`textDecoration` is `inherits = true` in Taleweaver, departing from CSS's
`inherits = false + visual propagation` quirk. This matches the user-intuitive
model: an underlined paragraph contains underlined text.

All other properties (display, sizing, margin/padding/border, backgrounds,
floats, fragmentation) are `inherits = false`.

#### Initial values

```
display:           "inline"
width, height:     "auto"
minWidth, minHeight: 0
maxWidth, maxHeight: "none"
boxSizing:         "content-box"
margin*:           0
padding*:          0
border*Width:      0
border*Style:      "none"
border*Color:      "black"
backgroundColor:   "transparent"
fontFamily:        system default (configured externally)
fontSize:          16
fontWeight:        "normal"     (= 400)
fontStyle:         "normal"
textDecoration:    "none"
lineHeight:        1.2          (multiplier)
color:             "black"
whiteSpace:        "normal"
verticalAlign:     "baseline"
float:             "none"
clear:             "none"
breakBefore:       "auto"
breakAfter:        "auto"
breakInside:       "auto"
widows:            2
orphans:           2
listStyleType:     "disc"
listStylePosition: "outside"
```

### 5.3 Length resolution

When the cascade sees `Length` values with `unit: "em"` or `unit: "percent"`:
- `em` resolves against the element's own computed `fontSize` (which is
  resolved first — fontSize itself uses `em` against the *parent's* fontSize).
- `percent` resolves against the appropriate base for that property (e.g.,
  `width: 50%` is 50% of containing block content width). This deferral may
  require partial layout; v1 simplifies by resolving simple percents at
  cascade time and leaving width-relative percents to layout time.

`number` is treated as `px`.

### 5.4 Incremental cascade

Mirrors the existing render-incremental pattern:

```
cascadeIncremental(newRender, oldRender, oldComputed, parentComputed, oldParentComputed):
  if newRender === oldRender AND parentComputed === oldParentComputed:
    return oldComputed                    ← short-circuit unchanged subtree

  newComputed = composeComputed(newRender.style, parentComputed)

  newChildren = newRender.children.map(child =>
    cascadeIncremental(
      child,
      oldChildByKey(oldRender, child.key),
      oldComputedByKey(oldComputed, child.key),
      newComputed,
      oldComputed,
    ))

  return new node with computedStyle = newComputed
```

Cost is O(dirty subtree). Style-only changes that don't affect inheritable
properties don't propagate past their immediate node.

---

## 6. Layout engine

Stage 4 takes the cascaded render tree and produces a layout tree. Dispatch
is by `computedStyle.display`. Each formatting context is a separate
algorithm.

### 6.1 Block Formatting Context (BFC)

Children are stacked vertically. Each BFC implicitly encloses its floats
(D.1.c — every block is treated as `display: flow-root`, no opt-in needed).

#### 6.1.1 Margin collapsing

CSS-faithful, all four rules:

1. **Adjacent siblings** — `A.marginBottom` and `B.marginTop` collapse.
   Collapsed gap = `max(A.marginBottom, B.marginTop)` for non-negative
   margins; standard CSS sign-aware logic for negatives.
2. **Empty block** — a block with no content/padding/border/explicit-height
   collapses its own top and bottom margins together.
3. **Parent / first child** — if parent has no top padding/border,
   `parent.marginTop` collapses with `firstChild.marginTop`.
4. **Parent / last child** — symmetric for bottom margins.

#### 6.1.2 Block sizing

- Width: `containerContentWidth − marginLeft − marginRight − borderLeft −
  borderRight − paddingLeft − paddingRight` (depending on `boxSizing`).
- `width: auto` → fill available.
- `width: <length>` → exact; auto margins absorb remainder horizontally.
- Vertical auto margins → 0 (CSS rule).
- Height: `auto` → content height; `<length>` → exact; min/max constraints
  applied.

#### 6.1.3 Float enclosure

Block's content height = `max(contentHeight, lowestFloatBottom)`. Every
block does this — no `display: flow-root` opt-in. We do not replicate
CSS's historical "floats escape parent" bug.

### 6.2 Inline Formatting Context (IFC)

Triggered when a block's children are inline-level (text, inline,
inline-block). Children are flowed into line boxes.

#### 6.2.1 Line construction

Greedy word wrap. For each line at y-coordinate `lineY`:
1. Query active floats: any float whose `[top, bottom]` interval contains `lineY`.
2. Compute available x-range: `[leftFloatWidth, containerWidth − rightFloatWidth]`.
3. Accumulate words into the line until the next word would exceed available width.
4. If the line is too narrow to fit the next word *and* there are active floats,
   advance `lineY` to the nearest float bottom and retry from step 1.
5. Finalize line: emit `LineBox` containing `TextRunBox`, `InlineBox`, and
   `InlineBlockBox` children.

#### 6.2.2 Word boundaries and oversize

- Word boundaries: whitespace runs are word separators in `normal`,
  `nowrap`, and `pre-line` modes; preserved as content in `pre` and `pre-wrap`.
- Oversize words: character-broken when a word alone exceeds available width.
- v1 does not expose `overflowWrap` / `wordBreak` style properties.

#### 6.2.3 White-space modes

| Mode | Whitespace runs | Newlines | Wrap |
|---|---|---|---|
| `normal` | collapse to one space | treated as space | yes, at word boundaries |
| `nowrap` | collapse to one space | treated as space | no |
| `pre` | preserve | break line | no |
| `pre-wrap` | preserve | break line | yes |
| `pre-line` | collapse to one space | break line | yes |

The IFC tokenizer reads `whiteSpace` from the IFC's containing block's
`computedStyle`.

#### 6.2.4 Line height and baseline

- Each inline-level box has a `lineHeight`.
- `lineBox.height = max(child lineHeights)`.
- Text glyphs are centered within each text box's line height via
  half-leading.
- Inline-level boxes are vertically aligned within the line per
  `verticalAlign`:
  - `baseline` — child's baseline aligns with line's baseline.
  - `top` — child's top aligns with line's top.
  - `middle` — child's vertical center aligns with line's middle.
  - `bottom` — child's bottom aligns with line's bottom.

#### 6.2.5 Intrinsic sizing (min-content / max-content)

Required by inline-block (§6.4) and table layout (§6.5) for sizing.

v1 implements brute-force: lay out the IFC at `width: Infinity` to obtain
max-content; lay out at `width: 0` to obtain min-content. Inefficient but
correct. Optimization is non-architectural.

#### 6.2.6 First-class inline boxes

`display: inline` produces `InlineBox` layout nodes that:
- Contain text/inline-block/nested-inline children.
- Carry their own computed style (background, border, padding).
- **Fragment across line boundaries** — when an inline spans lines, it
  produces multiple line-fragment InlineBoxes:
  - Left-edge fragment: has `paddingLeft` and `borderLeft`.
  - Right-edge fragment: has `paddingRight` and `borderRight`.
  - Middle fragments: no horizontal start/end padding/border.
- Vertical (top/bottom) padding and borders are visual but do not affect
  line height (CSS rule).

This unlocks backgrounds, borders, and hit-test boundaries on inline
content (a phrase highlighted in yellow, a clickable inline link).

### 6.3 Table FC

Table layout uses **fixed percentage column widths only**. Every table
carries `metadata.columnWidths` — an array of fractions summing to 1.0.
Auto-layout (column widths derived from content) is deferred — it adds
significant complexity and word processors don't use it.

#### 6.3.1 Column resolution

```
column[k].pixelWidth = tableContentWidth × columnWidths[k]
```

That's the entire algorithm. No min/max content measurement, no
distribution.

User actions (insert table, resize column) produce valid `columnWidths`:
- Insert N×M table: `columnWidths = Array(M).fill(1/M)`.
- Resize column k by Δfraction: `columnWidths[k] += Δfraction`; distribute
  `−Δfraction` proportionally across `columnWidths[k+1..end]`. Sum stays
  1.0.

#### 6.3.2 Row height

- `auto` (default) → `max(cell content heights)`.
- `style.height: <length>` on the row → at least that tall; cells shorter
  than the row use their own height (vertical alignment governed by
  `verticalAlign` — `baseline` default for cells, `top`/`middle`/`bottom`
  for explicit placement).

#### 6.3.3 Cell content as nested BFC

A `display: table-cell` box's interior is a BFC. Standard nested-formatting-
context dispatch. No special case in the algorithm.

#### 6.3.4 Borders: collapse semantics

v1 always uses `border-collapse: collapse` semantics (no `borderCollapse`
style property in v1). Cells carry standard `borderTop/Right/Bottom/Left*`
properties. Adjacent cells' borders reconcile per CSS rules (wider/darker
wins). Outer table borders also painted from cell border properties at
table edges.

#### 6.3.5 No anonymous boxes

Components produce well-formed tables (`table` > `table-row` > `table-cell`).
The layout engine does not generate anonymous rows or cells for malformed
input. This is consistent with §6.6 (no anonymous box generation anywhere).

### 6.4 Inline-block

```
Encountering ElementBox with display: inline-block during IFC walk:
1. Resolve width:
   - explicit Length → use it
   - "auto" → run BFC layout at width=Infinity to obtain max-content, use that
2. BFC layout the children with the resolved width
3. Resolve height:
   - explicit Length → use it (content overflows visibly if shorter)
   - "auto" → use BFC content height
4. Return to the IFC as an atomic InlineBlockBox of (width × height)
```

Inline-block is **atomic** — never fragments across lines. If too wide for
the available line width, it goes to a fresh line; if still too wide, it
overflows visibly.

Inline-block establishes its own BFC — floats inside don't escape.

Vertical alignment in the IFC line: `verticalAlign` style on the
inline-block.

### 6.5 Floats

Float layout is the algorithmically trickiest piece of v1.

#### 6.5.1 Float positioning

When a block-level element has `float: left | right`:
1. Removed from normal flow (siblings ignore for vertical stacking).
2. Positioned at the inline edge of containing block: left for `float: left`,
   right for `float: right`.
3. y is current "drawing y" of the BFC at the float's document-order position.
4. Stacks with other active floats on the same side.
5. Wraps to next line below if it doesn't fit horizontally beside active floats.

#### 6.5.2 IFC interaction with floats

(Restated from §6.2.1.) Each line in the IFC queries active floats at
`lineY`, computes `[leftFloatWidth, containerWidth − rightFloatWidth]` as
its x-range, and lays out into that range. If a line is too narrow and there
are active floats, advance to the nearest float bottom and retry.

#### 6.5.3 `clear` property

A block with `clear: left | right | both` is positioned below all active
floats of the cleared sides:
- Compute the y the block would occupy in flow.
- Look up active floats of cleared sides at that y.
- If any exist, add **clearance** — synthetic vertical gap — to push the
  block past them.
- Clearance interacts with margin-collapsing per CSS rules.

#### 6.5.4 Edge cases

- Oversized float (wider than containing block): place anyway; overflows.
- Float inside an inline element: float escapes to nearest containing BFC.
- Both float-left and float-right on same line: both reduce available width;
  line content fits between them.
- Float at end of containing block: BFC encloses via §6.1.3.
- Float taller than containing block: BFC grows to enclose.

### 6.6 No anonymous box generation

CSS auto-generates anonymous boxes when source structure is malformed
(e.g., text directly inside a `<table>`, or a `<div>` directly inside a
`<ul>`). Taleweaver does **not**.

Components produce well-formed render trees (matching display nesting
expectations). The layout engine assumes well-formed input. This is a
schema contract on components, not a layout-engine feature.

---

## 7. Fragmentation

Stage 5 of the pipeline. Only runs when the document is paginated
(`pageHeight` configured).

### 7.1 break-* properties

```ts
breakBefore?: "auto" | "page" | "avoid";
breakAfter?:  "auto" | "page" | "avoid";
breakInside?: "auto" | "avoid";
```

- `auto` — fragmenter decides.
- `page` — force page break before/after this block.
- `avoid` — try not to break here.

CSS's `column`, `region`, `left`, `right`, `recto`, `verso` values are
deferred (not relevant to v1's word-processor target).

### 7.2 Fragmentation algorithm

```
Input: laid-out flow tree
Output: sequence of PageBoxes containing fragments

walk blocks of the flow in document order:
  pageContentHeight = pageHeight − pageMargins.top − pageMargins.bottom
  currentPageY = 0
  pages = []

  for each block:
    if block.style.breakBefore === "page":
      flush current page

    remainingHeight = pageContentHeight − currentPageY

    if block.height fits in remainingHeight:
      place block on current page; currentPageY += block.height
    else if block.style.breakInside === "avoid" or block can't split:
      flush current page; retry block on fresh page
    else:
      head, tail = split(block, remainingHeight)
      place head on current page
      flush current page
      block = tail; retry on fresh page

    if block.style.breakAfter === "page":
      flush current page

  finalize last page
```

### 7.3 Per-FC split rules

Different formatting contexts split at different granularities:

#### BFC

- Split between block children. Walk children in order, place those that
  fit, recurse into the one that crosses.
- `break-inside: avoid` blocks any split — entire block moves to next page.
- Margins at split point: top fragment's `marginBottom` is suppressed;
  bottom fragment's `marginTop` is suppressed.

#### IFC

- Split between line boxes. Lines never split mid-line.
- `break-inside: avoid` blocks any split.
- Subject to widow/orphan constraints (§7.4).

#### Table FC

- Split between rows.
- `break-inside: avoid` on a row → row stays intact, moves to next page.
- Otherwise, oversized rows split internally (cells split at line boundaries
  in their content's IFC).
- `break-inside: avoid` on the table itself → whole table moves if it
  doesn't fit.

#### Inline-block

- Atomic — never splits. Overflows to next page if over budget at fragment
  boundary, or moves to next page entirely if `break-inside: avoid` on its
  containing BFC.

### 7.4 Widows and orphans

```ts
widows:  number;     // initial 2; min lines that must appear at top of next page
orphans: number;     // initial 2; min lines that must remain at bottom of previous page
```

Both inherit. Default 2/2 matches Word and Google Docs.

When fragmenting an IFC, the candidate split point isn't just "where it
fits" but "where it fits subject to widow/orphan constraints":

```
Given paragraph splitting at line N (N lines on prev page, M on next):
  reject if N < orphans     (too few lines stranded on previous page)
  reject if M < widows      (too few lines stranded on next page)
  if rejected: try moving split earlier (fewer lines on prev page)
  if no valid split exists: move entire paragraph to next page
```

### 7.5 Floats across pages

Floats stay with their containing BFC. When the BFC fragments, the float
goes with the fragment containing its **point of origin** (where it was
declared in document order).

If the float would overflow the page, it overflows visually. v1 does not
generate float fragments — that is a known-hard CSS-engine problem.

### 7.6 Page assembly (stage 6)

Pass-through in v1. Each page contains exactly the fragment(s) the
fragmenter assigned to it.

This stage exists as an architectural placeholder for v2 features:
- **Page templates** — running content (headers, footers, page numbers,
  watermarks). Page assembly composes each page from
  `(fragmented main content) + (template's running content)`.
- **Positioning when added** — page-anchored variants resolved here.

---

## 8. List markers

The original concern that motivated the redesign: today's `marker` field
on block render nodes is replaced by a layout-engine primitive driven by
`display: list-item`.

### 8.1 Generation

When the BFC layout walker encounters an `ElementBox` with
`computedStyle.display === "list-item"`:

1. Lay out the principal box normally.
2. Generate a sibling `MarkerBox` containing the marker glyph or
   counter-formatted string.
3. Position the MarkerBox per `listStylePosition` (§8.4).

`MarkerBox` is a layout-tree-only node:
```ts
interface MarkerBox extends LayoutBoxBase {
  readonly type: "marker";
  readonly text: string;                       // resolved marker content
}
```

It does not exist in the render tree.

### 8.2 Marker content from `listStyleType`

| Value | Marker |
|---|---|
| `disc` | • |
| `circle` | ○ |
| `square` | ▪ |
| `decimal` | counter-driven, e.g., "1.", "2." |
| `lower-alpha` | "a.", "b.", ... "z.", "aa.", ... |
| `upper-alpha` | "A.", "B.", ... |
| `lower-roman` | "i.", "ii.", "iii.", ... |
| `upper-roman` | "I.", "II.", "III.", ... |
| `none` | (no MarkerBox generated) |
| `{ content: string }` | the literal string |

`listStyleType` inherits, so the list parent can set it once and all
list-items inherit.

### 8.3 Counter scoping

Counters are scoped per BFC that contains list-item children. The layout
walker maintains a counter that increments per `display: list-item` direct
child. The counter is fresh inside each BFC, so:

- A new list (a block whose children are list-items) → counter starts at 1.
- Nested list (a list-item containing another list) → the nested list is
  inside the list-item's interior BFC, so its counter is also fresh.

No explicit `counter-reset` / `counter-increment` properties in v1.

### 8.4 Marker positioning

Two modes via `listStylePosition`:

- **`outside` (default):** marker lives in the parent list's `paddingLeft`
  gutter.
  - Principal box laid out at parent's content-area x.
  - MarkerBox positioned at `(principalX − markerWidth − markerGap)` —
    negative-offset into the gutter.
  - Marker wider than gutter → overflows visually (matches browser behavior).

- **`inside`:** marker is the first inline content of the principal box's
  IFC.
  - No gutter offset; principal box starts at parent's content area.
  - Subsequent lines wrap under the marker (no hanging indent).

### 8.5 Marker styling

In v1, the MarkerBox inherits `fontFamily`, `fontSize`, `fontWeight`,
`color` from the list-item. No separate `::marker` pseudo-element. v2 can
add per-marker styling.

---

## 9. Migration and delivery

### 9.1 Strategy

Aggressive in-place rewrite. No backward-compat shims, no parallel
infrastructure, no adapter code. Old code is replaced as new code lands;
tests are rewritten alongside; the example React app is updated in the
same changes that change the underlying API.

### 9.2 Breaking changes (all accepted)

| Surface | Change |
|---|---|
| `StateNode.styles` (NodeStyles) | → `StateNode.style` (Style) |
| `RenderNode` typed union | → `ElementBox \| TextBox` |
| `RenderStyles` | → `Style` |
| `LayoutBox` types | → new shapes per FC |
| `ComponentDefinition.createInitialState` | removed |
| `INSERT_BLOCK` action | → `INSERT_NODE` |
| `lineMargin*`, `blockMargin*` | removed; use 4-sided `margin*` with collapsing |
| `marker` field on block | removed; layout generates from `display: list-item` |
| `metadata.image`, `metadata.horizontal-line` | survive (escape hatch) |

### 9.3 Test strategy

1. **Unit tests per module (TDD).** Each new module — Style schema, cascade
   pass, BFC, IFC, Table FC, fragmenter — has tests written before
   implementation.
2. **Property/invariant tests** for cascade and layout. E.g.,
   "every cascade output has every property defined"; "BFC content height
   ≥ sum of children's heights"; "IFC line widths respect active floats."
3. **Snapshot/golden tests** of layout output for representative documents.
4. **Integration tests** through the editor reducer: apply action sequences,
   assert final layout shape and selection geometry.
5. **Performance benchmarks.** Typing latency in 1k/10k/100k-word
   paragraphs; scroll-and-paint time on 100-page documents; full
   re-layout time on container resize. Especially relevant to issue 03
   (incremental wrap) — v1 does *not* solve issue 03 (still re-wraps
   whole IFC on inline edits), but the new architecture is compatible
   with line-stable wrap which can land in v2.

---

## 10. Deferred features

Each is architecturally accommodated by v1; adding them is purely
additive (new style properties or new formatting-context handlers).

### Layout / positioning
- `position` (all values) — v1 has only static. Architecture has the
  page-assembly stage and FC-aware layout to host absolute/relative when
  added.
- Page templates — running headers/footers/page numbers. Land in stage 6
  (page assembly).
- Multi-column (`columnCount`, `columnWidth`) — new formatting context.
- Floats fragmenting across pages.

### Text / typography
- `textAlign`, `textIndent`, `letterSpacing`, `wordSpacing`.
- Subscript/superscript (`verticalAlign: sub | super | length | percentage`).
- Hyphenation.
- `direction`, `writingMode` (RTL, vertical writing).

### Visual
- Background images, gradients.
- `transform`, `opacity`, `visibility`, `zIndex`.
- `overflow` (visible/hidden/auto/scroll).
- Per-marker styling (`::marker` pseudo-element).

### Tables
- Auto column layout (table-layout: auto).
- `<caption>` / `display: table-caption`.
- First-class column elements (`<col>` / `display: table-column`).
- `border-collapse: separate`.

### Performance
- Line-stable incremental wrap (issue 03) — v1 still does whole-IFC re-wrap on
  inline edits.
- Long-document virtualization (issue 13).

### Other
- Operations as first-class values (issue 11) for collaboration.
- Accessibility tree (issue 12).
- Selector-based stylesheets / cascade rules.

---

## 11. Open implementation questions

Decisions left to the implementation phase:

- **Cascade pipeline placement** within the ElementBox object: do
  `style` and `computedStyle` coexist on the same node, or do we produce
  a parallel computed-style tree? Architecturally equivalent; pick what's
  simpler at write time.
- **MarkerBox identity for hit-testing:** is a click on a marker treated
  as a click on the list-item, or as a no-op?
- **Float vertical positioning when origin line moves:** if a line containing
  a float origin gets its y recomputed during incremental layout, does the
  float's y also move? Suspect yes; confirm during implementation.
- **Mixing of explicit and auto column widths in tables:** v1 spec says
  fixed-percentage only, but the column-resize action could conceivably
  hold one column at "auto" while others are fixed. Defer this to v2 when
  auto-layout lands.

These do not affect the design contracts. They are local implementation
choices that can be resolved during writing-plans / build.
