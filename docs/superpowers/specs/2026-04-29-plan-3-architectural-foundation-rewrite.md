# Plan 3 — Architectural Foundation Rewrite — Design

**Date:** 2026-04-29
**Status:** Approved (pending writing-plans handoff)
**Branch:** `feature/dom-architecture-redesign`
**Predecessors:** Plans 1 (foundation) and 2 (rich layout) shipped on this branch.
**Supersedes:** the original `2026-04-27-dom-architecture-plan-3-pagination.md` plan,
which is rolled into a later plan in the new sequence.

---

## 1. Goals and non-goals

### Goals

1. Replace the algorithmic shortcuts taken in Plans 1 and 2 with CSS-faithful
   implementations: full value-resolution chain, multi-pass intrinsic sizing,
   anonymous-box generation, real CSS 9.5 floats, line-stable IFC re-wrap,
   subtree-granularity incremental machinery.
2. Adopt logical-axis layout end-to-end so that the engine is internally
   ready for vertical writing modes and bidirectional text. The Style schema
   exposes only logical properties — no physical aliases.
3. Expand the text platform interface from "string width" to a full shaping
   API (positioned glyphs, cluster boundaries, break opportunities, bidi
   levels, font metrics) so that ligatures, complex scripts, RTL, and
   hyphenation are first-class throughout.
4. Land the load-bearing prerequisite for the rest of the multi-plan
   sequence (Plans 4–8 add features on this foundation; they do not
   re-architect what Plan 3 ships).
5. Absorb the bulk of the Plan 1 follow-ups
   (`docs/superpowers/plans/2026-04-27-plan-1-followups.md`) that are
   architectural in nature, particularly the F4.x perf regressions, F5.1–5.3
   length-handling type unsafety, and F7.6 hardcoded em-fallback.

### Non-goals

- Full CSS specification compliance. Documents are the target; flex, grid,
  sticky positioning, transforms with 3D, animations, transitions, filters,
  `clip-path`, and `mask` are out of scope.
- New user-facing features beyond what existing Plans 1+2 surface, except
  for end-to-end RTL/bidi (the rest of the deferred-features list lands in
  later plans). The point of this plan is to make the engine *correct*, not
  to add capabilities visible to authors.
- Backwards compatibility with the Plan 1+2 Style API. The schema changes
  break every call site that uses physical inset properties; the change is
  paid down in phase 3.A.
- Implementation of a text shaper. Plan 3 ships only the *interface* and a
  canvas-based fallback backend; HarfBuzz integration is a separate package.

### Why now

User direction: build a world-class word processor matching Google Docs
quality, leveraging DOM/CSS as the substrate for problems DOM has already
solved. The Plan 1+2 implementation is the right *shape* (display dispatch,
formatting contexts, render/layout split, immutable LayoutBox) but reaches
quality limits that are inherent to the algorithmic shortcuts taken to ship
v1. Plan 3 makes the engine clean before adding feature breadth in Plans 4–8.

---

## 2. Pipeline & value resolution

### 2.1 Stages

