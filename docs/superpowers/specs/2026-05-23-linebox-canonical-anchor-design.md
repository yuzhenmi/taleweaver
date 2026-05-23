# LineBox as canonical line-level anchor — design

> Spec for the E-E refactor in
> `docs/superpowers/plans/2026-05-23-editor-cursor-module-cleanup-plan.md`.
> Closes issue #172. Dissolves audit items E-A5, E-A9, E-A10, E-A11, D3,
> and #202.

## Problem

Today the geometry layer is **text-run-driven**: line identity, line
ownership, and line offset ranges are all reconstructed at query time
by flattening the layout tree to its leaf `TextRunBox`es and grouping
by absolute Y coordinate. Five consumers reconstruct the same flat
list:

- `cursor/hit-test.ts` (pixel → Position)
- `cursor/cursor-position.ts` (Position → pixel)
- `cursor/selection-geometry.ts` (Span → SelectionRect[])
- `cursor/line-navigation.ts` (ArrowUp / Down, Home / End)
- (indirectly via the four above) any consumer of `PixelPosition.lineY`

This produces a cluster of related issues:

1. **Synthetic-strut machinery (E-A10).** Empty paragraphs have no
   real text-runs. To make hit-test, selection-rect, and line
   navigation work on empty lines, `collectAllTextBoxes` emits one
   synthetic `AbsoluteTextBox` per empty LineBox carrying the line's
   geometry and a fake `${lineKey}:strut` key. Five consumers each
   special-case `entry.synthetic`. Recent bug fixes (`0cf2f40`,
   `#168`, `#169`, `#173`, `#201`) all touched this machinery.

2. **Float-Y line-equality fragility (E-A11).** Line identity is the
   pair `(pageIndex, absoluteY)`. Line navigation and selection-rect
   detect "same line" via float-Y comparison with a 0.5 px tolerance
   at line transitions. Sub-pixel layout rounding can corrupt
   identity.

3. **Per-click O(N) walks (E-A5, E-A6).** Every geometry call rewalks
   the full layout tree. `collectAllTextBoxes` + `buildLineEdgeMaps`
   + `collectPageLines` + `collectBlockBoundaryLines` together touch
   every text-run + LineBox once per query. E-D made hit-test's
   prefix-offset accumulator O(1), but the underlying collection is
   still O(N).

4. **Layering inversion (E-A9).** `cursor/*` imports `editor/layout-
   utils.ts` because that's where the flatten helpers live — but the
   only reason they live in `editor/` is historical. The new
   architecture moves line-level identity into the layout primitive
   itself, so the cursor layer can consume `LineBox`es directly
   without a flatten helper.

5. **Block-boundary detection band-aid (D3).** `collectBlockBoundaryLines`
   walks the tree to mark which (pageIndex, lineY) pairs are the LAST
   line of a paragraph. That's only because LineBoxes don't carry
   their position-in-block. In a LineBox-canonical model the IFC
   knows when it's emitting the last line — it can stamp the LineBox
   directly.