CSS distinguishes four progressively-resolved value stages. Today's engine
collapses them, which forces `em`/`%`/`min-content` to resolve at cascade
time against guesses (the containing block isn't known yet). Plan 3
separates them.

```
StateNode tree
  │ component.render() bottom-up
  ▼
Render tree (Style)                          ← declared / specified
  │ cascade pass: inheritance, initial values, inherit/initial/unset/revert
  ▼
Render tree + ComputedStyle                  ← computed
  │   • em / rem → px (font-size known from inheritance chain)
  │   • colors normalized to RGB
  │   • % / auto / min-content / max-content / fit-content kept symbolic
  │   • logical properties keep logical names; physical aliases removed
  ▼
Layout pass: per box, resolve against containing block
  │   • % → px (using containing block's resolved size in correct axis)
  │   • auto → resolved by FC algorithm
  │       ◦ in-flow block: containing block's available inline-size
  │       ◦ inline-block / float / table-cell auto-layout: shrink-to-fit
  │   • min-content / max-content / fit-content → intrinsic-sizing pass
  ▼
LayoutBox tree                               ← used (numeric)
  │   each box carries both ComputedStyle and UsedStyle
  │ painter (reads UsedStyle, snaps to actual)
  ▼
Canvas / paint commands
```

### 2.2 Three style types

```ts
interface Style {
  /* what components return — partial; declared values; logical props only */
}
interface ComputedStyle {
  /* fully populated; em/rem resolved; %/auto/intrinsic-sizes kept symbolic;
     colors normalized; one per render node */
}
interface UsedStyle {
  /* fully numeric; %/auto/intrinsic-sizes resolved; one per layout box,
     since one render node can produce multiple layout boxes via
     fragmentation or anonymous-box generation */
}
```

`ComputedStyle` is what the cascade pass produces. `UsedStyle` is what the
layout pass produces per box. Painter and hit-test consume both:
`ComputedStyle` for inherited/non-positional things (color, font-family,
text-decoration), `UsedStyle` for sizes and positions.

### 2.3 What resolves where

| Property kind | Resolved at | Notes |
|---|---|---|
| `inherit` / `initial` / `unset` / `revert` keywords | Cascade | Substituted with parent / spec / property-default values |
| `em`, `rem` | Cascade | Font-size known from inheritance chain |
| `%` (sizes, margins, padding) | Layout | Resolved against containing block in correct axis |
| `auto` (in-flow block inline-size) | Layout | Containing block's available inline-size |
| `auto` (shrink-to-fit: inline-block, float, table-cell) | Layout | Calls intrinsic-sizing pass |
| `min-content` / `max-content` / `fit-content` | Layout | Intrinsic-sizing pass |
| Color names / functions | Cascade | Normalized to RGB tuple |
| `calc()` (future) | Cascade where possible, layout otherwise | Defer to later plan |

### 2.4 Why this fixes existing bugs

- F7.6 (hardcoded em-fallback to 16) goes away — em resolution moves to
  cascade where the inheritance-chain font-size is always known.
- F5.1–F5.3 (type-unsafe length-handling casts) go away — separate types
  for `Length`, `ComputedLength` (no em/rem), `UsedLength` (numeric)
  eliminate casts.
- Percentage handling is correct (today percentages are silently dropped
  in `lengthToPx`; Plan 3 resolves them at layout time against the actual
  containing block).
- `min-content` / `max-content` / `fit-content` keywords on sizing
  properties become first-class.

---

## 3. Logical-axis layout

### 3.1 Axis model

CSS Writing Modes 3 defines two axis pairs. The engine reasons in *logical*
terms throughout layout; *physical* coordinates are derived for painting and
hit-testing.

- **Inline axis**: direction text advances within a line.
  - `horizontal-tb LTR`: left-to-right
  - `horizontal-tb RTL`: right-to-left (reversed at line-end via bidi)
  - `vertical-rl`: top-to-bottom (reading direction inside a line)
  - `vertical-lr`: top-to-bottom

- **Block axis**: direction blocks stack and successive lines accumulate.
  - `horizontal-tb`: top-to-bottom
  - `vertical-rl`: right-to-left
  - `vertical-lr`: left-to-right

Each box knows its containing block's writing-mode + direction at layout
time. The mapping from logical to physical coordinates is local and stable
per box.

### 3.2 Style schema is logical-only

Physical inset/sizing properties are removed from the Style API. Only
logical equivalents remain. Authors who paste examples from web CSS will
get TypeScript errors pointing them at the logical names.

| Concept | Style property |
|---|---|
| Margin | `marginBlockStart`, `marginBlockEnd`, `marginInlineStart`, `marginInlineEnd` |
| Padding | `paddingBlockStart`, `paddingBlockEnd`, `paddingInlineStart`, `paddingInlineEnd` |
| Border width / style / color | `borderBlockStartWidth`/`Style`/`Color`, `borderBlockEnd…`, `borderInlineStart…`, `borderInlineEnd…` |
| Border radius | `borderStartStartRadius`, `borderStartEndRadius`, `borderEndStartRadius`, `borderEndEndRadius` (corner names = `<block-edge><inline-edge>`) |
| Sizing | `inlineSize`, `blockSize`, `minInlineSize`, `minBlockSize`, `maxInlineSize`, `maxBlockSize` |
| Position insets | `insetBlockStart`, `insetBlockEnd`, `insetInlineStart`, `insetInlineEnd` |
| Float side | `float: "inline-start" \| "inline-end" \| "none"` |
| Clear side | `clear: "inline-start" \| "inline-end" \| "both" \| "none"` |
| Text-align side | `textAlign: "start" \| "end" \| "center" \| "justify"` |

Removed entirely: `marginTop`, `marginRight`, `marginBottom`, `marginLeft`,
all `padding-*` physical, all `border-*-*` physical, `top`, `right`,
`bottom`, `left` (positioning), `width`, `height`, `min-width`, `min-height`,
`max-width`, `max-height`, `float: left | right`, `clear: left | right`,
`textAlign: left | right`.

`text-decoration-line: underline | overline | line-through` keeps its names
(they're conceptual relative to the run, not directional in the page sense).

### 3.3 ComputedStyle — logical canonical

`ComputedStyle` exposes only the logical names. The cascade pass canonicalizes:
when a Style property is set on a logical name, it stays there; when set on
a physical name (which Plan 3 makes impossible at the type level, but Plan
1+2 component output may still produce them during the migration), the
cascade resolves it to the corresponding logical name based on parent's
writing-mode + direction.

After Plan 3.A, no code path produces physical Style properties; the cascade
canonicalization becomes a no-op except for `text-align: start/end` which
maps to direction.

### 3.4 LayoutBox carries both

```ts
interface LayoutBox {
  // Logical (FC algorithms read+write these)
  inlineOffset: number;        // parent-relative, content-edge origin
  blockOffset: number;
  inlineSize: number;
  blockSize: number;

  // Physical (painter / hit-test / selection-geometry read these)
  x: number;
  y: number;
  width: number;
  height: number;

  // Containing-block writing-mode + direction at this point
  writingMode: WritingMode;
  direction: Direction;

  // ...computedStyle, usedStyle, type, children, metadata, etc.
}
```

Physical coords are derived from logical + writing-mode + direction at the
end of laying out each box. The derivation is local (a box only needs to
know its own writing-mode); painters and hit-testers walk the tree
accumulating offsets.

Positions are stored **parent-relative**, not document-absolute. This is a
break from Plan 1+2 which store some positions as absolute. Section 8
covers the consequence: incremental subtree reuse becomes a single
reference assignment.

### 3.5 v1 behavior

Plan 3 exposes `writingMode: "horizontal-tb"` and `direction: "ltr" | "rtl"`
in the Style schema. Vertical writing modes (`vertical-rl`, `vertical-lr`)
are activated in Plan 4. Bidi/RTL is end-to-end in Plan 3 (see §9.6); the
logical→physical mapping handles both LTR and RTL.

Mapping for `horizontal-tb`:

- **LTR (default).** Identity for sizes and offsets:
  `inlineSize === width`, `blockSize === height`, `inlineOffset === x`
  (relative to parent's content origin), `blockOffset === y`.
  `inlineStart` edge = parent's left content edge; `inlineEnd` = right.
- **RTL.** Sizes are identity; the inline axis is mirrored. `inlineStart`
  edge = parent's right content edge; `inlineEnd` = left.
  `inlineOffset` is measured from the inline-start edge, so
  `physical x = parent.contentRightEdge − inlineOffset − inlineSize`.
  `blockOffset === y` (block axis is the same).

The full abstraction is in place across all four
`(horizontal-tb / vertical-rl / vertical-lr) × (ltr / rtl)` cases at the
algorithm level. Activating vertical modes in Plan 4 is exposing the
schema values and adding painter rotation — a small additive step.

---

## 4. Multi-pass layout & intrinsic sizing

### 4.1 The two intrinsic sizes

CSS defines per-box intrinsic inline sizes:

- **max-content inline-size** — widest the content wants given infinite
  space. For inline content: longest unbreakable run (a word, or a
  hyphenated word piece if `hyphens: auto`). For blocks: max of children's
  max-content. Propagates up.
- **min-content inline-size** — narrowest without overflow. For inline:
  widest single unbreakable grapheme cluster (CJK character; an
  unhyphenable word). For blocks: max of children's min-content.
  Propagates up.

These are inline-axis only in our scope. CSS doesn't define general
block-axis intrinsic sizes (block-axis intrinsic only exists for flex/grid,
which we don't have); we leave that out per the writing-mode discussion.

### 4.2 Where intrinsic sizing is consulted

| Case | Resolves `inlineSize: "auto"` to |
|---|---|
| inline-block | shrink-to-fit = `min(maxContent, available, max(minContent, available))` |
| Float | shrink-to-fit |
| Table-cell, auto-layout | derived from per-column min/max-content with rowspan/colspan rules |
| Multi-column, `columnWidth: "auto"` | max-content of widest content (Plan 7) |
| Explicit `inlineSize: "min-content" \| "max-content" \| "fit-content"` | direct |

In-flow blocks with `inlineSize: "auto"` use the containing block's
available inline-size — no intrinsic-sizing call. That's the bulk of
documents; cost is paid only on cases that genuinely need it.

### 4.3 Two-traversal algorithm

```
layoutBox(box, containingBlockInlineSize):
  inlineSize = resolveInlineSize(box, containingBlockInlineSize)
  // dispatches to FC; may call computeIntrinsicSizes for shrink-to-fit
  for child in children:
    layoutBox(child, inlineSize - padding - border)

computeIntrinsicSizes(box) → { minContent, maxContent }:
  // does NOT position; walks children once, returns intrinsic pair
  switch on box.computedStyle.display:
    block:    max-over-children of {min:child.min, max:child.max}
    inline:   sum-without-wrap {min: max(child.min), max: sum(child.max)}
    text:     widest grapheme cluster (min); unbreakable-run length (max)
    table:    derive from per-column min/max with rowspan/colspan rules
  cache result keyed by (renderNode, computedStyle)
```

The intrinsic-sizing pass is a distinct traversal from layout. It runs
lazily — only when a resolution actually needs it.

### 4.4 Cache

`IntrinsicSizes` is intrinsic to render node + ComputedStyle (not to layout
position). Cache lives on the render node. Invalidates via the same
dirty-tracking as cascade and layout: when a render node or its ComputedStyle
changes, the cached intrinsic sizes invalidate up the chain.

### 4.5 FC interaction

- **BFC** consults `computeIntrinsicSizes` when resolving inline-block,
  float, or table-cell inline-size.
- **IFC** *produces* inline content's intrinsic sizes —
  `max = sum of per-word max-content (no wrap)`,
  `min = widest single word`. "Per word" comes from the shaper
  (cluster + break-opportunity boundaries).
- **Table FC** consumes per-cell intrinsic sizes for auto-layout column
  resolution.

### 4.6 Style API extension

```ts
inlineSize: Length | "auto" | "min-content" | "max-content" | "fit-content";
blockSize: Length | "auto" | "min-content" | "max-content" | "fit-content";
minInlineSize: Length | "auto" | "min-content" | "max-content" | "fit-content";
// ...same shape for the other sizing properties
```

### 4.7 Block-axis intrinsic sizing

Out of Plan 3 scope. The architectural hook is `resolveBlockSize` as a
dispatch function on the layout side; a future plan can add new keyword
cases (`block-size: min-content` etc.) without restructuring algorithms.

---

## 5. Anonymous box generation

### 5.1 When anonymous boxes appear

CSS uses anonymous boxes to fix structural mismatches between the document
tree and what formatting contexts require. Real engines never expose them
to consumers — they're ephemeral layout-time wrappers.

1. **Block container with mixed block + inline children.** Each run of
   consecutive inline children gets wrapped in an anonymous block-level box
   that establishes its own IFC. BFC and IFC never coexist at the same
   level.

   ```
   <div>                   →    <div>            [BFC]
     "hello"                       [anon block]   [IFC]  "hello"
     <p>world</p>                  <p>            [IFC]  "world"
     "more text"                   [anon block]   [IFC]  "more text"
   </div>                        </div>
   ```

2. **Tables.** Table FC requires the chain
   `table > table-row-group > table-row > table-cell`. Missing intermediates
   are auto-generated:
   - `display: table-cell` directly inside `display: table` →
     anonymous `table-row` and `table-row-group` wrap it.
   - Inline content directly inside `display: table` →
     anonymous `table-cell` wraps it.
   - Free `display: table-cell` not inside any table →
     anonymous wrapping `display: table` generated.

3. **Inline-only blocks need no anonymous wrap.** A paragraph with only
   inline children stays as-is; the block runs an IFC directly. The
   wrap fires only on actual mixing.

### 5.2 Where generation happens

Real engines generate anonymous boxes inline during layout dispatch — not
as a separate render-tree pass. Plan 3 follows that:

- BFC at the top of `layoutBlock` walks children in document order. Groups
  consecutive inline-display children (`inline`, `inline-block`, text)
  into an "anonymous block run", dispatches one IFC per run. Block-display
  children dispatch normally to BFC / Table FC / etc.
- Table FC's dispatcher inserts the missing intermediate boxes when it
  sees a wrong-shaped child.

Implementation: a `groupChildren()` helper called by FC dispatchers. No
separate render-tree pass; no allocated anonymous nodes in memory.

### 5.3 Anonymous box style

Anonymous boxes inherit from their parent. Layout properties (margin,
padding, border) are zero — they're transparent containers. The IFC
inside an anonymous block uses the parent block's available inline-size,
padding-resolved.

### 5.4 Identity & incremental

Anonymous boxes have no state-node ID. For layout caching, they're keyed
positionally — `parentKey/anon[i]`. If parent children change, anonymous
keys may shift, invalidating cache below. This is the same invalidation
rule as for real children; only the key generation differs.

### 5.5 Fragmentation

Anonymous boxes split like real boxes — the fragmenter doesn't need to
know they're anonymous. The (anonymous) line-boxes inside propagate up;
parent BFC fragments normally.

### 5.6 Component model implication

Plan 1+2 components produce uniform output (paragraphs are all-inline,
documents are all-block), so anonymous-box cases rarely occur today. Plan 3
makes the engine correct regardless of state-tree shape, and components
stop having to be careful about wrapping inline runs in spans manually.

---

## 6. Real floats (CSS 9.5)

### 6.1 What's wrong today

Plan 2's `FloatContext` tracks active floats per BFC and exposes
`activeAt(y)` for IFC line-width queries. It misses several CSS 9.5 rules
and has a known integration bug — the IFC inline-content path uses an
empty per-IFC float context (followups F.2 / F.3). Plan 3 replaces it with
a CSS-faithful `FloatEnvironment` and fixes the IFC↔BFC integration.

### 6.2 The CSS 9.5.1 rules that matter for documents

- A float must not overlap an earlier float on the same side; the engine
  pushes it below if its inline-size doesn't fit.
- Top of float ≤ top of containing block; ≤ top of any earlier float.
- Floats "rise" to the nearest BFC — they're placed in their containing BFC,
  not in their parent block (unless the parent block establishes a BFC).
- Margins on floats don't collapse (out-of-flow).
- A new BFC is established by `overflow ∈ {hidden, auto, scroll, clip}`,
  `display: flow-root`, the box being floated itself, absolute-positioned
  boxes, inline-blocks, table cells.

### 6.3 The interface

```ts
interface FloatEnvironment {
  // Place a new float. Implements 9.5.1; returns final logical position.
  placeFloat(
    box: LayoutBox,
    side: "inline-start" | "inline-end",
    requestedBlockOffset: number,
    containingInlineSize: number,
  ): { blockOffset: number; inlineOffset: number };

  // For IFC: how much inline-size is available at a given block-offset?
  availableInlineSizeAt(
    blockOffset: number,
    containingInlineSize: number,
  ): { inlineStart: number; inlineEnd: number };

  // For `clear`: block-offset where the cleared side has no active float.
  clearance(
    side: "inline-start" | "inline-end" | "both",
    currentBlockOffset: number,
  ): number;

  // For BFC enclosure.
  lowestFloatBlockEdge(): number;

  // For incremental: earliest dirty block-offset since last layout.
  dirtyBlockOffsetSince(prev: FloatEnvironment): number;
}
```

A fresh `FloatEnvironment` is created at every BFC root. Floats inside
don't leak up; crossing a BFC boundary starts a new environment.

### 6.4 IFC integration fix

Today's IFC creates an empty per-IFC float context. Plan 3 passes the
parent BFC's `FloatEnvironment` through the layout context. Sequence per
float in inline content:

1. Compute the float's intrinsic size (Section 4's pass).
2. Ask the inherited environment to `placeFloat` at the current line's
   block-offset.
3. Re-query `availableInlineSizeAt(line.blockOffset)` for the in-progress
   line.
4. Continue laying out the line.

### 6.5 Below-min-content line push

Required by CSS for narrow columns with floats:

```
if availableInlineSizeAt(currentBlockOffset) < line.minContent:
    currentBlockOffset = next float bottom > currentBlockOffset
    retry
```

The line gets pushed below the float when no content can fit at the
current block-offset.

### 6.6 Clearance

When a block has `clear: inline-start | inline-end | both`:

1. Compute the block's natural block-offset (after margin collapse with
   prior sibling).
2. Query `clearance(side, naturalOffset)` — returns the block-offset where
   the cleared side has no active float.
3. The difference (clearance offset − natural offset) is treated as
   synthetic margin.
4. If clearance is non-zero, the cleared box's `marginBlockStart` does
   *not* collapse with parent (CSS 8.3.1).

### 6.7 BFC establishment

The layout dispatcher checks whether a box establishes a new BFC; if yes,
runs its layout in a fresh `FloatEnvironment`. Triggers:

- `overflow ∈ {hidden, auto, scroll, clip}`
- `display: "flow-root"` (added to schema; CSS Display 3 — the explicit
  "make this a BFC" value)
- The box is itself floated, absolute-positioned, inline-block, or table-cell.

### 6.8 Self-collapsing block with floats

The "clearfix" pattern works automatically because BFC enclosure takes
`max(inFlowBlockSize, lowestFloatEdge)`. A block with `overflow: hidden`
containing only floats has the right block-size by construction.

### 6.9 Out of scope

- `shape-outside` (CSS Shapes 1, irregular float-exclusion regions).
  Documents don't need; OUT.
- Float environments inside flex/grid items. Flex/grid is OUT.

---

## 7. Line-stable IFC

### 7.1 Why this matters

Plans 1+2 re-wrap the entire paragraph from scratch on every keystroke. A
50-line paragraph with one character inserted on line 30 re-wraps all 50
lines. This is followup F4.3 / issue 03 deferred work. For long paragraphs
typical in word-processor documents, constant-time-per-keystroke requires
line stability.

### 7.2 Approach

Greedy wrap as a fold over a stable token stream. Greedy wrap has a useful
property: line K's break point is fully determined by
`(start-token-of-line-K, available-inline-size-at-line-K's-block-offset)`.
If two re-wraps see the same `(start-token, available-inline-size)` at
line K, they produce the same break point. That's trivial convergence
detection.

### 7.3 Algorithm

```ts
// Token = indivisible wrap unit (word run, atomic inline-block,
// break opportunity, float marker)
// Each token has stable ID derived from (state-node-key, offset-within-node)

function rewrapIncremental(
  prev: { tokens: Token[]; lines: Line[] },
  next: { tokens: Token[] },
  changePoint: number,         // first divergent token index
  availableInlineSize: number,
  floatEnv: FloatEnvironment,
): Line[] {
  // 1. Reuse the prefix of lines whose tokens are all before the change.
  const startLineIdx = findLineContainingToken(prev.lines, changePoint);
  const reusedHead = prev.lines.slice(0, startLineIdx);

  // 2. Re-wrap from that line's first token forward.
  let cursor = prev.lines[startLineIdx].startTokenIdx;
  const newMiddle: Line[] = [];
  while (cursor < next.tokens.length) {
    const line = wrapOneLine(next.tokens, cursor, availableInlineSize, floatEnv);
    newMiddle.push(line);

    // 3. Convergence check: does the next line align with a previous line?
    const matchingPrev = findLineByStartToken(prev.lines, line.endTokenIdx + 1);
    if (matchingPrev && availableSizeMatches(matchingPrev, floatEnv)) {
      return [...reusedHead, ...newMiddle, ...prev.lines.slice(matchingPrev)];
    }
    cursor = line.endTokenIdx + 1;
  }
  return [...reusedHead, ...newMiddle];
}
```

### 7.4 Stable token IDs

Tokens need identity that survives state changes. ID is derived from:

- Text tokens: `(state-node-key, offset-within-node)`.
- Atomic tokens (inline-blocks, floats, hard breaks): `(state-node-key)`.

When text content in a node changes, that node's tokens get new IDs (offsets
shift). Surrounding nodes' tokens stay stable. The dirty range from the
state-tree diff bounds which tokens changed.

### 7.5 Float interaction

A float's `placeFloat` call or removal invalidates lines whose block-offset
is at or after the affected y. The `FloatEnvironment` tracks an "earliest
dirty block-offset"; the IFC uses it as a re-wrap floor. Most edits don't
move floats, so this rarely triggers.

### 7.6 Complexity

For a 100-line paragraph with one character changed on line 30:
- Lines 1–29 reuse (tokens before changePoint).
- Line 30 re-wraps.
- After 1–3 lines the new wrap converges with the old (same start-token +
  same available inline-size); 31–100 reuse.
- Effectively O(1) per keystroke regardless of paragraph length.

Pathological case: insert at start of paragraph. Every subsequent line
shifts; convergence may not happen until much later. Whole paragraph
re-wraps. Same cost as today; acceptable since N is paragraph length, not
document length.

### 7.7 Out of scope

Knuth-Plass-optimal wrap (TeX-style paragraph-level optimization) produces
prettier line balancing but loses convergence — line breaks depend on
whole-paragraph context, so no incremental wrap. CSS Text 4's
`text-wrap: pretty` is the spec hook. The schema reserves
`text-wrap: wrap | nowrap | balance | pretty | stable`; v1 ships
`wrap` and `nowrap`. The other values are accepted but treated as `wrap`
until later plans implement them.

### 7.8 Test discipline

Reference-equality test suite: for each edit type (insert mid-paragraph,
delete mid-paragraph, change span style, add/remove float), assert that
lines outside the affected range have reference-equal `Line` objects in
the new layout.

---

## 8. Incremental everything (cascade, layout, paint)

### 8.1 The unified flow

```
state edit → state-tree diff (dirty paths)
           ↓
render tree              ← unchanged subtrees structurally shared
           ↓
cascade incremental      ← reuse if (specifiedStyle, parentComputedStyle) match prev
           ↓
layout incremental       ← reuse if (renderNode, availableInlineSize, writingMode,
                            float-env state, intrinsic-cache state, block-axis context)
                            match prev
           ↓
paint incremental        ← repaint only boxes whose paint inputs changed
```

Reference equality is the reuse check throughout.

### 8.2 Layout incremental

A `LayoutBox` is reusable from its previous version when all of these match:

| Input | Source |
|---|---|
| Render-node identity / `computedStylesEqual` | Cascade output |
| `availableInlineSize` from containing block | Parent's resolved inline-size |
| Writing-mode + direction of containing block | Parent box |
| Float-env state at this block-offset | `FloatEnvironment.dirtyBlockOffsetSince(prev)` |
| Intrinsic-size cache state (for shrink-to-fit) | Per-render-node intrinsic cache |
| Block-axis context (preceding-sibling's `marginBlockEnd`, `clear` resolution) | Layout-context value |

If all match, reuse with a single reference assignment; descendants come
along automatically. If any differ, re-layout this box and recurse into
children with their own reuse checks.

### 8.3 Parent-relative positions

Each `LayoutBox` carries `(blockOffset, inlineOffset)` *relative to the
parent's content edge*, not document-absolute. Painter and hit-test walk
the tree accumulating offsets cumulatively. This makes subtree reuse
trivial — a reused subtree lands at a new parent-relative position with
only the parent box updated; descendants stay reference-equal.

This is a break from Plan 1+2 which store some positions as absolute. The
painter, hit-test, and selection-geometry modules all need the parallel
update.

### 8.4 Cache structure

A single render node can produce multiple layout boxes (page fragmentation
in Plan 5; anonymous-box wrapping in §5). Cache key is
`(renderNodeKey, fragmentIndex, anonIndex)`. The previous layout exposes
`Map<compositeKey, LayoutBox>` for lookup.

### 8.5 Paint incremental

Per box, hash the paint inputs:
- Parent-relative position
- Size
- ComputedStyle subset that affects paint (color, font, decoration, etc.)
- UsedStyle subset (resolved sizes)

Compute dirty regions = union of (old rect, new rect) for boxes whose hash
changed. Painter clears only those regions and repaints the affected boxes.

For long documents: layered canvas (one per page or per scroll viewport),
per-box hash. Only the visible page's painter runs at full cost; offscreen
pages stay warm-cached.

### 8.6 Test discipline

Reference-equality assertions per change type:

- Insert character mid-paragraph → unaffected paragraphs ref-equal.
- Toggle bold on a word → unaffected words ref-equal in the line.
- Add/remove float → siblings before float unchanged.
- Resize containing block → blocks with explicit `inlineSize` reuse;
  only auto-sized children re-layout.
- Add list item → unaffected list items ref-equal.

### 8.7 Performance target

For a 100-page document with one character inserted mid-page-50:
- Cascade reuses ≈99 pages of subtree.
- Layout re-walks the affected paragraph plus a couple of lines for IFC
  convergence; rest is reused.
- Paint repaints the dirty paragraph rect on the visible page.
- Approximate cost: O(visible page area) per keystroke, regardless of
  document length.

---

## 9. TextShaper interface

### 9.1 Why expand

Plans 1+2 use a `TextMeasurer` that returns string widths and font heights.
Adequate for greedy wrap of Latin text; insufficient for ligatures (cursor
positioning inside `fi`), complex scripts (Arabic shaping, Devanagari
reordering), bidi (mixed RTL/LTR), accurate intrinsic sizing (needs cluster
boundaries), and justification (needs glyph-level kerning info).

### 9.2 The interface

```ts
interface TextShaper {
  shape(
    text: string,
    style: ComputedStyle,
    baseDirection: Direction,
  ): ShapedRun;

  measureFontMetrics(style: ComputedStyle): FontMetrics;
}

interface ShapedRun {
  text: string;
  computedStyle: ComputedStyle;

  // Grapheme clusters in logical order
  clusters: Cluster[];

  // Aggregate metrics
  ascent: number;
  descent: number;
  lineGap: number;

  // Intrinsic sizing inputs (consumed by §4)
  minClusterInlineSize: number;       // widest single cluster
  unbreakableRunInlineSize: number;   // total run with no breaks

  // Unicode line-breaking (UAX-14) output, with hyphenation extension
  breakOpportunities: BreakOpportunity[];

  // Bidi level per Unicode Bidi Algorithm; 0 = LTR, 1 = RTL, etc.
  bidiLevel: number;
}

interface BreakOpportunity {
  clusterIndex: number;
  kind: "hard" | "soft" | "hyphen";
  // hard: forced (newline, after period if rules say so)
  // soft: regular UAX-14 break
  // hyphen: hyphenation point — IFC inserts hyphen glyph at line end
}

interface Cluster {
  start: number;                       // text-offset range
  end: number;
  inlineAdvance: number;               // logical-axis advance
  isLigature: boolean;
  glyphs: GlyphId[];                   // opaque to engine; passed through to painter
}

interface FontMetrics {
  ascent: number;
  descent: number;
  lineGap: number;
  capHeight: number;                   // for vertical-align: text-top
  xHeight: number;                     // for vertical-align: middle
}
```

### 9.3 Engine consumption sites

- **IFC tokenizer** consumes `breakOpportunities` for legal wrap points
  (replaces Plan 2's whitespace-based tokenizer; correct UAX-14 not
  approximated).
- **IFC line layout** uses per-cluster `inlineAdvance`. Ligatures
  position correctly.
- **IFC intrinsic sizing** sums `unbreakableRunInlineSize` and maxes
  `minClusterInlineSize` over the paragraph (§4 input).
- **Painter** draws clusters as glyph runs at cluster positions. Glyph
  IDs pass through to the canvas / font backend.
- **Hit-test** uses cluster boundaries — cursor lands at cluster edges,
  never inside a ligature.
- **Selection geometry** uses cluster ranges for highlight rects.
- **Bidi reordering** at line break: IFC walks clusters in logical order;
  before painting, reorders clusters per bidi level so visual order is
  correct. Painter receives visual-order clusters with final positions.

### 9.4 Backends

| Package | Purpose | Weight |
|---|---|---|
| `@taleweaver/shaper-canvas` | Default; bundled. Canvas `measureText`; cluster ≈ codepoint; no ligatures or complex scripts. Adequate for Latin LTR. | ~5 KB |
| `@taleweaver/shaper-harfbuzz` | Production; opt-in. HarfBuzz-WASM, fonts as ArrayBuffer. Full OpenType, bidi, complex scripts. | ~1 MB WASM |
| `@taleweaver/shaper-mock` | Tests. Deterministic synthetic glyphs. | trivial |

The engine is shaper-agnostic. Consumers pick the backend by passing it
to `EditorConfig`.

### 9.5 Caching

`ShapedRun` is cacheable by `(text, computedStyle hash)`. Cache lives on
text-node-keyed render nodes. Invalidates when text or relevant style
fields (font-family, font-size, font-weight, font-style, font-variant,
font-feature-settings, lang, direction) change. Typing inside a span
reuses ShapedRuns for unchanged spans.

### 9.6 Bidi (RTL) end-to-end

Pulled forward from Plan 4. The shaper applies the Unicode Bidi Algorithm
to the paragraph and emits `bidiLevel` per cluster. The IFC then:

- Lays out clusters in logical order, advancing inline by `inlineAdvance`
  per cluster.
- At line-end, reorders clusters for visual display: lower bidi-level
  runs are visually-first; runs reverse direction at level boundaries.
- The painter receives visual-order clusters with final positions.

The `direction` Style property exists in Plans 1+2 (`Direction = "ltr" | "rtl"`).
Plan 3 fills in IFC and painter sides so RTL paragraphs render correctly.

### 9.7 Hyphenation interface reservation

Plan 3 declares the `BreakOpportunity.kind: "hyphen"` value but the canvas
backend does not produce them. The HarfBuzz backend (or a future
hyphenation-dictionary package) emits soft-hyphen opportunities; the IFC
inserts the hyphen glyph at line-end when a break of `kind: "hyphen"` is
chosen. This costs nothing now and prevents an interface break later.

### 9.8 Text-align reservation slot

The line-stable IFC ships with a no-op alignment pass between line
construction and physical-coord finalization. Plan 4 drops in
`textAlign: "start" | "end" | "center" | "justify"` logic without
touching IFC core.

### 9.9 Backwards-compat shim

Plans 1+2's `TextMeasurer.measureWidth(text, style)` becomes a thin
wrapper:

```ts
shape(text, style).clusters.reduce((s, c) => s + c.inlineAdvance, 0)
```

Tests that just need widths keep working through phase 3.A.

---

## 10. Phase order

Each phase keeps the test suite green at its end. Phases are sequential —
later phases assume earlier infrastructure.

### 10.A Logical-axis abstraction

- Rename Style schema to logical-only.
- Update every component, factory, test, example that sets physical
  properties.
- Add `WritingMode` and `Direction` threading through layout context.
- LayoutBox carries both logical and physical coords; physical derived
  per-box at finalization.
- Update painter and hit-test to read from logical+physical.
- Implement direction-aware logical→physical mapping for
  `horizontal-tb LTR` (identity) and `horizontal-tb RTL` (inline-axis
  mirrored — see §3.5). Vertical writing modes are not yet exposed.
- `float: inline-start | inline-end` resolves to the correct physical
  side based on direction (LTR: inline-start = left; RTL: inline-start =
  right).

This phase is the bulk of the file-touching surface. Done first to avoid
later phases re-touching the same files.

### 10.B Value resolution

- Introduce `ComputedStyle` and `UsedStyle` distinction.
- Layout-time `%` and `em` resolution.
- `flattenLengths` deleted from cascade pass; lengths stay in their
  computed form (px or symbolic) until layout consumes them.
- F7.6 hardcoded em-fallback removed.
- F5.1–5.3 length-handling type unsafety eliminated by typed `Length`,
  `ComputedLength`, `UsedLength` distinctions.

### 10.C TextShaper expansion

- New `TextShaper` interface with `ShapedRun`, `Cluster`,
  `BreakOpportunity`, `FontMetrics`.
- Replace `TextMeasurer` consumption sites; add backwards-compat shim.
- Implement `@taleweaver/shaper-canvas` (default).
- Implement `@taleweaver/shaper-mock` (tests).
- Add bidi level emission (canvas backend uses simple LTR detection;
  HarfBuzz backend in a separate package can do real Unicode Bidi).

### 10.D Intrinsic sizing

- Two-traversal layout function (`layoutBox` and
  `computeIntrinsicSizes`).
- Per-render-node intrinsic-size cache keyed by ComputedStyle.
- Style schema: `inlineSize`, `blockSize`, `min`/`max` accept
  `"min-content"`, `"max-content"`, `"fit-content"`.
- BFC consults intrinsic sizing for inline-block, float, table-cell
  shrink-to-fit.
- IFC produces inline content's intrinsic sizes.
- Table FC consumes per-cell intrinsic sizes for auto-layout columns.

### 10.E Anonymous box generation

- `groupChildren()` helper at top of `layoutBlock` and `layoutTable`.
- BFC dispatches one IFC per inline run; block children dispatch normally.
- Table FC inserts anonymous row / row-group / cell when missing.
- Anonymous boxes inherit from parent; layout properties zero.
- Positional keying for incremental cache.

### 10.F Real floats

- Replace `FloatContext` with `FloatEnvironment` implementing the
  interface in §6.3.
- Full CSS 9.5.1 placement rules.
- BFC establishment logic: `overflow ∈ {hidden, auto, scroll, clip}`,
  `display: flow-root`, floated boxes themselves, abspos, inline-blocks,
  table cells.
- IFC↔BFC integration fix: pass parent BFC's `FloatEnvironment` through
  layout context (followups F.2 / F.3 closed).
- Below-min-content line push.
- Clearance with margin-collapse interaction.

### 10.G Line-stable IFC

- Token stream with stable IDs from `(state-node-key, offset-within-node)`.
- Convergence detection algorithm.
- Float-environment dirty-block-offset awareness.
- Reference-equality test suite for incremental wrap.
- Reserve `text-wrap: balance | pretty | stable` schema values (treated
  as `wrap`).

### 10.H Incremental layout

- Layout boxes positioned parent-relative.
- Painter, hit-test, selection-geometry walk tree accumulating offsets.
- Subtree-granularity reuse based on the input table in §8.2.
- Fragmentation key extension to `(renderNodeKey, fragmentIndex, anonIndex)`.
- Reference-equality test suite for incremental layout.

### 10.I Paint incremental

- Per-box paint-input hash.
- Dirty-region tracking.
- Layered canvas (per page or per viewport).
- Reference-equality test suite for paint reuse.

### 10.J Test rewrite & cleanup

- Convert physical-coord tests to logical.
- Restore tests deleted in Plan 1 G.x where they're now meaningful.
- Add reference-equality tests for incremental machinery.
- Close out absorbed Plan 1 followups; update the followups doc.

---

## 11. Migration & breaking changes

### 11.1 Style schema changes (10.A)

Every Plan 1+2 file that sets a physical Style property updates. Search-
and-replace handles the bulk; a few cases need manual review (e.g.,
`marginLeft` vs `marginInlineStart` in RTL contexts — but RTL is new in
Plan 3, so today's `marginLeft` is unambiguously `marginInlineStart`).

Files affected:
- `packages/core/src/styles/*` — schema definitions.
- `packages/core/src/components/*` — every component sets margins/padding.
- `packages/core/src/state/*` — initial state may set styles.
- `packages/core/src/layout/*.test.ts` — every layout test asserts on
  physical positions; rewrite to logical assertions.
- `packages/dom/src/*` — painter consumes physical, derived from logical.
- `packages/react/src/*` — minimal touch (renders engine output).
- `examples/react/src/*` — toolbar / menu / doc setup.

### 11.2 LayoutBox positions (10.H)

Today some positions are document-absolute (set via incoming `(x, y)`
parameters); some are parent-relative. Plan 3 makes all parent-relative.
The painter, hit-test, selection-geometry, and any consumers of layout
position need an update to walk the tree accumulating offsets.

### 11.3 TextMeasurer → TextShaper (10.C)

Backwards-compat shim is in place during the transition (`measureWidth`
delegates to `shape`). Tests using the mock measurer keep working until
they're rewritten to assert on cluster-level output.

### 11.4 No external consumers

Per the original spec (§9.2), there are no external consumers; the
redesign is free to break everything. Plan 3 takes full advantage.

---

## 12. Test strategy

- **Unit tests per algorithm.** Each FC, the cascade pass, intrinsic
  sizing, anonymous box generation, float environment, IFC, fragmenter
  (Plan 5), painter all get their own unit tests. Aim for fine-grained
  coverage of CSS-spec rules.
- **Reference-equality tests for incremental machinery.** A dedicated
  suite per phase (cascade in 10.B, layout in 10.H, paint in 10.I) that
  asserts ref-equal subtrees outside the affected range under each edit
  type.
- **Integration tests per scenario.** End-to-end pipeline tests for
  representative documents: a paragraph with floats and inline-blocks,
  a table with merged cells (Plan 6 surface) + auto column widths, a
  list with nested counters, a paginated document (Plan 5 surface).
- **CSS conformance subset.** A small suite of tests derived from the
  CSS specs we implement: CSS 2.1 §9 (visual formatting), §10 (sizes),
  §16 (text-decoration), CSS Writing Modes 3, CSS Sizing 3 intrinsic
  sizing, CSS Floats 1. Pass rate is a measurable metric.
- **Visual regression tests.** Headless canvas rendering of representative
  documents, compared against approved PNGs. Catches paint regressions
  the unit suite misses.
- **Performance tests.** Latency benchmarks per edit type at document
  sizes 1, 10, 100 pages. Target: O(visible page area) per keystroke.

---

## 13. What's deferred to later plans

| Topic | Plan |
|---|---|
| `text-align: start \| end \| center \| justify` (logic; Plan 3 reserves the IFC slot) | 4 |
| `text-indent`, `vertical-align` (sub/super), `letter-spacing`, `word-spacing`, `text-decoration` (full), `text-transform` | 4 |
| `hyphens: auto` (algorithm; Plan 3 reserves the shaper interface) | 4 |
| `font-feature-settings`, `font-variant` | 4 |
| `writing-mode: vertical-rl \| vertical-lr` (logical-axis foundation in 3.A; activation later) | 4 |
| Pagination, fragmentation, page templates, running headers/footers, footnotes, section breaks, generated content | 5 (supersedes the original Plan 3) |
| Backgrounds (full), borders (full + radius), box-shadow, opacity | 6 |
| Tables: merged cells (rowspan/colspan), auto column widths driven by intrinsic sizing, vertical-align in table-cells, border-collapse with conflict resolution, repeating header rows | 6 |
| Lists: multi-level counter scoping, `::marker` styling, hanging indent | 6 |
| `position: relative \| absolute`, transforms, multi-column | 7 |
| Tab stops, hyperlinks, comments / annotations layer, change tracking, cross-references / bookmarks, spell-check decoration layer | 8 |

---

## 14. Open implementation questions

- **Hashing for `computedStylesEqual`.** Today's Plan 2 implementation
  walks the structure value-by-value. For 100-page docs with cache hits
  on every keystroke, this becomes the bottleneck. An option: precomputed
  content-hash on each `ComputedStyle` at cascade time. Decision deferred
  to phase 10.B.
- **`UsedStyle` storage layout.** A 2 MB doc with 50K boxes carrying
  parallel `ComputedStyle` and `UsedStyle` objects has memory pressure.
  Options: (a) flat parallel arrays of fields, (b) `ComputedStyle` shared
  by reference across many boxes, `UsedStyle` allocated only for fields
  that differ from computed. Decision deferred.
- **Float environment serialization.** For incremental layout, we compare
  `FloatEnvironment.dirtyBlockOffsetSince(prev)`. Implementation: track
  highest-changed block-offset on each mutation, compare integers. Trivial
  but flag for the implementer.
- **Bidi paragraph boundary.** Unicode bidi runs at "paragraph" granularity.
  In our state tree, a paragraph corresponds to a `display: block` with
  inline children. The IFC delimits paragraphs; the shaper takes paragraph
  text as input. Confirm in 10.C that the API takes paragraph-sized
  arguments not span-sized.
- **Multi-shaper per-document.** A document with mixed scripts may want
  HarfBuzz for Arabic text and canvas for Latin (perf trade-off). Decision:
  v1 uses one shaper per document; per-script dispatch is a future
  refinement.

---

## 15. Success criteria

Plan 3 lands cleanly when:

1. All 9 phases complete with green test suites at each phase boundary.
2. Reference-equality test suites pass for cascade, layout, and paint
   incrementality.
3. Plan 1 followups F4.x, F5.1–5.3, F7.6, F-1.x are closed.
4. The followups document is updated to reflect what was absorbed and
   what remains.
5. Performance benchmarks show O(visible page area) keystroke latency at
   100-page documents.
6. CSS conformance subset (the spec rules implemented in this plan) passes.
7. Example app boots and renders a representative rich document
   (mixed paragraphs, lists, tables with auto columns, floats with
   text-wrap, inline-blocks, RTL paragraph) with no visual regression
   from Plans 1+2 plus the new behaviors enabled.
8. Plans 4–8 can be designed against the Plan 3 foundation without
   re-architecting any of it.