6. **Strut-detection misfire on inline-block-only lines (#202).** The
   synthetic-strut emitter checks `box.children` for any text-run; if
   a line has only inline-block children (no text-runs), it
   mis-fires. A LineBox that knows its own offset range never has
   this ambiguity.

The underlying cause is the same in all six: **line identity, line
ownership, and line offset range are derivable from the layout tree
but require an O(N) reconstruction**. They should be intrinsic to the
`LineBox` itself.

## Target architecture

### `LineBox` carries its own anchor data

Extend `LineBox` in `packages/core/src/layout/layout-box-v2.ts`:

```ts
export interface LineBox extends LayoutBoxBase {
  readonly type: "line";
  readonly children: readonly LayoutBox[];
  readonly baseline: number;
  readonly endsWithHyphenContinuation?: boolean;

  // NEW — LineBox-canonical fields:

  /**
   * The block whose IFC produced this line. Stamped by the IFC at
   * line-emit time.
   */
  readonly ownerBlockId: BlockId;

  /**
   * Inline-content offset (UTF-16 code units, summed across the
   * block's text + embed items) of the FIRST character on this line.
   * For an empty line, equal to `inlineOffsetEnd` (the line covers
   * zero characters; its only valid cursor position is this offset).
   */
  readonly inlineOffsetStart: number;

  /**
   * Inline-content offset just past the LAST character on this line.
   * For a line that does not end with a hard break, this is the same
   * as the next line's `inlineOffsetStart`. For the final line of a
   * block, this is `inlineContentLength(block.inlineContent)`.
   */
  readonly inlineOffsetEnd: number;

  /**
   * True iff this is the LAST line of its `ownerBlockId`'s IFC. Used
   * by selection-rect emission to draw the paragraph-break indicator
   * after the line. Replaces the band-aid
   * `collectBlockBoundaryLines` traversal.
   *
   * A symmetric `isFirstLineOfBlock` is intentionally NOT added — it
   * is trivially derivable as `inlineOffsetStart === 0`, and no
   * current consumer needs O(1) access to "is this the first line of
   * its block." Selection-rect emission for the first line uses the
   * computed `startPos.x` to anchor the rect; no per-LineBox lookup
   * is needed.
   */
  readonly isBlockBoundaryLine: boolean;
}
```

`createLineBox` factory gains four required positional args (or
becomes an options-object factory). IFC call sites stamp the values
explicitly.

### Three LineBox factories must thread the new fields

LineBoxes are constructed in three places in `layout/`. ALL three
must thread the new fields:

1. **`createLineBox`** (`layout-box-v2.ts`) — the primary factory.
   IFC's wrap pass calls this when emitting a freshly-wrapped line.
   The new fields are stamped here.
2. **`rebuildBoxWithOffsets`** (`layout-box-v2.ts`, the `"line"`
   case) — used by `withInlineOffset` / `withBlockOffset` /
   `withOffsets` helpers. Currently passes positional args:
   `(key, inlineOffset, blockOffset, ..., children, baseline,
   containingInlineSize, endsWithHyphenContinuation)`. After E-E.1
   it must also pass through `ownerBlockId`, `inlineOffsetStart`,
   `inlineOffsetEnd`, `isBlockBoundaryLine` from the source box.
   Called by `reorderLineForBidi` (every RTL line) and any future
   float-placement repositioning of lines.
3. **`rebaseLine`** (`ifc.ts`, inside the fragmentation path,
   currently around the line "function rebaseLine(line: LineBox,
   newBlockOffset: number): LineBox"). Re-creates a LineBox with
   a new `blockOffset` when resuming after a page break. Today it
   reconstructs via `createLineBox` and drops everything not
   passed. After E-E.1 it must thread the new fields.

A fourth site, **`assignFragmentEdges`** (`ifc.ts`), uses an
`Object.freeze({ ...line, children: ... })` spread rather than
`createLineBox`. The spread naturally propagates the new fields
(they're enumerable own-properties on the source LineBox). This is
correct as-is — but E-E.1 should add an explicit comment confirming
the spread covers the new fields, so future maintainers don't
"helpfully" route this through `createLineBox` and lose them.

### IFC cache-hit path naturally preserves the new fields

`ifc.ts` has an incremental-wrap cache (around `prevState.lines`
return path) that returns the cached LineBoxes directly when tokens
and `availableInlineSize` are unchanged. Cached LineBoxes were
stamped with the new fields on initial construction; the cache-hit
path returns them as-is. No re-stamping needed — the new fields are
stable across reuse (they're purely derived from the block's
content, which the cache-hit condition just verified is unchanged).

E-E.1 must include a test that the cache-hit path returns lines
with the same `ownerBlockId / inlineOffsetStart / End /
isBlockBoundaryLine` values as the equivalent cache-miss path.

### IFC stamps the new fields at line-emit time

The IFC (`packages/core/src/layout/ifc.ts`) is the only LineBox
producer (modulo BFC's invocation of it). At line-emit time the IFC
already knows:
- the source block being processed (passed in as the BFC's current
  block) → `ownerBlockId`
- the current cursor in the block's inline-content stream →
  `inlineOffsetStart` of the line about to emit
- the cursor after consuming this line's content →
  `inlineOffsetEnd`
- whether the line is the last in the block (loop-termination signal)
  → `isBlockBoundaryLine`

The wiring is small: thread three accumulators through the wrap-pass
loop, stamp them on the constructed LineBox, mark
`isBlockBoundaryLine` on the final emission of each block's IFC.

#### Offset accumulator semantics

`inlineOffsetStart` and `inlineOffsetEnd` describe **logical
state-model offsets** within the owning block's `inlineContent`
(consistent with `state/block-position.ts`'s `Position.offset`
semantic — UTF-16 code units across text items, plus 1 per embed
item).

The IFC's wrap pass consumes tokens produced by
`collectInlineTokens`. Each token contributes to the offset
accumulator as follows:

- **Text tokens** (regular text, including spaces emitted as
  `isSpace: true`): contribute `token.text.length` units. The
  tokenizer splits a source text item's text into spaces and
  non-space segments; their concatenated lengths equal the source
  item's text length, matching the state model exactly.
- **Inline-block tokens** (representing an embed item from the
  state's `inlineContent`): contribute exactly **1** unit. This
  matches the state-model rule that each embed counts as one
  cursor position. The token carries `text: ""` and a populated
  `inlineBlock` field; the IFC distinguishes embeds from text via
  `token.inlineBlock !== undefined`.
- **Explicit line-break tokens** (`isLineBreak: true`): if the
  source representation is a literal `\n` inside a text item's
  text, the `\n` is already counted via the text token's
  `text.length`. If a future token type emits a non-textual
  hard-break, its contribution is defined when that token is
  introduced.

The IFC maintains a single `cursor: number` accumulator
initialized to 0 at the start of the block's wrap pass, advanced
per token consumed. At line-emit time:
- `line.inlineOffsetStart` = the accumulator's value when the
  line's first token began being consumed.
- `line.inlineOffsetEnd` = the accumulator's value after the
  line's last consumed token.

#### Trailing-space treatment on soft-wrapped lines

A soft wrap occurring at a word boundary leaves the trailing space
token logically attached to one of the two lines. The convention is
that **`nextLine.inlineOffsetStart === currentLine.inlineOffsetEnd`
always** — the line boundary is at the same offset on both sides,
with no gaps. Whichever line consumed the space token via the
wrap-pass logic owns the offset advance; the other line picks up
exactly where the first stopped. This invariant makes
`moveToLineBoundary("end")` simple: it returns
`(line.ownerBlockId, line.inlineOffsetEnd)` with no special
handling for the soft-wrap edge (the previous implementation's
"step back one grapheme cluster" defense is no longer needed and
can be deleted).

The existing wrap-pass behavior — which token (and therefore which
offset advance) lands on which line — is preserved by E-E.1; only
the accumulator is added. End-to-end cursor positions reachable by
clicking on each line are unchanged.

### Geometry queries walk LineBoxes directly

Replace `collectAllTextBoxes` (returning `AbsoluteTextBox[]` keyed by
absolute Y) with `collectLineBoxes` (returning `AbsoluteLineBox[]`).

```ts
interface AbsoluteLineBox {
  readonly line: LineBox;
  readonly absoluteX: number;
  readonly absoluteY: number;
  readonly pageIndex: number;
}

function collectLineBoxes(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  out: AbsoluteLineBox[],
  pageIndex?: number,
): void;
```

Hit-test, cursor-position, selection-geometry, and line-navigation
all switch to consuming `AbsoluteLineBox[]`. The text-run flatten
helper remains useful for **within-line** X measurement (binary
search over text-runs' inline-offsets to find the run containing the
click X, then `findCharOffset` within that run) but is now a private
helper inside the cursor module, not a public flatten of the entire
tree.

### Identity becomes the LineBox reference

The current `(pageIndex, absoluteY)` line key is replaced by the
LineBox reference itself (or its `key` string when a map is needed —
the layout key is stable per layout pass). The float-Y equality
fragility dissolves: two LineBoxes are the same line iff
`a.line === b.line` (or `a.line.key === b.line.key`).

### Synthetic struts dissolve

`makeSyntheticStrutEntry` and the `synthetic` field on
`AbsoluteTextBox` go away. An empty LineBox is a first-class
`AbsoluteLineBox`. Hit-test on an empty line returns `{ blockId:
line.ownerBlockId, offset: line.inlineOffsetStart }`. Selection-rect
emission for an empty line in a multi-line selection draws the
narrow paragraph-break indicator (using
`line.isBlockBoundaryLine === true` instead of the
`collectBlockBoundaryLines` traversal).

### `editor/layout-utils.ts` → `cursor/line-flatten.ts`

The flatten helpers move out of `editor/` (closing the layering
inversion E-A9). They become private cursor-internals; nothing in
`editor/actions/*` imports them after the migration.

## Migration sequence

Each task ends with reviewer-until-clean per the standing rule.

### E-E.1 — Add fields to `LineBox`, update IFC to stamp them.

- Extend `LineBox` interface with `ownerBlockId`, `inlineOffsetStart`,
  `inlineOffsetEnd`, `isBlockBoundaryLine`.
- Update `createLineBox` factory signature.
- Update the IFC wrap pass to maintain the per-block offset
  accumulator (per the "Offset accumulator semantics" section
  above) and stamp the new fields at line-emit time.
- Update `rebuildBoxWithOffsets` (the `"line"` case) to thread the
  new fields from the source LineBox to the rebuilt one.
- Update `rebaseLine` (in `ifc.ts`'s fragmentation path) to thread
  the new fields.
- Verify (and add an explicit comment confirming) that
  `assignFragmentEdges`'s `Object.freeze({ ...line, children: ... })`
  spread correctly propagates the new fields.
- Verify the IFC cache-hit path returns lines with the new fields
  populated identically to the cache-miss path. Add a test.
- Add layout-pass-level tests asserting the new fields are correctly
  populated across: single-line block, multi-line wrapped block
  (covers trailing-space invariant), empty paragraph, block with
  embed items (covers the +1 contribution rule), block fragmented
  across pages (covers `rebaseLine` and cross-page offset
  continuity), RTL block (covers `rebuildBoxWithOffsets` via
  bidi-reorder).
- Build clean. Existing tests stay green (the new fields are
  additive at this point; consumers still use the text-run-driven
  path).

### E-E.2 — Introduce `collectLineBoxes` + `AbsoluteLineBox`.

- New file `packages/core/src/cursor/line-flatten.ts` (per the
  layering-inversion fix; cursor owns its own flatten).
- Export `AbsoluteLineBox` interface + `collectLineBoxes` function.
- Add tests asserting collection traverses correctly across pages,
  inline-blocks, table cells.
- No consumer migration yet.

### E-E.3 — Migrate `hit-test.ts` to LineBox-canonical.

- Rewrite `resolvePositionFromPixel` to descend `AbsoluteLineBox[]`:
  - Find the LineBox containing `y` (by line absoluteY + blockSize).
  - Within the line, walk children to find the text-run containing
    `x`. Use `findCharOffset` for char-precision.
  - Return `{ blockId: line.ownerBlockId,
    offset: line.inlineOffsetStart + offsetWithinLine }` where
    `offsetWithinLine` is the text-run's inline-offset-within-line
    plus the char offset within the run.
- Drop `parseInlineBoxKey` calls. Drop the synthetic-line fallback
  branch (replaced by first-class empty LineBox handling).
- All existing hit-test tests must stay green.

### E-E.4 — Migrate `cursor-position.ts` to LineBox-canonical.

- Rewrite `resolvePixelPosition` to find the containing LineBox for
  a `Position` (binary-search `AbsoluteLineBox[]` for the LineBox
  whose `(ownerBlockId, inlineOffsetStart..inlineOffsetEnd)`
  contains the position), then measure within-line prefix to derive
  X.
- Empty-block case becomes trivial: the block's single LineBox is
  the anchor; cursor X = lineBox.absoluteX (or +indent / +leading
  margin as styles dictate).
- Existing cursor-position tests stay green.

### E-E.5 — Migrate `selection-geometry.ts` to LineBox-canonical.

- Rewrite `computeSelectionRects` to identify `startLine` and
  `endLine` (the `AbsoluteLineBox` containing each endpoint), then
  iterate `AbsoluteLineBox[]` between them. Line edges come from
  the LineBox's geometry, not from rebuilt `lineEdgeMap`.
- `isBlockBoundaryLine` flag replaces `collectBlockBoundaryLines`.
  Delete the latter from `editor/layout-utils.ts`.
- Existing selection-geometry tests stay green (this is the largest
  test file; ~400 lines per audit estimate).

### E-E.6 — Migrate `line-navigation.ts` to LineBox-canonical.

- Rewrite `moveToLine` (Up / Down) to walk `AbsoluteLineBox[]` in
  document order and pick the adjacent line.
- Rewrite `moveToLineBoundary` (Home / End) to use the current
  LineBox's `inlineOffsetStart` / `inlineOffsetEnd`. The
  soft-wrap-edge back-up case dissolves (we're staying within one
  LineBox by construction).
- The cross-block defense gap (E-A15 carved out as task #212) is
  resolved here too — the new logic naturally returns
  `(line.ownerBlockId, line.inlineOffsetEnd)` for End.
- Existing line-navigation tests stay green.

### E-E.7 — Remove synthetic-strut machinery + retire `editor/layout-utils.ts`.

- Delete `makeSyntheticStrutEntry`, the `synthetic` field on
  `AbsoluteTextBox`, and the `text-run`-emit branch's strut-creation
  block.
- Move any still-needed flatten helpers to `cursor/line-flatten.ts`.
- Delete `editor/layout-utils.ts` (or shrink it to just any helpers
  the editor reducer still needs — currently none after this
  migration).
- Update `1-core/overview.md` to remove `editor/layout-utils.ts`
  references; add `cursor/line-flatten.ts`.
- Update `docs/architecture/1-core/1.7-editor.md` per the new
  shape (mark synthetic-strut `[implemented]` → removed; mark hit-
  test / cursor-position / selection-geometry / line-navigation as
  `[implemented]` against the LineBox-canonical target).
- All test suites green.

## Risk table

| Risk | Likelihood | Mitigation |
|---|---|---|
| Embed items skew `inlineOffsetEnd` calculation in the IFC. Embeds count as 1 character per the state model — IFC must remember this. | Medium | Add IFC test asserting offsets across mixed text + embed inline content. |
| Table cells and inline-blocks have their own IFCs that produce LineBoxes. `ownerBlockId` for those LineBoxes must be the inline-bearing leaf BLOCK inside the cell / inline-block, not the cell / inline-block itself (containers have no inlineContent). | Medium | The IFC always knows which block it's running for; the stamp is unambiguous. Add a fixture test with a table containing a multi-line cell. |
| Float-Y line identity removal changes line-navigation semantics in edge cases where two visually-adjacent lines have identical Y (e.g., floats clearing). The new model uses LineBox reference identity — these cases get distinct identity automatically. | Low | Add a regression test fixture with a float clearing into a same-Y position. |
| Multi-page fragmentation: a paragraph fragmenting across pages produces N LineBoxes (some on page i, others on page i+1). Their `inlineOffsetStart` / `End` must continue across pages. | Medium | The IFC processes the block once; offsets continue naturally. Add a fixture test asserting cross-page offsets. |
| Existing tests assert on `AbsoluteTextBox` shape / `synthetic` / `lineKey` strings — need updating. | High | Each task includes a "update affected tests" sub-step; budget ~30% of task effort for tests. |
| Hidden consumer reads `synthetic` field (e.g., dom/paint). | Low | `grep -rn synthetic packages/` after the schema change; only the cursor module uses it. |
| Existing `PixelPosition.lineY` semantics depend on `absoluteY` matching across queries (float-Y identity assumption). Consumers (e.g., the DOM controller's selection-rect painter) may break if we change `lineY` semantics. | Low | Keep `PixelPosition.lineY` populated as `line.absoluteY`; the field still works as a paint coordinate even when identity moves to LineBox refs. |

## Test strategy

Each task includes:
1. New unit tests on the changed primitive (e.g., E-E.1 adds layout-
   pass tests for the new LineBox fields).
2. The existing integration tests in `hit-test.test.ts`,
   `cursor-position.test.ts`, `selection-geometry.test.ts`,
   `line-navigation.test.ts` MUST stay green after each task. They
   assert end-to-end behavior (returned positions / rects) and are
   the canary that the refactor preserves observable semantics.
3. Browser smoke pass after E-E.7 (per CLAUDE.md "Browser smoke test
   for UI work" — unit tests assert structure, only the browser
   exercises pixel coordinates).

## Out of scope

- **Incremental layout (R-D / L-E).** The new LineBox-canonical model
  makes incremental geometry easier (line-level invalidation is now
  meaningful), but wiring incremental is a separate task.
- **Multi-column layout.** LineBox-canonical is independent of column
  layout. Multi-column is a future workpiece.
- **Vertical writing-mode hit-test.** The current model already
  abstracts X/Y as inline/block axes via `LayoutBoxBase.writingMode`.
  The migration preserves this; vertical-WM correctness is unchanged.

## Closes

- `#172` (LineBox-canonical refactor, root issue).
- E-A9 (cursor → editor layering inversion).
- E-A10 (synthetic-strut machinery).
- E-A11 (float-Y line equality fragility).
- D3 (`collectBlockBoundaryLines` becomes dead).
- `#202` (strut-detection misfire on inline-block-only lines).
- E-A15 (`moveToLineBoundary` cross-block back-up defense gap —
  resolved structurally in E-E.6, task #212).

**Partially addressed:** E-A5 (`collectAllTextBoxes` re-walks per
query). The new `collectLineBoxes` is still O(N) per query;
synthetic-strut handling and key-parsing overhead are eliminated
(meaningful constant-factor improvement), but full closure of E-A5
requires per-layout caching, carved out as a separate follow-up
once the LineBox-canonical migration lands.
